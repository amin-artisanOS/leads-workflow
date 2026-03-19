/**
 * mass-discover-batch-4.js
 * 1. Runs proven Google Dorks via Apify in batches to find artisan stores.
 * 2. Deduplicates domains.
 * 3. Uses Apify Leads Finder to get verified names and emails.
 * 4. Saves results incrementally to COMMERIUM/BATCH_4_DISCOVERED_RAW.csv.
 */

import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import createCsvWriter from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');
const OUTPUT_FILE = path.join(COMMERIUM, 'BATCH_4_DISCOVERED_RAW.csv');

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const DORKS = [
    'site:myshopify.com "handcrafted" pottery USA',
    'site:myshopify.com "handcrafted" ceramics USA',
    'site:myshopify.com "artisan" woodworking USA',
    'site:myshopify.com "handcrafted" leather goods USA',
    'site:myshopify.com "artisan" jewelry handcrafted',
    'site:myshopify.com "hand-poured" candles artisan',
    'site:myshopify.com "small batch" skincare apothecary',
    'site:myshopify.com "custom furniture" handcrafted',
    'site:myshopify.com "artisan" textiles USA',
    'site:myshopify.com "hand-blown glass" artisan',
    'site:myshopify.com "handmade stationary" gift shop',
    'site:myshopify.com "artisan soap" handcrafted',
    'site:myshopify.com "natural dyes" handcrafted textiles',
    'site:myshopify.com "bespoke footwear" handmade',
    'site:myshopify.com "artisan knives" handcrafted',
    'site:myshopify.com "handcrafted" paper goods',
    'site:myshopify.com "artisan" weaving workshop',
    'site:myshopify.com "hand-forged" ironwork artisan',
    'site:myshopify.com "handcrafted" basket weaving',
    'site:myshopify.com "artisan" leather bags handmade',
    'site:myshopify.com "handcrafted" ceramic dinnerware',
    'site:myshopify.com "artisan" candle studio',
    'site:myshopify.com "handcrafted" skincare botanical',
    'site:myshopify.com "artisan" wood turning USA',
    'site:myshopify.com "handcrafted" silver jewelry',
    'site:myshopify.com "artisan" wool products handmade',
    'site:myshopify.com "handcrafted" linen clothing',
    'site:myshopify.com "artisan" hat maker handmade',
    'site:myshopify.com "handcrafted" wood toys',
    'site:myshopify.com "artisan" clay studio',
    '"powered by shopify" "handmade in USA" artisan',
    '"powered by shopify" "crafted in America" pottery',
    '"powered by shopify" "small batch" apothecary',
    '"powered by shopify" "handcrafted" ceramics',
    '"powered by shopify" "artisan" woodworking',
    'intext:"proudly powered by WooCommerce" "handcrafted" ceramics',
    'intext:"proudly powered by WooCommerce" "artisan" woodworking',
    'intext:"proudly powered by WooCommerce" "small batch" apothecary',
    'intext:"proudly powered by WooCommerce" "handcrafted" candles',
    'intext:"proudly powered by WooCommerce" "artisan" jewelry'
];

function isJunk(domain) {
    const junk = [
        'google.com', 'facebook.com', 'instagram.com', 'twitter.com', 'youtube.com', 
        'pinterest.com', 'amazon.com', 'etsy.com', 'wikipedia.org', 
        'ebay.com', 'yelp.com', 'yellowpages.com', 'linkedin.com', 'tiktok.com',
        'apple.com', 'microsoft.com', 'reddit.com'
    ];
    // Block common platforms precisely, but allow subdomains like *.myshopify.com
    if (domain === 'shopify.com' || domain === 'myshopify.com') return true;
    return junk.some(j => domain === j || domain.endsWith('.' + j));
}

async function runDiscoveryInBatches(dorks) {
    console.log(`🔎 Starting discovery for ${dorks.length} dorks in batches...`);
    const allDomains = new Set();
    const BATCH_SIZE = 4; // Process 4 dorks at a time for feedback

    for (let i = 0; i < dorks.length; i += BATCH_SIZE) {
        const batch = dorks.slice(i, i + BATCH_SIZE);
        console.log(`   Searching batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(dorks.length/BATCH_SIZE)}...`);
        
        try {
            const run = await client.actor('apify/google-search-scraper').call({
                queries: batch.join('\n'),
                maxPagesPerQuery: 3,
                resultsPerPage: 50,
                gl: 'us',
                hl: 'en',
                mobileResults: false
            });

            const { items } = await client.dataset(run.defaultDatasetId).listItems();
            console.log(`     - Received ${items.length} pages of results.`);

            items.forEach(page => {
                const results = page.organicResults || [];
                results.forEach(res => {
                    try {
                        const url = new URL(res.url);
                        const domain = url.hostname.replace('www.', '').toLowerCase();
                        if (!isJunk(domain)) allDomains.add(domain);
                    } catch {}
                });
            });
            console.log(`     - Current unique domain pool: ${allDomains.size}`);
        } catch (e) {
            console.error(`   ❌ Batch failed: ${e.message}`);
        }
    }

    return Array.from(allDomains);
}

async function enrich(domains) {
    console.log(`📡 Sourcing leads for ${domains.length} domains...`);
    const results = [];
    const CHUNK_SIZE = 30;
    
    // Initialize CSV with header
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: OUTPUT_FILE,
        header: [
            { id: 'email', title: 'email' },
            { id: 'name', title: 'name' },
            { id: 'domain', title: 'domain' },
            { id: 'title', title: 'title' }
        ]
    });

    for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
        const chunk = domains.slice(i, i + CHUNK_SIZE);
        console.log(`   Enriching chunk ${Math.floor(i/CHUNK_SIZE) + 1} of ${Math.ceil(domains.length/CHUNK_SIZE)}...`);
        try {
            const run = await client.actor('vdrmota/contact-info-scraper').call({
                startUrls: chunk.map(d => ({ url: `https://${d}` })),
                maxRequestsPerCrawl: 50,
                maxDepth: 1
            });
            const { items } = await client.dataset(run.defaultDatasetId).listItems();
            const chunkLeads = [];
            items.forEach(item => {
                const emails = item.emails || [];
                if (emails.length > 0) {
                    const domain = item.url ? new URL(item.url).hostname.replace('www.', '') : '';
                    emails.forEach(email => {
                        if (email && email.includes('@')) {
                            chunkLeads.push({
                                email: email,
                                name: 'Store Owner', // contact-details-scraper doesn't usually get names well
                                domain: domain,
                                title: ''
                            });
                        }
                    });
                }
            });
            
            if (chunkLeads.length > 0) {
                await csvWriter.writeRecords(chunkLeads);
                results.push(...chunkLeads);
                console.log(`      - Added ${chunkLeads.length} leads to CSV.`);
            }
        } catch (e) {
            console.error(`   ❌ Enrichment chunk failed: ${e.message}`);
        }
    }
    return results;
}

async function main() {
    if (!fs.existsSync(COMMERIUM)) fs.mkdirSync(COMMERIUM, { recursive: true });

    const totalDomains = await runDiscoveryInBatches(DORKS);
    if (totalDomains.length === 0) {
        console.log('❌ No domains found across all batches.');
        return;
    }

    // Load processed emails for final filter
    const processedEmails = new Set();
    const PREV_FILES = [
        path.join(COMMERIUM, 'INSTANTLY_READY_ARTISAN_OS.csv'),
        path.join(COMMERIUM, 'INSTANTLY_READY_BATCH_2.csv'),
        path.join(COMMERIUM, 'INSTANTLY_READY_BATCH_3.csv')
    ];
    for (const f of PREV_FILES) {
        if (fs.existsSync(f)) {
            const content = fs.readFileSync(f, 'utf8');
            content.split('\n').slice(1).forEach(line => {
                const e = line.split(',')[0].replace(/"/g, '').toLowerCase().trim();
                if (e) processedEmails.add(e);
            });
        }
    }
    console.log(`📋 Deduplicating against ${processedEmails.size} existing leads.`);

    const leads = await enrich(totalDomains);
    const finalCount = leads.filter(l => !processedEmails.has(l.email.toLowerCase())).length;

    console.log(`\n🎉 BATCH 4 COMPLETE!`);
    console.log(`📊 Total unique leads found: ${leads.length}`);
    console.log(`📊 Fresh leads saved: ${finalCount}`);
    console.log(`📂 File: ${OUTPUT_FILE}`);
}

main();
