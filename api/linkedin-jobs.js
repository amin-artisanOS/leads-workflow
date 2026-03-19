import { ApifyClient } from 'apify-client';
import { GoogleGenerativeAI } from '@google/generative-ai';

let apifyClient = null;
let geminiModel = null;

function getApifyClient() {
    if (!apifyClient) {
        apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });
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

function normalizeDomain(value) {
    if (!value) return '';
    return value.toString().toLowerCase()
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0].trim();
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const {
        jobTitles = '',
        location = '',
        industry = '23',
        jobsCount = 50,
        decisionMakerTitles = '',
        leadsPerCompany = 100,
        maxCompanies = 20,
        customQueries = ''
    } = req.body;

    if (!jobTitles && !customQueries) {
        return res.status(400).json({ error: 'Either jobTitles or customQueries is required' });
    }

    console.log(`\n💼 LINKEDIN JOBS TO LEADS`);
    console.log(`   Job Titles: ${jobTitles}`);
    console.log(`   Location: ${location}`);
    console.log(`   Industry: ${industry}`);
    console.log('='.repeat(60));

    try {
        const client = getApifyClient();

        // Parse inputs
        const titlesArray = jobTitles ? jobTitles.split(',').map(t => t.trim()).filter(Boolean) : [];
        const queriesArray = customQueries ? customQueries.split('|').map(q => q.trim()).filter(Boolean) : [];
        const decisionTitles = decisionMakerTitles
            ? decisionMakerTitles.split(',').map(t => t.trim()).filter(Boolean)
            : ['CEO', 'Owner', 'Founder', 'VP Sales', 'Sales Director', 'Business Development'];

        // Build LinkedIn search URLs
        const urls = [];

        if (queriesArray.length > 0) {
            queriesArray.forEach(query => {
                const params = new URLSearchParams({ keywords: query, position: '1', pageNum: '0' });
                if (industry) params.set('f_I', industry);
                if (location) params.set('location', location);
                urls.push(`https://www.linkedin.com/jobs/search/?${params.toString()}`);
            });
        } else {
            titlesArray.forEach(title => {
                const params = new URLSearchParams({ keywords: title, position: '1', pageNum: '0' });
                if (industry) params.set('f_I', industry);
                if (location) params.set('location', location);
                urls.push(`https://www.linkedin.com/jobs/search/?${params.toString()}`);
            });
        }

        console.log(`📡 Searching ${urls.length} LinkedIn URLs...`);

        // Search LinkedIn Jobs
        const jobsRun = await client.actor('hKByXkMQaC5Qt9UMN').call({
            urls: urls.slice(0, 5), // Limit for timeout
            scrapeCompany: true,
            count: Math.min(parseInt(jobsCount), 100)
        });

        const { items: jobs } = await client.dataset(jobsRun.defaultDatasetId).listItems();
        console.log(`✅ Found ${jobs.length} job postings`);

        // Extract unique companies
        const companiesMap = new Map();
        jobs.forEach(job => {
            const companyName = job.companyName || job.company || '';
            const website = normalizeDomain(job.companyWebsite || job.companyAddress?.website || '');
            if (!companyName || !website) return;

            if (!companiesMap.has(website)) {
                companiesMap.set(website, {
                    companyName,
                    website,
                    linkedinUrl: job.companyLinkedinUrl || '',
                    jobCount: 0,
                    jobs: []
                });
            }
            const entry = companiesMap.get(website);
            entry.jobCount++;
            entry.jobs.push({ title: job.title, location: job.location });
        });

        let companies = Array.from(companiesMap.values()).slice(0, parseInt(maxCompanies));
        console.log(`🏢 Extracted ${companies.length} unique companies`);

        if (companies.length === 0) {
            return res.status(404).json({ error: 'No companies found from job postings' });
        }

        // Get leads via Apollo
        const leadsResults = [];
        for (const company of companies.slice(0, 10)) { // Limit for timeout
            try {
                const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
                    method: 'POST',
                    headers: {
                        'x-api-key': process.env.APOLLO_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        q_organization_domains: company.website,
                        person_titles: decisionTitles,
                        page: 1,
                        per_page: Math.min(parseInt(leadsPerCompany), 5)
                    })
                });

                const data = await response.json();
                if (data.people && data.people.length > 0) {
                    data.people.forEach(person => {
                        leadsResults.push({
                            companyName: company.companyName,
                            companyWebsite: company.website,
                            jobCount: company.jobCount,
                            fullName: `${person.first_name || ''} ${person.last_name || ''}`.trim(),
                            email: person.email || '',
                            title: person.title || '',
                            linkedin: person.linkedin_url || ''
                        });
                    });
                }
                await new Promise(r => setTimeout(r, 400));
            } catch (e) {
                console.log(`⚠️ Apollo error for ${company.website}: ${e.message}`);
            }
        }

        console.log(`✅ Found ${leadsResults.length} leads`);

        res.status(200).json({
            success: true,
            jobsFound: jobs.length,
            companiesFound: companies.length,
            leadsFound: leadsResults.length,
            leads: leadsResults
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
}
