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

const INPUT_FILE = path.join(COMMERIUM, 'ARTISAN_MASTER_TO_ENRICH.csv');
const OUTPUT_FILE = path.join(COMMERIUM, 'ARTISAN_FINAL_ENRICHED_READY.csv');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite-preview-02-05" });

async function readCSV(filePath) {
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
        const res = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
        return res.data.substring(0, 10000).replace(/<[^>]*>?/gm, ' '); // Strip tags, grab 10k chars
    } catch (e) {
        return "FAILED_TO_LOAD";
    }
}

async function getEnrichment(domain, htmlText) {
    if (htmlText === "FAILED_TO_LOAD" || !htmlText.trim() || htmlText.length < 100) return null;

    const prompt = `You are a B2B sales strategist for 'Artisan OS'. Analyze this website text for ${domain}:
    
    ${htmlText}

    Extract exactly:
    1. PRODUCT_TYPE: What do they make? (max 5 words)
    2. SHOUTOUT: One specific thing you saw on their site that is impressive or unique about their craftsmanship.
    3. PAIN_POINT: Why would they need a digital catalog or B2B/wholesale portal specifically? (e.g. they use PDFs, manual ordering, no wholesale sign-up).
    4. FIRST_LINE: A friendly, hyper-specific 1-sentence opening for a cold email that mentions their work/style.

    Return as JSON ONLY:
    {"product": "...", "shoutout": "...", "pain_point": "...", "first_line": "..."}`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const cleaned = text.replace(/```json|```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        return null;
    }
}

async function main() {
    console.log('🤖 STARTING MASSIVE GEMINI ENRICHMENT (FLASH-LITE)...');

    const leads = await readCSV(INPUT_FILE);
    const enriched = [];

    // Check if output already exists to potentially resume or avoid overwrite
    // For now, we overwrite but we could add a check.

    console.log(`Processing total of ${leads.length} leads...`);

    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: OUTPUT_FILE,
        header: [
            { id: 'email', title: 'email' },
            { id: 'name', title: 'name' },
            { id: 'domain', title: 'domain' },
            { id: 'icp', title: 'icp' },
            { id: 'product_type', title: 'product_type' },
            { id: 'shoutout', title: 'shoutout' },
            { id: 'pain_point', title: 'pain_point' },
            { id: 'first_line', title: 'first_line' }
        ]
    });

    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        process.stdout.write(`\r[${i + 1}/${leads.length}] Processing: ${lead.domain}... `);

        const text = await scrapeWebsiteText(lead.domain);
        const data = await getEnrichment(lead.domain, text);

        if (data) {
            const entry = {
                ...lead,
                product_type: data.product,
                shoutout: data.shoutout,
                pain_point: data.pain_point,
                first_line: data.first_line
            };
            enriched.push(entry);
            // Optional: write in real-time or small batches
            if (enriched.length % 10 === 0) {
                await csvWriter.writeRecords(enriched.slice(enriched.length - 10));
            }
        }
    }

    // Write any remaining
    const remaining = enriched.length % 10;
    if (remaining > 0) {
        await csvWriter.writeRecords(enriched.slice(enriched.length - remaining));
    }

    console.log(`\n\n🎉 ENRICHMENT COMPLETE! Found ${enriched.length} enriched leads.`);
    console.log(`📂 Final File: ${OUTPUT_FILE}`);
}

main();
