/**
 * clear-and-reload-leads-v3.js
 * 1. Wipe all leads from the account using a reliable single-delete method.
 * 2. Re-upload the Artisan OS leads from our CSVs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import csvParser from 'csv-parser';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.INSTANTLY_API_KEY;
const TARGET_CAMPAIGN_ID = 'fadb7d84-824b-4f24-b859-37e7d2a3eb45';
const COMMERIUM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'COMMERIUM');

const BATCH_1_FILE = path.join(COMMERIUM, 'INSTANTLY_READY_ARTISAN_OS.csv');
const BATCH_2_FILE = path.join(COMMERIUM, 'INSTANTLY_READY_BATCH_2.csv');

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

async function clearAccount() {
    console.log('🧹 Wiping account leads (reliable method)...');
    const processedIds = new Set();
    let totalDeleted = 0;
    let consecutiveEmpty = 0;

    while (consecutiveEmpty < 2) {
        try {
            // Fetch next batch
            const res = await api.post('/leads/list', { limit: 100 });
            const items = res.data.items || [];

            // Filter to only new IDs we haven't tried to delete in this run
            const newLeads = items.filter(l => !processedIds.has(l.id));

            if (newLeads.length === 0) {
                consecutiveEmpty++;
                if (items.length > 0) {
                    console.log('\n⌛ Waiting for API to reflect deletions...');
                    await new Promise(r => setTimeout(r, 2000));
                }
                continue;
            }

            consecutiveEmpty = 0;

            for (const lead of newLeads) {
                try {
                    // Instantly is very picky: 
                    // - If Content-Type is application/json, body cannot be empty.
                    // - If body is {}, it says body must be null. 
                    // Solution: Use a clean request without the default JSON header.
                    await axios.delete(`https://api.instantly.ai/api/v2/leads/${lead.id}`, {
                        headers: { 'Authorization': `Bearer ${API_KEY}` }
                    });
                    processedIds.add(lead.id);
                    totalDeleted++;
                    process.stdout.write(`\r   - Deleted: ${totalDeleted} leads`);
                } catch (de) {
                    if (de.response?.status !== 404) {
                        console.error(`\n❌ Failed to delete ${lead.id}: ${de.response?.data?.message || de.message}`);
                    }
                }
            }

            // Wait a bit after a batch delete
            await new Promise(r => setTimeout(r, 500));

        } catch (err) {
            console.error('\n❌ Error fetching list:', err.message);
            break;
        }
    }
    console.log(`\n✅ Account wipe finished. Total unique leads deleted: ${totalDeleted}\n`);
}

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

function cleanCompanyName(name) {
    if (!name) return '';
    // 1. Remove common legal suffixes (case insensitive, with optional punctuation)
    let cleaned = name.replace(/\b(LLC|INC|LTD|CO|CORP|CORPORATION|LIMITED)\b[.,]?/gi, '').trim();
    // 2. Remove trailing commas or extra spaces
    cleaned = cleaned.replace(/[,]$/, '').trim();
    // 3. Fix ALL CAPS or all lowercase to Title Case
    if (cleaned.length > 0 && (cleaned === cleaned.toUpperCase() || cleaned === cleaned.toLowerCase())) {
        cleaned = cleaned.toLowerCase().split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
    return cleaned || name;
}

function formatLead(raw) {
    const email = cleanEmail(raw.Email);
    if (!email || !email.includes('@') || email.includes('@2x') || email.length < 5) return null;

    const rawCompany = raw.Company_Name || '';
    const cleanedCompany = cleanCompanyName(rawCompany);

    let rawSalutation = raw.Salutation || '';
    let cleanedSalutation = rawSalutation;

    // If salutation contains the original company name, replace it with the clean version
    if (rawCompany && rawSalutation.toLowerCase().includes(rawCompany.toLowerCase())) {
        cleanedSalutation = rawSalutation.replace(new RegExp(rawCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), cleanedCompany);
    } else {
        // Otherwise just clean any LLC/Caps from the salutation directly
        cleanedSalutation = cleanCompanyName(rawSalutation);
    }

    const isTeamFallback = (cleanedSalutation || '').toLowerCase().includes(' team');

    return {
        email,
        first_name: isTeamFallback ? '' : cleanedSalutation,
        company_name: cleanedCompany,
        website: raw.Website || '',
        location: raw.Location || '',
        personalization: raw.Personalized_Opening || '',
        custom_variables: {
            Salutation: cleanedSalutation,
            Company_Name: cleanedCompany,
            Niche: raw.Niche || '',
            Location: raw.Location || '',
            Personalized_Opening: raw.Personalized_Opening || '',
            The_AI_Pitch: raw.The_AI_Pitch || ''
        }
    };
}

async function main() {
    await clearAccount();

    console.log('🚀 RE-LOADING CLEAN LEADS...');
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

    console.log(`✨ Total unique leads to upload: ${allLeads.length}`);

    const CHUNK_SIZE = 50; // Smaller chunks for reliability
    for (let i = 0; i < allLeads.length; i += CHUNK_SIZE) {
        const chunk = allLeads.slice(i, i + CHUNK_SIZE);
        try {
            await api.post('/leads/add', {
                campaign_id: TARGET_CAMPAIGN_ID,
                leads: chunk,
                skip_if_in_workspace: false,
                skip_if_in_campaign: false
            });
            process.stdout.write(`\r   - Upload progress: ${Math.min(i + CHUNK_SIZE, allLeads.length)}/${allLeads.length} leads`);
        } catch (e) {
            console.error(`\n❌ Upload failed at ${i}:`, e.response?.data || e.message);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n\n🎉 ALL DONE! Campaign is refreshed with clean leads.`);
    console.log(`🔗 https://app.instantly.ai/campaigns/${TARGET_CAMPAIGN_ID}`);
}

main();
