/**
 * enrich-extra.js
 * Scrapes the specific list of high-quality artisan domains.
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createObjectCsvWriter } from 'csv-writer';

const INPUT = 'COMMERIUM/EXTRA_DISCOVERY.txt';
const OUTPUT = 'COMMERIUM/EXTRA_ENRICHED_RAW.csv';

async function scrapeDomain(domain) {
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    try {
        console.log(`   🕸️ Scraping ${url}...`);
        const response = await axios.get(url, { 
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);
        const emails = new Set();
        
        // Find emails
        const bodyText = $('body').text();
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const found = bodyText.match(emailRegex);
        if (found) found.forEach(e => emails.add(e.toLowerCase()));

        // Check contact page
        const contactLink = $('a[href*="contact"]').attr('href');
        if (contactLink) {
            const contactUrl = contactLink.startsWith('http') ? contactLink : new URL(contactLink, url).href;
            const contactRes = await axios.get(contactUrl, { timeout: 5000 }).catch(() => null);
            if (contactRes) {
                const c$ = cheerio.load(contactRes.data);
                const cFound = c$.text().match(emailRegex);
                if (cFound) cFound.forEach(e => emails.add(e.toLowerCase()));
            }
        }

        return Array.from(emails).map(email => ({
            email,
            domain,
            name: 'Store Owner',
            title: 'Owner'
        }));
    } catch (e) {
        console.error(`      ❌ Failed ${domain}: ${e.message}`);
        return [];
    }
}

async function main() {
    const domains = fs.readFileSync(INPUT, 'utf8').split('\n').filter(d => d.trim());
    const allLeads = [];

    for (const d of domains) {
        const leads = await scrapeDomain(d.trim());
        allLeads.push(...leads);
    }

    const csvWriter = createObjectCsvWriter({
        path: OUTPUT,
        header: [
            { id: 'email', title: 'email' },
            { id: 'domain', title: 'domain' },
            { id: 'name', title: 'name' },
            { id: 'title', title: 'title' }
        ]
    });

    await csvWriter.writeRecords(allLeads);
    console.log(`✅ Done! Saved ${allLeads.length} leads to ${OUTPUT}`);
}

main();
