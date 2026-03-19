/**
 * closing-gap-discovery.js
 * Finding the last 50-100 domains to hit the 500 lead goal.
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
    'site:myshopify.com "handcrafted" apothecary organic',
    'site:myshopify.com "artisan" home goods USA',
    'site:myshopify.com "handmade" wooden kitchenware',
    'site:myshopify.com "artisan" woven rugs handmade',
    'site:myshopify.com "hand-knitted" wool artisan',
    'site:myshopify.com "bespoke" leather artisan workshop',
    'site:myshopify.com "artisanal" spice blends small batch',
    'site:myshopify.com "hand-forged" garden tools artisan',
    'site:myshopify.com "handmade" plant-based skincare artisan',
    'site:myshopify.com "artisan" stationary calligraphy'
];

async function main() {
    console.log(`🔍 Closing the gap to 500 leads...`);
    
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
            // Use a cheaper way if possible? Google search is $5/1k. 
            // 10 queries * 100 results = 1k results = $5.
            const run = await client.actor('apify/google-search-scraper').call({
                queries: query,
                maxPagesPerQuery: 1,
                resultsPerPage: 100,
                countryCode: 'us'
            });

            const { items } = await client.dataset(run.defaultDatasetId).listItems();
            
            items.forEach(item => {
                if (item.organicResults) {
                    item.organicResults.forEach(res => {
                        try {
                            const url = new URL(res.url);
                            if (url.hostname.includes('.myshopify.com') && !existingDomains.has(url.origin) && !newDomains.has(url.origin)) {
                                newDomains.add(url.origin);
                                console.log(`      ✨ Found: ${url.origin}`);
                            }
                        } catch (e) {}
                    });
                }
            });
        } catch (err) {
            console.error(`      ❌ Error:`, err.message);
        }
    }

    if (newDomains.size > 0) {
        fs.appendFileSync(DOMAINS_FILE, Array.from(newDomains).join('\n') + '\n');
        console.log(`\n✅ Added ${newDomains.size} new domains.`);
    }
}

main();
