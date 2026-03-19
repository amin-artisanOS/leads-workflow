import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import createCsvWriter from 'csv-writer';

dotenv.config();

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

async function enrich() {
    console.log('🚀 Starting APiFY Enrichment for Scraped Leads...');
    console.log('==============================================');

    let localLeads = [];
    try {
        localLeads = JSON.parse(fs.readFileSync('local_scraped_results.json', 'utf8'));
    } catch (e) {
        console.error('❌ Could not find local_scraped_results.json');
        return;
    }

    const finalLeads = [];

    for (const lead of localLeads) {
        console.log(`\n💎 Enriching: ${lead.domain}`);

        let leadData = {
            domain: lead.domain,
            source: 'local_scrape',
            name: 'Contact',
            title: 'Store Representative',
            email: lead.emails[0] || 'N/A',
            all_scraped_emails: lead.emails.join('; '),
            linkedin: 'N/A'
        };

        try {
            console.log(`  📡 Querying Apify Leads Finder for ${lead.domain}...`);
            const run = await client.actor('code_crafter/leads-finder').call({
                fetch_count: 1,
                contact_job_title: ["Owner", "CEO", "Founder", "Marketing"],
                company_domain: [lead.domain],
                has_email: true
            });

            const { items } = await client.dataset(run.defaultDatasetId).listItems();

            if (items && items.length > 0) {
                const dm = items[0];
                console.log(`  ✨ UPGRADE FOUND: ${dm.full_name || dm.name} (${dm.email})`);
                leadData.name = dm.full_name || dm.name || leadData.name;
                leadData.title = dm.job_title || dm.title || 'Owner/Decision Maker';
                leadData.email = dm.email || leadData.email;
                leadData.linkedin = dm.linkedin || dm.linkedin_url || 'N/A';
                leadData.source = 'apify_database';
            } else {
                console.log(`  ⏭️ No better lead in database. Keeping local email.`);
            }
        } catch (error) {
            console.log(`  ⚠️ Enrichment error: ${error.message}`);
        }

        finalLeads.push(leadData);
    }

    // Save to CSV
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: 'final_enriched_leads.csv',
        header: [
            { id: 'domain', title: 'Domain' },
            { id: 'name', title: 'Contact Person' },
            { id: 'title', title: 'Title' },
            { id: 'email', title: 'Email' },
            { id: 'source', title: 'Data Source' },
            { id: 'linkedin', title: 'LinkedIn' },
            { id: 'all_scraped_emails', title: 'All Local Emails' }
        ]
    });

    await csvWriter.writeRecords(finalLeads);

    console.log('\n\n✅ ENRICHMENT COMPLETE');
    console.log('==============================================');
    console.table(finalLeads.map(l => ({
        Domain: l.domain,
        Contact: l.name,
        Email: l.email,
        Source: l.source
    })));
    console.log(`\n📄 Final report saved to: final_enriched_leads.csv`);
}

enrich();
