/**
 * finalize-batch-4.js
 * 1. Reads raw local results.
 * 2. Deduplicates against previous campaigns and historical leads.
 * 3. Removes placeholder/junk emails.
 * 4. Saves a clean list for MillionVerifier.
 */

import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

const RAW_FILE = 'COMMERIUM/BATCH_4_LOCAL_RAW.csv';
const PROCESSED_LEADS_FILE = 'PROCESSED_LEADS.csv';
const OTHER_READY_FILES = [
    'COMMERIUM/INSTANTLY_READY_ARTISAN_OS.csv',
    'COMMERIUM/INSTANTLY_READY_BATCH_2.csv',
    'COMMERIUM/INSTANTLY_READY_BATCH_3.csv'
];
const OUTPUT_FILE = 'COMMERIUM/BATCH_4_CLEANED_FOR_VERIFICATION.csv';

const JUNK_EMAILS = new Set([
    'your@email.com', 'email@example.com', 'xxx@xxx.xxx', 'your-email@example.com',
    'john@example.com', 'jane@example.com', 'info@yourstore.com', 'support@yourstore.com',
    'shop@yourstore.com', 'sales@yourstore.com', 'contact@yourstore.com',
    'email@yourdomain.com', 'test@test.com', 'shimmernsuds@gmail.comphone',
    'mountainmademerch@gmail.comphone'
]);

const JUNK_DOMAINS = [
    'example.com', 'yourstore.com', 'test.com', 'xxx.xxx'
];

async function loadEmails(filePath) {
    const emails = new Set();
    if (!fs.existsSync(filePath)) return emails;
    
    return new Promise((resolve) => {
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (row) => {
                const email = row.email || row.Email || row.EMAIL;
                if (email) emails.add(email.toLowerCase().trim());
            })
            .on('end', () => resolve(emails));
    });
}

async function main() {
    console.log('🧹 Finalizing Batch 4 leads...');

    // 1. Load existing emails to avoid duplicates
    const existingEmails = new Set();
    
    const processed = await loadEmails(PROCESSED_LEADS_FILE);
    processed.forEach(e => existingEmails.add(e));
    console.log(`Loaded ${processed.size} emails from PROCESSED_LEADS.csv`);

    for (const file of OTHER_READY_FILES) {
        const other = await loadEmails(file);
        other.forEach(e => existingEmails.add(e));
        console.log(`Loaded ${other.size} emails from ${file}`);
    }

    // 2. Process raw results
    const cleanLeads = [];
    const seenInThisBatch = new Set();

    if (!fs.existsSync(RAW_FILE)) {
        console.error(`❌ Raw file not found: ${RAW_FILE}`);
        return;
    }

    fs.createReadStream(RAW_FILE)
        .pipe(csvParser())
        .on('data', (row) => {
            let email = (row.email || '').toLowerCase().trim();
            
            // Basic cleaning
            if (!email || email === '' || email.includes(' ') || !email.includes('@')) return;
            
            // Remove junk
            if (JUNK_EMAILS.has(email)) return;
            if (JUNK_DOMAINS.some(d => email.endsWith(d))) return;
            
            // Deduplicate against history
            if (existingEmails.has(email)) return;
            
            // Deduplicate against itself
            if (seenInThisBatch.has(email)) return;
            seenInThisBatch.add(email);

            cleanLeads.push({
                email: email,
                name: row.name || 'Store Owner',
                domain: row.domain || '',
                title: row.title || 'Owner'
            });
        })
        .on('end', async () => {
            console.log(`✅ Found ${cleanLeads.length} unique, fresh artisan leads.`);
            
            const csvWriter = createObjectCsvWriter({
                path: OUTPUT_FILE,
                header: [
                    { id: 'email', title: 'email' },
                    { id: 'name', title: 'first_name' },
                    { id: 'domain', title: 'company_domain' },
                    { id: 'title', title: 'job_title' }
                ]
            });

            await csvWriter.writeRecords(cleanLeads);
            console.log(`🚀 Cleaned leads saved to: ${OUTPUT_FILE}`);
            console.log(`Ready for MillionVerifier!`);
        });
}

main();
