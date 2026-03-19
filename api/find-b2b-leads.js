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

// Search Google Maps for B2B leads with filters
async function searchGoogleMapsB2B(industry, location, filters = {}) {
    console.log(`🔍 Searching for ${industry} companies in ${location}...`);
    console.log(`   Filters:`, JSON.stringify(filters));

    try {
        const client = getApifyClient();

        // Build search strings
        const searchSuffixes = filters.searchSuffixes || ['companies', 'business', 'agency', 'firm'];
        let searchStrings = searchSuffixes.map(suffix => `${industry} ${suffix}`);

        // If user provided custom search terms, use those instead
        if (filters.customSearchTerms && filters.customSearchTerms.length > 0) {
            searchStrings = filters.customSearchTerms;
        }

        const input = {
            searchStringsArray: searchStrings,
            locationQuery: location,
            maxCrawledPlacesPerSearch: filters.maxResults || 25,
            language: filters.language || 'en',
            skipClosedPlaces: filters.skipClosedPlaces !== false,
            placeMinimumStars: filters.minRating ? String(filters.minRating) : '',
            website: 'allPlaces',
            searchMatching: 'all',
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
                location: location
            }));

        // Apply minimum reviews filter
        if (filters.minReviews) {
            businesses = businesses.filter(b => b.reviews >= filters.minReviews);
        }

        // Apply minimum rating filter
        if (filters.minRating) {
            businesses = businesses.filter(b => b.rating >= filters.minRating);
        }

        // Limit results
        businesses = businesses.slice(0, filters.maxResults || 25);

        console.log(`📊 Filtered to ${businesses.length} valid businesses with websites`);
        return businesses;
    } catch (error) {
        console.error('❌ Google Maps search failed:', error.message);
        return [];
    }
}

// Get emails via Apollo.io
async function getEmailsFromApollo(businesses, decisionMakerTitles = []) {
    console.log(`📧 Getting contacts for ${businesses.length} businesses via Apollo...`);

    const results = [];
    let successCount = 0;

    const titles = decisionMakerTitles.length > 0 ? decisionMakerTitles : [
        'CEO', 'Owner', 'Founder', 'Managing Director',
        'Marketing Manager', 'Marketing Director',
        'Operations Manager', 'General Manager',
        'Business Development Manager'
    ];

    for (const business of businesses) {
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

            await new Promise(resolve => setTimeout(resolve, 400));
        } catch (error) {
            console.log(`⚠️ Failed to get contact for ${business.name}: ${error.message}`);
            results.push({
                ...business,
                contactName: '',
                contactTitle: '',
                email: '',
                linkedin: ''
            });
        }
    }

    console.log(`✅ Found contacts for ${successCount}/${businesses.length} businesses via Apollo`);
    return results;
}

// Generate personalized outreach email
async function generateOutreachEmail(business, serviceOffering, senderInfo) {
    try {
        const model = await getGeminiModel();

        const prompt = `Write a professional cold outreach email to offer services to a potential B2B client.

Your Company: ${senderInfo.companyName || 'Our Agency'}
Your Name: ${senderInfo.yourName || 'Business Development'}
Service you're offering: ${serviceOffering}

Prospect Company: ${business.name}
Their Industry/Category: ${business.category || 'Business'}
Their Location: ${business.location}
Contact Person: ${business.contactName || 'Decision Maker'}
Contact Title: ${business.contactTitle || ''}

Write a short, personalized email (under 150 words) that:
1. References something specific about their business or industry
2. Clearly explains the value proposition
3. Includes a soft call-to-action (e.g., quick call, reply)
4. Sounds natural and professional, not salesy

Output format:
Subject: [subject line - make it compelling and specific]
Body: [email body]

Keep it concise and professional.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();

        const subjectMatch = text.match(/Subject:\s*(.+?)(?:\n|$)/i);
        const bodyMatch = text.match(/Body:\s*(.+)/is);

        const subject = subjectMatch ? subjectMatch[1].trim() : `Partnership opportunity: ${serviceOffering}`;
        const body = bodyMatch ? bodyMatch[1].trim() : text;

        return { subject, body };
    } catch (error) {
        console.log(`⚠️ Email generation failed for ${business.name}, using template`);
        return {
            subject: `Partnership opportunity for ${business.name}`,
            body: `Hi${business.contactName ? ' ' + business.contactName.split(' ')[0] : ''},

I came across ${business.name} and was impressed by your work in the ${business.category || 'industry'}.

We specialize in ${serviceOffering} and have helped similar businesses achieve significant results.

Would you be open to a quick 15-minute call to explore how we might be able to help ${business.name}?

Best regards,
${senderInfo.yourName || 'Business Development Team'}
${senderInfo.companyName || ''}`
        };
    }
}

export default async function handler(req, res) {
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
        industry,
        location,
        serviceOffering,
        decisionMakerTitles = [],
        senderInfo = {},
        // Apify filters
        maxResults = 25,
        minRating = 0,
        minReviews = 0,
        skipClosedPlaces = true,
        searchSuffixes = [],
        customSearchTerms = [],
        categoryFilter = '',
        language = 'en'
    } = req.body;

    if (!industry || !location || !serviceOffering) {
        return res.status(400).json({
            error: 'Industry, location, and serviceOffering are required'
        });
    }

    console.log(`\n🎯 B2B LEAD FINDER - Finding ${industry} companies in ${location}`);
    console.log(`   Service to offer: ${serviceOffering}`);
    console.log('='.repeat(60));

    try {
        // Build filters
        const filters = {
            maxResults: Math.min(maxResults, 50),
            minRating,
            minReviews,
            skipClosedPlaces,
            searchSuffixes: searchSuffixes.length > 0 ? searchSuffixes : undefined,
            customSearchTerms: customSearchTerms.length > 0 ? customSearchTerms : undefined,
            categoryFilter: categoryFilter || undefined,
            language
        };

        // Step 1: Search Google Maps
        const businesses = await searchGoogleMapsB2B(industry, location, filters);
        if (businesses.length === 0) {
            return res.status(404).json({ error: 'No businesses found with these filters' });
        }

        // Step 2: Get decision maker contacts via Apollo
        const businessesWithContacts = await getEmailsFromApollo(businesses, decisionMakerTitles);
        const businessesWithEmails = businessesWithContacts.filter(b => b.email);

        console.log(`📧 Found ${businessesWithEmails.length} businesses with email contacts`);

        // Step 3: Generate outreach emails
        const outreachCampaigns = [];
        const emailLimit = Math.min(businessesWithEmails.length, 15);

        for (const business of businessesWithEmails.slice(0, emailLimit)) {
            const emailContent = await generateOutreachEmail(business, serviceOffering, senderInfo);
            outreachCampaigns.push({
                business,
                emailContent,
                emailReady: true
            });

            await new Promise(resolve => setTimeout(resolve, 250));
        }

        console.log(`\n✅ B2B Lead campaign complete!`);
        console.log(`📊 Businesses found: ${businesses.length}`);
        console.log(`📧 Emails found: ${businessesWithEmails.length}`);
        console.log(`📨 Outreach ready: ${outreachCampaigns.length}`);

        res.status(200).json({
            success: true,
            industry,
            location,
            serviceOffering,
            filtersApplied: filters,
            businessesFound: businesses.length,
            emailsFound: businessesWithEmails.length,
            outreachReady: outreachCampaigns.length,
            leads: outreachCampaigns.map(c => ({
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
        console.error('❌ Error in B2B lead search:', error);
        res.status(500).json({ error: error.message });
    }
}
