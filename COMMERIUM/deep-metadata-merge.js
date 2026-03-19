/**
 * deep-metadata-merge.js
 * Merges verified emails with their full metadata (Location, Company Name, Names) from the master DB.
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

const VERIFIED_LIST = path.join(COMMERIUM, 'ARTISAN_MASTER_TO_ENRICH.csv'); // Our 2003 list
const MASTER_DB_1 = path.join(ROOT, 'processed_leads.csv'); // 11k leads
const MASTER_DB_2 = path.join(ROOT, 'verified_leads.csv'); // 1.5k leads

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

function cleanInput(str) {
    if (!str) return '';
    return str.toString().trim().replace(/^"|"$/g, '');
}

async function main() {
    console.log('🏗️ BUILDING DEEP METADATA MASTER LIST...');

    const verifiedLeads = await readCSV(VERIFIED_LIST);
    const db1 = await readCSV(MASTER_DB_1);
    const db2 = await readCSV(MASTER_DB_2);

    // Build a lookup map of EVERY lead we've ever seen
    const dbMap = new Map();

    const processDB = (rows) => {
        rows.forEach(row => {
            const email = (row.email || row.Email || row.ContactEmail || '').toLowerCase().trim();
            if (!email) return;

            // Normalize names
            let firstName = row.firstName || row.First_Name || row['First Name'] || '';
            let lastName = row.lastName || row.Last_Name || row['Last Name'] || '';
            let fullName = row.companyName || row.name || row.Name || row['Contact Name'] || row['Full Name'] || '';

            if (fullName && !firstName && fullName.includes(' ')) {
                const parts = fullName.split(' ');
                firstName = parts[0];
                lastName = parts.slice(1).join(' ');
            }

            dbMap.set(email, {
                company: cleanInput(row.companyName || row.Company || row.Organization || row.domain || ''),
                firstName: cleanInput(firstName),
                lastName: cleanInput(lastName),
                fullName: cleanInput(fullName),
                city: cleanInput(row.city || row.City || ''),
                state: cleanInput(row.state || row.State || ''),
                country: cleanInput(row.country || row.Country || 'USA'),
                industry: cleanInput(row.industry || row.Industry || row.icp || 'Artisan Production'),
                website: cleanInput(row.website || row.Website || row.domain || '')
            });
        });
    };

    processDB(db1);
    processDB(db2);

    console.log(`📡 Database lookup loaded: ${dbMap.size} unique profiles.`);

    const finalOut = [];
    let matchCount = 0;

    verifiedLeads.forEach(v => {
        const email = v.email.toLowerCase().trim();
        const profile = dbMap.get(email);

        if (profile) {
            finalOut.push({
                email,
                firstName: profile.firstName || v.name?.split(' ')[0] || 'Store Owner',
                lastName: profile.lastName || v.name?.split(' ').slice(1).join(' ') || '',
                companyName: profile.company || v.domain?.split('.')[0] || 'Your Studio',
                website: profile.website || v.domain || '',
                city: profile.city || '',
                state: profile.state || '',
                country: profile.country || 'USA',
                industry: profile.industry || v.icp || 'Artisan'
            });
            matchCount++;
        } else {
            // Fallback for new dork scrapes with no DB entry yet
            finalOut.push({
                email,
                firstName: v.name?.split(' ')[0] || 'Store Owner',
                lastName: v.name?.split(' ').slice(1).join(' ') || '',
                companyName: v.domain?.split('.')[0] || 'Your Studio',
                website: v.domain || '',
                city: '',
                state: '',
                country: 'USA',
                industry: v.icp || 'Artisan'
            });
        }
    });

    console.log(`✅ Deep Merge Results: ${matchCount} leads fully enriched with location/names.`);

    const writer = createCsvWriter.createObjectCsvWriter({
        path: path.join(COMMERIUM, 'ARTISAN_PRO_MASTER_LIST.csv'),
        header: [
            { id: 'email', title: 'Email' },
            { id: 'firstName', title: 'First Name' },
            { id: 'lastName', title: 'Last Name' },
            { id: 'companyName', title: 'Company Name' },
            { id: 'website', title: 'Website' },
            { id: 'city', title: 'City' },
            { id: 'state', title: 'State/Region' },
            { id: 'country', title: 'Country' },
            { id: 'industry', title: 'Industry' }
        ]
    });

    await writer.writeRecords(finalOut);
    console.log(`\n🚀 FINAL CSV GENERATED: ${path.join(COMMERIUM, 'ARTISAN_PRO_MASTER_LIST.csv')}`);
}

main();
