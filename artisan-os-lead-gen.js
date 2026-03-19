import axios from 'axios';
import * as cheerio from 'cheerio';
import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import createCsvWriter from 'csv-writer';

dotenv.config();

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const GOOGLE_DORKS = [
    'site:myshopify.com "handmade jewelry" USA',
    'site:myshopify.com "handcrafted pottery" United States',
    'site:myshopify.com "artisan candles" American',
    'site:myshopify.com "handmade ceramics" USA',
    'site:myshopify.com "leather goods" handcrafted USA',
    'site:myshopify.com "woodworking" artisan American',
    '"powered by shopify" "handmade in USA"',
    '"powered by shopify" "crafted in America" artisan'
];

// Load already-processed domains from previous runs
function loadProcessedDomains() {
    const processed = new Set();
    try {
        const files = fs.readdirSync('.').filter(f => f.startsWith('artisan_os_usa_leads_') && f.endsWith('.csv'));
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n').slice(1); // Skip header
            for (const line of lines) {
                const domain = line.split(',')[0];
                if (domain) processed.add(domain.trim());
            }
        }
        console.log(`📋 Loaded ${processed.size} already-processed domains from previous runs`);
    } catch (e) { }
    return processed;
}

async function runGoogleDorks() {
    console.log('🔎 STEP 1: Running Google Dorks to Find USA Artisan Shopify Stores...');

    try {
        const run = await client.actor('apify/google-search-scraper').call({
            queries: GOOGLE_DORKS.join('\n'),
            maxPagesPerQuery: 2,
            resultsPerPage: 100,
            mobileResults: false,
            gl: 'us',
            hl: 'en'
        });

        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        console.log(`✅ Retrieved ${items.length} search result pages`);

        const domains = new Set();
        items.forEach(page => {
            if (page.organicResults) {
                page.organicResults.forEach(result => {
                    try {
                        const url = new URL(result.url);
                        let domain = url.hostname.replace('www.', '');
                        if (!domain.includes('google.') && !domain.includes('facebook.') &&
                            !domain.includes('instagram.') && !domain.includes('pinterest.') &&
                            !domain.includes('etsy.') && !domain.includes('amazon.') &&
                            !domain.includes('youtube.') && !domain.includes('tiktok.')) {
                            domains.add(domain);
                        }
                    } catch (e) { }
                });
            }
        });

        console.log(`📊 Found ${domains.size} unique store domains`);
        return Array.from(domains);
    } catch (error) {
        console.error('❌ Google Dork failed:', error.message);
        return [];
    }
}

async function localScrapeAll(domains) {
    console.log(`\n🧵 STEP 2: Local Scrape for ${domains.length} domains...`);
    const results = {};

    for (const domain of domains) {
        const emails = new Set();
        const urls = [
            `https://${domain}`,
            `https://www.${domain}`,
            `https://${domain}/pages/contact`,
            `https://${domain}/pages/contact-us`
        ];

        for (const url of urls) {
            try {
                const res = await axios.get(url, {
                    timeout: 6000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
                });
                const html = res.data;
                const matches = html.match(EMAIL_REGEX);
                if (matches) matches.forEach(e => {
                    const low = e.toLowerCase();
                    if (!low.endsWith('.png') && !low.endsWith('.jpg') && !low.endsWith('.gif') &&
                        !low.endsWith('.js') && !low.endsWith('.css') && !low.includes('sentry') &&
                        !low.includes('example@') && !low.includes('your@')) {
                        emails.add(low);
                    }
                });
                const $ = cheerio.load(html);
                $('a[href^="mailto:"]').each((i, el) => {
                    const mail = $(el).attr('href').replace('mailto:', '').split('?')[0].trim();
                    if (mail && !mail.includes('example@') && !mail.includes('your@')) {
                        emails.add(mail.toLowerCase());
                    }
                });
                if (emails.size > 0) break;
            } catch (e) { }
        }

        results[domain] = Array.from(emails);
        process.stdout.write(`\r   Scraped ${Object.keys(results).length}/${domains.length}`);
    }
    console.log('\n   ✅ Local scrape complete');
    return results;
}

async function batchEnrichWithLeadsFinder(domains) {
    console.log(`\n📡 STEP 3: BATCH Apify Leads Finder for ${domains.length} domains (SINGLE API CALL)...`);

    const dbResults = {};

    try {
        // Call the actor ONCE with all domains
        const run = await client.actor('code_crafter/leads-finder').call({
            fetch_count: domains.length * 2, // Get 2 leads per domain max
            company_domain: domains,
            contact_job_title: ["Owner", "Founder", "CEO", "Marketing", "Creative Director"],
            has_email: true
        });

        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        console.log(`   ✅ Retrieved ${items.length} leads from database`);

        // Map results back to domains
        for (const lead of items) {
            // The actor returns company_domain or organization_domain
            const leadDomain = (lead.company_domain || lead.organization_domain || '').toLowerCase().replace('www.', '');

            // Find matching domain
            const matchedDomain = domains.find(d => d.includes(leadDomain) || leadDomain.includes(d.replace('.myshopify.com', '')));

            if (matchedDomain && lead.email) {
                if (!dbResults[matchedDomain]) {
                    dbResults[matchedDomain] = {
                        name: lead.full_name || lead.name || '',
                        email: lead.email,
                        title: lead.job_title || lead.title || '',
                        linkedin: lead.linkedin || lead.linkedin_url || ''
                    };
                }
            }
        }

        console.log(`   📊 Matched ${Object.keys(dbResults).length} domains to database leads`);
    } catch (error) {
        console.error('   ❌ Batch enrichment failed:', error.message);
    }

    return dbResults;
}

async function generateColdEmailList() {
    console.log('🚀 ARTISAN OS - USA COLD EMAIL LIST GENERATOR (OPTIMIZED)');
    console.log('=========================================================');
    console.log('✨ Batched Apify calls to save money');
    console.log('✨ Skipping already-processed domains');
    console.log('=========================================================\n');

    // Load already processed domains
    const processedDomains = loadProcessedDomains();

    // Step 1: Find stores via Google Dorking
    const allDomains = await runGoogleDorks();
    if (allDomains.length === 0) {
        console.log('❌ No domains found. Exiting.');
        return;
    }

    // Filter out already-processed domains
    const newDomains = allDomains.filter(d => !processedDomains.has(d));
    console.log(`\n� ${newDomains.length} new domains to process (${allDomains.length - newDomains.length} already done)`);

    if (newDomains.length === 0) {
        console.log('✅ All domains already processed!');
        return;
    }

    // Step 2: Local scrape all new domains
    const scrapedEmails = await localScrapeAll(newDomains);

    // Step 3: BATCH enrichment with Apify (ONE CALL for all domains)
    const dbLeads = await batchEnrichWithLeadsFinder(newDomains);

    // Step 4: Combine results
    const leads = newDomains.map(domain => {
        const scraped = scrapedEmails[domain] || [];
        const db = dbLeads[domain] || null;

        return {
            domain,
            scrapedEmails: scraped.join('; ') || 'NONE',
            dbName: db?.name || 'N/A',
            dbEmail: db?.email || 'N/A',
            dbTitle: db?.title || 'N/A',
            dbLinkedin: db?.linkedin || 'N/A',
            bestEmail: db?.email || scraped[0] || 'N/A',
            bestContact: db?.name || 'Store Owner'
        };
    });

    // Step 5: Save to CSV
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `artisan_os_usa_leads_${timestamp}.csv`;

    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: filename,
        header: [
            { id: 'domain', title: 'Store Domain' },
            { id: 'bestContact', title: 'Contact Name' },
            { id: 'bestEmail', title: 'Best Email' },
            { id: 'scrapedEmails', title: 'All Scraped Emails' },
            { id: 'dbName', title: 'DB Contact Name' },
            { id: 'dbEmail', title: 'DB Email' },
            { id: 'dbTitle', title: 'DB Title' },
            { id: 'dbLinkedin', title: 'LinkedIn' }
        ]
    });

    await csvWriter.writeRecords(leads);

    // Summary
    const withEmails = leads.filter(l => l.bestEmail !== 'N/A').length;
    const withDbContacts = leads.filter(l => l.dbEmail !== 'N/A').length;

    console.log('\n\n✅ COLD EMAIL LIST GENERATED (OPTIMIZED)');
    console.log('=========================================================');
    console.log(`📊 New Stores Processed: ${leads.length}`);
    console.log(`📧 Stores with Emails: ${withEmails}`);
    console.log(`👤 DB Contacts Found: ${withDbContacts}`);
    console.log(`💰 Apify Calls Made: 2 (1 Google, 1 Leads Finder)`);
    console.log(`📄 Saved to: ${filename}`);

    console.log('\n--- PREVIEW (first 15) ---');
    console.table(leads.slice(0, 15).map(l => ({
        Domain: l.domain.substring(0, 35),
        Contact: l.bestContact,
        Email: l.bestEmail
    })));
}

generateColdEmailList();
