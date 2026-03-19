/**
 * finalize-batch-3.js
 * 1. Reads ARTISAN_BATCH_3_ENRICHED.csv
 * 2. Filters out obviously fake or malformed emails
 * 3. Formats salutations
 * 4. Outputs INSTANTLY_READY_BATCH_3.csv
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMMERIUM = path.join(__dirname, '..', 'COMMERIUM');

const INPUT = path.join(COMMERIUM, 'ARTISAN_BATCH_3_ENRICHED.csv');
const OUTPUT = path.join(COMMERIUM, 'INSTANTLY_READY_BATCH_3.csv');

const JUNK_EMAILS = new Set([
    'your.email@example.com', 'test@domain.com', 'name@email.com', 'nike@email.com',
    'support@creativecirclemedia.com', // Too corporate
    'jquery@ananas.min.mjs', // Parsing error
    'fullsizerender_345x345@2x.heic' // Parsing error
]);

const JUNK_DOMAINS = [
    'sentry.io', 'reddit.com', 'linkedin.com', 'un.org', 'framer.app', 'walmart.ca'
];

function isJunkEmail(email) {
    if (!email || !email.includes('@')) return true;
    const low = email.toLowerCase().trim();
    if (JUNK_EMAILS.has(low)) return true;
    if (low.includes('sentry.io')) return true;
    if (low.includes('example.com')) return true;
    if (low.includes('ingest.us.sentry.io')) return true;
    if (low.length < 5) return true;
    return false;
}

function getFirstName(fullName) {
    if (!fullName) return null;
    const cleaned = fullName.replace(/store owner/i, '').trim();
    if (!cleaned) return null;
    const first = cleaned.split(' ')[0].trim();
    if (first.length < 2) return null;
    return first;
}

async function main() {
    console.log('🚀 Finalizing Batch 3...');

    const rows = [];
    if (!fs.existsSync(INPUT)) {
        console.log('Input file not found. Exiting.');
        return;
    }

    await new Promise((resolve) => {
        fs.createReadStream(INPUT)
            .pipe(csvParser())
            .on('data', (row) => rows.push(row))
            .on('end', resolve);
    });

    console.log(`✅ Loaded ${rows.length} enriched leads.`);

    const header = [
        'Email',
        'Salutation',
        'Company_Name',
        'Niche',
        'Location',
        'Personalized_Opening',
        'The_AI_Pitch',
        'Website'
    ].join(',') + '\n';

    fs.writeFileSync(OUTPUT, header);

    let cleanCount = 0;

    for (const row of rows) {
        const email = (row.Email || row.email || '').toLowerCase().trim();
        const website = row.Website || '';
        
        if (isJunkEmail(email)) continue;
        
        // Skip junk domains
        if (JUNK_DOMAINS.some(d => website.includes(d))) continue;

        const contactName = row.Contact_Name || '';
        const company = row.Company_Name || website.split('.')[0].toUpperCase() || 'your studio';

        let salutation;
        const firstName = getFirstName(contactName);
        if (firstName) {
            salutation = firstName;
        } else {
            salutation = `${company.toLowerCase()} team`;
        }

        function esc(str) {
            if (!str) return '';
            return `"${str.toString().replace(/"/g, '""')}"`;
        }

        const line = [
            esc(email),
            esc(salutation),
            esc(company),
            esc(row.Niche_Segment),
            esc(row.Location || 'USA'),
            esc(row.Personalized_Opening),
            esc(row.The_AI_Pitch),
            esc(website)
        ].join(',') + '\n';

        fs.appendFileSync(OUTPUT, line);
        cleanCount++;
    }

    console.log(`\n📊 Cleaned Batch 3 breakdown:`);
    console.log(`   Final ready leads: ${cleanCount}`);
    console.log(`   Removed junk:     ${rows.length - cleanCount}`);
    console.log(`\n✅ DONE: ${OUTPUT}`);
}

main();
