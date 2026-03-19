import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import createCsvWriter from 'csv-writer';

dotenv.config();

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const domains = [
    'jmillsstudio.com',
    'melrosia.com',
    'madisonwithlove.com',
    'estygrossman.com',
    'mettlebyabby.com',
    'hanaijewelry.com',
    'shop.stilosissima.com',
    'cadettejewelry.com'
];

async function processLeads() {
    console.log(`🚀 Processing ${domains.length} domains via Apify Leads Finder...`);
    const results = [];

    for (const domain of domains) {
        console.log(`🔍 Searching contacts for: ${domain}`);
        try {
            const run = await client.actor('code_crafter/leads-finder').call({
                fetch_count: 2,
                contact_job_title: ["Owner", "Founder", "CEO", "Marketing"],
                company_domain: [domain],
                has_email: true
            });

            const { items } = await client.dataset(run.defaultDatasetId).listItems();
            console.log(`✅ Found ${items.length} leads for ${domain}`);

            items.forEach(item => {
                results.push({
                    domain: domain,
                    name: item.full_name || item.name || 'N/A',
                    title: item.job_title || item.title || 'N/A',
                    email: item.email || 'N/A',
                    linkedin: item.linkedin || item.linkedin_url || 'N/A'
                });
            });
        } catch (e) {
            console.error(`❌ Error processing ${domain}:`, e.message);
        }
        // Small delay to avoid hitting rate limits too hard
        await new Promise(r => setTimeout(r, 500));
    }

    // Save to CSV
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: 'dorked_leads_enriched.csv',
        header: [
            { id: 'domain', title: 'Domain' },
            { id: 'name', title: 'Name' },
            { id: 'title', title: 'Title' },
            { id: 'email', title: 'Email' },
            { id: 'linkedin', title: 'LinkedIn' }
        ]
    });

    await csvWriter.writeRecords(results);
    console.log('\n✨ Processing Complete!');
    console.log(`📊 Total Leads Enriched: ${results.length}`);
    console.log('📄 Saved to: dorked_leads_enriched.csv');

    console.log('\n--- Preview ---');
    results.forEach(r => console.log(`${r.domain}: ${r.name} (${r.email})`));
}

processLeads();
