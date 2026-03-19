import axios from 'axios';
import * as cheerio from 'cheerio';
import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import createCsvWriter from 'csv-writer';

dotenv.config();

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;

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

function loadProcessedDomains() {
    const processed = new Set();
    try {
        const files = fs.readdirSync('.').filter(f => f.startsWith('artisan_os_') && f.endsWith('.csv'));
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n').slice(1);
            for (const line of lines) {
                const domain = line.split(',')[0];
                if (domain) processed.add(domain.trim());
            }
        }
        console.log(`📋 Loaded ${processed.size} already-processed domains`);
    } catch (e) { }
    return processed;
}

async function runGoogleDorks() {
    console.log('🔎 STEP 1: Running Google Dorks...');

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

        // Extract domains WITH search context
        const domainData = new Map();

        items.forEach(page => {
            const searchQuery = page.searchQuery?.term || '';

            if (page.organicResults) {
                page.organicResults.forEach(result => {
                    try {
                        const url = new URL(result.url);
                        let domain = url.hostname.replace('www.', '');

                        if (!domain.includes('google.') && !domain.includes('facebook.') &&
                            !domain.includes('instagram.') && !domain.includes('pinterest.') &&
                            !domain.includes('etsy.') && !domain.includes('amazon.') &&
                            !domain.includes('youtube.') && !domain.includes('tiktok.')) {

                            if (!domainData.has(domain)) {
                                domainData.set(domain, {
                                    domain: domain,
                                    url: result.url,
                                    title: result.title || '',
                                    description: result.description || '',
                                    searchQuery: searchQuery,
                                    niche: extractNiche(searchQuery),
                                    country: 'USA' // All dorks target USA
                                });
                            }
                        }
                    } catch (e) { }
                });
            }
        });

        console.log(`📊 Found ${domainData.size} unique store domains with context`);
        return domainData;
    } catch (error) {
        console.error('❌ Google Dork failed:', error.message);
        return new Map();
    }
}

function extractNiche(searchQuery) {
    const query = searchQuery.toLowerCase();
    if (query.includes('jewelry')) return 'Handmade Jewelry';
    if (query.includes('pottery') || query.includes('ceramics')) return 'Pottery & Ceramics';
    if (query.includes('candles')) return 'Artisan Candles';
    if (query.includes('leather')) return 'Leather Goods';
    if (query.includes('woodworking')) return 'Woodworking';
    if (query.includes('handmade')) return 'Handmade Goods';
    return 'Artisan Products';
}

async function scrapeWebsiteData(domain, existingData) {
    const data = {
        ...existingData,
        companyName: '',
        phone: '',
        address: '',
        socialLinks: '',
        aboutText: '',
        allEmails: []
    };

    const urls = [
        `https://${domain}`,
        `https://www.${domain}`,
        `https://${domain}/pages/contact`,
        `https://${domain}/pages/about-us`
    ];

    for (const url of urls) {
        try {
            const res = await axios.get(url, {
                timeout: 8000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
            });
            const html = res.data;
            const $ = cheerio.load(html);

            // Extract company name from title or og:site_name
            if (!data.companyName) {
                data.companyName = $('meta[property="og:site_name"]').attr('content') ||
                    $('title').text().split('–')[0].split('|')[0].trim() || '';
            }

            // Extract emails
            const emailMatches = html.match(EMAIL_REGEX);
            if (emailMatches) {
                emailMatches.forEach(e => {
                    const low = e.toLowerCase();
                    if (!low.endsWith('.png') && !low.endsWith('.jpg') && !low.endsWith('.gif') &&
                        !low.endsWith('.js') && !low.endsWith('.css') && !low.includes('sentry') &&
                        !low.includes('example@') && !low.includes('your@')) {
                        data.allEmails.push(low);
                    }
                });
            }

            // Mailto links
            $('a[href^="mailto:"]').each((i, el) => {
                const mail = $(el).attr('href').replace('mailto:', '').split('?')[0].trim().toLowerCase();
                if (mail && !mail.includes('example@') && !mail.includes('your@')) {
                    data.allEmails.push(mail);
                }
            });

            // Extract phone numbers
            const phoneMatches = html.match(PHONE_REGEX);
            if (phoneMatches && !data.phone) {
                data.phone = phoneMatches[0];
            }

            // Extract social links
            const socials = [];
            $('a[href*="instagram.com"]').each((i, el) => socials.push($(el).attr('href')));
            $('a[href*="facebook.com"]').each((i, el) => socials.push($(el).attr('href')));
            $('a[href*="twitter.com"]').each((i, el) => socials.push($(el).attr('href')));
            $('a[href*="pinterest.com"]').each((i, el) => socials.push($(el).attr('href')));
            $('a[href*="tiktok.com"]').each((i, el) => socials.push($(el).attr('href')));
            if (socials.length > 0) {
                data.socialLinks = [...new Set(socials)].slice(0, 5).join(' | ');
            }

            // Extract about/description text
            if (!data.aboutText) {
                const aboutMeta = $('meta[name="description"]').attr('content') ||
                    $('meta[property="og:description"]').attr('content') || '';
                data.aboutText = aboutMeta.slice(0, 300);
            }

            if (data.allEmails.length > 0) break;
        } catch (e) { }
    }

    data.allEmails = [...new Set(data.allEmails)];
    return data;
}

async function batchEnrichWithLeadsFinder(domains) {
    console.log(`\n📡 STEP 3: BATCH Apify Leads Finder for ${domains.length} domains...`);

    const dbResults = {};

    try {
        const domainList = Array.from(domains);
        const run = await client.actor('code_crafter/leads-finder').call({
            fetch_count: domainList.length * 2,
            company_domain: domainList,
            contact_job_title: ["Owner", "Founder", "CEO", "Marketing", "Creative Director"],
            has_email: true
        });

        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        console.log(`   ✅ Retrieved ${items.length} leads from database`);

        for (const lead of items) {
            const leadDomain = (lead.company_domain || lead.organization_domain || '').toLowerCase().replace('www.', '');
            const matchedDomain = domainList.find(d => d.includes(leadDomain) || leadDomain.includes(d.replace('.myshopify.com', '')));

            if (matchedDomain && lead.email) {
                if (!dbResults[matchedDomain]) {
                    dbResults[matchedDomain] = {
                        contactName: lead.full_name || lead.name || '',
                        contactEmail: lead.email,
                        contactTitle: lead.job_title || lead.title || '',
                        contactLinkedin: lead.linkedin || lead.linkedin_url || '',
                        companyLinkedin: lead.company_linkedin || '',
                        companySize: lead.company_size || lead.employees || '',
                        companyIndustry: lead.industry || '',
                        companyLocation: lead.company_location || lead.location || ''
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

async function generateFullLeadList() {
    console.log('🚀 ARTISAN OS - FULL DATA LEAD GENERATOR');
    console.log('==========================================');
    console.log('Scraping: Company info, emails, phones, socials, niche');
    console.log('==========================================\n');

    const processedDomains = loadProcessedDomains();

    // Step 1: Get domains with search context
    const domainData = await runGoogleDorks();
    if (domainData.size === 0) {
        console.log('❌ No domains found.');
        return;
    }

    // Bypass "already processed" check to get FULL data for everyone
    const newDomains = domainData;
    console.log(`\n📋 Processing ${newDomains.size} domains for FULL DATA enrichment`);

    if (newDomains.size === 0) {
        console.log('✅ All domains already processed!');
        return;
    }

    // Step 2: Scrape each website for full data
    console.log(`\n🧵 STEP 2: Scraping ${newDomains.size} websites for full data...`);
    const scrapedData = new Map();
    let count = 0;

    for (const [domain, baseData] of newDomains) {
        count++;
        process.stdout.write(`\r   Scraping ${count}/${newDomains.size}: ${domain.slice(0, 40)}...`);
        const fullData = await scrapeWebsiteData(domain, baseData);
        scrapedData.set(domain, fullData);
    }
    console.log('\n   ✅ Website scrape complete');

    // Step 3: Batch enrich with Leads Finder
    const dbLeads = await batchEnrichWithLeadsFinder(Array.from(newDomains.keys()));

    // Step 4: Combine all data
    const leads = [];
    for (const [domain, data] of scrapedData) {
        const db = dbLeads[domain] || {};

        let fullName = db.contactName || 'Store Owner';
        let firstName = '';
        let lastName = '';

        if (fullName === 'Store Owner') {
            firstName = 'Store';
            lastName = 'Owner';
        } else {
            const parts = fullName.trim().split(/\s+/);
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
        }

        leads.push({
            domain: domain,
            companyName: data.companyName || data.title?.split('–')[0].trim() || domain.replace('.myshopify.com', ''),
            website: data.url || `https://${domain}`,
            niche: data.niche,
            country: data.country,
            description: data.aboutText || data.description || '',

            // Contact info
            firstName: firstName,
            lastName: lastName,
            contactTitle: db.contactTitle || '',
            contactEmail: db.contactEmail || data.allEmails[0] || 'N/A',
            contactLinkedin: db.contactLinkedin || '',

            // All scraped emails
            allEmails: data.allEmails.join('; ') || 'N/A',
            phone: data.phone || '',
            socialLinks: data.socialLinks || '',

            // Company enrichment
            companySize: db.companySize || '',
            companyLinkedin: db.companyLinkedin || '',
            companyIndustry: db.companyIndustry || data.niche,
            companyLocation: db.companyLocation || data.country,

            // Source info
            searchQuery: data.searchQuery || '',
            dataSource: db.contactEmail ? 'Apify + Scraped' : 'Scraped Only'
        });
    }

    // Save to CSV with ALL columns
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `COMMERIUM/artisan_os_split_names_${timestamp}.csv`;

    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: filename,
        header: [
            { id: 'domain', title: 'Domain' },
            { id: 'companyName', title: 'Company Name' },
            { id: 'website', title: 'Website' },
            { id: 'niche', title: 'Niche' },
            { id: 'country', title: 'Country' },
            { id: 'description', title: 'Description' },
            { id: 'firstName', title: 'First Name' },
            { id: 'lastName', title: 'Last Name' },
            { id: 'contactTitle', title: 'Contact Title' },
            { id: 'contactEmail', title: 'Contact Email' },
            { id: 'contactLinkedin', title: 'Contact LinkedIn' },
            { id: 'allEmails', title: 'All Scraped Emails' },
            { id: 'phone', title: 'Phone' },
            { id: 'socialLinks', title: 'Social Links' },
            { id: 'companySize', title: 'Company Size' },
            { id: 'companyLinkedin', title: 'Company LinkedIn' },
            { id: 'companyIndustry', title: 'Industry' },
            { id: 'companyLocation', title: 'Location' },
            { id: 'searchQuery', title: 'Found Via Query' },
            { id: 'dataSource', title: 'Data Source' }
        ]
    });

    await csvWriter.writeRecords(leads);

    // Final Summary
    console.log(`\n✅ FULL DATA LEAD LIST GENERATED`);
    console.log(`==========================================`);
    console.log(`📊 Total Leads: ${leads.length}`);
    console.log(`📧 With Emails: ${leads.filter(l => l.contactEmail !== 'N/A').length}`);
    console.log(`👤 With DB Contacts: ${leads.filter(l => l.firstName !== 'Store').length}`);
    console.log(`📞 With Phone: ${leads.filter(l => l.phone).length}`);
    console.log(`📱 With Socials: ${leads.filter(l => l.socialLinks).length}`);
    console.log(`📄 Saved to: ${filename}`);

    // Show a few samples
    console.log(`\n--- SAMPLE DATA ---`);
    if (leads.length > 0) {
        const sample = leads[0];
        console.log(`Company: ${sample.companyName}`);
        console.log(`Niche: ${sample.niche}`);
        console.log(`Contact: ${sample.firstName} ${sample.lastName} (${sample.contactEmail})`);
        console.log(`Phone: ${sample.phone || 'N/A'}`);
        console.log(`Socials: ${sample.socialLinks ? sample.socialLinks.split(' | ')[0] : 'N/A'}`);
    }
}

generateFullLeadList();
