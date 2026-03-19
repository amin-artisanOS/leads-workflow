/**
 * instantly-upload-batch-2.js
 * Uploads leads in bulk (up to 1000 per call) using POST /api/v2/leads/add
 * Correct field name: campaign_id (for bulk), campaign (for single)
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
const CAMPAIGN_ID = 'fadb7d84-824b-4f24-b859-37e7d2a3eb45'; // Artisan OS - Elite 250
const CHUNK_SIZE = 100; // Upload in chunks of 100

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

    // Salutation: use first name if not "team" fallback
    const isTeamFallback = (raw.Salutation || '').includes(' team');
    const firstName = isTeamFallback ? '' : (raw.Salutation || '');

    return {
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

async function uploadChunk(leads, chunkNum, total) {
    try {
        const r = await api.post('/leads/add', {
            campaign_id: CAMPAIGN_ID,
            leads,
            skip_if_in_workspace: false,
            skip_if_in_campaign: false
        });
        const added = r.data?.total_new_leads_added ?? '?';
        process.stdout.write(`\r   ✅ Chunk ${chunkNum}/${total} — ${added} new leads added.          `);
        return { success: true, added };
    } catch (e) {
        const msg = e.response?.data?.message || e.message;
        console.error(`\n❌ Chunk ${chunkNum} failed: ${msg}`);
        return { success: false, added: 0 };
    }
}

async function main() {
    console.log('🚀 INSTANTLY BULK UPLOAD — Artisan OS Campaign');
    console.log(`📋 Campaign: ${CAMPAIGN_ID}\n`);

    // Load both batches and deduplicate
    console.log('📥 Loading lead files...');
    const batch1 = await readLeads(BATCH_1_FILE);
    const batch2 = await readLeads(BATCH_2_FILE);
    console.log(`   Batch 1: ${batch1.length} rows`);
    console.log(`   Batch 2: ${batch2.length} rows`);

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

    console.log(`\n✨ Total unique valid leads to upload: ${allLeads.length}`);

    // Split into chunks and upload
    const chunks = [];
    for (let i = 0; i < allLeads.length; i += CHUNK_SIZE) {
        chunks.push(allLeads.slice(i, i + CHUNK_SIZE));
    }

    console.log(`📦 Uploading in ${chunks.length} chunks of ${CHUNK_SIZE}...\n`);

    let totalAdded = 0;
    for (let i = 0; i < chunks.length; i++) {
        const result = await uploadChunk(chunks[i], i + 1, chunks.length);
        if (result.success) totalAdded += result.added;
        await new Promise(r => setTimeout(r, 500)); // Small delay between chunks
    }

    console.log(`\n\n🎉 UPLOAD COMPLETE!`);
    console.log(`   Total new leads added: ${totalAdded}`);
    console.log(`🔗 https://app.instantly.ai/campaigns/${CAMPAIGN_ID}`);
}

main();
