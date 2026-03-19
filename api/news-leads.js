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

const IGNORED_DOMAINS = ['google.com', 'linkedin.com', 'facebook.com', 'twitter.com', 'youtube.com', 'wikipedia.org'];

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
        maxResultsPerQuery = 20,
        decisionMakerTitles = '',
        leadsPerCompany = 50,
        searchCountry = '',
        searchLanguage = ''
    } = req.body;

    if (!searchQueries) {
        return res.status(400).json({ error: 'searchQueries is required (pipe-separated)' });
    }

    console.log(`\n📰 NEWS-BASED LEAD GENERATION`);
    console.log(`   Queries: ${searchQueries}`);
    console.log('='.repeat(60));

    try {
        const client = getApifyClient();
        const queries = searchQueries.split('|').map(q => q.trim()).filter(Boolean);
        const decisionTitles = decisionMakerTitles
            ? decisionMakerTitles.split(',').map(t => t.trim()).filter(Boolean)
            : ['CEO', 'Owner', 'Founder', 'VP Sales', 'Director', 'Manager'];

        // Step 1: Google Search
        console.log(`🔍 Running Google search for ${queries.length} queries...`);

        const searchInput = {
            queries: queries.join('\n'),
            maxPagesPerQuery: 1,
            maxResultsPerQuery: parseInt(maxResultsPerQuery),
            resultsPerPage: 100,
            includeUnfilteredResults: false
        };
        if (searchCountry) searchInput.gl = searchCountry;
        if (searchLanguage) searchInput.hl = searchLanguage;

        const searchRun = await client.actor('apify/google-search-scraper').call(searchInput);
        const { items: searchResults } = await client.dataset(searchRun.defaultDatasetId).listItems();

        // Normalize results
        const urls = new Set();
        const companiesFromSearch = new Map();

        searchResults.forEach(page => {
            (page.organicResults || []).forEach(item => {
                const domain = normalizeDomain(item.url);
                if (domain && !shouldIgnore(domain) && !companiesFromSearch.has(domain)) {
                    companiesFromSearch.set(domain, {
                        domain,
                        url: item.url,
                        title: item.title,
                        description: item.description
                    });
                    urls.add(item.url);
                }
            });
        });

        console.log(`✅ Found ${companiesFromSearch.size} unique domains`);

        if (companiesFromSearch.size === 0) {
            return res.status(404).json({ error: 'No companies found from search' });
        }

        // Step 2: Extract articles  
        console.log(`📰 Extracting articles from ${Math.min(urls.size, 20)} URLs...`);

        const articleRun = await client.actor('lukaskrivka/article-extractor-smart').call({
            startUrls: Array.from(urls).slice(0, 20).map(url => ({ url })),
            crawlWholeSubdomain: false,
            onlyInsideArticles: true,
            saveHtml: false
        });

        const { items: articles } = await client.dataset(articleRun.defaultDatasetId).listItems();
        console.log(`✅ Extracted ${articles.length} articles`);

        // Step 3: Use Gemini to extract companies from articles
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

        const extractedCompanies = new Map();

        for (const article of articles.slice(0, 10)) { // Limit for timeout
            try {
                const prompt = `Extract company names and their websites from this article. Return JSON array:
[{"companyName": "name", "website": "domain.com"}]

Article: ${article.title || ''}\n${(article.text || '').slice(0, 2000)}

JSON:`;

                const result = await model.generateContent(prompt);
                const text = result.response.text().trim();
                const match = text.match(/\[[\s\S]*?\]/);

                if (match) {
                    const companies = JSON.parse(match[0]);
                    companies.forEach(c => {
                        if (c.companyName && c.website) {
                            extractedCompanies.set(normalizeDomain(c.website), c);
                        }
                    });
                }
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.log(`⚠️ Gemini error: ${e.message}`);
            }
        }

        console.log(`🏢 Extracted ${extractedCompanies.size} companies from articles`);

        // Step 4: Get leads via Apollo
        const leads = [];
        const domains = Array.from(extractedCompanies.keys()).slice(0, 10);

        for (const domain of domains) {
            try {
                const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
                    method: 'POST',
                    headers: {
                        'x-api-key': process.env.APOLLO_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        q_organization_domains: domain,
                        person_titles: decisionTitles,
                        page: 1,
                        per_page: Math.min(parseInt(leadsPerCompany), 5)
                    })
                });

                const data = await response.json();
                if (data.people) {
                    data.people.forEach(person => {
                        leads.push({
                            companyName: extractedCompanies.get(domain)?.companyName || domain,
                            companyWebsite: domain,
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
            articlesExtracted: articles.length,
            companiesFound: extractedCompanies.size,
            leadsFound: leads.length,
            leads
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
}
