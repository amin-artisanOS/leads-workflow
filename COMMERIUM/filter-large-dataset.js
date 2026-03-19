/**
 * filter-large-dataset.js
 * Searches the 4k leads file for artisan-relevant companies.
 */

import fs from 'fs';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

const INPUT = 'dataset_leads-finder_2025-11-04_14-56-17-327.csv';
const OUTPUT = 'COMMERIUM/LARGE_DATASET_FILTERED.csv';
const PROCESSED_LEADS_FILE = 'PROCESSED_LEADS.csv';

const ARTISAN_KEYWORDS = [
    'pottery', 'ceramic', 'jewelry', 'leather', 'candle', 'soap', 'handcrafted', 'artisan',
    'handmade', 'woodworking', 'apothecary', 'textile', 'glassware', 'hand-poured',
    'small batch', 'boutique', 'craft', 'maker', 'studio', 'gallery'
];

async function loadProcessedEmails() {
    const emails = new Set();
    if (!fs.existsSync(PROCESSED_LEADS_FILE)) return emails;
    
    return new Promise((resolve) => {
        fs.createReadStream(PROCESSED_LEADS_FILE)
            .pipe(csvParser())
            .on('data', (row) => {
                const email = row.email || row.Email || row.EMAIL;
                if (email) emails.add(email.toLowerCase().trim());
            })
            .on('end', () => resolve(emails));
    });
}

async function main() {
    const processed = await loadProcessedEmails();
    const leads = [];
    const seen = new Set();

    fs.createReadStream(INPUT)
        .pipe(csvParser())
        .on('data', (row) => {
            const description = (row.company_description || '').toLowerCase();
            const industry = (row.industry || '').toLowerCase();
            const email = (row.email || '').toLowerCase().trim();

            if (!email || processed.has(email) || seen.has(email)) return;

            const isArtisan = ARTISAN_KEYWORDS.some(k => 
                description.includes(k) || industry.includes(k)
            );

            if (isArtisan) {
                seen.add(email);
                leads.push({
                    email: email,
                    first_name: row.first_name,
                    company_name: row.company_name,
                    company_domain: row.company_domain,
                    industry: row.industry
                });
            }
        })
        .on('end', async () => {
            console.log(`✅ Found ${leads.length} potential artisan leads in the large dataset.`);
            
            const csvWriter = createObjectCsvWriter({
                path: OUTPUT,
                header: [
                    { id: 'email', title: 'email' },
                    { id: 'first_name', title: 'first_name' },
                    { id: 'company_name', title: 'company_name' },
                    { id: 'company_domain', title: 'company_domain' },
                    { id: 'industry', title: 'industry' }
                ]
            });

            await csvWriter.writeRecords(leads);
            console.log(`📂 Saved to ${OUTPUT}`);
        });
}

main();
