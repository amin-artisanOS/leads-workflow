/**
 * prepare-batch-4-upload.js
 * Enriches verified leads with niche mapping and salutations.
 * Ready for Instantly.ai upload.
 */

import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

const INPUT = 'COMMERIUM/BATCH_4_VERIFIED.csv';
const OUTPUT = 'COMMERIUM/INSTANTLY_READY_BATCH_4.csv';

const NICHE_MAP = [
    { keywords: ['pottery', 'ceramic'], niche: 'pottery' },
    { keywords: ['jewelry', 'jewel'], niche: 'jewelry' },
    { keywords: ['leather'], niche: 'leather goods' },
    { keywords: ['candle', 'melt', 'wick', 'beeswax'], niche: 'candle' },
    { keywords: ['soap', 'apothecary', 'skincare', 'botanical', 'herbal'], niche: 'apothecary' },
    { keywords: ['wood', 'furniture', 'joinery'], niche: 'woodworking' },
    { keywords: ['textile', 'linen', 'fabric', 'weave', 'weaving', 'stitch'], niche: 'textile' },
    { keywords: ['glass'], niche: 'glassware' },
    { keywords: ['iron', 'forged', 'metal'], niche: 'metalwork' },
    { keywords: ['print', 'stationary', 'stationery', 'paper'], niche: 'paper goods' }
];

function getNiche(domain) {
    const d = domain.toLowerCase();
    for (const entry of NICHE_MAP) {
        if (entry.keywords.some(k => d.includes(k))) {
            return entry.niche;
        }
    }
    return 'handcrafted';
}

function getCleanCompanyName(domain) {
    let name = domain.replace('.myshopify.com', '').replace('www.', '');
    name = name.split('-').join(' ').split('_').join(' ');
    // Title case
    return name.replace(/\b\w/g, l => l.toUpperCase());
}

async function main() {
    console.log('👷 Preparing Batch 4 for Instantly...');

    const leads = [];
    if (!fs.existsSync(INPUT)) {
        console.error(`❌ Input file not found: ${INPUT}`);
        return;
    }

    fs.createReadStream(INPUT)
        .pipe(csvParser())
        .on('data', (row) => {
            const result = row['MillionVerifier Result'] || '';
            // Only keep 'ok' and 'catch_all' and 'unknown' (optional, but user wants 500)
            if (result === 'ok' || result === 'catch_all' || result === 'unknown') {
                const domain = row.company_domain || '';
                const companyName = getCleanCompanyName(domain);
                const niche = getNiche(domain);
                
                leads.push({
                    email: row.email,
                    first_name: row.first_name || 'Store Owner',
                    company_name: companyName,
                    niche: niche,
                    website: domain.startsWith('http') ? domain : `https://${domain}`,
                    salutation: row.first_name && row.first_name !== 'Store Owner' ? row.first_name : `${companyName} team`
                });
            }
        })
        .on('end', async () => {
            console.log(`✅ Filtered and enriched ${leads.length} leads.`);

            const csvWriter = createObjectCsvWriter({
                path: OUTPUT,
                header: [
                    { id: 'email', title: 'Email' },
                    { id: 'salutation', title: 'Salutation' },
                    { id: 'company_name', title: 'Company_Name' },
                    { id: 'niche', title: 'Niche' },
                    { id: 'website', title: 'Website' }
                ]
            });

            await csvWriter.writeRecords(leads);
            console.log(`🚀 Final upload list saved to: ${OUTPUT}`);
        });
}

main();
