/**
 * consolidate-session-leads.js
 * Merges Batch 2, 3, and 4 into a single file for the user.
 */

import fs from 'fs';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

const FILES = [
    'COMMERIUM/INSTANTLY_READY_BATCH_2.csv',
    'COMMERIUM/INSTANTLY_READY_BATCH_3.csv',
    'COMMERIUM/INSTANTLY_READY_BATCH_4.csv'
];
const OUTPUT = 'COMMERIUM/TOTAL_SESSION_LEADS_500.csv';

async function loadLeads(file) {
    const leads = [];
    if (!fs.existsSync(file)) return leads;
    
    return new Promise((resolve) => {
        fs.createReadStream(file)
            .pipe(csvParser())
            .on('data', (row) => leads.push(row))
            .on('end', () => resolve(leads));
    });
}

async function main() {
    let allLeads = [];
    for (const f of FILES) {
        const leads = await loadLeads(f);
        console.log(`Loaded ${leads.length} from ${f}`);
        allLeads.push(...leads);
    }

    // Deduplicate just in case
    const seen = new Set();
    const uniqueLeads = allLeads.filter(l => {
        const email = (l.Email || l.email).toLowerCase().trim();
        if (seen.has(email)) return false;
        seen.add(email);
        return true;
    });

    console.log(`Total unique leads: ${uniqueLeads.length}`);

    const csvWriter = createObjectCsvWriter({
        path: OUTPUT,
        header: [
            { id: 'Email', title: 'Email' },
            { id: 'Salutation', title: 'Salutation' },
            { id: 'Company_Name', title: 'Company_Name' },
            { id: 'Niche', title: 'Niche' },
            { id: 'Website', title: 'Website' }
        ]
    });

    await csvWriter.writeRecords(uniqueLeads);
    console.log(`✅ Final consolidated file: ${OUTPUT}`);
}

main();
