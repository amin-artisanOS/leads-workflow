/**
 * update-instantly-commerium.js
 * Updates the sequence for the Commerium campaign.
 * Fixes the branding (Commerium) and the pricing placeholder error.
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
        body: `Hi {{Salutation}},\n\nSince Commerium is still in pre-launch and we’re looking for a few "anchor" brands to test it, the software itself is $0/month for you.\n\nWe use a "Bring Your Own API" model. You just plug in your own OpenAI key and pay them directly for the "AI fuel" you actually use. It works out to about $0.05 to $0.10 per listing, and nothing goes to us.\n\nYou can see a video demo of how it works right here: trycommerium.com\n\nI saw your shop is running on WooCommerce. We are currently rolling out our direct-sync integration for it (ready in a few days), but in the meantime, the tool generates high-converting listings you can use immediately.\n\nI'd love to record a quick 60-second video using one of your actual {{Niche}} photos so you can see the results for your specific brand. Would that be helpful?\n\nBest,\nAmin B.`,
        delay: 0
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Just bumping this up — did you see my note about the 60-second demo for {{Company_Name}}?\n\nI can show you exactly how Commerium handles your specific products.\n\nAmin B.`,
        delay: 3
    },
    {
        subject: "RE: your {{Niche}} catalog",
        body: `Hi {{Salutation}},\n\nQuick version: One photo → full product listing in 60 seconds.\n\nYou pay the AI directly (~5 cents per item) and we charge nothing for the software itself while we are in pre-launch.\n\nWould you like to see that video demo?\n\nAmin B.`,
        delay: 3
    }
];

async function main() {
    try {
        console.log(`🔧 Updating sequence for campaign: ${CAMPAIGN_ID} to Commerium branding...`);

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
        console.log('✅ Sequence updated successfully with Commerium branding and fixed pricing.');

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
