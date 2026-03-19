/**
 * update-instantly-sequence.js
 * Updates the sequence for the existing Artisan OS campaign.
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

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

const NEW_SEQUENCE = [
    {
        subject: "your {{Niche}} catalog",
        body: `Hi {{Salutation}},\n\n{{Personalized_Opening}}\n\nI built a tool that turns one product photo into a full listing — description, pricing sheet, wholesale catalog. Under 60 seconds.\n\n{{The_AI_Pitch}}\n\nIt's not launched yet. I'm looking for a few early users to test it.\n\nThe deal: you pay the AI directly — about $0.05 per product. Nothing to us.\n\nNo subscription. No catch.\n\nInterested?\n\nAmin B.`,
        delay: 0
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Just bumping this up — did you see my note?\n\nAmin B.`,
        delay: 3
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Hi {{Salutation}},\n\nQuick version:\n\nOne photo → full product listing in 60 seconds.\n\nYou pay the AI directly, about $0.05 per item. We charge nothing to early users.\n\nReply and I'll walk you through it.\n\nAmin B.`,
        delay: 3
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `One of our early testers had 60 unlisted products.\n\nShe got through all of them in an afternoon — cost her about $3.\n\nWould that change anything for {{Company_Name}}?\n\nAmin B.`,
        delay: 4
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Hi {{Salutation}},\n\nHow long does it take you to write one product listing right now?\n\nMost makers say 20–40 minutes per item.\n\nWe get it to under 60 seconds, at about 5 cents per product.\n\nCurious how it works?\n\nAmin B.`,
        delay: 4
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Last one from me.\n\nEarly access is still open — no subscription, no monthly fee, just a few cents per listing.\n\nWhenever you're ready to stop building catalogs by hand, just reply.\n\nAmin B.`,
        delay: 5
    }
];

async function main() {
    try {
        console.log(`🔧 Updating sequence for campaign: ${CAMPAIGN_ID}...`);

        const steps = NEW_SEQUENCE.map((step, idx) => ({
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

        await api.patch(`/campaigns/${CAMPAIGN_ID}`, {
            sequences: [
                {
                    steps: steps
                }
            ]
        });
        console.log('✅ Sequence updated successfully with proper spacing, presale info, and creator signature.');

    } catch (err) {
        console.error('❌ Error updating sequence:');
        if (err.response) {
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err.message);
        }
    }
}

main();
