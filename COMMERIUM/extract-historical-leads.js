/**
 * extract-historical-leads.js
 * Pulls leads from the old USA csv and prepares them for verification.
 */

import fs from 'fs';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

const INPUT = 'artisan_os_usa_leads_2026-01-21T20-13-09-313Z.csv';
const OUTPUT = 'COMMERIUM/HISTORICAL_FOR_VERIFICATION.csv';
const PROCESSED_LEADS_FILE = 'PROCESSED_LEADS.csv';

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
            const email = (row['Best Email'] || '').toLowerCase().trim();
            if (!email || email === 'n/a' || email === 'none' || email.includes('example.com')) return;
            if (processed.has(email) || seen.has(email)) return;
            seen.add(email);

            leads.push({
                email: email,
                first_name: row['Contact Name'] === 'Store Owner' ? '' : row['Contact Name'],
                company_domain: row['Store Domain']
            });
        })
        .on('end', async () => {
            console.log(`✅ Extracted ${leads.length} historical leads.`);
            
            const csvWriter = createObjectCsvWriter({
                path: OUTPUT,
                header: [
                    { id: 'email', title: 'email' },
                    { id: 'first_name', title: 'first_name' },
                    { id: 'company_domain', title: 'company_domain' }
                ]
            });

            await csvWriter.writeRecords(leads);
            console.log(`📂 Saved to ${OUTPUT}`);
        });
}

main();
