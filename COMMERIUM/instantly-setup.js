/**
 * instantly-setup.js
 * Creates a campaign in Instantly.ai, sets the sequence, and uploads leads.
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

const LEADS_FILE = path.join(COMMERIUM, 'INSTANTLY_READY_ARTISAN_OS.csv');
const API_KEY = process.env.INSTANTLY_API_KEY;

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

async function readLeads() {
    const results = [];
    return new Promise((resolve) => {
        fs.createReadStream(LEADS_FILE)
            .pipe(csvParser())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results));
    });
}

const SEQUENCE = [
    {
        subject: "your {{Niche}} catalog",
        body: `Hi {{Salutation}},\n\n{{Personalized_Opening}}\n\nI'm reaching out because we built a tool for makers like you.\n\nYou take one photo of a product. It builds the full digital listing — description, pricing sheet, wholesale catalog. Done in 30 seconds.\n\n{{The_AI_Pitch}}\n\nIf it doesn't save you time in the first week, you don't pay. Simple.\n\nWorth a quick look?\n\n[Your Name]\n[Your Phone]\n[City, Country]`,
        delay: 0
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Just bumping this up.\n\nDid you get a chance to see my last note?\n\n[Your Name]`,
        delay: 3
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Hi {{Salutation}},\n\nQuick version of what I sent over:\n\nYou take one photo → we build the full wholesale catalog for you.\n\nNo monthly fee to start. No risk.\n\nWorth 10 minutes?\n\n[Your Name]`,
        delay: 3
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `One of our makers had 60 products she hadn't listed yet.\n\nShe did them all in an afternoon.\n\nWould that help {{Company_Name}}?\n\n[Your Name]`,
        delay: 4
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Hi {{Salutation}},\n\nReal question — how long does it take you to list one new product right now?\n\nMost makers tell us 20–40 minutes per item.\n\nWe get it to under 60 seconds.\n\nCurious how?\n\n[Your Name]`,
        delay: 4
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Last one from me.\n\nIf the timing isn't right — totally fine.\n\nWhenever you're ready to stop doing listings by hand, just reply and I'll show you how it works.\n\nGood luck with {{Company_Name}}.\n\n[Your Name]`,
        delay: 5
    }
];

const SCHEDULE = {
    "schedules": [
        {
            "name": "Default Schedule",
            "timing": {
                "from": "09:00",
                "to": "18:00"
            },
            "days": {
                "1": true,
                "2": true,
                "3": true,
                "4": true,
                "5": true
            },
            "timezone": "Africa/Ceuta"
        }
    ],
    "start_date": null,
    "end_date": null
};

async function main() {
    try {
        console.log('🚀 Creating campaign: Artisan OS - Elite 250...');
        const createRes = await api.post('/campaigns', {
            name: 'Artisan OS - Elite 250',
            campaign_schedule: SCHEDULE
        });

        const campaignId = createRes.data.id;
        console.log(`✅ Campaign created! ID: ${campaignId}`);

        console.log('🔧 Setting up email sequence...');

        const steps = SEQUENCE.map((step, idx) => ({
            type: 'email',
            delay: step.delay,
            delay_unit: 'days',
            variants: [
                {
                    subject: step.subject,
                    body: step.body
                }
            ]
        }));

        await api.patch(`/campaigns/${campaignId}`, {
            sequences: [
                {
                    steps: steps
                }
            ]
        });
        console.log('✅ Sequence set successfully.');

        console.log('📥 Loading leads from CSV...');
        const leads = await readLeads();
        console.log(`✅ Loaded ${leads.length} leads.`);

        console.log('📤 Uploading leads to campaign (one by one)...');
        const formattedLeads = leads.map(l => ({
            email: l.Email,
            first_name: l.Salutation.includes(' team') ? '' : l.Salutation,
            company_name: l.Company_Name,
            custom_variables: {
                Salutation: l.Salutation,
                Company_Name: l.Company_Name,
                Niche: l.Niche,
                Location: l.Location,
                Personalized_Opening: l.Personalized_Opening,
                The_AI_Pitch: l.The_AI_Pitch
            }
        }));
        for (let i = 0; i < formattedLeads.length; i++) {
            const leadData = formattedLeads[i];
            try {
                await api.post('/leads', {
                    campaign_id: campaignId,
                    ...leadData
                });
                if ((i + 1) % 10 === 0 || i === formattedLeads.length - 1) {
                    process.stdout.write(`\r   - Progress: ${i + 1}/${formattedLeads.length} leads uploaded`);
                }
            } catch (le) {
                console.error(`\r❌ Failed lead ${leadData.email}: ${le.message}`);
                // Continue with next lead
            }
        }
        console.log('\n');

        console.log('\n✨ ALL DONE!');
        console.log(`Campaign "Artisan OS - Elite 250" is ready with ${leads.length} leads.`);
        console.log(`🔗 Link: https://app.instantly.ai/campaigns/${campaignId}`);

    } catch (err) {
        console.error('❌ Error during setup:');
        if (err.response) {
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err.message);
        }
    }
}

main();
