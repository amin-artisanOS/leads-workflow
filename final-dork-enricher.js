import axios from 'axios';
import * as cheerio from 'cheerio';
import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import createCsvWriter from 'csv-writer';

dotenv.config();

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const domains = [
    'jmillsstudio.com',
    'melrosia.com',
    'madisonwithlove.com',
    'estygrossman.com',
    'mettlebyabby.com',
    'hanaijewelry.com',
    'shop.stilosissima.com',
    'cadettejewelry.com'
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function localScrape(domain) {
    console.log(`\n🧵 [1/2] Local Scrape: ${domain}`);
    const emails = new Set();
    const urls = [
        `https://${domain}`,
        `https://www.${domain}`,
        `https://${domain}/pages/contact`,
        `https://${domain}/pages/contact-us`,
        `https://${domain}/pages/about`,
        `https://${domain}/pages/about-us`
    ];

    for (const url of urls) {
        try {
            const res = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
            const html = res.data;
            const matches = html.match(EMAIL_REGEX);
            if (matches) matches.forEach(e => {
                const low = e.toLowerCase();
                if (!low.endsWith('.png') && !low.endsWith('.jpg') && !low.includes('sentry')) emails.add(low);
            });
            const $ = cheerio.load(html);
            $('a[href^="mailto:"]').each((i, el) => {
                const mail = $(el).attr('href').replace('mailto:', '').split('?')[0].trim();
                if (mail) emails.add(mail.toLowerCase());
            });
            if (emails.size > 0) break; // If we found stuff on home/contact, stop early to save time
        } catch (e) { }
    }
    const found = Array.from(emails);
    console.log(`   └─ Found ${found.length} emails: ${found.join(', ') || 'None'}`);
    return found;
}

async function runEnrichment() {
    console.log('🚀 STARTING COMMAND-LINE DORK ENRICHMENT');
    console.log('ORDER: 1. LOCAL SCRAPE -> 2. ACTOR FALLBACK/UPGRADE');
    console.log('================================================');

    const finalResults = [];

    for (const domain of domains) {
        // 1. Local Scrape
        const scrapedEmails = await localScrape(domain);

        let result = {
            domain,
            email: scrapedEmails[0] || 'N/A',
            name: 'Contact',
            source: scrapedEmails.length > 0 ? 'Local Scrape' : 'None',
            scraped: scrapedEmails.join('; ')
        };

        // 2. Apify Leads Finder Upgrade
        console.log(`📡 [2/2] Calling code_crafter/leads-finder for ${domain}...`);
        try {
            const run = await client.actor('code_crafter/leads-finder').call({
                fetch_count: 1,
                company_domain: [domain],
                contact_job_title: ["Owner", "Founder", "CEO", "Marketing"],
                has_email: true
            });

            const { items } = await client.dataset(run.defaultDatasetId).listItems();
            if (items && items.length > 0) {
                const lead = items[0];
                if (lead.email) {
                    console.log(`   ✨ UPGRADE: Found ${lead.full_name || lead.name} (${lead.email})`);
                    result.email = lead.email;
                    result.name = lead.full_name || lead.name || 'Decision Maker';
                    result.source = 'code_crafter/leads-finder';
                }
            } else {
                console.log(`   ⏭️ No database leads. Using local scrape.`);
            }
        } catch (e) {
            console.log(`   ❌ Actor failed: ${e.message}`);
        }

        finalResults.push(result);
    }

    // Save to CSV
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: 'dork_final_results_cli.csv',
        header: [
            { id: 'domain', title: 'Domain' },
            { id: 'name', title: 'Name' },
            { id: 'email', title: 'Email' },
            { id: 'source', title: 'Source' },
            { id: 'scraped', title: 'All Local Emails' }
        ]
    });

    await csvWriter.writeRecords(finalResults);
    console.log('\n\n✅ DONE!');
    console.table(finalResults);
    console.log(`📄 Saved to: dork_final_results_cli.csv`);
}

runEnrichment();
