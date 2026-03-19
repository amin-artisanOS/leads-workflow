import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import createCsvWriter from 'csv-writer';
import axios from 'axios';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.APIFY_TOKEN || !process.env.GEMINI_API_KEY) {
    console.error("❌ APIFY_TOKEN or GEMINI_API_KEY not found in env!");
    process.exit(1);
}

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Multiply dorks by niches + locations to generate 2000+ leads
const NICHES = [
    "jewelry", "ceramics", "leather goods", "woodworking",
    "candles", "soap", "specialty food", "olive oil", "coffee roaster", "textiles"
];

// 1. Build a massive list of highly targeted Dorks
function generateMassDorks() {
    const dorks = {
        "No Ecommerce (B2B Producers)": [],
        "Small Ecommerce (Solo Makers)": [],
        "Physical Workshops": []
    };

    for (const niche of NICHES) {
        // ICP 1
        dorks["No Ecommerce (B2B Producers)"].push(`"wholesale catalog" "${niche}" filetype:pdf`);
        dorks["No Ecommerce (B2B Producers)"].push(`"trade account" producer "${niche}"`);
        dorks["No Ecommerce (B2B Producers)"].push(`"price list" "${niche}" "email to order"`);

        // ICP 2 
        dorks["Small Ecommerce (Solo Makers)"].push(`site:myshopify.com "handmade ${niche}" "about the maker"`);
        dorks["Small Ecommerce (Solo Makers)"].push(`"powered by shopify" "${niche}" "handcrafted"`);
        dorks["Small Ecommerce (Solo Makers)"].push(`site:etsy.com "${niche} artisan" "custom orders"`);

        // ICP 3
        dorks["Physical Workshops"].push(`intext:"visit our workshop" artisan "${niche}"`);
        dorks["Physical Workshops"].push(`"our taller" handmade "${niche}"`);
        dorks["Physical Workshops"].push(`"studio visit" handcrafted "${niche}"`);
    }

    return dorks;
}

const DORKS_ICP = generateMassDorks();

async function runGoogleSearch(queries, maxPages) {
    try {
        const run = await client.actor('apify/google-search-scraper').call({
            queries: queries.join('\n'),
            maxPagesPerQuery: maxPages,
            resultsPerPage: 100,
        });
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        const results = [];
        items.forEach(page => {
            if (page.organicResults) {
                page.organicResults.forEach(r => results.push({ url: r.url, title: r.title, query: page.searchQuery?.term }));
            }
        });
        return results;
    } catch (e) {
        console.error("❌ Google Scraper failed:", e.message);
        return [];
    }
}

const PLACEHOLDER_EMAILS = new Set(['user@domain.com', 'example@domain.com', 'example@email.com', 'your@email.com', 'hello@gmail.com', 'info@example.com', 'you@company.com', 'contoso@example.com', 'contact@example.com', 'jan.novak@example.com', 'email@example.com']);

function isValidEmail(e) {
    const low = e.toLowerCase();
    if (PLACEHOLDER_EMAILS.has(low)) return false;
    // Reject file-looking emails
    if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|pdf|woff|ttf|ico|mp4|webm|zip)$/i.test(low)) return false;
    // Reject base64 / hash-looking local parts > 40 chars
    if (low.split('@')[0].length > 50) return false;
    // Reject tracking pixels / obfuscated
    if (low.includes('noreply') || low.includes('no-reply') || low.includes('bounce')) return false;
    return true;
}

async function scrapeWebsiteForEmails(domain) {
    const emails = new Set();
    // Deeper crawl: homepage + 5 common contact/about subpages
    const targets = [
        `https://${domain}`,
        `https://${domain}/contact`,
        `https://${domain}/contact-us`,
        `https://${domain}/about`,
        `https://${domain}/pages/contact`,
        `https://${domain}/pages/about-us`,
        `https://${domain}/about-us`,
        `https://${domain}/info`,
    ];
    for (const url of targets) {
        try {
            const res = await axios.get(url, { timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' } });
            // Also extract mailto: links directly
            const mailtoMatches = res.data.match(/mailto:([^?"'\s<>]+)/gi);
            if (mailtoMatches) {
                mailtoMatches.forEach(m => {
                    const e = m.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
                    if (e && isValidEmail(e)) emails.add(e);
                });
            }
            const matches = res.data.match(EMAIL_REGEX);
            if (matches) {
                matches.forEach(e => { if (isValidEmail(e.toLowerCase())) emails.add(e.toLowerCase()); });
            }
        } catch (e) { }
    }
    return [...emails];
}

async function main() {
    console.log("🚀 STARTING MASSIVE ARTISAN OS PIPELINE (TARGET: >2000 LEADS)");
    const allDomains = new Map();

    // 1. MASS DORKS (Pulling ~3000-5000 raw domains)
    for (const [icp, queries] of Object.entries(DORKS_ICP)) {
        console.log(`\n🔎 Sourcing ICP: ${icp} (${queries.length} queries)... `);

        // Chunk queries so we don't crash Apify
        const chunkSize = 15;
        for (let i = 0; i < queries.length; i += chunkSize) {
            const chunk = queries.slice(i, i + chunkSize);
            console.log(`   Running batch ${i / chunkSize + 1} of ${Math.ceil(queries.length / chunkSize)}...`);

            // Set maxPagesPerQuery to 2 (100 results per page * 2 pages = 200 results per dork)
            const searchResults = await runGoogleSearch(chunk, 2);

            searchResults.forEach(res => {
                try {
                    const url = new URL(res.url);
                    const domain = url.hostname.replace('www.', '');
                    if (!domain.includes('google.') && !domain.includes('amazon.') && !domain.includes('pinterest.') && !domain.includes('etsy.') && !domain.includes('instagram.') && !domain.includes('facebook.')) {
                        if (!allDomains.has(domain)) {
                            allDomains.set(domain, { domain, icp, dork_source: res.query });
                        }
                    }
                } catch (e) { }
            });
        }
        console.log(`✅ ${icp}: Gathered ${allDomains.size} total domains so far.`);
    }

    const domainList = Array.from(allDomains.values());
    console.log(`\n📊 Raw Domains Collected: ${domainList.length}`);

    // We want 2000 output leads. Since email find rate on websites is ~60%, 
    // we should process ~3500 domains to hit >2000 emails.
    // We want all 2000+ output leads.
    const targetProcessList = domainList;

    // 2. MASS EMAIL SCRAPING
    // (We are skipping Apollo DB check here - it yielded 0 B2B producers in our test. 
    // We are going straight to the local web crawl which gave us a 100% success rate on info@ emails)
    console.log(`\n🕸️ Proceeding to shallow scrape ${targetProcessList.length} domains for emails...`);

    const finalLeads = [];
    const concurrentLimit = 15; // Higher concurrency for speed

    for (let i = 0; i < targetProcessList.length; i += concurrentLimit) {
        const batch = targetProcessList.slice(i, i + concurrentLimit);
        const promises = batch.map(d => scrapeWebsiteForEmails(d.domain));
        const results = await Promise.allSettled(promises);

        batch.forEach((d, idx) => {
            const res = results[idx];
            let foundEmails = [];
            if (res.status === 'fulfilled') foundEmails = res.value;

            if (foundEmails.length > 0) {
                finalLeads.push({
                    domain: d.domain,
                    icp_target: d.icp,
                    priority_email: foundEmails[0], // First valid email (usually info@/sales@)
                    local_scraped_emails: foundEmails.join('; '),
                    dork_used: d.dork_source
                });
            }
        });

        if (i % 50 === 0 && i > 0) process.stdout.write(`\r   Scraped ${i}/${targetProcessList.length} | Emails found so far: ${finalLeads.length}...`);
    }

    console.log(`\n\n🎉 EXTRACTION COMPLETE! Found ${finalLeads.length} leads with emails.`);

    // 4. WRITE TO CSV
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileOut = `COMMERIUM/Mass_Scrape_2000_${timestamp}.csv`;
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: fileOut,
        header: [
            { id: 'domain', title: 'Domain' },
            { id: 'icp_target', title: 'ICP Targeting' },
            { id: 'priority_email', title: 'Target Email' },
            { id: 'local_scraped_emails', title: 'All Emails Found' },
            { id: 'dork_used', title: 'Dork Used' }
        ]
    });

    await csvWriter.writeRecords(finalLeads);
    console.log(`📁 Saved to ${fileOut}`);
    console.log(`\n🚀 NEXT STEP: Run this list through MillionVerifier before loading to Instantly!`);
}

main();
