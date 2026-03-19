import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
dotenv.config();

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

async function test() {
    try {
        console.log('Running Apify test...');
        const run = await client.actor('apify/google-search-scraper').call({
            queries: 'test pottery shopify',
            maxPagesPerQuery: 1,
            resultsPerPage: 10
        });

        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        console.log('SUCCESS: Items found:', items.length);
        if (items.length > 0) {
            console.log('Keys:', Object.keys(items[0]));
            if (items[0].organicResults) {
                console.log('Organic results count:', items[0].organicResults.length);
            }
        }
    } catch (e) {
        console.error('FAILURE:', e.message);
    }
}
test();
