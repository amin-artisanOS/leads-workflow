/**
 * merge-artisan-os-final.js
 * Combines ALL sources of Artisan OS leads into one clean, deduplicated CSV ready for Instantly.
 * 
 * Sources:
 * - COMMERIUM/Mass_Scrape_2000_*.csv          (new dork scrapes)
 * - COMMERIUM/ARTISAN_OS_MASTER_LIST.csv      (old enriched list)
 * - COMMERIUM/artisan_os_full_*.csv            (old full list)
 * - COMMERIUM/artisan_os_split_names_*.csv     (old split names)
 * 
 * Output: COMMERIUM/ARTISAN_OS_FINAL_FOR_INSTANTLY.csv
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import createCsvWriter from 'csv-writer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMMERIUM = path.join(__dirname, '..', 'COMMERIUM');

// Known placeholder/junk emails to hard-reject
const JUNK_EMAILS = new Set([
    'user@domain.com', 'example@domain.com', 'example@email.com', 'your@email.com',
    'hello@gmail.com', 'info@example.com', 'you@company.com', 'contoso@example.com',
    'contact@example.com', 'jan.novak@example.com', 'email@example.com',
    'filler@godaddy.com', 'support@cloudinary.com', 'documents@worldbank.org',
    'support@trustpilot.com', 'privacy@trustpilot.com', 'unctadinfo@unctad.org',
    'dspace@mit.edu', 'example@gmail.com', 'support@starapps.studio'
]);

// Domains that are clearly not artisan targets
const JUNK_DOMAINS = ['trustpilot.com', 'scribd.com', 'tiktok.com', 'smu.edu', 'uspto.gov',
    'bu.edu', 'unctad.org', 'dspace.mit.edu', 'documents.worldbank.org',
    'documents1.worldbank.org', 'sandiegouniontribune.com', 'abc7news.com',
    'pdfcoffee.com', 'fiverr-res.cloudinary.com', 'assets.simpleviewinc.com',
    'discoverlosangeles.com', 'visitmontgomery.com', 'bitu.org', 'tyasuite.com',
    'heyzine.com', 'cdn.heyzine.com', 'cdnc.heyzine.com', 'afsa.org',
    'paperform.co', 'bridalmusings.com', 'cryptoresearch.report'];

function isJunk(email, domain) {
    if (!email || !email.includes('@')) return true;
    const low = email.toLowerCase();
    if (JUNK_EMAILS.has(low)) return true;
    if (JUNK_DOMAINS.some(d => domain?.includes(d))) return true;
    if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|pdf|woff|zip|ico)$/i.test(low)) return true;
    if (low.split('@')[0].length > 50) return true;
    if (low.includes('@2x.') || low.includes('@1x.')) return true;
    return false;
}

function parseCSV(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
        return lines.slice(1).map(line => {
            // Simple CSV parse (handles basic quoting)
            const cols = [];
            let cur = '', inQ = false;
            for (const ch of line + ',') {
                if (ch === '"') { inQ = !inQ; }
                else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
                else cur += ch;
            }
            const obj = {};
            headers.forEach((h, i) => obj[h] = cols[i] || '');
            return obj;
        });
    } catch (e) {
        console.warn(`  ⚠️ Could not read ${filePath}: ${e.message}`);
        return [];
    }
}

function extractEmail(row) {
    // Try common column names in priority order
    for (const key of ['contact email', 'target email', 'priority email', 'priority_email', 'email', 'db email', 'db_email', 'contactemail']) {
        if (row[key] && row[key].includes('@')) return row[key].trim().toLowerCase();
    }
    // Fallback: scan all values
    for (const val of Object.values(row)) {
        if (val && val.includes('@') && val.includes('.')) {
            const low = val.trim().toLowerCase();
            if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(low)) return low;
        }
    }
    return '';
}

function extractDomain(row) {
    return (row['domain'] || row['website'] || '').replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
}

function extractICP(row) {
    if (row['icp targeting'] || row['icp_target']) return row['icp targeting'] || row['icp_target'];
    if (row['niche']) return row['niche'];
    return 'Artisan/Handmade';
}

function extractName(row) {
    const first = row['first name'] || row['firstname'] || '';
    const last = row['last name'] || row['lastname'] || '';
    const full = row['full name'] || row['fullname'] || row['db contact'] || row['db_contact'] || '';
    if (full) return full;
    if (first || last) return `${first} ${last}`.trim();
    return '';
}

async function main() {
    console.log('🔀 MERGING ALL ARTISAN OS LEAD SOURCES...\n');

    const allFiles = fs.readdirSync(COMMERIUM)
        .filter(f => f.endsWith('.csv'))
        .map(f => path.join(COMMERIUM, f));

    const seen = new Set(); // deduplicate by email
    const final = [];

    for (const file of allFiles) {
        const rows = parseCSV(file);
        console.log(`  📄 ${path.basename(file)}: ${rows.length} rows`);
        for (const row of rows) {
            const domain = extractDomain(row);
            const email = extractEmail(row);
            if (!email || isJunk(email, domain)) continue;
            if (seen.has(email)) continue;
            seen.add(email);

            final.push({
                email,
                domain,
                icp: extractICP(row),
                contact_name: extractName(row),
                dork: row['dork used'] || row['found via query'] || '',
                data_source: row['data source'] || row['source_type'] || row['source type'] || 'Scraped'
            });
        }
    }

    console.log(`\n✅ DEDUPLICATION COMPLETE`);
    console.log(`  Total unique emails found: ${final.length}`);

    // Show segment breakdown
    const byICP = {};
    final.forEach(l => { byICP[l.icp] = (byICP[l.icp] || 0) + 1; });
    console.log('\n📊 Breakdown by ICP:');
    Object.entries(byICP).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));

    const outFile = path.join(COMMERIUM, 'ARTISAN_OS_FINAL_FOR_INSTANTLY.csv');
    const writer = createCsvWriter.createObjectCsvWriter({
        path: outFile,
        header: [
            { id: 'email', title: 'Email' },
            { id: 'contact_name', title: 'Contact Name' },
            { id: 'domain', title: 'Domain' },
            { id: 'icp', title: 'ICP Segment' },
            { id: 'dork', title: 'Source Query' },
            { id: 'data_source', title: 'Data Source' }
        ]
    });

    await writer.writeRecords(final);
    console.log(`\n🚀 SAVED: ${outFile}`);
    console.log(`  → ${final.length} unique leads ready for MillionVerifier → Instantly`);
}

main();
