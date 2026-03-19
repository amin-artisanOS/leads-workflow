#!/usr/bin/env node
/**
 * SEO Outreach Lead Generation for Home Decor
 *
 * This script helps find home decor websites for outreach campaigns:
 * 1. Run Google searches for home decor websites and blogs
 * 2. Extract company domains from SERP results
 * 3. Use Gemini to qualify websites for outreach opportunities
 * 4. Generate personalized outreach emails for:
 *    - Product sourcing proposals
 *    - Guest post requests
 *    - Backlink opportunities
 *    - Partnership requests
 *
 * Usage:
 *   npm run outreach
 *
 * Advanced usage:
 *   node seoOutreachLeadGeneration.js \
 *     --queries "home decor blogs 2025|interior design websites" \
 *     --product "handmade ceramic planters" \
 *     --outreach-type "guest-post,backlink,partnership" \
 *     --max-pages-per-query 3 \
 *     --run-name home-decor-outreach
 *
 * Resume flags:
 *   --skip-search: Load existing search-results.json
 *   --skip-extraction: Load domains-raw.json
 *   --skip-qualification: Load qualified-domains.json
 *
 * Environment variables:
 *   APIFY_TOKEN: Required for Google search
 *   GEMINI_API_KEY: Required for AI processing
 *   APIFY_GOOGLE_SEARCH_ACTOR_ID (optional)
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

const OUTPUT_ROOT = path.join(__dirname, 'seo_outreach_runs');
const GOOGLE_SEARCH_ACTOR_ID = process.env.APIFY_GOOGLE_SEARCH_ACTOR_ID || 'apify/google-search-scraper';

const DEFAULT_SEARCH_QUERIES = [
  'home decor blogs 2025',
  'interior design websites',
  'home styling blogs',
  'decor inspiration websites',
  'home decor trends blogs'
];

const DEFAULT_OUTREACH_TYPES = ['guest-post', 'backlink', 'partnership'];
const DEFAULT_PRODUCT = 'home decor products';

const DEFAULT_MAX_PAGES_PER_QUERY = parseInt(process.env.GOOGLE_SEARCH_MAX_PAGES || '2', 10);
const DEFAULT_MAX_RESULTS_PER_QUERY = parseInt(process.env.GOOGLE_SEARCH_MAX_RESULTS || '20', 10);
const DEFAULT_RESULTS_PER_PAGE = parseInt(process.env.GOOGLE_SEARCH_RESULTS_PER_PAGE || '100', 10);
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
    queries = DEFAULT_SEARCH_QUERIES;
  }

  return {
    queries,
    maxPagesPerQuery: parseInt(getValue('--max-pages-per-query') || DEFAULT_MAX_PAGES_PER_QUERY, 10),
    maxResultsPerQuery: parseInt(getValue('--max-results-per-query') || DEFAULT_MAX_RESULTS_PER_QUERY, 10),
    resultsPerPage: parseInt(getValue('--results-per-page') || DEFAULT_RESULTS_PER_PAGE, 10),
    searchCountry: getValue('--search-country') || '',
    searchLanguage: getValue('--search-language') || '',
    product: getValue('--product') || DEFAULT_PRODUCT,
    outreachTypes: parseList(getValue('--outreach-type') || DEFAULT_OUTREACH_TYPES.join(',')),
    maxDomains: parseInt(getValue('--max-domains') || '0', 10),
    runName: getValue('--run-name'),
    skipSearch: hasFlag('--skip-search'),
    skipExtraction: hasFlag('--skip-extraction'),
    skipQualification: hasFlag('--skip-qualification'),
    dryRun: hasFlag('--dry-run')
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeDomain(url) {
  if (!url) return '';
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function slugify(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'domain';
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

function shouldIgnoreDomain(domain) {
  if (!domain) return true;
  const ignorePatterns = [
    'google.com',
    'facebook.com',
    'twitter.com',
    'instagram.com',
    'linkedin.com',
    'youtube.com',
    'pinterest.com',
    'amazon.com',
    'wikipedia.org',
    'reddit.com'
  ];
  return ignorePatterns.some(pattern => domain.includes(pattern));
}

function extractDomainsFromSearchResults(searchResults) {
  console.log('\n🏢 Extracting domains from search results...');

  const domains = new Map();
  searchResults.forEach((result) => {
    const domain = normalizeDomain(result.url);
    if (!domain || shouldIgnoreDomain(domain)) return;

    if (!domains.has(domain)) {
      domains.set(domain, {
        domain,
        urls: [],
        titles: [],
        descriptions: [],
        queries: []
      });
    }

    const domainData = domains.get(domain);
    domainData.urls.push(result.url);
    domainData.titles.push(result.title);
    domainData.descriptions.push(result.description);
    domainData.queries.push(result.query);
  });

  const domainList = Array.from(domains.values());
  console.log(`✅ Extracted ${domainList.length} unique domains`);
  return domainList;
}

function initGemini() {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  return genAI.getGenerativeModel({
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 2048
    }
  });
}

async function qualifyDomainsForOutreach(model, domains, options) {
  if (!GEMINI_API_KEY) {
    console.warn('⚠️ Skipping Gemini qualification: GEMINI_API_KEY not set.');
    return domains;
  }

  if (!domains.length) return [];

  console.log('\n🎯 Qualifying domains for outreach...');

  const batchSize = 10;
  const qualified = [];

  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    const prompt = `You are an SEO outreach expert evaluating websites for partnership opportunities.

Target audience: Home decor blogs, interior design websites, and lifestyle blogs that accept:
- Guest posts about home decor trends and products
- Backlink partnerships
- Product reviews and collaborations
- Content partnerships

**Task:** Select domains that would be interested in outreach for: ${options.outreachTypes.join(', ')}

Product focus: ${options.product}

Respond with ONLY a JSON array of 1-based indices for approved domains (e.g. [1,3]). Return [] if none qualify.

Domains:
${batch
  .map(
    (domain, idx) =>
      `${idx + 1}. ${domain.domain}
Titles: ${domain.titles.slice(0, 2).join('; ')}
Description: ${domain.descriptions[0]?.slice(0, 100) || 'N/A'}
Queries: ${domain.queries.slice(0, 2).join('; ')}`
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

  console.log(`✅ Qualified ${qualified.length} out of ${domains.length} domains`);
  return qualified;
}

async function generateOutreachTemplates(model, domains, options) {
  if (!domains.length) return [];

  console.log('\n📧 Generating outreach templates...');

  const templates = [];

  for (const domain of domains) {
    const domainTemplates = {};

    for (const outreachType of options.outreachTypes) {
      const prompt = `Generate a personalized ${outreachType} outreach email template for this website.

Website: ${domain.domain}
Titles: ${domain.titles.slice(0, 2).join('; ')}
Description: ${domain.descriptions[0]?.slice(0, 100) || 'N/A'}

Product/Service: ${options.product}
Outreach Type: ${outreachType}

Generate a professional, personalized email template that:
- Has a compelling subject line
- Personalizes based on the website content
- Clearly states the value proposition
- Includes a specific call-to-action
- Is concise but engaging

Return ONLY the email template in this format:
Subject: [Subject Line]

Dear [Website Owner/Editor],

[Email body]

Best regards,
[Your Name]
[Your Company]
[Your Contact Info]`;

      try {
        const response = await model.generateContent(prompt);
        const template = response.response?.text()?.trim() || '';
        domainTemplates[outreachType] = template;
      } catch (error) {
        console.error(`   ⚠️ Error generating ${outreachType} template for ${domain.domain}:`, error.message);
        domainTemplates[outreachType] = `Error generating template: ${error.message}`;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    templates.push({
      domain: domain.domain,
      urls: domain.urls,
      titles: domain.titles,
      descriptions: domain.descriptions,
      queries: domain.queries,
      templates: domainTemplates
    });
  }

  console.log(`✅ Generated outreach templates for ${templates.length} domains`);
  return templates;
}

async function writeOutreachCsv(filePath, templates) {
  if (!templates.length) return;
  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'domain', title: 'Domain' },
      { id: 'primaryUrl', title: 'Primary URL' },
      { id: 'primaryTitle', title: 'Primary Title' },
      { id: 'description', title: 'Description' },
      { id: 'queries', title: 'Found Via Queries' },
      { id: 'guestPostTemplate', title: 'Guest Post Template' },
      { id: 'backlinkTemplate', title: 'Backlink Template' },
      { id: 'partnershipTemplate', title: 'Partnership Template' },
      { id: 'productSourcingTemplate', title: 'Product Sourcing Template' }
    ]
  });

  const records = templates.map((template) => ({
    domain: template.domain,
    primaryUrl: template.urls[0] || '',
    primaryTitle: template.titles[0] || '',
    description: template.descriptions[0] || '',
    queries: template.queries.join('; '),
    guestPostTemplate: template.templates['guest-post'] || '',
    backlinkTemplate: template.templates['backlink'] || '',
    partnershipTemplate: template.templates['partnership'] || '',
    productSourcingTemplate: template.templates['product-sourcing'] || ''
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
  const runLabel = options.runName || `outreach-${timestamp}`;
  const runDir = path.join(OUTPUT_ROOT, runLabel);
  ensureDir(runDir);

  console.log(`📁 Run directory: ${runDir}`);
  console.log('\n⚙️ Configuration:');
  console.log(`   Queries: ${options.queries.join(', ')}`);
  console.log(`   Product: ${options.product}`);
  console.log(`   Outreach types: ${options.outreachTypes.join(', ')}`);
  console.log(`   Max pages per query: ${options.maxPagesPerQuery}`);
  console.log(`   Max results per query: ${options.maxResultsPerQuery}`);
  console.log(`   Results per page: ${options.resultsPerPage}`);
  console.log(`   Search country: ${options.searchCountry || 'Default'}`);
  console.log(`   Search language: ${options.searchLanguage || 'Default'}`);
  console.log(`   Max domains: ${options.maxDomains > 0 ? options.maxDomains : 'Unlimited'}`);

  const client = new ApifyClient({ token });

  let searchResults = [];
  const searchPath = path.join(runDir, 'search-results.json');

  if (options.skipSearch) {
    try {
      const raw = await fsp.readFile(searchPath, 'utf8');
      searchResults = JSON.parse(raw);
      console.log(`📥 Loaded ${searchResults.length} search result(s) from ${searchPath}`);
    } catch (error) {
      console.error(`🔴 Failed to load search results: ${error.message}`);
      process.exit(1);
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

  let extractedDomains = [];
  const domainsRawPath = path.join(runDir, 'domains-raw.json');

  if (options.skipExtraction) {
    try {
      const raw = await fsp.readFile(domainsRawPath, 'utf8');
      extractedDomains = JSON.parse(raw);
      console.log(`📥 Loaded ${extractedDomains.length} extracted domains from ${domainsRawPath}`);
    } catch (error) {
      console.error(`🔴 Failed to load domains-raw.json: ${error.message}`);
      process.exit(1);
    }
  } else {
    extractedDomains = extractDomainsFromSearchResults(normalizedResults);
    await writeJson(domainsRawPath, extractedDomains);
  }

  let qualifiedDomains = [];
  const domainsPath = path.join(runDir, 'qualified-domains.json');

  if (options.skipQualification) {
    try {
      const raw = await fsp.readFile(domainsPath, 'utf8');
      qualifiedDomains = JSON.parse(raw);
      console.log(`📥 Loaded ${qualifiedDomains.length} qualified domains from ${domainsPath}`);
    } catch (error) {
      console.error(`🔴 Failed to load qualified-domains.json: ${error.message}`);
      process.exit(1);
    }
  } else {
    const model = initGemini();
    qualifiedDomains = await qualifyDomainsForOutreach(model, extractedDomains, options);
    await writeJson(domainsPath, qualifiedDomains);
  }

  if (!qualifiedDomains.length) {
    console.error('🔴 No domains qualified for outreach.');
    process.exit(1);
  }

  const selectedDomains = options.maxDomains > 0
    ? qualifiedDomains.slice(0, options.maxDomains)
    : qualifiedDomains;
  console.log(`🎯 Domains selected for outreach: ${selectedDomains.length}`);

  const model = initGemini();
  const outreachTemplates = await generateOutreachTemplates(model, selectedDomains, options);

  const domainSummaries = selectedDomains.map((domain, index) => ({
    domain: domain.domain,
    primaryUrl: domain.urls[0],
    primaryTitle: domain.titles[0],
    description: domain.descriptions[0]?.slice(0, 100),
    queries: domain.queries.slice(0, 3),
    templateCount: Object.keys(outreachTemplates[index]?.templates || {}).length
  }));

  await writeJson(path.join(runDir, 'outreach-templates.json'), outreachTemplates);
  await writeOutreachCsv(path.join(runDir, 'outreach-templates.csv'), outreachTemplates);
  await writeJson(path.join(runDir, 'summary.json'), {
    runLabel,
    generatedAt: new Date().toISOString(),
    searchResultsCollected: normalizedResults.length,
    domainsCollected: extractedDomains.length,
    domainsQualified: qualifiedDomains.length,
    domainsProcessed: selectedDomains.length,
    templatesGenerated: outreachTemplates.length,
    product: options.product,
    outreachTypes: options.outreachTypes,
    queries: options.queries,
    searchCountry: options.searchCountry,
    searchLanguage: options.searchLanguage,
    domainSummaries
  });

  console.log('\n🎯 Outreach workflow completed.');
  console.log(`   Search results collected: ${normalizedResults.length}`);
  console.log(`   Domains collected: ${extractedDomains.length}`);
  console.log(`   Domains qualified: ${qualifiedDomains.length}`);
  console.log(`   Domains processed: ${selectedDomains.length}`);
  console.log(`   Templates generated: ${outreachTemplates.length}`);
  console.log(`\n📁 Artifacts stored in ${runDir}`);
}

main().catch((error) => {
  console.error('🔴 SEO outreach workflow failed:', error);
  process.exit(1);
});
