import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import createCsvWriter from 'csv-writer';
import axios from 'axios';
import * as cheerio from 'cheerio';

dotenv.config();

// Quick check for api key
if (!process.env.APIFY_TOKEN) {
    console.error("APIFY_TOKEN not found in env!");
    process.exit(1);
}

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// 1. Segmentation / ICP
const SEGMENTS = {
    "Wholesale Crafters": [
        '"wholesale catalog" "home decor" filetype:pdf',
        '"trade account" producer "artisanal"'
    ],
    "Traditional Producers": [
        'intext:"delivery note" producer "olive oil" Spain',
        '"producer of" "specialty food" Italy contact',
        '"manufactured by" artisanal "contact us"'
    ],
    "Offline/Low-Tech Artisans": [
        'site:facebook.com "no website" "handmade jewelry"',
        '"price list" "ceramic studio" "email to order"'
    ]
};

async function scrapeWebsiteData(domain) {
    const data = { allEmails: [] };
    const urls = [`https://${domain}`, `https://www.${domain}`, `https://${domain}/contact`];
    for (const url of urls) {
        if (domain.includes('facebook') || domain.includes('instagram') || domain.includes('pinterest')) break;
        try {
            const res = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
            const html = res.data;
            const emailMatches = html.match(EMAIL_REGEX);
            if (emailMatches) {
                emailMatches.forEach(e => {
                    const low = e.toLowerCase();
                    // Filter out common false positives
                    if (!low.endsWith('.png') && !low.endsWith('.jpg') && !low.includes('sentry') && !low.includes('.css') && !low.includes('.js')) {
                        data.allEmails.push(low);
                    }
                });
            }
        } catch (e) { }
    }
    data.allEmails = [...new Set(data.allEmails)];
    return data;
}

async function runTest() {
    console.log("🚀 Starting B2B/Producer Pipeline Test");

    // 1. Run Dorks natively via Google Search Scraper
    let allDomains = [];
    const domainsData = new Map();

    for (const [segment, queries] of Object.entries(SEGMENTS)) {
        console.log(`\n🔎 Segment: ${segment}`);
        console.log(`   Running ${queries.length} queries...`);
        try {
            const run = await client.actor('apify/google-search-scraper').call({
                queries: queries.join('\n'),
                maxPagesPerQuery: 1,
                resultsPerPage: 20,
            });

            const { items } = await client.dataset(run.defaultDatasetId).listItems();

            items.forEach(page => {
                if (page.organicResults) {
                    page.organicResults.forEach(result => {
                        try {
                            const url = new URL(result.url);
                            let domain = url.hostname.replace('www.', '');
                            // Exclude giants
                            if (!domain.includes('google.') && !domain.includes('youtube.') && !domain.includes('amazon.')) {
                                if (!domainsData.has(domain)) {
                                    domainsData.set(domain, { domain, url: result.url, segment, query: page.searchQuery?.term });
                                    allDomains.push(domain);
                                }
                            }
                        } catch (e) { }
                    });
                }
            });
            console.log(`   ✅ Query complete. Gathered so far: ${domainsData.size} domains.`);
        } catch (err) {
            console.error(`❌ Error running search for ${segment}:`, err.message);
        }
    }

    // Test size: top 5 from each segment for a total of ~15
    const processedDomains = [];
    for (const segment of Object.keys(SEGMENTS)) {
        const segDomains = [...domainsData.values()].filter(d => d.segment === segment).slice(0, 5);
        processedDomains.push(...segDomains);
    }

    console.log(`\n📊 Found ${domainsData.size} raw domains total. Downselecting to ${processedDomains.length} domains for extraction...`);

    // 2. Apify leads finder batch execution
    const domainList = processedDomains.map(d => d.domain);
    const dbResults = {};

    console.log(`\n📡 Querying code_crafter/leads-finder for ${domainList.length} domains...`);
    try {
        const run = await client.actor('code_crafter/leads-finder').call({
            fetch_count: processedDomains.length * 2,
            company_domain: domainList,
            contact_job_title: ["Owner", "Founder", "CEO", "Sales", "Director", "Manager"],
            has_email: true
        });
        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        for (const lead of items) {
            const leadDomain = (lead.company_domain || '').toLowerCase().replace('www.', '');
            if (lead.email) {
                // simple matching since leads-finder might return full domain or base domain
                const matchedDomain = domainList.find(d => d.includes(leadDomain) || leadDomain.includes(d));
                if (matchedDomain && !dbResults[matchedDomain]) {
                    dbResults[matchedDomain] = {
                        name: lead.full_name || lead.name || '',
                        email: lead.email,
                        title: lead.job_title || lead.title || '',
                        linkedin: lead.linkedin || ''
                    };
                }
            }
        }
        console.log(`   ✅ Matched ${Object.keys(dbResults).length} domains to DB leads.`);
    } catch (err) {
        console.error('❌ Error in leads-finder:', err.message);
    }

    // 3. Local Scrape and Merge
    console.log(`\n🕸️  Locally scraping domains for generic emails...`);
    const finalLeads = [];
    for (const d of processedDomains) {
        // console.log(`   Scanning ${d.domain}...`);
        const siteData = await scrapeWebsiteData(d.domain);
        const dbLead = dbResults[d.domain] || {};

        // Find best email
        let priorityEmail = dbLead.email || siteData.allEmails[0] || '';
        if (priorityEmail.includes('.css') || priorityEmail.includes('.js')) priorityEmail = '';

        finalLeads.push({
            segment: d.segment,
            query: d.query,
            domain: d.domain,
            url: d.url,
            priorityEmail: priorityEmail,
            scrapedEmails: siteData.allEmails.join('; '),
            dbContact: dbLead.name || '',
            dbEmail: dbLead.email || '',
            dbTitle: dbLead.title || '',
            sourceType: dbLead.email ? 'Apify Apollo DB' : (siteData.allEmails.length > 0 ? 'Website Scrape' : 'No Email Found')
        });
    }

    // 4. Export
    const fileOut = 'COMMERIUM/b2b-producer-test-results.csv';
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: fileOut,
        header: [
            { id: 'segment', title: 'Segment / ICP' },
            { id: 'query', title: 'Google Dork Query' },
            { id: 'domain', title: 'Domain' },
            { id: 'priorityEmail', title: 'Best Target Email' },
            { id: 'sourceType', title: 'Lead Source' },
            { id: 'dbContact', title: 'DB Contact Name' },
            { id: 'dbTitle', title: 'DB Title' },
            { id: 'url', title: 'Found URL' },
            { id: 'scrapedEmails', title: 'All Local Scraped Emails' },
            { id: 'dbEmail', title: 'DB Email' }
        ]
    });

    await csvWriter.writeRecords(finalLeads);
    console.log(`\n✅ Test complete. ${finalLeads.length} leads saved to ${fileOut}`);

    // Print a quick summary inside terminal for you
    console.table(finalLeads.map(l => ({
        Segment: l.segment.substring(0, 15),
        Domain: l.domain,
        Email: l.priorityEmail,
        Source: l.sourceType
    })));
}

runTest();
