import { ApifyClient } from 'apify-client';
import { GoogleGenerativeAI } from '@google/generative-ai';

let apifyClient = null;

function getApifyClient() {
    if (!apifyClient) {
        apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });
    }
    return apifyClient;
}

function normalizeDomain(url) {
    if (!url) return '';
    try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        return urlObj.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
}

const IGNORED_DOMAINS = ['google.com', 'linkedin.com', 'facebook.com', 'twitter.com', 'youtube.com', 'wikipedia.org', 'pinterest.com', 'instagram.com'];

function shouldIgnore(domain) {
    return IGNORED_DOMAINS.some(d => domain.includes(d));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const {
        searchQueries = '',
        maxResultsPerQuery = 50,
        decisionMakerTitles = '',
        industryDescription = '',
        searchCountry = '',
        searchLanguage = ''
    } = req.body;

    if (!searchQueries) {
        return res.status(400).json({ error: 'searchQueries is required (pipe-separated)' });
    }

    console.log(`\n🔍 GOOGLE SEARCH SCRAPING FOR LEADS`);
    console.log(`   Queries: ${searchQueries}`);
    console.log('='.repeat(60));

    try {
        const client = getApifyClient();
        const queries = searchQueries.split('|').map(q => q.trim()).filter(Boolean);
        const decisionTitles = decisionMakerTitles
            ? decisionMakerTitles.split(',').map(t => t.trim()).filter(Boolean)
            : ['CEO', 'Owner', 'Founder', 'Marketing Director', 'Content Manager'];

        // Step 1: Google Search
        console.log(`🔍 Running Google search for ${queries.length} queries...`);

        const searchInput = {
            queries: queries.join('\n'),
            maxPagesPerQuery: 2,
            maxResultsPerQuery: parseInt(maxResultsPerQuery),
            resultsPerPage: 100
        };
        if (searchCountry) searchInput.gl = searchCountry;
        if (searchLanguage) searchInput.hl = searchLanguage;

        const searchRun = await client.actor('apify/google-search-scraper').call(searchInput);
        const { items: searchResults } = await client.dataset(searchRun.defaultDatasetId).listItems();

        // Extract domains
        const domainsMap = new Map();

        searchResults.forEach(page => {
            (page.organicResults || []).forEach(item => {
                const domain = normalizeDomain(item.url);
                if (domain && !shouldIgnore(domain) && !domainsMap.has(domain)) {
                    domainsMap.set(domain, {
                        domain,
                        url: item.url,
                        title: item.title,
                        description: item.description
                    });
                }
            });
        });

        console.log(`✅ Found ${domainsMap.size} unique domains`);

        if (domainsMap.size === 0) {
            return res.status(404).json({ error: 'No domains found' });
        }

        // Step 2: Qualify with Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

        const domainsList = Array.from(domainsMap.values()).slice(0, 30);
        const qualifiedDomains = [];

        const industryDesc = industryDescription || 'blogs, content websites, and small businesses in the niche';

        for (let i = 0; i < domainsList.length; i += 10) {
            const batch = domainsList.slice(i, i + 10);
            try {
                const prompt = `Review these websites for SEO outreach targeting ${industryDesc}.
Select sites that would be good for backlink outreach or partnerships.
Reject social media, marketplaces, news aggregators, and major platforms.

Websites:
${batch.map((d, idx) => `${idx + 1}. ${d.domain} - ${d.title}`).join('\n')}

Return JSON array of numbers for approved sites (e.g., [1, 3, 5]):`;

                const result = await model.generateContent(prompt);
                const text = result.response.text().trim();
                const match = text.match(/\[[^\]]*\]/);

                if (match) {
                    const indices = JSON.parse(match[0]);
                    indices.forEach(idx => {
                        if (idx >= 1 && idx <= batch.length) {
                            qualifiedDomains.push(batch[idx - 1]);
                        }
                    });
                }
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.log(`⚠️ Gemini error: ${e.message}`);
                // On error, include all from batch
                qualifiedDomains.push(...batch);
            }
        }

        console.log(`🎯 Qualified ${qualifiedDomains.length} domains`);

        // Step 3: Get leads via Apollo
        const leads = [];

        for (const site of qualifiedDomains.slice(0, 15)) {
            try {
                const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
                    method: 'POST',
                    headers: {
                        'x-api-key': process.env.APOLLO_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        q_organization_domains: site.domain,
                        person_titles: decisionTitles,
                        page: 1,
                        per_page: 3
                    })
                });

                const data = await response.json();
                if (data.people) {
                    data.people.forEach(person => {
                        leads.push({
                            website: site.domain,
                            pageTitle: site.title,
                            fullName: `${person.first_name || ''} ${person.last_name || ''}`.trim(),
                            email: person.email || '',
                            title: person.title || '',
                            linkedin: person.linkedin_url || ''
                        });
                    });
                }
                await new Promise(r => setTimeout(r, 400));
            } catch (e) {
                console.log(`⚠️ Apollo error: ${e.message}`);
            }
        }

        console.log(`✅ Found ${leads.length} leads`);

        res.status(200).json({
            success: true,
            queriesSearched: queries.length,
            domainsFound: domainsMap.size,
            domainsQualified: qualifiedDomains.length,
            leadsFound: leads.length,
            leads
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
}
