#!/usr/bin/env node
/**
 * News-Based Lead Generation for Food Companies
 *
 * This script helps food producers struggling with US tariffs by:
 * 1. Running Google searches (apify/google-search-scraper) for tariff impact stories
 * 2. Extracting full articles (lukaskrivka/article-extractor-smart) from SERP URLs
 * 3. Using Gemini to identify companies seeking international expansion
 * 4. Scraping decision-maker contacts for export / international sales roles
 *
 * Usage:
 *   npm run news-leads
 *
 * Advanced usage:
 *   node newsBasedLeadGeneration.js \
 *     --queries "food company tariffs|food exporters diversify" \
 *     --max-pages-per-query 2 \
 *     --max-results-per-query 20 \
 *     --decision-titles "Director of International Sales,VP of Exports" \
 *     --contact-locations "Germany,France,Netherlands" \
 *     --leads-per-company 100 \
 *     --run-name custom-run
 *
 * Resume flags:
 *   --skip-search: Load existing search-results.json
 *   --skip-articles: Load articles.json (after article extraction)
 *   --skip-extraction: Load companies-raw.json (after Gemini extraction)
 *   --skip-gemini: Load companies.json (after Gemini qualification)
 *   --articles-file: Override path to articles.json (for manual downloads)
 *
 * Environment variables:
 *   APIFY_TOKEN: Required (Google search + article extractor + leads finder)
 *   GEMINI_API_KEY: Required for AI processing
 *   APIFY_GOOGLE_SEARCH_ACTOR_ID (optional)
 *   APIFY_SMART_ARTICLE_ACTOR_ID (optional)
 */
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_ROOT = path.join(__dirname, 'news_based_leads_runs');
const GOOGLE_SEARCH_ACTOR_ID = process.env.APIFY_GOOGLE_SEARCH_ACTOR_ID || 'apify/google-search-scraper';
const SMART_ARTICLE_ACTOR_ID = process.env.APIFY_SMART_ARTICLE_ACTOR_ID || 'lukaskrivka/article-extractor-smart';
const LEADS_FINDER_ACTOR_ID = 'code_crafter/leads-finder';

// Google queries for finding food companies struggling with US tariffs and seeking international expansion
const DEFAULT_SEARCH_QUERIES = [
  'food companies us tariffs',
  'food exporters diversify markets',
  'agricultural exporters tariff challenges',
  'food producers international expansion',
  'food companies seeking new markets Europe'
];

const DEFAULT_DECISION_TITLES = [
  'Director of International Sales',
  'Head of International Sales',
  'VP of International Sales',
  'International Sales Director',
  'International Sales Manager',
  'Director of Exports',
  'Head of Exports',
  'VP of Exports',
  'Export Sales Director',
  'Export Sales Manager',
  'Director of Business Development',
  'Head of Business Development',
  'VP of Business Development',
  'Business Development Manager'
];

const DEFAULT_MAX_PAGES_PER_QUERY = parseInt(process.env.GOOGLE_SEARCH_MAX_PAGES || '2', 10);
const DEFAULT_MAX_RESULTS_PER_QUERY = parseInt(process.env.GOOGLE_SEARCH_MAX_RESULTS || '20', 10);
const DEFAULT_RESULTS_PER_PAGE = parseInt(process.env.GOOGLE_SEARCH_RESULTS_PER_PAGE || '100', 10);
const DEFAULT_MAX_ARTICLES = parseInt(process.env.SMART_ARTICLE_MAX_ARTICLES || '60', 10);
const DEFAULT_LEADS_PER_COMPANY = parseInt(process.env.LEADS_FINDER_LEADS_PER_COMPANY || '200', 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

function parseArgs() {
  const args = process.argv.slice(2);

  const getValue = (flag) => {
    const prefix = `${flag}=`;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg.startsWith(prefix)) return arg.slice(prefix.length);
      if (arg === flag && i + 1 < args.length) return args[i + 1];
    }
    return undefined;
  };

  const hasFlag = (flag) => args.includes(flag);

  const parseList = (value, separator = ',') => {
    if (!value) return [];
    return value
      .split(separator)
      .map((item) => item.trim())
      .filter(Boolean);
  };

  let queries = parseList(getValue('--queries') || '', '|');
  if (!queries.length) {
    const legacyKeywords = parseList(getValue('--keywords') || '', '|');
    queries = legacyKeywords.length ? legacyKeywords : DEFAULT_SEARCH_QUERIES;
  }

  return {
    queries,
    maxPagesPerQuery: parseInt(getValue('--max-pages-per-query') || DEFAULT_MAX_PAGES_PER_QUERY, 10),
    maxResultsPerQuery: parseInt(getValue('--max-results-per-query') || DEFAULT_MAX_RESULTS_PER_QUERY, 10),
    resultsPerPage: parseInt(getValue('--results-per-page') || DEFAULT_RESULTS_PER_PAGE, 10),
    searchCountry: getValue('--search-country') || '',
    searchLanguage: getValue('--search-language') || '',
    maxArticles: parseInt(getValue('--max-articles') || DEFAULT_MAX_ARTICLES, 10),
    articleStartUrls: parseList(getValue('--article-start-urls') || ''),
    decisionTitles: parseList(getValue('--decision-titles') || DEFAULT_DECISION_TITLES.join(',')),
    contactLocations: parseList(getValue('--contact-locations') || ''),
    leadsPerCompany: parseInt(getValue('--leads-per-company') || DEFAULT_LEADS_PER_COMPANY, 10),
    maxCompanies: parseInt(getValue('--max-companies') || '0', 10),
    runName: getValue('--run-name'),
    skipSearch: hasFlag('--skip-search'),
    skipArticles: hasFlag('--skip-articles'),
    skipExtraction: hasFlag('--skip-extraction'),
    skipGemini: hasFlag('--skip-gemini'),
    companiesFile: getValue('--companies-file'),
    articlesFile: getValue('--articles-file'),
    dryRun: hasFlag('--dry-run')
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
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

const IGNORED_DOMAIN_SUFFIXES = [
  'google.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'pinterest.com',
  'wikipedia.org',
  'news.google.com',
  'maps.google.com',
  'bing.com',
  'duckduckgo.com',
  'yahoo.com'
];

function shouldIgnoreDomain(domain) {
  if (!domain) return true;
  const lc = domain.toLowerCase();
  return IGNORED_DOMAIN_SUFFIXES.some((suffix) => lc === suffix || lc.endsWith(`.${suffix}`));
}

function slugify(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'company';
}

async function runGoogleSearch(client, options) {
  console.log('\n🔍 Running Google search actor...');
  const actorInput = {
    queries: options.queries.join('\n'),
    maxPagesPerQuery: Math.max(options.maxPagesPerQuery, 1),
    maxResultsPerQuery: Math.max(options.maxResultsPerQuery, 1),
    resultsPerPage: Math.max(options.resultsPerPage, 1),
    includeUnfilteredResults: false,
    focusOnPaidAds: false,
    forceExactMatch: false,
    saveHtml: false,
    saveHtmlToKeyValueStore: false
  };

  if (options.searchCountry) actorInput.gl = options.searchCountry;
  if (options.searchLanguage) actorInput.hl = options.searchLanguage;

  if (options.dryRun) {
    console.log('   [DRY RUN] Google search input:');
    console.log(JSON.stringify(actorInput, null, 2));
    return [];
  }

  const run = await client.actor(GOOGLE_SEARCH_ACTOR_ID).call(actorInput);
  const dataset = client.dataset(run.defaultDatasetId);
  const { items } = await dataset.listItems({ clean: true });
  const results = Array.isArray(items) ? items : [];

  console.log(`📥 Retrieved ${results.length} search result item(s).`);
  return results;
}

function normalizeGoogleResults(rawResults) {
  if (!Array.isArray(rawResults)) return [];
  const normalized = [];
  rawResults.forEach((page) => {
    const organicResults = page.organicResults || [];
    organicResults.forEach((item) => {
      normalized.push({
        url: item.url || '',
        title: item.title || '',
        description: item.description || '',
        query: page.searchQuery?.term || item.query || ''
      });
    });
  });
  return normalized;
}

async function extractArticlesWithSmartActor(client, searchResults, options) {
  const urls = new Set();
  searchResults.forEach((item) => {
    const normalized = normalizeDomain(item.url);
    if (!normalized || shouldIgnoreDomain(normalized)) return;
    urls.add(item.url);
  });

  if (options.articleStartUrls.length) {
    options.articleStartUrls.forEach((url) => urls.add(url));
  }

  const startUrls = Array.from(urls).slice(0, options.maxArticles);

  if (!startUrls.length) {
    console.warn('⚠️ No article URLs available for extraction.');
    return [];
  }

  console.log(`\n📰 Extracting articles with Smart Article Extractor (${startUrls.length} URLs)...`);

  const actorInput = {
    startUrls: startUrls.map((url) => ({ url })),
    crawlWholeSubdomain: false,
    onlyInsideArticles: true,
    saveHtml: false,
    saveHtmlAsLink: false,
    saveSnapshots: false,
    scanSitemaps: false,
    onlyNewArticles: false,
    onlyNewArticlesPerDomain: false,
    mustHaveDate: true,
    proxyConfiguration: { useApifyProxy: true }
  };

  if (options.dryRun) {
    console.log('   [DRY RUN] Smart article extractor input:');
    console.log(JSON.stringify(actorInput, null, 2));
    return [];
  }

  const run = await client.actor(SMART_ARTICLE_ACTOR_ID).call(actorInput);
  const dataset = client.dataset(run.defaultDatasetId);
  const { items } = await dataset.listItems({ clean: true });
  const articles = Array.isArray(items) ? items : [];

  console.log(`✅ Extracted ${articles.length} article(s)`);
  return articles.map((article) => ({
    title: article.title || article.pageTitle || '',
    url: article.url || article.pageUrl || '',
    body: article.text || article.content || '',
    date: article.date || article.publishedDate || article.firstSeen || '',
    source: {
      title: article.sourceName || '',
      location: article.location || ''
    },
    lang: article.lang || article.language || '',
    summary: article.summary || ''
  }));
}

function initGemini() {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  return genAI.getGenerativeModel({
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 2048
    }
  });
}

async function extractCompaniesFromArticles(model, articles) {
  console.log('\n🏢 Extracting companies from news articles...');

  const seenCompanies = new Map();

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    console.log(`   Processing article ${i + 1}/${articles.length}: ${article.title?.slice(0, 50)}...`);

    const prompt = `You are a lead generation expert. Extract food companies mentioned in this news article that are struggling with US tariffs and seeking international expansion.

**Article Title:** ${article.title || 'N/A'}
**Published:** ${article.date || 'N/A'}
**Source:** ${article.source?.title || 'N/A'}
**Article Content:**
${article.body || 'N/A'}

**Task:**
Identify food companies that:
1. Are impacted by US tariffs
2. Are seeking to diversify into international markets
3. Need help finding new customers in other countries

For each qualifying company, extract:
- Company name (exact as mentioned)
- Specific tariff challenge mentioned
- Target international markets (if mentioned)
- Estimated website domain

**Output Format (JSON array):**
[
  {
    "companyName": "Exact Company Name",
    "painPoint": "US tariff impact description",
    "targetMarkets": ["country1", "country2"],
    "website": "bestguess.com"
  }
]

**Rules:**
- Only include food/agricultural companies with clear tariff challenges
- Exclude generic industry references
- If no qualifying companies found, return []
- Return valid JSON only

**Output:**`;

    try {
      const response = await model.generateContent(prompt);
      const text = response.response?.text()?.trim() || '';

      const jsonMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || text.match(/(\[[\s\S]*?\])/);
      if (!jsonMatch) {
        console.warn(`   ⚠️ No JSON found in response for article: ${article.title?.slice(0, 50)}`);
        continue;
      }

      const companies = JSON.parse(jsonMatch[1]);
      if (!Array.isArray(companies)) continue;

      for (const company of companies) {
        const name = company.companyName?.trim();
        if (!name) continue;

        const key = name.toLowerCase();
        if (!seenCompanies.has(key)) {
          seenCompanies.set(key, {
            companyName: name,
            website: company.website || '',
            painPoint: company.painPoint || '',
            targetMarkets: company.targetMarkets || [],
            articles: []
          });
        }

        seenCompanies.get(key).articles.push({
          title: article.title,
          url: article.url,
          date: article.date,
          source: article.source?.title
        });
      }

    } catch (error) {
      console.error(`   🔴 Error extracting from article "${article.title?.slice(0, 50)}": ${error.message}`);
    }

    // Rate limiting for Gemini API
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const companies = Array.from(seenCompanies.values());
  console.log(`✅ Extracted ${companies.length} unique companies from ${articles.length} articles`);
  return companies;
}

async function qualifyCompaniesWithGemini(model, companies) {
  if (!GEMINI_API_KEY) {
    console.warn('⚠️ Skipping Gemini qualification: GEMINI_API_KEY not set.');
    return companies;
  }

  if (!companies.length) return [];

  console.log('\n🎯 Qualifying companies for tariff-diversification lead generation...');

  const batchSize = 8;
  const qualified = [];

  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);
    const prompt = `You are evaluating food companies for international sales lead generation services.

Target audience: Food producers struggling with US tariffs who need to:
- Find new customers in international markets
- Diversify away from US-dependent sales
- Expand export sales to mitigate tariff impacts

**Task:** Select companies that would benefit from professional lead generation services for international expansion.

Respond with ONLY a JSON array of 1-based indices for approved companies (e.g. [1,3]). Return [] if none qualify.

Companies:
${batch
  .map(
    (company, idx) =>
      `${idx + 1}. ${company.companyName} (${company.website})
Pain point: ${company.painPoint || 'N/A'}
Target markets: ${company.targetMarkets?.join(', ') || 'N/A'}
Articles: ${company.articles?.length || 0} mentions`
  )
  .join('\n\n')}

Approved indices:`;

    try {
      const response = await model.generateContent(prompt);
      const text = response.response?.text()?.trim() || '';
      const match = text.match(/\[[^\]]*\]/);
      if (!match) continue;
      const indexes = JSON.parse(match[0]);
      indexes.forEach((idx) => {
        if (Number.isInteger(idx) && idx >= 1 && idx <= batch.length) {
          qualified.push(batch[idx - 1]);
        }
      });
    } catch (error) {
      console.error('   ⚠️ Gemini qualification error:', error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log(`✅ Qualified ${qualified.length} out of ${companies.length} companies`);
  return qualified;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getLeadDomain(lead) {
  const candidates = [
    lead.companyDomain,
    lead.company_domain,
    lead.companyWebsite,
    lead.company_website,
    lead.organization?.domain,
    lead.organization?.website,
    lead.raw?.company_domain,
    lead.raw?.companyWebsite,
    lead.raw?.company_website
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDomain(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeLead(item) {
  const firstName = item.firstName || item.first_name || '';
  const lastName = item.lastName || item.last_name || '';
  const fullName = item.fullName || item.full_name || `${firstName} ${lastName}`.trim();
  const companyDomain = normalizeDomain(
    item.companyDomain ||
      item.company_domain ||
      item.companyWebsite ||
      item.company_website ||
      item.organization?.website ||
      item.organization?.domain ||
      ''
  );
  const companyIndustry = Array.isArray(item.company_industry)
    ? item.company_industry.join('; ')
    : item.companyIndustry || item.company_industry || '';

  return {
    fullName,
    firstName,
    lastName,
    email: item.email || '',
    position: item.position || item.job_title || '',
    seniority: Array.isArray(item.seniority_level)
      ? item.seniority_level.join('; ')
      : item.seniority || item.seniority_level || '',
    city: item.city || item.contact_city || '',
    state: item.state || item.contact_state || '',
    country: item.country || item.contact_country || '',
    linkedinUrl: item.linkedinUrl || item.linkedin || item.linkedin_url || '',
    companyWebsite: companyDomain,
    companyLinkedIn: item.companyLinkedIn || item.company_linkedin || '',
    companyDomain,
    companySize: item.companySize || item.company_size || '',
    companyIndustry,
    organization: {
      website: companyDomain,
      linkedinUrl: item.companyLinkedIn || item.company_linkedin || '',
      size: item.companySize || item.company_size || '',
      industry: companyIndustry,
      id: item.company_linkedin_uid || item.organizationId || ''
    },
    raw: item
  };
}

async function scrapeLeadsForCompanies(client, companies, decisionTitles, leadsPerCompany, contactLocations, runDir) {
  if (!companies.length) return new Map();
  console.log('\n👥 Running leads finder...');
  console.log(`   Decision-maker titles: ${decisionTitles.join(', ')}`);
  if (contactLocations.length) {
    console.log(`   Contact locations: ${contactLocations.join(', ')}`);
  }
  console.log(`   Leads per company target: ${leadsPerCompany}`);

  const domains = companies.map((company) => normalizeDomain(company.website)).filter(Boolean);
  const domainChunks = chunkArray(domains, Math.max(1, Math.min(10, domains.length)));
  const leadsByDomain = new Map(domains.map((domain) => [domain, []]));

  for (const chunk of domainChunks) {
    const fetchCount = Math.min(leadsPerCompany * chunk.length, 5000);
    const input = {
      company_domain: chunk,
      contact_job_title: decisionTitles,
      email_status: ['validated'],
      fetch_count: fetchCount
    };
    if (contactLocations.length) {
      input.contact_location = contactLocations;
    }

    console.log(`   Domains batch (${chunk.length}): ${chunk.join(', ')}`);

    try {
      const run = await client.actor(LEADS_FINDER_ACTOR_ID).call(input);
      const dataset = client.dataset(run.defaultDatasetId);
      const { items } = await dataset.listItems({ clean: true });
      const normalized = items.map(normalizeLead);

      normalized.forEach((lead) => {
        const domain = getLeadDomain(lead) || chunk[0];
        if (!leadsByDomain.has(domain)) {
          leadsByDomain.set(domain, []);
        }
        leadsByDomain.get(domain).push(lead);
      });

      const sample = normalized.slice(0, Math.min(3, normalized.length));
      if (sample.length) {
        console.log('   Sample lead(s):');
        console.log(JSON.stringify(sample, null, 2));
      } else {
        console.log('   No leads returned for this batch.');
      }
    } catch (error) {
      console.error(`   🔴 Leads finder failed for domains: ${chunk.join(', ')}`);
      console.error(`   ${error.message}`);
    }
  }

  return leadsByDomain;
}

async function writeLeadsCsv(filePath, leads, companyName) {
  if (!leads.length) return;
  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'company', title: 'Company' },
      { id: 'fullName', title: 'Full Name' },
      { id: 'firstName', title: 'First Name' },
      { id: 'lastName', title: 'Last Name' },
      { id: 'email', title: 'Email' },
      { id: 'position', title: 'Position' },
      { id: 'seniority', title: 'Seniority' },
      { id: 'city', title: 'City' },
      { id: 'state', title: 'State' },
      { id: 'country', title: 'Country' },
      { id: 'linkedinUrl', title: 'LinkedIn URL' },
      { id: 'companyWebsite', title: 'Company Website' },
      { id: 'companyLinkedIn', title: 'Company LinkedIn' },
      { id: 'companySize', title: 'Company Size' },
      { id: 'companyIndustry', title: 'Company Industry' },
      { id: 'organizationId', title: 'Organization ID' }
    ]
  });

  const records = leads.map((lead) => ({
    company: companyName,
    fullName: lead.fullName || '',
    firstName: lead.firstName || '',
    lastName: lead.lastName || '',
    email: lead.email || '',
    position: lead.position || '',
    seniority: lead.seniority || '',
    city: lead.city || '',
    state: lead.state || '',
    country: lead.country || '',
    linkedinUrl: lead.linkedinUrl || '',
    companyWebsite: lead.companyWebsite || '',
    companyLinkedIn: lead.companyLinkedIn || '',
    companySize: lead.companySize || '',
    companyIndustry: lead.companyIndustry || '',
    organizationId: lead.organization?.id || ''
  }));

  await csvWriter.writeRecords(records);
}

async function main() {
  const options = parseArgs();
  const token = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
  if (!token) {
    console.error('🔴 Missing Apify API token. Set APIFY_TOKEN in .env');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runLabel = options.runName || `news-tariff-leads-${timestamp}`;
  const runDir = path.join(OUTPUT_ROOT, runLabel);
  ensureDir(runDir);

  console.log(`📁 Run directory: ${runDir}`);
  console.log('\n⚙️ Configuration:');
  console.log(`   Queries: ${options.queries.join(', ')}`);
  console.log(`   Max pages per query: ${options.maxPagesPerQuery}`);
  console.log(`   Max results per query: ${options.maxResultsPerQuery}`);
  console.log(`   Results per page: ${options.resultsPerPage}`);
  console.log(`   Search country: ${options.searchCountry || 'Default'}`);
  console.log(`   Search language: ${options.searchLanguage || 'Default'}`);
  console.log(`   Max articles: ${options.maxArticles}`);
  console.log(`   Decision titles: ${options.decisionTitles.join(', ')}`);
  console.log(`   Contact locations: ${options.contactLocations.length ? options.contactLocations.join(', ') : 'None'}`);
  console.log(`   Leads per company: ${options.leadsPerCompany}`);
  console.log(`   Max companies: ${options.maxCompanies > 0 ? options.maxCompanies : 'Unlimited'}`);

  const client = new ApifyClient({ token });

  let searchResults = [];
  const searchPath = path.join(runDir, 'search-results.json');

  if (options.skipSearch) {
    try {
      const raw = await fsp.readFile(searchPath, 'utf8');
      searchResults = JSON.parse(raw);
      console.log(`📥 Loaded ${searchResults.length} search result(s) from ${searchPath}`);
    } catch (error) {
      console.warn(`⚠️ search-results.json missing or unreadable (${error.message}). Re-running Google search...`);
      searchResults = await runGoogleSearch(client, options);
      await writeJson(searchPath, searchResults);
    }
  } else {
    searchResults = await runGoogleSearch(client, options);
    await writeJson(searchPath, searchResults);
  }

  const normalizedResults = normalizeGoogleResults(searchResults);
  if (!normalizedResults.length && !options.skipSearch) {
    console.error('🔴 No Google search results available.');
    process.exit(1);
  }

  let articles = [];
  const articlesPath = path.join(runDir, 'articles.json');

  if (options.skipArticles || options.skipExtraction) {
    try {
      let articlesPath = path.join(runDir, 'articles.json');
      if (options.articlesFile) {
        articlesPath = path.isAbsolute(options.articlesFile)
          ? options.articlesFile
          : path.join(process.cwd(), options.articlesFile);
      }
      const raw = await fsp.readFile(articlesPath, 'utf8');
      articles = JSON.parse(raw);
      console.log(`📥 Loaded ${articles.length} articles from ${articlesPath}`);
    } catch (error) {
      if (options.skipArticles && !options.articlesFile) {
        console.warn(`⚠️ articles.json missing or unreadable (${error.message}). Re-running article extraction...`);
        articles = await extractArticlesWithSmartActor(client, normalizedResults, options);
        await writeJson(articlesPath, articles);
      } else {
        console.error(`🔴 Failed to load articles: ${error.message}`);
        process.exit(1);
      }
    }
  } else {
    articles = await extractArticlesWithSmartActor(client, normalizedResults, options);
    await writeJson(articlesPath, articles);
  }

  if (!Array.isArray(articles) || !articles.length) {
    console.error('🔴 No articles available to extract companies.');
    process.exit(1);
  }

  let extractedCompanies = [];
  const companiesRawPath = path.join(runDir, 'companies-raw.json');

  if (options.skipExtraction) {
    try {
      const raw = await fsp.readFile(companiesRawPath, 'utf8');
      extractedCompanies = JSON.parse(raw);
      console.log(`📥 Loaded ${extractedCompanies.length} extracted companies from ${companiesRawPath}`);
    } catch (error) {
      console.error(`🔴 Failed to load companies-raw.json: ${error.message}`);
      process.exit(1);
    }
  } else {
    const model = initGemini();
    extractedCompanies = await extractCompaniesFromArticles(model, articles);
    await writeJson(companiesRawPath, extractedCompanies);
  }

  let qualifiedCompanies = [];
  let rejectedCompanies = [];
  const companiesPath = path.join(runDir, 'companies.json');

  if (options.skipGemini) {
    try {
      let source = companiesPath;
      if (options.companiesFile) {
        source = path.isAbsolute(options.companiesFile)
          ? options.companiesFile
          : path.join(__dirname, options.companiesFile);
      }
      const raw = await fsp.readFile(source, 'utf8');
      qualifiedCompanies = JSON.parse(raw);
      console.log(`📥 Loaded ${qualifiedCompanies.length} qualified companies from ${source}`);
    } catch (error) {
      console.error(`🔴 Failed to load companies.json: ${error.message}`);
      process.exit(1);
    }
  } else {
    const model = initGemini();
    qualifiedCompanies = await qualifyCompaniesWithGemini(model, extractedCompanies);
    rejectedCompanies = extractedCompanies.filter(
      (company) => !qualifiedCompanies.includes(company)
    );
    await writeJson(companiesPath, qualifiedCompanies);
    await writeJson(path.join(runDir, 'companies-rejected.json'), rejectedCompanies);
  }

  if (!qualifiedCompanies.length) {
    console.error('🔴 No companies qualified for lead generation.');
    process.exit(1);
  }

  const selectedCompanies = options.maxCompanies > 0
    ? qualifiedCompanies.slice(0, options.maxCompanies)
    : qualifiedCompanies;
  console.log(`🎯 Companies selected for leads: ${selectedCompanies.length}`);

  const leadsByDomain = await scrapeLeadsForCompanies(
    client,
    selectedCompanies,
    options.decisionTitles,
    options.leadsPerCompany,
    options.contactLocations,
    runDir
  );

  const allLeads = [];
  const summary = [];

  for (const company of selectedCompanies) {
    const domain = normalizeDomain(company.website);
    const leads = domain ? leadsByDomain.get(domain) || [] : [];

    const companyDir = path.join(runDir, slugify(company.companyName || domain));
    ensureDir(companyDir);

    await writeJson(path.join(companyDir, 'company.json'), company);
    await writeJson(path.join(companyDir, 'leads.json'), leads);
    await writeLeadsCsv(path.join(companyDir, 'leads.csv'), leads, company.companyName || 'Unknown Company');

    allLeads.push(...leads);
    summary.push({
      companyName: company.companyName,
      website: company.website,
      painPoint: company.painPoint,
      targetMarkets: company.targetMarkets,
      articlesCount: company.articles?.length || 0,
      leadsScraped: leads.length
    });
  }

  await writeJson(path.join(runDir, 'all-leads.json'), allLeads);
  await writeLeadsCsv(path.join(runDir, 'all-leads.csv'), allLeads, 'All Companies');
  await writeJson(path.join(runDir, 'summary.json'), {
    runLabel,
    generatedAt: new Date().toISOString(),
    searchResultsCollected: normalizedResults.length,
    articlesCollected: articles.length,
    companiesCollected: extractedCompanies.length,
    companiesQualified: qualifiedCompanies.length,
    companiesRejected: rejectedCompanies.length,
    companiesProcessed: selectedCompanies.length,
    leadsCollected: allLeads.length,
    decisionTitles: options.decisionTitles,
    contactLocations: options.contactLocations,
    queries: options.queries,
    searchCountry: options.searchCountry,
    searchLanguage: options.searchLanguage,
    summary
  });

  console.log('\n🎯 Flow completed.');
  console.log(`   Articles collected: ${articles.length}`);
  console.log(`   Companies collected: ${extractedCompanies.length}`);
  console.log(`   Companies qualified: ${qualifiedCompanies.length}`);
  console.log(`   Companies processed: ${selectedCompanies.length}`);
  console.log(`   Leads collected: ${allLeads.length}`);
  console.log(`\n📁 Artifacts stored in ${runDir}`);
}

main().catch((error) => {
  console.error('🔴 News-based lead generation failed:', error);
  process.exit(1);
});
