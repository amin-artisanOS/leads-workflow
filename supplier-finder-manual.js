#!/usr/bin/env node

import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { ApifyClient } from 'apify-client';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3005; // Different port from automated version

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Serve static files
app.use(express.static(__dirname));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Initialize clients
const apifyClient = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

// Initialize Gemini
let geminiModel = null;
async function getGeminiModel() {
    if (!geminiModel) {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    }
    return geminiModel;
}

// Search Google using the Google Search Scraper (for Google Dorking)
async function searchGoogleSearch(queries, filters = {}) {
    console.log(`🔍 Running Google Search Dorking for queries:`, queries);

    try {
        const input = {
            queries: queries.join('\n'),
            maxPagesPerQuery: Math.max(Math.ceil((filters.maxResults || 25) / 10), 1),
            resultsPerPage: 100,
            mobileResults: false,
            includeUnfilteredResults: false,
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
        };

        if (filters.searchCountry) input.gl = filters.searchCountry;
        if (filters.searchLanguage) input.hl = filters.searchLanguage;

        console.log(`📡 Apify Google Search input:`, JSON.stringify(input, null, 2));

        const run = await apifyClient.actor('apify/google-search-scraper').call(input);
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

        console.log(`✅ Retrieved ${items.length} search result pages`);

        // Flatten organic results from all pages
        const results = [];
        items.forEach(page => {
            if (page.organicResults) {
                page.organicResults.forEach(item => {
                    results.push({
                        name: item.title,
                        website: item.url,
                        description: item.description,
                        address: '',
                        phone: '',
                        email: '',
                        rating: 0,
                        reviews: 0,
                        category: 'Shopify Store',
                        country: filters.country || 'Global'
                    });
                });
            }
        });

        // Filter out common base domains and duplicates
        const uniqueBusinesses = [];
        const seenDomains = new Set();

        for (const item of results) {
            try {
                const url = item.website.startsWith('http') ? item.website : `https://${item.website}`;
                const domain = new URL(url).hostname.replace('www.', '');
                if (!seenDomains.has(domain) && !domain.includes('google.com') && !domain.includes('facebook.com') && !domain.includes('instagram.com')) {
                    seenDomains.add(domain);
                    uniqueBusinesses.push(item);
                }
            } catch (e) {
                // skip invalid URLs
            }
        }

        console.log(`📊 Found ${uniqueBusinesses.length} unique stores from Google Search`);
        return uniqueBusinesses.slice(0, filters.maxResults || 25);
    } catch (error) {
        console.error('❌ Google Search failed:', error.message);
        return [];
    }
}

// Search Google Maps for businesses
async function searchGoogleMaps(product, country, maxResults = 25) {
    console.log(`🔍 Searching Google Maps for "${product}" in ${country}...`);

    try {
        // Use Apify's Google Maps scraper
        const input = {
            "searchStringsArray": [
                `${product} manufacturer`,
                `${product} supplier`,
                `${product} wholesale`,
                `${product} company`
            ],
            "locationQuery": country,
            "maxCrawledPlacesPerSearch": maxResults,
            "language": "en",
            "skipClosedPlaces": false,
            "placeMinimumStars": "",
            "website": "allPlaces",
            "searchMatching": "all"
        };

        const run = await apifyClient.actor('lukaskrivka/google-maps-with-contact-details').call(input);
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

        console.log(`✅ Found ${items.length} businesses on Google Maps`);

        // Filter and clean results
        const businesses = items
            .filter(item => item.title && item.address && item.website)
            .map(item => ({
                name: item.title,
                address: item.address,
                website: item.website,
                phone: item.phone || item.phoneNumber || '',
                email: item.email || '',
                rating: item.rating || item.totalScore || 0,
                reviews: item.reviewsCount || item.totalScore || 0,
                category: item.categoryName || item.category || '',
                country: country
            }))
            .slice(0, maxResults);

        console.log(`📊 Filtered to ${businesses.length} valid businesses with websites`);
        return businesses;

    } catch (error) {
        console.error('❌ Google Maps search failed:', error.message);
        return [];
    }
}

// Get emails via Apollo.io or Apify Leads Finder
async function getEmailsFromApollo(businesses) {
    console.log(`📧 Getting emails for ${businesses.length} businesses...`);

    const results = [];
    let successCount = 0;

    for (const business of businesses) {
        // If business already has email from Google Maps actor, skip
        if (business.email && business.email.includes('@')) {
            console.log(`⏭️  Skipping ${business.name} - already has email: ${business.email}`);
            results.push({
                ...business,
                contactName: business.contactName || '',
                contactTitle: business.contactTitle || '',
                linkedin: business.linkedin || ''
            });
            continue;
        }

        let emailFound = false;
        let scrapedEmail = null;
        let scrapedPhone = null;
        let scrapedLinkedin = null;

        const domain = business.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

        // Strategy 1: Fast raw scrape (Get "every email" as requested)
        try {
            console.log(`🌐 Scraping ${domain} for all contact details...`);
            const run = await apifyClient.actor('vdrmota/contact-info-scraper').call({
                startUrls: [{ url: business.website }],
                maxDepth: 1,
                sameDomain: true,
                maxRequests: 5 // Keep it fast
            });

            const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
            if (items && items.length > 0) {
                // Collect first valid email found across any scraped page
                const contactPage = items.find(item => item.emails && item.emails.length > 0);
                if (contactPage) {
                    scrapedEmail = contactPage.emails[0];
                    scrapedPhone = contactPage.phones && contactPage.phones.length > 0 ? contactPage.phones[0] : null;
                    scrapedLinkedin = contactPage.linkedIns && contactPage.linkedIns.length > 0 ? contactPage.linkedIns[0] : null;
                    console.log(`📡 Scraped base email: ${scrapedEmail}`);
                }
            }
        } catch (scrapeError) {
            console.log(`⚠️ Scraper failed for ${business.name}: ${scrapeError.message}`);
        }

        // Strategy 2: Upscale to Decision Maker via Apify Leads Finder
        try {
            console.log(`📡 Searching for Decision Makers at ${domain}...`);
            const run = await apifyClient.actor('code_crafter/leads-finder').call({
                fetch_count: 1,
                contact_job_title: ["Owner", "CEO", "Founder", "Marketing"],
                company_domain: [domain],
                has_email: true
            });

            const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
            if (items && items.length > 0) {
                const person = items[0];
                if (person.email) {
                    results.push({
                        ...business,
                        contactName: person.full_name || person.name || '',
                        contactTitle: person.job_title || person.title || 'Decision Maker',
                        email: person.email,
                        linkedin: person.linkedin || person.linkedin_url || scrapedLinkedin || ''
                    });
                    successCount++;
                    emailFound = true;
                    console.log(`✅ Found DM email via Leads Finder: ${person.email}`);
                }
            }
        } catch (actorError) {
            console.log(`⚠️ Leads Finder failed for ${business.name}: ${actorError.message}`);
        }

        // Strategy 3: Fallback to Apollo (if DM search failed)
        if (!emailFound) {
            try {
                if (process.env.APOLLO_API_KEY && process.env.APOLLO_API_KEY.length > 10) {
                    const response = await axios.post('https://api.apollo.io/api/v1/mixed_people/search', {
                        q_organization_domains: domain,
                        page: 1,
                        per_page: 1
                    }, {
                        headers: { 'x-api-key': process.env.APOLLO_API_KEY, 'Content-Type': 'application/json' },
                        timeout: 5000
                    });

                    if (response.data.people && response.data.people.length > 0) {
                        const person = response.data.people[0];
                        if (person.email) {
                            results.push({
                                ...business,
                                contactName: `${person.first_name || ''} ${person.last_name || ''}`.trim(),
                                contactTitle: person.title || 'Decision Maker',
                                email: person.email,
                                linkedin: person.linkedin_url || scrapedLinkedin || ''
                            });
                            successCount++;
                            emailFound = true;
                            console.log(`✅ Found DM email via Apollo: ${person.email}`);
                        }
                    }
                }
            } catch (error) {
                console.log(`⚠️ Apollo fallback failed for ${business.name}`);
            }
        }

        // Final Fallback: use the raw scraped email if we have it
        if (!emailFound && scrapedEmail) {
            results.push({
                ...business,
                contactName: '',
                contactTitle: 'Store Contact',
                email: scrapedEmail,
                phone: scrapedPhone || business.phone,
                linkedin: scrapedLinkedin || ''
            });
            successCount++;
            emailFound = true;
            console.log(`✅ Using scraped fallback email: ${scrapedEmail}`);
        }

        // If absolutely nothing found
        if (!emailFound) {
            results.push({
                ...business,
                contactName: '',
                contactTitle: '',
                email: business.email || '', // Keep whatever we had
                linkedin: ''
            });
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`✅ Finished enrichment. Found emails for ${successCount}/${businesses.length} businesses.`);
    return results;
}

// Generate email content
async function generateEmail(business, product, senderInfo = {}) {
    try {
        const model = await getGeminiModel();

        const companyStr = senderInfo.companyName || 'our ecommerce store';
        const nameStr = senderInfo.yourName || 'the store owner';
        const descStr = senderInfo.storeDescription || 'a premium online retailer specializing in unique, high-quality products';

        const prompt = `Write a professional cold email to a potential supplier.

Your Company: ${companyStr}
Your Name: ${nameStr}
Your Store Description: ${descStr}

Supplier Company: ${business.name}
Product you're interested in: ${product}
Their location: ${business.country}

Write a short email (under 150 words) asking if they would be interested in supplying this product to your ecommerce store. Be professional, warm, and mention that you found them through their online presence.

Output format:
Subject: [subject line]
Body: [email body]

Keep it under 150 words total. Mention the specific product "${product}".`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();

        const subjectMatch = text.match(/Subject:\s*(.+?)(?:\n|$)/i);
        const bodyMatch = text.match(/Body:\s*(.+)/is);

        const subject = subjectMatch ? subjectMatch[1].trim() : `Interest in supplying ${product}`;
        const body = bodyMatch ? bodyMatch[1].trim() : text;

        return { subject, body };
    } catch (error) {
        console.log(`⚠️ Email generation failed for ${business.name}, using template`);
        const companyStr = senderInfo.companyName || 'our ecommerce store';
        const nameStr = senderInfo.yourName || 'the store owner';
        return {
            subject: `Interest in supplying ${product}`,
            body: `Hi,

I hope this email finds you well. I came across your company ${business.name} and was impressed by your products.

I'm running ${companyStr} and am looking for suppliers of ${product}. Would you be interested in discussing a potential partnership?

Looking forward to hearing from you.

Best regards,
${nameStr}
${companyStr}`
        };
    }
}

// Main API endpoint for manual version
app.post('/api/find-suppliers-manual', async (req, res) => {
    const {
        product,
        country,
        searchType = 'google-maps',
        customSearchTerms = [],
        senderInfo = {}
    } = req.body;

    if (!product && searchType !== 'google-search') {
        return res.status(400).json({ error: 'Product is required' });
    }

    console.log(`\n🏪 MANUAL MODE - Finding suppliers for "${product}" ${country ? `in ${country}` : '(Global)'} using ${searchType}`);
    console.log('='.repeat(60));

    try {
        let businesses = [];

        if (searchType === 'google-search') {
            let queries = [];
            if (customSearchTerms && customSearchTerms.length > 0) {
                queries = customSearchTerms;
            } else {
                queries = [
                    `site:myshopify.com "${product}"`,
                    `site:myshopify.com "handmade ${product}"`,
                    `"powered by shopify" "${product}" artisan`
                ];
            }
            businesses = await searchGoogleSearch(queries, {
                maxResults: 25,
                country: country,
                searchCountry: country === 'Spain' ? 'es' : undefined,
                searchLanguage: country === 'Spain' ? 'es' : 'en'
            });
        } else {
            businesses = await searchGoogleMaps(product, country, 25);
        }

        if (businesses.length === 0) {
            return res.status(404).json({ error: 'No businesses found' });
        }

        // Step 2: Get emails via Apollo
        const businessesWithContacts = await getEmailsFromApollo(businesses);
        const businessesWithEmails = businessesWithContacts.filter(b => b.email);

        console.log(`📧 Found ${businessesWithEmails.length} businesses with email contacts`);

        // Step 3: Generate email content for businesses with emails
        const emailCampaigns = [];
        const emailLimit = Math.min(businessesWithEmails.length, 15);

        for (const business of businessesWithEmails.slice(0, emailLimit)) {
            const emailContent = await generateEmail(business, product || 'your products', senderInfo);
            emailCampaigns.push({
                business: business,
                emailContent: emailContent,
                emailReady: true
            });

            await new Promise(resolve => setTimeout(resolve, 250));
        }

        // Save results to CSV
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const csvFile = path.join(__dirname, `supplier_campaign_manual_${timestamp}.csv`);

        const csvWriter = createCsvWriter.createObjectCsvWriter({
            path: csvFile,
            header: [
                { id: 'name', title: 'Business Name' },
                { id: 'website', title: 'Website' },
                { id: 'email', title: 'Email' },
                { id: 'phone', title: 'Phone' },
                { id: 'address', title: 'Address' },
                { id: 'country', title: 'Country' },
                { id: 'contactName', title: 'Contact Name' },
                { id: 'contactTitle', title: 'Contact Title' },
                { id: 'category', title: 'Category' },
                { id: 'emailSubject', title: 'Email Subject' },
                { id: 'emailBody', title: 'Email Body' }
            ]
        });

        const csvData = businessesWithContacts.map(business => {
            const campaign = emailCampaigns.find(c => c.business.name === business.name);
            return {
                name: business.name,
                website: business.website,
                email: business.email,
                phone: business.phone,
                address: business.address,
                country: business.country,
                contactName: business.contactName,
                contactTitle: business.contactTitle,
                category: business.category,
                emailSubject: campaign ? campaign.emailContent.subject : '',
                emailBody: campaign ? campaign.emailContent.body : ''
            };
        });

        await csvWriter.writeRecords(csvData);

        console.log(`\n✅ Manual campaign complete!`);
        console.log(`📊 Businesses found: ${businesses.length}`);
        console.log(`📧 Emails found: ${businessesWithEmails.length}`);
        console.log(`📨 Emails ready: ${emailCampaigns.length}`);
        console.log(`💾 Results saved to: ${csvFile}`);

        res.json({
            success: true,
            product: product,
            country: country || 'Global',
            businessesFound: businesses.length,
            emailsFound: businessesWithEmails.length,
            emailsReady: emailCampaigns.length,
            csvFilename: `supplier_campaign_manual_${timestamp}.csv`,
            campaigns: emailCampaigns.map(c => ({
                businessName: c.business.name,
                email: c.business.email,
                subject: c.emailContent.subject,
                body: c.emailContent.body,
                website: c.business.website,
                phone: c.business.phone,
                address: c.business.address,
                contactName: c.business.contactName,
                contactTitle: c.business.contactTitle,
                category: c.business.category
            }))
        });

    } catch (error) {
        console.error('❌ Error in manual supplier search:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download CSV endpoint
app.get('/api/download-csv-manual/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, filename);

    if (!filename.startsWith('supplier_campaign_manual_') || !filename.endsWith('.csv')) {
        return res.status(403).json({ error: 'Invalid filename' });
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
});

// Check configuration status
app.get('/api/config-status-manual', (req, res) => {
    const status = {
        apify: process.env.APIFY_TOKEN && process.env.APIFY_TOKEN.startsWith('apify_api_'),
        apollo: process.env.APOLLO_API_KEY && (process.env.APOLLO_API_KEY.length > 10 || process.env.APOLLO_API_KEY.startsWith('sk_')),
        gemini: process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('AIzaSy')
    };

    const allConfigured = Object.values(status).every(Boolean);

    res.json({
        configured: allConfigured,
        status: status,
        message: allConfigured ? 'All API keys configured ✓' : 'Some API keys need to be configured. Check .env file'
    });
});

// Serve the manual UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'supplier-finder-manual.html'));
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`\n📋 MANUAL SUPPLIER FINDER (UPDATED)`);
    console.log('='.repeat(40));
    console.log(`   Local: http://localhost:${port}`);
    console.log('📱 Ready for Google Dorking strategy!\n');
});
