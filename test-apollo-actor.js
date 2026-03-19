import dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';

dotenv.config();

const client = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

async function testApolloActor() {
    const domain = "wisehandmadejewelry.com";
    const titles = ['Owner', 'CEO', 'Founder'];

    console.log(`🔍 Testing Apollo Scraper Actor (microworlds/apollo-scraper) for domain: ${domain}`);

    // Construct the Apollo URL just like the Actor expectations or common patterns
    const apolloUrl = `https://app.apollo.io/#/people?page=1&personTitles[]=${titles.join('&personTitles[]=')}&organizationDomains[]=${domain}`;

    const input = {
        "url": apolloUrl,
        "max_result": 5,
        "contact_email_status_v2_verified": true
    };

    console.log(`📡 Input:`, JSON.stringify(input, null, 2));

    try {
        const run = await client.actor('microworlds/apollo-scraper').call(input);
        console.log(`✅ Actor Run ID: ${run.id}`);
        console.log(`⏳ Waiting for results...`);

        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        if (items.length > 0) {
            console.log(`🎉 Found ${items.length} items!`);
            console.log(JSON.stringify(items[0], null, 2));
        } else {
            console.log(`❌ No items found in dataset.`);
        }
    } catch (error) {
        console.error(`🔴 Actor execution failed:`, error.message);
    }
}

testApolloActor();
