import fs from 'fs';
import path from 'path';
import createCsvWriter from 'csv-writer';

const OUTPUT_DIR = '/Users/aminb101/leads-workflow/COMMERIUM';
const SOURCE_DIR = '/Users/aminb101/leads-workflow';

// Find all artisan_os CSV files
const csvFiles = fs.readdirSync(SOURCE_DIR)
    .filter(f => f.startsWith('artisan_os_usa_leads_') && f.endsWith('.csv'));

console.log(`📂 Found ${csvFiles.length} CSV files to merge:`);
csvFiles.forEach(f => console.log(`   - ${f}`));

// Collect all leads, deduplicating by domain
const allLeads = new Map();

for (const file of csvFiles) {
    const content = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8');
    const lines = content.split('\n');
    const header = lines[0];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV line (simple comma split - works for this data)
        const parts = line.split(',');
        const domain = parts[0];

        if (domain && !allLeads.has(domain)) {
            allLeads.set(domain, {
                domain: parts[0] || '',
                bestContact: parts[1] || 'Store Owner',
                bestEmail: parts[2] || 'N/A',
                scrapedEmails: parts[3] || '',
                dbName: parts[4] || 'N/A',
                dbEmail: parts[5] || 'N/A',
                dbTitle: parts[6] || 'N/A',
                dbLinkedin: parts[7] || 'N/A'
            });
        }
    }
}

console.log(`\n📊 Total unique leads: ${allLeads.size}`);

// Write merged CSV
const outputPath = path.join(OUTPUT_DIR, 'artisan_os_all_leads.csv');

const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: outputPath,
    header: [
        { id: 'domain', title: 'Store Domain' },
        { id: 'bestContact', title: 'Contact Name' },
        { id: 'bestEmail', title: 'Best Email' },
        { id: 'scrapedEmails', title: 'All Scraped Emails' },
        { id: 'dbName', title: 'DB Contact Name' },
        { id: 'dbEmail', title: 'DB Email' },
        { id: 'dbTitle', title: 'DB Title' },
        { id: 'dbLinkedin', title: 'LinkedIn' }
    ]
});

await csvWriter.writeRecords(Array.from(allLeads.values()));

console.log(`\n✅ MERGED CSV CREATED`);
console.log(`📁 Location: ${outputPath}`);
console.log(`📊 Total Leads: ${allLeads.size}`);

// Count emails
const withEmails = Array.from(allLeads.values()).filter(l => l.bestEmail && l.bestEmail !== 'N/A').length;
console.log(`📧 Leads with Emails: ${withEmails}`);
