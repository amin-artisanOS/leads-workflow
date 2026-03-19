import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
dotenv.config();

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

async function testActor(name) {
    try {
        console.log(`Testing actor: ${name}...`);
        const actor = await client.actor(name).get();
        console.log(`✅ Actor ${name} found!`);
        return true;
    } catch (e) {
        console.log(`❌ Actor ${name} NOT found: ${e.message}`);
        return false;
    }
}

async function run() {
    await testActor('apify/contact-details-scraper');
    await testActor('vdrmota/contact-info-scraper');
    await testActor('microworlds/apollo-scraper');
    await testActor('apify/google-search-scraper');
}
run();
