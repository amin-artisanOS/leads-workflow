import { ApifyClient } from 'apify-client';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize clients lazily
let apifyClient = null;
let geminiModel = null;

function getApifyClient() {
    if (!apifyClient) {
        apifyClient = new ApifyClient({
            token: process.env.APIFY_TOKEN,
        });
    }
    return apifyClient;
}

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
        const client = getApifyClient();

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

        const run = await client.actor('apify/google-search-scraper').call(input);
        const { items } = await client.dataset(run.defaultDatasetId).listItems();

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

// Search Google Maps for businesses with filters
async function searchGoogleMaps(product, country, filters = {}) {
    console.log(`🔍 Searching Google Maps for "${product}" in ${country}...`);
    console.log(`   Filters:`, JSON.stringify(filters));

    try {
        const client = getApifyClient();

        // Build search strings based on user input or defaults
        const searchSuffixes = filters.searchSuffixes || ['manufacturer', 'supplier', 'wholesale', 'company'];
        const searchStrings = searchSuffixes.map(suffix => `${product} ${suffix}`);

        // If user provided custom search terms, use those instead
        if (filters.customSearchTerms && filters.customSearchTerms.length > 0) {
            searchStrings.length = 0;
            searchStrings.push(...filters.customSearchTerms);
        }

        const input = {
            searchStringsArray: searchStrings,
            locationQuery: country,
            maxCrawledPlacesPerSearch: filters.maxResults || 25,
            language: filters.language || 'en',
            skipClosedPlaces: filters.skipClosedPlaces !== false,
            placeMinimumStars: filters.minRating ? String(filters.minRating) : '',
            website: 'allPlaces', // Only get places with websites
            searchMatching: 'all',
            // Additional filters
            ...(filters.categoryFilter && { categoryFilterList: [filters.categoryFilter] })
        };

        console.log(`📡 Apify input:`, JSON.stringify(input, null, 2));

        const run = await client.actor('lukaskrivka/google-maps-with-contact-details').call(input);
        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        console.log(`✅ Found ${items.length} businesses on Google Maps`);

        // Filter and clean results
        let businesses = items
            .filter(item => item.title && item.address && item.website)
            .map(item => ({
                name: item.title,
                address: item.address,
                website: item.website,
                phone: item.phone || item.phoneNumber || '',
                email: item.email || '',
                rating: item.rating || item.totalScore || 0,
                reviews: item.reviewsCount || 0,
                category: item.categoryName || item.category || '',
                country: country
            }));

        // Apply minimum reviews filter if specified
        if (filters.minReviews) {
            businesses = businesses.filter(b => b.reviews >= filters.minReviews);
        }

        // Apply minimum rating filter (client-side for accuracy)
        if (filters.minRating) {
            businesses = businesses.filter(b => b.rating >= filters.minRating);
        }

        // Limit results
        const limit = filters.maxResults || 25;
        businesses = businesses.slice(0, limit);

        console.log(`📊 Filtered to ${businesses.length} valid businesses with websites`);
        return businesses;
    } catch (error) {
        console.error('❌ Google Maps search failed:', error.message);
        return [];
    }
}

// Get emails via Apollo.io
async function getEmailsFromApollo(businesses, contactTitles = []) {
    console.log(`📧 Getting emails for ${businesses.length} businesses via Apollo...`);

    const results = [];
    let successCount = 0;

    // Default titles if not provided
    const titles = contactTitles.length > 0 ? contactTitles : [
        'Owner', 'CEO', 'Founder', 'Managing Director',
        'Sales Manager', 'Export Manager', 'Business Development'
    ];

    for (const business of businesses) {
        // If business already has email from Google Maps actor, use it
        if (business.email && business.email.includes('@')) {
            console.log(`⏭️  ${business.name} - has email from Google Maps: ${business.email}`);
            results.push({
                ...business,
                contactName: '',
                contactTitle: '',
                linkedin: ''
            });
            continue;
        }

        try {
            const domain = business.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

            const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
                method: 'POST',
                headers: {
                    'x-api-key': process.env.APOLLO_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q_organization_domains: domain,
                    person_titles: titles,
                    page: 1,
                    per_page: 3
                })
            });

            const data = await response.json();

            if (data.people && data.people.length > 0) {
                const person = data.people[0];
                results.push({
                    ...business,
                    contactName: `${person.first_name || ''} ${person.last_name || ''}`.trim(),
                    contactTitle: person.title || 'Contact',
                    email: person.email || '',
                    linkedin: person.linkedin_url || ''
                });
                if (person.email) successCount++;
            } else {
                results.push({
                    ...business,
                    contactName: '',
                    contactTitle: '',
                    email: '',
                    linkedin: ''
                });
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 400));
        } catch (error) {
            console.log(`⚠️ Failed to get email for ${business.name}: ${error.message}`);
            results.push({
                ...business,
                contactName: '',
                contactTitle: '',
                email: '',
                linkedin: ''
            });
        }
    }

    console.log(`✅ Found emails for ${successCount}/${businesses.length} businesses via Apollo`);
    return results;
}

// Generate email content
async function generateEmail(business, product, senderInfo = {}) {
    try {
        const model = await getGeminiModel();

        const prompt = `Write a professional cold email to a potential supplier.

Your Company: ${senderInfo.companyName || 'Ecommerce Store'}
Your Name: ${senderInfo.yourName || 'Store Owner'}
Your Store Description: ${senderInfo.storeDescription || 'Online retailer specializing in quality products'}

Supplier Company: ${business.name}
Product you're interested in: ${product}
Their location: ${business.country}
Their category: ${business.category || 'N/A'}

Write a short email (under 150 words) asking if they would be interested in supplying this product to your ecommerce store. Be professional and mention that you found them through their online presence.

Output format:
Subject: [subject line]
Body: [email body]

Keep it under 150 words total.`;

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
        return {
            subject: `Interest in supplying ${product}`,
            body: `Hi,

I hope this email finds you well. I came across your company ${business.name} and was impressed by your products.

I'm running an ecommerce store and am looking for suppliers of ${product}. Would you be interested in discussing a potential partnership?

Looking forward to hearing from you.

Best regards,
${senderInfo.yourName || 'Store Owner'}
${senderInfo.companyName || 'Ecommerce Store'}`
        };
    }
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
        product,
        country,
        // Apify filters
        maxResults = 25,
        minRating = 0,
        minReviews = 0,
        skipClosedPlaces = true,
        searchSuffixes = [],
        customSearchTerms = [],
        categoryFilter = '',
        language = 'en',
        // Apollo filters
        contactTitles = [],
        // Email customization
        senderInfo = {},
        searchType = 'google-maps' // 'google-maps' or 'google-search'
    } = req.body;

    if (!product && searchType !== 'google-search') {
        return res.status(400).json({ error: 'Product is required' });
    }

    const filtersApplied = {
        maxResults: Math.min(maxResults, 50),
        minRating,
        minReviews,
        skipClosedPlaces,
        searchSuffixes: searchSuffixes.length > 0 ? searchSuffixes : undefined,
        customSearchTerms: customSearchTerms.length > 0 ? customSearchTerms : undefined,
        categoryFilter: categoryFilter || undefined,
        language
    };

    console.log(`\n🏪 Finding suppliers for "${product}" ${country ? `in ${country}` : '(Global)'} using ${searchType}`);
    console.log('='.repeat(60));

    try {
        // Step 1: Search for businesses
        let businesses = [];

        if (searchType === 'google-search') {
            // Use Google Dorking strategy
            let queries = [];
            if (customSearchTerms && customSearchTerms.length > 0) {
                queries = customSearchTerms;
            } else {
                // Default dorks based on product
                queries = [
                    `site:myshopify.com "${product}"`,
                    `site:myshopify.com "handmade ${product}"`,
                    `"powered by shopify" "${product}" artisan`
                ];
            }
            businesses = await searchGoogleSearch(queries, {
                maxResults,
                country,
                searchCountry: country === 'Spain' ? 'es' : undefined,
                searchLanguage: country === 'Spain' ? 'es' : 'en'
            });
        } else {
            // Default Google Maps search
            businesses = await searchGoogleMaps(product, country, filtersApplied);
        }

        if (businesses.length === 0) {
            return res.status(404).json({ error: 'No businesses found with these filters' });
        }

        // Step 2: Get emails via Apollo
        const businessesWithContacts = await getEmailsFromApollo(businesses, contactTitles);
        const businessesWithEmails = businessesWithContacts.filter(b => b.email);

        console.log(`📧 Found ${businessesWithEmails.length} businesses with email contacts`);

        // Step 3: Generate email content for businesses with emails
        const emailCampaigns = [];
        const emailLimit = Math.min(businessesWithEmails.length, 15); // Limit for timeout

        for (const business of businessesWithEmails.slice(0, emailLimit)) {
            const emailContent = await generateEmail(business, product, senderInfo);
            emailCampaigns.push({
                business: business,
                emailContent: emailContent,
                emailReady: true
            });

            await new Promise(resolve => setTimeout(resolve, 250));
        }

        console.log(`\n✅ Campaign complete!`);
        console.log(`📊 Businesses found: ${businesses.length}`);
        console.log(`📧 Emails found: ${businessesWithEmails.length}`);
        console.log(`📨 Emails ready: ${emailCampaigns.length}`);

        res.status(200).json({
            success: true,
            product,
            country: country || 'Global',
            filtersApplied,
            businessesFound: businesses.length,
            emailsFound: businessesWithEmails.length,
            emailsReady: emailCampaigns.length,
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
                category: c.business.category,
                rating: c.business.rating,
                reviews: c.business.reviews,
                linkedin: c.business.linkedin
            }))
        });
    } catch (error) {
        console.error('❌ Error in supplier search:', error);
        res.status(500).json({ error: error.message });
    }
}
