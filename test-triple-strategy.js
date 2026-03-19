import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
dotenv.config();

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

async function testTripleEnrichment() {
    const domain = "cadettejewelry.com";
    console.log(`🚀 Testing Triple Strategy for: ${domain}`);

    // Strategy 3 (Scraper) test
    try {
        console.log(`🌐 Scraping ${domain} directly...`);
        const run = await client.actor('apify/contact-details-scraper').call({
            startUrls: [{ url: `https://${domain}` }],
            maxDepth: 1,
            sameEnvelop: true
        });

        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        if (items && items.length > 0) {
            const contacts = items[0];
            console.log(`✅ Scraper Found:`, contacts.emails || "No emails");
        }
    } catch (e) {
        console.error("❌ Scraper failed:", e.message);
    }
}

testTripleEnrichment();
