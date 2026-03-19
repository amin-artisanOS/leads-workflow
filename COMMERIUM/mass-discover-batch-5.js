/**
 * mass-discover-batch-5.js
 * Scrapes Google for more artisan domains to reach the 500 lead goal.
 */

import { ApifyClient } from 'apify-client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');
const DOMAINS_FILE = path.join(COMMERIUM, 'DISCOVERED_DOMAINS.txt');

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const DORKS = [
    'site:myshopify.com "handcrafted" pottery USA',
    'site:myshopify.com "artisan" ceramics USA',
    'site:myshopify.com "handmade" leather goods USA',
    'site:myshopify.com "small batch" apothecary USA',
    'site:myshopify.com "hand-poured" candles USA',
    'site:myshopify.com "custom furniture" handcrafted USA',
    'site:myshopify.com "artisan" jewelry "handmade in USA"',
    'site:myshopify.com "hand-blown glass" artisan USA',
    'site:myshopify.com "artisan soap" handcrafted USA',
    'site:myshopify.com "textiles" artisan handcrafted USA',
    'site:myshopify.com "woodworking" custom artisan USA',
    'site:myshopify.com "hand-stitched" leather artisan',
    'site:myshopify.com "forged" ironwork artisan USA',
    'site:myshopify.com "hand-woven" basket artisan',
    'site:myshopify.com "artisan" print shop handmade',
    'site:myshopify.com "custom-made" boutique artisan USA',
    'site:myshopify.com "hand-carved" wood artisan',
    'site:myshopify.com "artisanal" food producer shopify',
    'site:myshopify.com "handmade" baby goods artisan',
    'site:myshopify.com "sustainable" handcrafted goods artisan'
];

async function main() {
    console.log(`🔍 Discovering more artisan domains (Batch 5)...`);
    
    // Load existing domains to avoid redunancy
    const existingDomains = new Set();
    if (fs.existsSync(DOMAINS_FILE)) {
        const content = fs.readFileSync(DOMAINS_FILE, 'utf8');
        content.split('\n').forEach(line => {
            if (line.trim()) existingDomains.add(line.trim());
        });
    }

    const newDomains = new Set();

    for (const query of DORKS) {
        try {
            console.log(`   🔎 Searching: ${query}`);
            const run = await client.actor('apify/google-search-scraper').call({
                queries: query,
                maxPagesPerQuery: 2,
                resultsPerPage: 100,
                countryCode: 'us'
            });

            const { items } = await client.dataset(run.defaultDatasetId).listItems();
            
            items.forEach(item => {
                if (item.organicResults) {
                    item.organicResults.forEach(res => {
                        try {
                            const url = new URL(res.url);
                            const hostname = url.hostname;
                            if (hostname.includes('.myshopify.com') && !existingDomains.has(url.origin) && !newDomains.has(url.origin)) {
                                newDomains.add(url.origin);
                                console.log(`      ✨ Found: ${url.origin}`);
                            }
                        } catch (e) {}
                    });
                }
            });
        } catch (err) {
            console.error(`      ❌ Error for query "${query}":`, err.message);
            if (err.message.includes('Usage limit')) {
                console.error('🛑 Apify usage limit reached. Stopping search.');
                break;
            }
        }
    }

    if (newDomains.size > 0) {
        console.log(`\n✅ Found ${newDomains.size} new domains!`);
        fs.appendFileSync(DOMAINS_FILE, Array.from(newDomains).join('\n') + '\n');
        console.log(`📂 Updated ${DOMAINS_FILE}`);
    } else {
        console.log('⚠️ No new domains found.');
    }
}

main();
