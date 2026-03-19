/**
 * finalize-instantly-export.js
 * Takes the enriched master list and produces a clean Instantly-ready CSV with:
 * - A smart salutation: first name if real, otherwise "{{companyName}} team"
 * - All Instantly personalization variables in one place
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMMERIUM = path.join(__dirname, '..', 'COMMERIUM');

const INPUT = path.join(COMMERIUM, 'ARTISAN_ELITE_CLEAN_BATCH_2.csv');
const OUTPUT = path.join(COMMERIUM, 'INSTANTLY_READY_BATCH_2.csv');

// Names that are clearly generic — fall back to company name
const GENERIC_NAMES = new Set([
    'the maker', 'store owner', 'owner', 'seller', 'unknown', '', 'n/a', 'admin'
]);

function isGenericName(name) {
    if (!name) return true;
    const lower = name.toLowerCase().trim();
    if (GENERIC_NAMES.has(lower)) return true;
    if (lower.startsWith('the maker at')) return true;
    if (lower.startsWith('expert at')) return true;
    return false;
}

function getFirstName(fullName) {
    if (!fullName) return null;
    const first = fullName.split(' ')[0].trim();
    if (first.length < 2) return null;
    return first;
}

async function main() {
    console.log('🚀 Finalizing Instantly-Ready Export...');

    const rows = [];
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

    let realNameCount = 0;
    let teamFallbackCount = 0;

    for (const row of rows) {
        const contactName = row['Contact_Name'] || '';
        const company = row['Company_Name'] || row['Website'] || 'your studio';

        let salutation;
        if (!isGenericName(contactName)) {
            const firstName = getFirstName(contactName);
            if (firstName) {
                salutation = firstName;
                realNameCount++;
            } else {
                salutation = `${company} team`;
                teamFallbackCount++;
            }
        } else {
            salutation = `${company} team`;
            teamFallbackCount++;
        }

        function esc(str) {
            if (!str) return '';
            return `"${str.toString().replace(/"/g, '""')}"`;
        }

        const line = [
            esc(row['Email']),
            esc(salutation),
            esc(row['Company_Name']),
            esc(row['Niche_Segment']),
            esc(row['Location']),
            esc(row['Personalized_Opening']),
            esc(row['The_AI_Pitch']),
            esc(row['Website'])
        ].join(',') + '\n';

        fs.appendFileSync(OUTPUT, line);
    }

    console.log(`\n📊 Salutation breakdown:`);
    console.log(`   Real first names found: ${realNameCount}`);
    console.log(`   Company team fallback:  ${teamFallbackCount}`);
    console.log(`\n✅ DONE: ${OUTPUT}`);
    console.log(`   → ${rows.length} leads ready to upload to Instantly`);
}

main();
