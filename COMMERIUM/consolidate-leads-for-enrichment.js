/**
 * consolidate-and-prepare-enrichment.js
 * Merges new verified leads with relevant legacy leads to create a ~1500-2000 master list.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import createCsvWriter from 'csv-writer';
import csvParser from 'csv-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');

const NEW_VERIFIED = path.join(COMMERIUM, 'VERIFIED_NEW_ARTISANS.csv');
const PROCESSED_LEADS = path.join(ROOT, 'processed_leads.csv');

const ARTISAN_KEYWORDS = ['handmade', 'artisan', 'ceramic', 'jewelry', 'producer', 'wholesale', 'maker', 'studio', 'workshop', 'pottery', 'woodworking', 'leather', 'oil', 'food', 'catalogue', 'stockist'];

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

function isArtisanRelevant(row) {
    const text = JSON.stringify(row).toLowerCase();
    return ARTISAN_KEYWORDS.some(kw => text.includes(kw));
}

async function main() {
    console.log('🚀 CONSOLIDATING ARTISAN LEADS FOR ENRICHMENT...\n');

    const newVerifiedRaw = await readCSV(NEW_VERIFIED);
    const legacyRaw = await readCSV(PROCESSED_LEADS);

    const consolidated = new Map();

    // 1. Process New Verified (Filter for OK)
    console.log(`Processing ${newVerifiedRaw.length} new verified leads...`);
    let newOkCount = 0;
    newVerifiedRaw.forEach(row => {
        const email = (row['Email'] || '').toLowerCase().trim();
        const result = (row['MillionVerifier Result'] || '').toLowerCase().trim();

        if (email && result === 'ok') {
            consolidated.set(email, {
                email,
                name: row['Contact Name'] || '',
                domain: row['Domain'] || '',
                icp: row['ICP Segment'] || 'Artisan',
                source: 'New Dork Scrape'
            });
            newOkCount++;
        }
    });
    console.log(`✅ Added ${newOkCount} "ok" leads from new batch.`);

    // 2. Process Legacy (Filter for Relevance)
    console.log(`Scanning ${legacyRaw.length} legacy leads for artisan relevance...`);
    let legacyAddCount = 0;
    legacyRaw.forEach(row => {
        const email = (row['email'] || '').toLowerCase().trim();
        if (email && !consolidated.has(email) && isArtisanRelevant(row)) {
            consolidated.set(email, {
                email,
                name: row['companyName'] || row['contactName'] || '',
                domain: row['website'] || '',
                icp: row['qualification'] || 'Legacy Artisan',
                source: 'Legacy Database'
            });
            legacyAddCount++;
        }
    });
    console.log(`✅ Added ${legacyAddCount} relevant leads from legacy stockpile.`);

    const finalLeads = Array.from(consolidated.values());
    console.log(`\n📊 TOTAL CONSOLIDATED LIST: ${finalLeads.length} Leads`);

    const outFile = path.join(COMMERIUM, 'ARTISAN_MASTER_TO_ENRICH.csv');
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: outFile,
        header: [
            { id: 'email', title: 'email' },
            { id: 'name', title: 'name' },
            { id: 'domain', title: 'domain' },
            { id: 'icp', title: 'icp' },
            { id: 'source', title: 'source' }
        ]
    });

    await csvWriter.writeRecords(finalLeads);
    console.log(`\n📂 Final preparation complete: ${outFile}`);
    console.log(`👉 NEXT: Running Gemini Hyper-Personalization Agent...`);
}

main();
