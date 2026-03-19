/**
 * discover-new-domains.js
 * Scrapes Google for new Shopify-based artisan domains using Apify.
 */

import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');

const APIFY_TOKEN = process.env.APIFY_TOKEN || process.env.APIFY_API_KEY;

const QUERIES = [
    'site:myshopify.com "handcrafted pottery"',
    'site:myshopify.com "handmade ceramics"',
    'site:myshopify.com "artisan jewelry"',
    'site:myshopify.com "bespoke woodwork"',
    'site:myshopify.com "handmade leather goods"',
    'site:myshopify.com "artisanal candles"',
    'site:myshopify.com "handmade soap"',
    'site:myshopify.com "textile studio"',
    'site:myshopify.com "glassblowing workshop"',
    'site:myshopify.com "independent maker studio"'
];

async function main() {
    if (!APIFY_TOKEN) {
        console.error('❌ No APIFY_TOKEN found in .env');
        return;
    }

    console.log('🔍 DISCOVERING NEW ARTISAN DOMAINS VIA APIFY...');

    const searchInput = {
        queries: QUERIES.join('\n'),
        maxPagesPerQuery: 10,
        resultsPerPage: 100,
        mobileResults: false,
        includeUnfilteredResults: false,
        saveHtml: false,
        saveHtmlToKeyValueStore: false,
    };

    try {
        console.log('🚀 Starting Apify google-search-scraper...');
        const runRes = await axios.post(`https://api.apify.com/v2/acts/apify~google-search-scraper/runs?token=${APIFY_TOKEN}`, searchInput);
        const runId = runRes.data.data.id;
        const datasetId = runRes.data.data.defaultDatasetId;

        console.log(`📡 Run started: ${runId}`);
        console.log(`📊 Dataset ID: ${datasetId}`);

        // Wait for it to finish (poll every 30s)
        let status = 'RUNNING';
        while (status === 'RUNNING' || status === 'READY') {
            const statusRes = await axios.get(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
            status = statusRes.data.data.status;
            process.stdout.write(`\r   Status: ${status}... `);
            if (status !== 'SUCCEEDED') await new Promise(r => setTimeout(r, 15000));
        }

        console.log('\n✅ Search Complete. Fetching results...');
        const itemsRes = await axios.get(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`);
        const items = itemsRes.data;

        // Extract clean domains
        const domains = new Set();
        items.forEach(item => {
            if (item.organicResults) {
                item.organicResults.forEach(res => {
                    try {
                        const url = new URL(res.url);
                        if (url.hostname.includes('myshopify.com')) {
                            domains.add(url.hostname);
                        }
                    } catch (e) { }
                });
            }
        });

        console.log(`✨ Found ${domains.size} unique Shopify domains.`);
        const outputPath = path.join(COMMERIUM, 'DISCOVERED_DOMAINS.txt');
        fs.writeFileSync(outputPath, Array.from(domains).join('\n'));
        console.log(`💾 Saved to ${outputPath}`);

    } catch (err) {
        console.error('❌ Scrape failed:', err.response?.data || err.message);
    }
}

main();
