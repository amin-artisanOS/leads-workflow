/**
 * enrich-batch-4-gemini.js
 * Deep AI enrichment for Batch 4 using Gemini 2.0 Flash Lite.
 * Fills: product_type, shoutout, pain_point, first_line.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');

const INPUT_FILE = path.join(COMMERIUM, 'BATCH_4_VERIFIED.csv');
const OUTPUT_FILE = path.join(COMMERIUM, 'BATCH_4_ELITE_ENRICHED.csv');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

async function readCSV(filePath) {
    const results = [];
    if (!fs.existsSync(filePath)) return results;
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
        console.log(`   🌐 Scraping ${url}...`);
        const res = await axios.get(url, { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            validateStatus: () => true 
        });
        
        if (typeof res.data !== 'string') return "FAILED_TO_LOAD";
        return res.data.substring(0, 10000).replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' '); 
    } catch (e) {
        return "FAILED_TO_LOAD";
    }
}

async function getEnrichment(domain, htmlText) {
    if (htmlText === "FAILED_TO_LOAD" || !htmlText.trim() || htmlText.length < 100) {
        return {
            product: "Artisanal goods",
            shoutout: "your unique craftsmanship",
            pain_point: "Likely uses manual ordering or PDF catalogs for wholesale.",
            first_line: "I was browsing your store and was impressed by the artisanal quality of your work."
        };
    }

    const prompt = `You are a B2B sales strategist for 'Commerium' (formerly Artisan OS). Analyze this website text for ${domain}:
    
    ${htmlText}

    Context: Commerium provides a digital B2B catalog and wholesale order management system for artisans.
    
    Extract exactly:
    1. PRODUCT_TYPE: What specific artisanal goods do they make? (max 5 words)
    2. SHOUTOUT: One specific thing you saw on their site that is impressive or unique about their craftsmanship or brand story.
    3. PAIN_POINT: Why would they need a digital catalog or B2B/wholesale portal specifically? (Look for mentions of "wholesale", "stockists", "contact us for catalog", or lack thereof).
    4. FIRST_LINE: A friendly, hyper-specific 1-sentence opening for a cold email that mentions a specific collection, material, or detail from their work.

    Return as JSON ONLY:
    {"product": "...", "shoutout": "...", "pain_point": "...", "first_line": "..."}`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const cleaned = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return parsed;
    } catch (e) {
        console.error(`      ❌ Gemini Error for ${domain}:`, e.message);
        return null;
    }
}

async function main() {
    console.log('🤖 STARTING BATCH 4 GEMINI ENRICHMENT (ELITE PERSONALIZATION)...');

    const allLeads = await readCSV(INPUT_FILE);
    // Filter for valid leads only
    const leads = allLeads.filter(l => 
        ['ok', 'catch_all', 'unknown'].includes(l['MillionVerifier Result'])
    );

    console.log(`Processing ${leads.length} verified leads...`);

    const csvWriter = createObjectCsvWriter({
        path: OUTPUT_FILE,
        header: [
            { id: 'email', title: 'Email' },
            { id: 'first_name', title: 'Salutation' },
            { id: 'company_name', title: 'Company_Name' },
            { id: 'domain', title: 'Website' },
            { id: 'product_type', title: 'Niche' },
            { id: 'shoutout', title: 'Shoutout' },
            { id: 'pain_point', title: 'Pain_Point' },
            { id: 'first_line', title: 'Personalized_Opening' }
        ]
    });

    const enrichedCount = 0;

    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        const domain = lead.company_domain || '';
        
        console.log(`\n[${i + 1}/${leads.length}] Processing: ${domain}`);

        const text = await scrapeWebsiteText(domain);
        const data = await getEnrichment(domain, text);

        if (data) {
            const companyName = domain.replace('.myshopify.com', '').split('-').join(' ').replace(/\b\w/g, l => l.toUpperCase());
            const salutation = lead.first_name && lead.first_name !== 'Store Owner' ? lead.first_name : `${companyName} team`;

            const entry = {
                email: lead.email,
                first_name: salutation,
                company_name: companyName,
                domain: domain,
                product_type: data.product,
                shoutout: data.shoutout,
                pain_point: data.pain_point,
                first_line: data.first_line
            };

            await csvWriter.writeRecords([entry]);
            console.log(`   ✅ Enriched: ${data.product}`);
        } else {
            console.log(`   ⚠️ Skipped (No data)`);
        }
    }

    console.log(`\n\n🎉 ENRICHMENT COMPLETE!`);
    console.log(`📂 Final Elite File: ${OUTPUT_FILE}`);
}

main();
