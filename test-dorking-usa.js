import dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';
import axios from 'axios';

dotenv.config();

const apifyClient = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

console.log("Debug: APOLLO_API_KEY =", JSON.stringify(process.env.APOLLO_API_KEY));
console.log("Debug: Type of API KEY =", typeof process.env.APOLLO_API_KEY);
console.log("Debug: Length of API KEY =", process.env.APOLLO_API_KEY?.length);

async function runTest() {
    const product = "handmade jewelry";
    const country = "United States";
    const maxResults = 10;

    const queries = [
        `site:myshopify.com "${product}"`,
        `site:myshopify.com "handmade ${product}"`,
        `"powered by shopify" "${product}" artisan`
    ];

    console.log(`🔍 Searching for 10 leads in the USA...`);

    try {
        const input = {
            queries: queries.join('\n'),
            maxPagesPerQuery: 1,
            resultsPerPage: 10,
            mobileResults: false,
            gl: 'us',
            hl: 'en'
        };

        console.log(`📡 Calling Apify Google Search Scraper...`);
        const run = await apifyClient.actor('apify/google-search-scraper').call(input);
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

        const results = [];
        items.forEach(page => {
            if (page.organicResults) {
                page.organicResults.forEach(item => {
                    results.push({
                        name: item.title,
                        website: item.url,
                        description: item.description
                    });
                });
            }
        });

        // Unique domains only
        const uniqueLeads = [];
        const seen = new Set();
        for (const item of results) {
            try {
                const domain = new URL(item.website).hostname.replace('www.', '');
                if (!seen.has(domain) && !domain.includes('google.com')) {
                    seen.add(domain);
                    uniqueLeads.push(item);
                }
            } catch (e) { }
        }

        const finalLeads = uniqueLeads.slice(0, maxResults);
        console.log(`✅ Found ${finalLeads.length} leads!`);

        for (const lead of finalLeads) {
            console.log(`\n-------------------`);
            console.log(`Name: ${lead.name}`);
            console.log(`URL: ${lead.website}`);

            // Try to find email via Apollo
            console.log(`📧 Enrichment Attempt...`);
            try {
                const domain = new URL(lead.website).hostname.replace('www.', '');
                const response = await axios.post('https://api.apollo.io/api/v1/mixed_people/search', {
                    q_organization_domains: domain,
                    page: 1,
                    per_page: 1
                }, {
                    headers: {
                        'x-api-key': process.env.APOLLO_API_KEY,
                        'Content-Type': 'application/json'
                    }
                });

                if (response.data.people && response.data.people.length > 0) {
                    const person = response.data.people[0];
                    console.log(`👤 Contact: ${person.first_name} ${person.last_name} (${person.title})`);
                    console.log(`📧 Email: ${person.email || 'N/A'}`);
                } else {
                    console.log(`❌ No contact found in Apollo.`);
                }
            } catch (e) {
                console.log(`⚠️ Enrichment failed: ${e.message}`);
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

runTest();
