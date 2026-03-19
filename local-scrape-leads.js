import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

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

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function scrapeDomain(domain) {
    console.log(`\n🔍 Scraping: ${domain}`);
    const results = { domain, emails: new Set(), status: 'pending' };

    // Pages to check
    const pagesToTry = [
        `https://${domain}`,
        `https://www.${domain}`,
        `https://${domain}/pages/contact`,
        `https://${domain}/pages/contact-us`,
        `https://${domain}/pages/about-us`
    ];

    for (const url of pagesToTry) {
        try {
            console.log(`  🔗 checking ${url}...`);
            const response = await axios.get(url, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const html = response.data;
            const $ = cheerio.load(html);

            // 1. Text-based regex
            const matches = html.match(EMAIL_REGEX);
            if (matches) {
                matches.forEach(email => {
                    // Basic filter for junk
                    if (!email.toLowerCase().endsWith('.png') && !email.toLowerCase().endsWith('.jpg') && !email.toLowerCase().includes('sentry')) {
                        results.emails.add(email.toLowerCase());
                    }
                });
            }

            // 2. Mailto links
            $('a[href^="mailto:"]').each((i, el) => {
                const email = $(el).attr('href').replace('mailto:', '').split('?')[0].trim();
                if (email) results.emails.add(email.toLowerCase());
            });

            if (results.emails.size > 0) {
                console.log(`  ✅ Found ${results.emails.size} emails on ${url}`);
            }

        } catch (error) {
            // console.log(`  ❌ Failed ${url}: ${error.message}`);
        }
    }

    results.status = results.emails.size > 0 ? 'success' : 'failed';
    return {
        domain: results.domain,
        emails: Array.from(results.emails),
        status: results.status
    };
}

async function run() {
    console.log('🚀 Starting LOCAL Scrape (No Actors)...');
    console.log('====================================');

    const allResults = [];
    for (const domain of domains) {
        const res = await scrapeDomain(domain);
        allResults.push(res);
    }

    console.log('\n\n📊 FINAL RESULTS');
    console.log('====================================');
    console.table(allResults.map(r => ({
        Domain: r.domain,
        Emails: r.emails.join(', ') || 'NONE',
        Status: r.status
    })));

    fs.writeFileSync('local_scraped_results.json', JSON.stringify(allResults, null, 2));
    console.log(`\n💾 Results saved to local_scraped_results.json`);
}

run();
