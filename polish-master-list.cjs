const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer');

const inputFile = '/Users/aminb101/leads-workflow/COMMERIUM/artisan_os_split_names_2026-01-21T21-23-11-714Z.csv';
const outputFile = '/Users/aminb101/leads-workflow/COMMERIUM/ARTISAN_OS_MASTER_LIST.csv';

const leads = [];
const junkEmails = ['email@example.com', 'your-email@example.com', 'xxx@xxx.xxx', 'your@email.com', 'test@test.com'];

fs.createReadStream(inputFile)
    .pipe(csv())
    .on('data', (row) => {
        // Filter out N/A emails
        if (row['Contact Email'] === 'N/A' || !row['Contact Email']) return;

        // Filter out junk emails
        if (junkEmails.includes(row['Contact Email'].toLowerCase())) return;

        // Clean up "Store Owner" to something more natural if needed or keep it?
        // User wants the list "well", so let's keep it professional.

        leads.push(row);
    })
    .on('end', () => {
        const csvWriter = createCsvWriter.createObjectCsvWriter({
            path: outputFile,
            header: [
                { id: 'Domain', title: 'Domain' },
                { id: 'Company Name', title: 'Company Name' },
                { id: 'Website', title: 'Website' },
                { id: 'Niche', title: 'Niche' },
                { id: 'Country', title: 'Country' },
                { id: 'Description', title: 'Description' },
                { id: 'First Name', title: 'First Name' },
                { id: 'Last Name', title: 'Last Name' },
                { id: 'Contact Title', title: 'Contact Title' },
                { id: 'Contact Email', title: 'Contact Email' },
                { id: 'Contact LinkedIn', title: 'Contact LinkedIn' },
                { id: 'All Scraped Emails', title: 'All Scraped Emails' },
                { id: 'Phone', title: 'Phone' },
                { id: 'Social Links', title: 'Social Links' },
                { id: 'Company Size', title: 'Company Size' },
                { id: 'Company LinkedIn', title: 'Company LinkedIn' },
                { id: 'Industry', title: 'Industry' },
                { id: 'Location', title: 'Location' },
                { id: 'Found Via Query', title: 'Found Via Query' },
                { id: 'Data Source', title: 'Data Source' }
            ]
        });

        csvWriter.writeRecords(leads).then(() => {
            console.log(`\n💎 MASTER LIST READY`);
            console.log(`=========================`);
            console.log(`📊 Cleaned Leads: ${leads.length}`);
            console.log(`📂 Path: ${outputFile}`);
            console.log(`\n(Filtered out 0 emails and placeholder addresses like 'email@example.com')`);
        });
    });
