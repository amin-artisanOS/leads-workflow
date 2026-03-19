/**
 * build-2k-elite-master.js
 * Creates a clean master list of 2000+ leads that MUST have both Email and Website.
 * Filters for artisan/maker keywords.
 * Handles varying column names.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';
import createCsvWriter from 'csv-writer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');

const SOURCES = [
    path.join(COMMERIUM, 'VERIFIED_NEW_ARTISANS.csv'),
    path.join(ROOT, 'artisan_os_usa_leads_2026-01-21T19-52-40-428Z.csv'),
    path.join(ROOT, 'artisan_os_usa_leads_2026-01-21T20-13-09-313Z.csv'),
    path.join(COMMERIUM, 'artisan_os_all_leads.csv'),
    path.join(COMMERIUM, 'artisan_os_full_2026-01-21T20-55-34-288Z.csv'),
    path.join(COMMERIUM, 'ARTISAN_OS_FINAL_FOR_INSTANTLY.csv'),
    path.join(ROOT, 'processed_leads.csv')
];

const ARTISAN_KEYWORDS = [
    'artisan', 'handcrafted', 'handmade', 'pottery', 'ceramics', 'studio', 'workshop',
    'maker', 'jewelry', 'woodwork', 'leather', 'candle', 'soap', 'weaver', 'knit',
    'crochet', 'glassblower', 'blacksmith', 'craft', 'boutique', 'atelier'
];

function isArtisan(row) {
    const text = JSON.stringify(row).toLowerCase();
    return ARTISAN_KEYWORDS.some(k => text.includes(k));
}

function cleanUrl(url) {
    if (!url) return '';
    let cleaned = url.trim().toLowerCase();
    if (cleaned.startsWith('www.')) cleaned = 'https://' + cleaned;
    if (!cleaned.startsWith('http') && cleaned.includes('.')) cleaned = 'https://' + cleaned;
    try {
        const u = new URL(cleaned);
        return u.origin;
    } catch (e) {
        return '';
    }
}

function getVal(row, keys) {
    for (const key of keys) {
        if (row[key]) return row[key].trim();
        // Case-insensitive search
        const lowerKey = key.toLowerCase();
        for (const k in row) {
            if (k.toLowerCase() === lowerKey) return row[k].trim();
        }
    }
    return '';
}

async function readSource(filePath) {
    const results = [];
    if (!fs.existsSync(filePath)) return results;

    return new Promise((resolve) => {
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', () => resolve([]));
    });
}

async function main() {
    console.log('🏗️ BUILDING 2K ELITE MASTER LIST...');
    const finalLeads = new Map(); // email -> lead object

    for (const filePath of SOURCES) {
        console.log(`  📄 Processing ${path.basename(filePath)}...`);
        const rows = await readSource(filePath);

        let added = 0;
        for (const row of rows) {
            const email = getVal(row, ['Email', 'Best Email', 'DB Email']).toLowerCase();
            const url = cleanUrl(getVal(row, ['Domain', 'Store Domain', 'Website', 'website']));

            if (email && url && email.includes('@') && !finalLeads.has(email)) {
                if (isArtisan(row) || path.basename(filePath).toLowerCase().includes('artisan')) {
                    finalLeads.set(email, {
                        email: email,
                        website: url,
                        company_name: getVal(row, ['Company Name', 'Company_Name', 'companyName']),
                        contact_name: getVal(row, ['Contact Name', 'Contact_Name', 'firstName', 'DB Contact Name']) || 'Store Owner',
                        niche: getVal(row, ['ICP Segment', 'Industry', 'niche', 'ICP Targeting']) || 'Artisan Production'
                    });
                    added++;
                }
            }
        }
        console.log(`    ✅ Added ${added} unique artisan leads.`);
    }

    const leadsArray = Array.from(finalLeads.values());
    console.log(`\n✨ TOTAL ELITE LEADS FOUND: ${leadsArray.length}`);

    const outputPath = path.join(COMMERIUM, 'ARTISAN_PRO_MASTER_LIST_V2.csv');
    const writer = createCsvWriter.createObjectCsvWriter({
        path: outputPath,
        header: [
            { id: 'email', title: 'Email' },
            { id: 'contact_name', title: 'First Name' },
            { id: 'company_name', title: 'Company Name' },
            { id: 'website', title: 'Website' },
            { id: 'niche', title: 'Industry' }
        ]
    });

    await writer.writeRecords(leadsArray);
    console.log(`🚀 SAVED: ${outputPath}`);
}

main();
