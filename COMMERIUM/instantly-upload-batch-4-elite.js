/**
 * instantly-upload-batch-4-elite.js
 * Uploads the fully AI-enriched Batch 4 leads to Instantly.ai.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMMERIUM = path.join(__dirname, '..', 'COMMERIUM');

const INPUT = path.join(COMMERIUM, 'BATCH_4_ELITE_ENRICHED.csv');
const CAMPAIGN_ID = 'fadb7d84-824b-4f24-b859-37e7d2a3eb45';
const API_KEY = process.env.INSTANTLY_API_KEY;

async function uploadLeads() {
    console.log('🚀 Uploading ELITE AI-Enriched Batch 4 Leads to Instantly...');

    const rows = [];
    if (!fs.existsSync(INPUT)) {
        console.error(`❌ Input file not found: ${INPUT}`);
        return;
    }

    await new Promise((resolve) => {
        fs.createReadStream(INPUT)
            .pipe(csvParser())
            .on('data', (row) => rows.push(row))
            .on('end', resolve);
    });

    // Filter out badly enriched ones
    const validRows = rows.filter(r => 
        r.Personalized_Opening && 
        !r.Personalized_Opening.includes('Unable to determine') &&
        !r.Personalized_Opening.includes('Not enough information') &&
        !r.Personalized_Opening.includes('I am unable to')
    );

    console.log(`✅ Loaded ${validRows.length} valid, fully personalized leads for upload (out of ${rows.length}).`);

    const leads = validRows.map(r => ({
        email: r.Email,
        first_name: r.Salutation,
        company_name: r.Company_Name,
        website: r.Website,
        custom_variables: {
            Salutation: r.Salutation,
            Niche: r.Niche,
            Personalized_Opening: r.Personalized_Opening
        }
    }));

    try {
        const payload = {
            campaign_id: CAMPAIGN_ID,
            leads: leads,
            skip_if_in_workspace: false, // Set to false to UPDATE existing leads with the new personalized opening
            skip_if_in_campaign: false 
        };

        const resp = await axios.post('https://api.instantly.ai/api/v2/leads/add', payload, {
            headers: { 
                Authorization: 'Bearer ' + API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ UPLOAD SUCCESSFUL!');
        console.log('Total added or updated:', resp.data.added);
    } catch (e) {
        console.error('❌ UPLOAD FAILED:', e.response?.data || e.message);
    }
}

uploadLeads();
