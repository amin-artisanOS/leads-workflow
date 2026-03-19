/**
 * instantly-upload-batch-4.js
 * Uploads 244 sanitized leads to Instantly.ai campaign: fadb7d84-824b-4f24-b859-37e7d2a3eb45
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

const INPUT = path.join(COMMERIUM, 'INSTANTLY_READY_BATCH_4.csv');
const CAMPAIGN_ID = 'fadb7d84-824b-4f24-b859-37e7d2a3eb45';
const API_KEY = process.env.INSTANTLY_API_KEY;

async function uploadLeads() {
    console.log('🚀 Uploading Batch 4 Leads to Instantly...');

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

    console.log(`✅ Loaded ${rows.length} leads for upload.`);

    // Instantly Bulk Add API v2
    const leads = rows.map(r => ({
        email: r.Email,
        first_name: r.Salutation,
        company_name: r.Company_Name,
        website: r.Website,
        custom_variables: {
            Salutation: r.Salutation,
            Niche: r.Niche
        }
    }));

    try {
        const payload = {
            campaign_id: CAMPAIGN_ID,
            leads: leads,
            skip_if_in_workspace: true, // Don't upload duplicates already in other campaigns
            skip_if_in_campaign: true 
        };

        const resp = await axios.post('https://api.instantly.ai/api/v2/leads/add', payload, {
            headers: { 
                Authorization: 'Bearer ' + API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ UPLOAD SUCCESSFUL!');
        console.log('Total added:', resp.data.added);
    } catch (e) {
        console.error('❌ UPLOAD FAILED:', e.response?.data || e.message);
    }
}

uploadLeads();
