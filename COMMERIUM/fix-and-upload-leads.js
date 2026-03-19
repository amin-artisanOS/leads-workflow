/**
 * fix-and-upload-leads.js
 * Updates all leads one by one to avoid the bulk endpoint's limit issues for updates.
 * Also ensures all personalization variables are correctly mapped.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import csvParser from 'csv-parser';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');

const BATCH_1_FILE = path.join(COMMERIUM, 'INSTANTLY_READY_ARTISAN_OS.csv');
const BATCH_2_FILE = path.join(COMMERIUM, 'INSTANTLY_READY_BATCH_2.csv');
const API_KEY = process.env.INSTANTLY_API_KEY;
const CAMPAIGN_ID = 'fadb7d84-824b-4f24-b859-37e7d2a3eb45';

if (!API_KEY) {
    console.error('❌ No INSTANTLY_API_KEY found in .env');
    process.exit(1);
}

const api = axios.create({
    baseURL: 'https://api.instantly.ai/api/v2',
    headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    }
});

function cleanEmail(email) {
    if (!email) return '';
    return email.trim().replace(/%20/g, '').replace(/\\/g, '').replace(/\s+/g, '').toLowerCase();
}

async function readLeads(filePath) {
    const results = [];
    if (!fs.existsSync(filePath)) return [];
    return new Promise((resolve) => {
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results));
    });
}

function formatLead(raw) {
    const email = cleanEmail(raw.Email);
    if (!email || !email.includes('@') || email.includes('@2x') || email.length < 5) return null;

    const isTeamFallback = (raw.Salutation || '').includes(' team');
    const firstName = isTeamFallback ? '' : (raw.Salutation || '');

    return {
        campaign: CAMPAIGN_ID, // Use 'campaign' for single lead endpoint
        email,
        first_name: firstName,
        company_name: raw.Company_Name || '',
        website: raw.Website || '',
        location: raw.Location || '',
        personalization: raw.Personalized_Opening || '',
        custom_variables: {
            Salutation: raw.Salutation || '',
            Company_Name: raw.Company_Name || '',
            Niche: raw.Niche || '',
            Location: raw.Location || '',
            Personalized_Opening: raw.Personalized_Opening || '',
            The_AI_Pitch: raw.The_AI_Pitch || ''
        }
    };
}

async function main() {
    console.log('🚀 RE-SYNCING LEADS — Artisan OS Campaign');

    const batch1 = await readLeads(BATCH_1_FILE);
    const batch2 = await readLeads(BATCH_2_FILE);
    const allRaw = [...batch1, ...batch2];

    const seen = new Set();
    const allLeads = [];
    for (const raw of allRaw) {
        const formatted = formatLead(raw);
        if (formatted && !seen.has(formatted.email)) {
            seen.add(formatted.email);
            allLeads.push(formatted);
        }
    }

    console.log(`✨ Syncing ${allLeads.length} unique leads...`);

    let success = 0;
    let fail = 0;

    for (let i = 0; i < allLeads.length; i++) {
        const lead = allLeads[i];
        try {
            await api.post('/leads', lead);
            success++;
            if (success % 10 === 0 || i === allLeads.length - 1) {
                process.stdout.write(`\r   - Progress: ${i + 1}/${allLeads.length} (Success: ${success}, Fail: ${fail})`);
            }
        } catch (e) {
            const msg = e.response?.data?.message || e.message;
            if (msg.includes('limit reached')) {
                fail++;
            } else {
                process.stdout.write(`\n❌ Failed ${lead.email}: ${msg}\n`);
                fail++;
            }
        }
        // Small delay to be polite
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n\n✅ DONE!`);
    console.log(`   Synced: ${success}`);
    console.log(`   Failed/Limit: ${fail}`);
}

main();
