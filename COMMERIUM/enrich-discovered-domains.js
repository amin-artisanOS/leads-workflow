/**
 * enrich-discovered-domains.js
 * 1. Reads domains from COMMERIUM/DISCOVERED_DOMAINS.txt
 * 2. Uses the CHEAP code_crafter/leads-finder ($1.5/1k)
 * 3. Saves results to COMMERIUM/BATCH_4_ENRICHED_RAW.csv
 */

import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import createCsvWriter from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const COMMERIUM = path.join(ROOT, 'COMMERIUM');
const INPUT_FILE = path.join(COMMERIUM, 'DISCOVERED_DOMAINS.txt');
const OUTPUT_FILE = path.join(COMMERIUM, 'BATCH_4_ENRICHED_RAW.csv');

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

async function main() {
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ Input file not found: ${INPUT_FILE}`);
        return;
    }

    const rawContent = fs.readFileSync(INPUT_FILE, 'utf8');
    const domains = rawContent.split('\n')
        .map(line => {
            try {
                const url = new URL(line.trim());
                return url.hostname.replace('www.', '');
            } catch {
                return line.trim();
            }
        })
        .filter(d => d && d.length > 3);

    console.log(`📋 Loaded ${domains.length} domains for enrichment.`);

    // Deduplicate domains
    const uniqueDomains = Array.from(new Set(domains));
    console.log(`🎯 ${uniqueDomains.length} unique domains after deduplication.`);

    // Initialize CSV
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: OUTPUT_FILE,
        header: [
            { id: 'email', title: 'email' },
            { id: 'name', title: 'name' },
            { id: 'domain', title: 'domain' },
            { id: 'title', title: 'title' }
        ]
    });

    const results = [];
    const CHUNK_SIZE = 50; // Small chunks for safer budget management

    for (let i = 0; i < uniqueDomains.length; i += CHUNK_SIZE) {
        // Check budget if possible? Apify doesn't give a simple "remaining credits" via client easily
        // but we'll try to process what we can.
        
        const chunk = uniqueDomains.slice(i, i + CHUNK_SIZE);
        console.log(`   Enriching chunk ${Math.floor(i/CHUNK_SIZE) + 1} of ${Math.ceil(uniqueDomains.length/CHUNK_SIZE)} (${chunk.length} domains)...`);
        
        try {
            const run = await client.actor('code_crafter/leads-finder').call({
                company_domain: chunk,
                contact_job_title: ["Owner", "Founder", "CEO", "Partner", "President"],
                has_email: true,
                max_leads_per_domain: 2
            });

            const { items } = await client.dataset(run.defaultDatasetId).listItems();
            const chunkLeads = [];
            
            items.forEach(item => {
                if (item.email && item.email.includes('@')) {
                    chunkLeads.push({
                        email: item.email,
                        name: item.full_name || item.name || 'Store Owner',
                        domain: item.company_domain || item.organization_domain || '',
                        title: item.job_title || ''
                    });
                }
            });

            if (chunkLeads.length > 0) {
                await csvWriter.writeRecords(chunkLeads);
                results.push(...chunkLeads);
                console.log(`      ✅ Added ${chunkLeads.length} leads.`);
            } else {
                console.log(`      ⚠️ No leads found in this chunk.`);
            }
        } catch (e) {
            console.error(`   ❌ Chunk failed: ${e.message}`);
            if (e.message.includes('exceed your remaining usage')) {
                console.log('🛑 Budget reached. Stopping enrichment.');
                break;
            }
        }
    }

    console.log(`\n🎉 ENRICHMENT COMPLETE!`);
    console.log(`📊 Total leads found: ${results.length}`);
    console.log(`📂 Saved to: ${OUTPUT_FILE}`);
}

main();
