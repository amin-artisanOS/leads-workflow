#!/usr/bin/env node
// Usage: node cli/import-leads.js --file=COMMERIUM/ARTISAN_PRO_NEW_READY.csv --campaign=1

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';
import dotenv from 'dotenv';
import { pool, upsertLead } from '../engine/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function getArgValue(flag) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
  }
  return null;
}

const FILE     = getArgValue('--file');
const CAMPAIGN = parseInt(getArgValue('--campaign') || '0', 10);

if (!FILE || !CAMPAIGN) {
  console.error('Usage: node cli/import-leads.js --file=leads.csv --campaign=<id>');
  process.exit(1);
}

const filePath = path.resolve(FILE);
if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }

let imported = 0, skipped = 0, total = 0;
const promises = [];

await new Promise((resolve, reject) => {
  fs.createReadStream(filePath)
    .pipe(csvParser())
    .on('data', (row) => {
      total++;
      const email = (row.Email || row.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) { skipped++; return; }

      const p = upsertLead({
        campaign_id:          CAMPAIGN,
        email,
        first_name:           row.FirstName   || row['First Name Enriched'] || row.first_name  || '',
        last_name:            row.LastName    || row['Last Name Enriched']  || row.last_name   || '',
        company:              row.Company_Name || row['Company Clean']       || row.company     || '',
        website:              row.Website     || row['Website Enriched']    || row.website     || '',
        niche:                row.Niche       || row.niche                  || '',
        salutation:           row.Salutation  || row.salutation             || '',
        personalized_opening: row.Personalized_Opening || row.personalized_opening || '',
      }).then(result => { if (result) imported++; else skipped++; });

      promises.push(p);

      if (total % 100 === 0)
        process.stdout.write(`\r  Processed ${total}... (${imported} new, ${skipped} skipped)`);
    })
    .on('end', resolve)
    .on('error', reject);
});

await Promise.all(promises);
console.log(`\n✅ Import complete: ${imported} imported, ${skipped} skipped (dupes/invalid)`);
await pool.end();
