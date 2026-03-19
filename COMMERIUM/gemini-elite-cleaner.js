import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import csvParser from 'csv-parser';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');

// Batch 2 Settings
const INPUT_FILE = path.join(COMMERIUM, 'ARTISAN_PRO_MASTER_LIST_V2.csv');
const OUTPUT_FILE = path.join(COMMERIUM, 'ARTISAN_ELITE_CLEAN_BATCH_2.csv');
const START_INDEX = 248; // Skip fixed Batch 1

// USING EXACT MODEL SPECIFIED BY USER
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });

async function readCSV(filePath) {
    const results = [];
    return new Promise((resolve) => {
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results));
    });
}

function escapeCSV(val) {
    if (!val) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
}

async function scrapeWebsiteText(url) {
    if (!url) return '';
    try {
        const targetUrl = url.startsWith('http') ? url : `https://${url}`;

        // Timeout race: 6s for the request, 8s hard wrap
        const response = await Promise.race([
            axios.get(targetUrl, {
                timeout: 6000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Hard Timeout')), 8000))
        ]);

        const text = response.data.replace(/<[^>]*>?/gm, ' ')
            .replace(/\s+/g, ' ')
            .substring(0, 10000);
        return text;
    } catch (err) {
        return '';
    }
}

async function getEliteEnrichment(url, text) {
    if (!text || text.length < 200) return null;

    const prompt = `
    Analyze this artisan/maker website text and extract:
    1. Owner/Maker first name (if found, else "Store Owner")
    2. Brand/Company Name
    3. Specific Niche (e.g. "Handcrafted Ceramics", "Bespoke Jewelry")
    4. Location (City, State/Country)
    5. A personalized opening hook about their specific work style/aesthetic.
    6. A specific pitch for "One Photo -> Full Digital Catalog" showing how it solves their manual work.

    Rules:
    - Reading level: 4th Grade (Kincaid).
    - Extremely punchy.
    - Focus on the "One Photo" benefit.
    
    Website: ${url}
    Content: ${text}

    Return JSON: { "owner": "", "brandName": "", "niche": "", "location": "", "opener": "", "pitch": "" }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let jsonStr = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (err) {
        return null;
    }
}

async function main() {
    console.log('💎 ELITE ENRICHMENT STARTING (Batch 2)...');

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ Input file not found: ${INPUT_FILE}`);
        return;
    }

    const leads = await readCSV(INPUT_FILE);
    console.log(`📊 Loaded ${leads.length} total leads from V2 Master.`);
    console.log(`🚀 Processing from index ${START_INDEX} to ${leads.length}`);

    // Write header
    const header = ['Email', 'Contact_Name', 'Company_Name', 'Niche_Segment', 'Location', 'Personalized_Opening', 'The_AI_Pitch', 'Website'].join(',') + '\n';
    fs.writeFileSync(OUTPUT_FILE, header);

    const totalToProcess = leads.length - START_INDEX;
    let processedCount = 0;

    for (let i = START_INDEX; i < leads.length; i++) {
        const lead = leads[i];
        processedCount++;

        // Match the header of V2 (Email, First Name, Company Name, Website, Industry)
        const leadEmail = lead['Email'];
        const leadUrl = lead['Website'];

        process.stdout.write(`\r[${processedCount}/${totalToProcess}] Researching: ${leadUrl}... `);

        const text = await scrapeWebsiteText(leadUrl);
        const data = await getEliteEnrichment(leadUrl, text);

        if (data) {
            const row = [
                escapeCSV(leadEmail),
                escapeCSV(data.owner),
                escapeCSV(data.brandName),
                escapeCSV(data.niche),
                escapeCSV(data.location),
                escapeCSV(data.opener),
                escapeCSV(data.pitch),
                escapeCSV(leadUrl)
            ].join(',') + '\n';

            fs.appendFileSync(OUTPUT_FILE, row);
        }
    }

    console.log('\n\n✅ DONE! Batch 2 Elite List at ' + OUTPUT_FILE);
}

main();
