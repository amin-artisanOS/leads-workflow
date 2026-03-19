/**
 * mass-local-enrich.js
 * 1. Reads domains from COMMERIUM/DISCOVERED_DOMAINS.txt
 * 2. Scrapes them LOCALLY (no Apify cost)
 * 3. Uses concurrency for speed
 * 4. Saves to COMMERIUM/BATCH_4_LOCAL_RAW.csv
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import createCsvWriter from 'csv-writer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');
const INPUT_FILE = path.join(COMMERIUM, 'DISCOVERED_DOMAINS.txt');
const OUTPUT_FILE = path.join(COMMERIUM, 'BATCH_4_LOCAL_RAW.csv');

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function scrapeDomain(domain) {
    const results = { domain, emails: new Set() };
    const pagesToTry = [
        `https://${domain}`,
        `https://www.${domain}`,
        `https://${domain}/pages/contact`,
        `https://${domain}/pages/contact-us`,
        `https://${domain}/pages/about-us`,
        `https://${domain}/pages/about`
    ];

    for (const url of pagesToTry) {
        try {
            const response = await axios.get(url, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const html = response.data;
            if (typeof html !== 'string') continue;
            
            const $ = cheerio.load(html);

            // 1. Text-based regex
            const matches = html.match(EMAIL_REGEX);
            if (matches) {
                matches.forEach(email => {
                    const e = email.toLowerCase();
                    if (!/\.(png|jpg|jpeg|gif|webp|svg|css|js|pdf|woff|ttf|ico|mp4|webm)$/i.test(e) && !e.includes('sentry') && !e.includes('wix')) {
                        results.emails.add(e);
                    }
                });
            }

            // 2. Mailto links
            $('a[href^="mailto:"]').each((i, el) => {
                const href = $(el).attr('href');
                if (href) {
                    const email = href.replace('mailto:', '').split('?')[0].trim();
                    if (email && email.includes('@')) results.emails.add(email.toLowerCase());
                }
            });

            if (results.emails.size > 0) break; // found something, move on

        } catch (error) {
            // silent fail for individual pages
        }
    }

    return Array.from(results.emails).map(email => ({
        email,
        name: 'Store Owner',
        domain: domain,
        title: ''
    }));
}

async function main() {
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ Input file not found: ${INPUT_FILE}`);
        return;
    }

    const domains = fs.readFileSync(INPUT_FILE, 'utf8')
        .split('\n')
        .map(line => {
            try {
                const url = new URL(line.trim());
                return url.hostname.replace('www.', '');
            } catch { return line.trim(); }
        })
        .filter(d => d && d.length > 3);

    const uniqueDomains = Array.from(new Set(domains));
    console.log(`🚀 Starting LOCAL Enrichment for ${uniqueDomains.length} domains...`);

    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: OUTPUT_FILE,
        header: [
            { id: 'email', title: 'email' },
            { id: 'name', title: 'name' },
            { id: 'domain', title: 'domain' },
            { id: 'title', title: 'title' }
        ]
    });

    const CONCURRENCY = 10;
    let processed = 0;
    let totalLeads = 0;

    for (let i = 0; i < uniqueDomains.length; i += CONCURRENCY) {
        const chunk = uniqueDomains.slice(i, i + CONCURRENCY);
        const promises = chunk.map(d => scrapeDomain(d));
        
        const results = await Promise.all(promises);
        const flatLeads = results.flat();
        
        if (flatLeads.length > 0) {
            await csvWriter.writeRecords(flatLeads);
            totalLeads += flatLeads.length;
        }

        processed += chunk.length;
        process.stdout.write(`\rProgress: ${processed}/${uniqueDomains.length} | Found: ${totalLeads} leads`);
    }

    console.log(`\n\n🎉 LOCAL ENRICHMENT COMPLETE!`);
    console.log(`📊 Total leads found: ${totalLeads}`);
    console.log(`📂 Saved to: ${OUTPUT_FILE}`);
}

main();
