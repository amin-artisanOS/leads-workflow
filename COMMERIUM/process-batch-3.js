/**
 * process-batch-3.js
 * 1. Pulls leads from ARTISAN_MASTER_TO_ENRICH.csv
 * 2. Filters for valid domains and avoids duplicates from Batches 1 & 2
 * 3. Scrapes website text and enriches via Gemini 2.0 Flash Lite
 * 4. Saves to ARTISAN_BATCH_3_ENRICHED.csv
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import csvParser from 'csv-parser';
import createCsvWriter from 'csv-writer';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');

const SOURCE_FILES = [
    path.join(COMMERIUM, 'ARTISAN_PRO_MASTER_LIST_V2.csv'),
    path.join(COMMERIUM, 'VERIFIED_NEW_ARTISANS.csv'),
    path.join(COMMERIUM, 'ARTISAN_MASTER_TO_ENRICH.csv')
];
const OUTPUT_FILE = path.join(COMMERIUM, 'ARTISAN_BATCH_3_ENRICHED.csv');
const PROCESSED_FILES = [
    path.join(COMMERIUM, 'INSTANTLY_READY_ARTISAN_OS.csv'),
    path.join(COMMERIUM, 'INSTANTLY_READY_BATCH_2.csv')
];

const BATCH_SIZE = 250;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

async function readCSV(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const results = [];
    return new Promise((resolve) => {
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results));
    });
}

async function scrapeWebsiteText(domain) {
    try {
        const url = domain.startsWith('http') ? domain : `https://${domain}`;
        const res = await axios.get(url, { 
            timeout: 8000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } 
        });
        return res.data.substring(0, 15000).replace(/<[^>]*>?/gm, ' ');
    } catch (e) {
        return "FAILED_TO_LOAD";
    }
}

async function getEnrichment(domain, htmlText) {
    if (htmlText === "FAILED_TO_LOAD" || !htmlText.trim() || htmlText.length < 100) return null;

    const prompt = `Analyze this website content for ${domain} and extract details for a B2B SaaS called 'Commerium' (formerly Artisan OS).
    Commerium turns one product photo into a full digital catalog listing (description, pricing, specs).
    
    Website Text:
    ${htmlText}

    Extract exactly:
    1. PRODUCT_TYPE: What exactly do they sell/make?
    2. SHOUTOUT: One hyper-specific detail about their craftsmanship or aesthetic mentioned on the site.
    3. PAIN_POINT: Why would they benefit from an automated catalog tool?
    4. FIRST_LINE: A genuine, expert-level opening sentence for a cold email. Mention their specific style/collection.
    5. PITCH: A 1-sentence explanation of why Commerium specifically helps their inventory speed.

    Return as JSON ONLY:
    {"product": "...", "shoutout": "...", "pain_point": "...", "first_line": "...", "pitch": "..."}`;

    try {
        if (!process.env.GEMINI_API_KEY) {
            console.log('\n   ❌ MISSING GEMINI_API_KEY');
            return null;
        }
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const cleaned = text.replace(/```json|```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        console.log(`\n   ❌ Gemini Error: ${e.message}`);
        return null;
    }
}

async function main() {
    console.log('🤖 BATCH 3 ENRICHMENT STARTING...');

    // 1. Get processed emails to avoid duplicates
    const processedEmails = new Set();
    for (const file of PROCESSED_FILES) {
        const rows = await readCSV(file);
        rows.forEach(r => {
            const email = r.Email || r.email || r['Email'] || r['email'];
            if (email) processedEmails.add(email.toLowerCase().trim());
        });
    }
    console.log(`Loaded ${processedEmails.size} already processed emails.`);

    // 2. Load potential leads from all sources
    let allCandidates = [];
    for (const file of SOURCE_FILES) {
        const rows = await readCSV(file);
        const valid = rows.filter(l => {
            const domain = l.Domain || l.domain || l.Website || l.website || '';
            const email = (l.Email || l.email || '').toLowerCase().trim();
            return domain.length > 3 && domain.includes('.') && 
                   email.includes('@') && !processedEmails.has(email);
        });
        
        // Map to uniform structure
        const mapped = valid.map(l => ({
            email: l.Email || l.email,
            name: l['Contact Name'] || l['Contact_Name'] || l.name || 'Store Owner',
            domain: l.Domain || l.domain || l.Website || l.website
        }));
        
        allCandidates = allCandidates.concat(mapped);
    }

    // 3. Deduplicate candidates themselves (since they might be in multiple source files)
    const uniqueCandidates = [];
    const internalSeen = new Set();
    for (const c of allCandidates) {
        if (!internalSeen.has(c.email.toLowerCase())) {
            internalSeen.add(c.email.toLowerCase());
            uniqueCandidates.push(c);
        }
    }

    console.log(`Found ${uniqueCandidates.length} unique fresh candidates with valid domains.`);
    const leads = uniqueCandidates.slice(0, BATCH_SIZE);
    
    if (leads.length === 0) {
        console.log('No fresh leads found. Exiting.');
        return;
    }

    const enriched = [];

    console.log(`Processing up to ${leads.length} leads...`);

    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: OUTPUT_FILE,
        header: [
            { id: 'Email', title: 'Email' },
            { id: 'Contact_Name', title: 'Contact_Name' },
            { id: 'Company_Name', title: 'Company_Name' },
            { id: 'Website', title: 'Website' },
            { id: 'Location', title: 'Location' },
            { id: 'Niche_Segment', title: 'Niche_Segment' },
            { id: 'Personalized_Opening', title: 'Personalized_Opening' },
            { id: 'The_AI_Pitch', title: 'The_AI_Pitch' }
        ]
    });

    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        process.stdout.write(`\r[${i + 1}/${leads.length}] ${lead.domain}... `);

        const text = await scrapeWebsiteText(lead.domain);
        if (text === "FAILED_TO_LOAD") {
            console.log(`\n   ❌ Scrape failed for ${lead.domain}`);
            continue;
        }

        const data = await getEnrichment(lead.domain, text);

        if (data && data.product && data.first_line) {
            const entry = {
                Email: lead.email,
                Contact_Name: lead.name || 'Store Owner',
                Company_Name: lead.domain.split('.')[0].toUpperCase(),
                Website: lead.domain,
                Location: "USA", 
                Niche_Segment: data.product.substring(0, 100),
                Personalized_Opening: data.first_line.substring(0, 500),
                The_AI_Pitch: data.pitch ? data.pitch.substring(0, 500) : ''
            };
            enriched.push(entry);
            console.log(`\n   ✅ Enriched: ${lead.email}`);
            
            if (enriched.length % 5 === 0 || i === leads.length - 1) {
                await csvWriter.writeRecords(enriched.slice(enriched.length - (enriched.length % 5 || 5)));
            }
        } else {
            console.log(`\n   ⚠️ Gemini failed for ${lead.domain}. Data: ${JSON.stringify(data)}`);
        }
    }

    // Final write
    const remaining = enriched.length % 5;
    if (remaining > 0) {
        await csvWriter.writeRecords(enriched.slice(enriched.length - remaining));
    }

    console.log(`\n\n🎉 BATCH 3 COMPLETE! Enriched ${enriched.length} leads.`);
}

main();
