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

async function runDualScrape() {
    console.log('🔥 STARTING COMPREHENSIVE DUAL-SCRAPE (NO FALLBACKS - BOTH AGENTS ACTIVE)');
    console.log('======================================================================');

    const finalResults = [];

    for (const domain of domains) {
        console.log(`\n💎 PROCESSING: ${domain}`);

        // 1. Local Scrape (Get every email from the site)
        console.log(`   🧵 [Agent 1] Local Crawler searching...`);
        const localEmails = new Set();
        const urls = [
            `https://${domain}`,
            `https://www.${domain}`,
            `https://${domain}/pages/contact`,
            `https://${domain}/pages/contact-us`,
            `https://${domain}/pages/about-us`
        ];

        for (const url of urls) {
            try {
                const res = await axios.get(url, {
                    timeout: 8000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                });
                const html = res.data;
                const matches = html.match(EMAIL_REGEX);
                if (matches) matches.forEach(e => {
                    const low = e.toLowerCase();
                    if (!low.endsWith('.png') && !low.endsWith('.jpg') && !low.includes('sentry')) localEmails.add(low);
                });
                const $ = cheerio.load(html);
                $('a[href^="mailto:"]').each((i, el) => {
                    const mail = $(el).attr('href').replace('mailto:', '').split('?')[0].trim();
                    if (mail) localEmails.add(mail.toLowerCase());
                });
            } catch (e) { }
        }
        const scraped = Array.from(localEmails).join('; ');
        console.log(`   └─ Scraped: ${scraped || 'None'}`);

        // 2. Apify Leads Finder (Get database leads)
        console.log(`   📡 [Agent 2] Apify code_crafter/leads-finder querying...`);
        let databaseLead = 'N/A';
        let databaseName = 'N/A';
        let databaseTitle = 'N/A';
        let databaseLinkedin = 'N/A';

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
                databaseLead = lead.email || 'N/A';
                databaseName = lead.full_name || lead.name || 'N/A';
                databaseTitle = lead.job_title || lead.title || 'N/A';
                databaseLinkedin = lead.linkedin || lead.linkedin_url || 'N/A';
                console.log(`   └─ Database: ${databaseName} (${databaseLead})`);
            } else {
                console.log(`   └─ Database: No record found`);
            }
        } catch (e) {
            console.log(`   ❌ Database Agent Error: ${e.message}`);
        }

        finalResults.push({
            domain,
            scrapedEmails: scraped || 'NONE FOUND',
            dbContact: databaseName,
            dbEmail: databaseLead,
            dbTitle: databaseTitle,
            dbLinkedin: databaseLinkedin
        });
    }

    // Save to CSV with BOTH records
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: 'comprehensive_dual_leads.csv',
        header: [
            { id: 'domain', title: 'Domain' },
            { id: 'scrapedEmails', title: 'Scraped Emails (Direct from Site)' },
            { id: 'dbContact', title: 'DB Contact Name' },
            { id: 'dbEmail', title: 'DB Contact Email' },
            { id: 'dbTitle', title: 'DB Contact Title' },
            { id: 'dbLinkedin', title: 'DB Linkedin' }
        ]
    });

    await csvWriter.writeRecords(finalResults);

    console.log('\n\n✅ COMPREHENSIVE DUAL-REPORT GENERATED');
    console.log('======================================================================');
    console.table(finalResults.map(r => ({
        Domain: r.domain,
        'Scraped Emails': r.scrapedEmails,
        'DB Email': r.dbEmail,
        'DB Contact': r.dbContact
    })));
    console.log(`\n📄 Final report saved to: comprehensive_dual_leads.csv`);
}

runDualScrape();
