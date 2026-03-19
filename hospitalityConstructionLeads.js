#!/usr/bin/env node
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

const OUTPUT_ROOT = path.join(__dirname, 'hospitality_construction_runs');
const GOOGLE_SEARCH_ACTOR_ID = process.env.APIFY_GOOGLE_SEARCH_ACTOR_ID || 'apify/google-search-scraper';
const LEADS_FINDER_ACTOR_ID = 'code_crafter/leads-finder';
const DEFAULT_QUERIES = [
  'restaurant construction interior design firm',
  'hotel renovation procurement company',
  'hospitality fit out contractor purchasing',
  'restaurant interior design build contractor',
  'hotel construction procurement services'
];
const DEFAULT_DECISION_TITLES = [
  'Director of Interior Design',
  'Head of Interior Design',
  'Interior Design Manager',
  'Head of Purchasing',
  'Purchasing Director',
  'Purchasing Manager',
  'Head of Procurement',
  'Procurement Director',
  'Procurement Manager'
];
const DEFAULT_MAX_PAGES_PER_QUERY = parseInt(process.env.GOOGLE_SEARCH_MAX_PAGES || '3', 10);
const DEFAULT_MAX_RESULTS_PER_QUERY = parseInt(process.env.GOOGLE_SEARCH_MAX_RESULTS || '20', 10);
const DEFAULT_LEADS_PER_COMPANY = parseInt(process.env.LEADS_FINDER_LEADS_PER_COMPANY || '200', 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

async function qualifyCompaniesWithGemini(companies, { industryDescription = 'hotels, hotel groups, and hospitality interior designers' } = {}) {
  if (!GEMINI_API_KEY) {
    console.warn('⚠️  Skipping Gemini qualification: GEMINI_API_KEY not set.');
    return companies;
  }

  if (!companies.length) return [];

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 1024
    }
  });

  const batchSize = 10;
  const qualified = [];

  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);
    const prompt = `You qualify companies for hospitality outreach targeting hotels and hotel interior designers.

Target audience: ${industryDescription} - companies that would need interior design, purchasing, or procurement services for hotel projects.

Reject directories, news/media sites, tech vendors, or unrelated services. Approve hotels, hotel groups, hospitality brands, and interior design firms focused on hospitality.

Respond with ONLY a JSON array of 1-based indices for approved companies (e.g. [1,3]). Return [] if none qualify.

Companies:\n${batch
      .map(
        (company, idx) =>
          `${idx + 1}. ${company.companyName || '(Unknown name)'} (${company.website})\nTitle: ${company.searchTitle || 'N/A'}\nSnippet: ${company.searchSnippet || 'N/A'}`
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
      console.error('   ⚠️  Gemini qualification error:', error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log(`✅ Gemini qualified companies: ${qualified.length} / ${companies.length}`);
  return qualified;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitise(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

function parseList(value, fallback = []) {
  if (!value) return fallback.slice();
  if (Array.isArray(value)) return value.map((item) => sanitise(item)).filter(Boolean);
  const items = value
    .split(/[|,;]/)
    .map((item) => sanitise(item))
    .filter(Boolean);
  return items.length ? items : fallback.slice();
}

function normalizeDomain(value) {
  if (!value) return '';
  return value
    .toString()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .trim();
}

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

  const queries = parseList(getValue('--queries'), DEFAULT_QUERIES);
  const decisionTitles = parseList(getValue('--decision-titles'), DEFAULT_DECISION_TITLES);
  const searchCountries = parseList(getValue('--countries'), []);
  const searchLanguages = parseList(getValue('--languages'), []);
  const contactLocations = parseList(getValue('--contact-locations'), []);

  return {
    queries,
    decisionTitles,
    searchCountries,
    searchLanguages,
    contactLocations,
    maxPagesPerQuery: parseInt(getValue('--max-pages') || `${DEFAULT_MAX_PAGES_PER_QUERY}`, 10),
    maxResultsPerQuery: parseInt(getValue('--max-results') || `${DEFAULT_MAX_RESULTS_PER_QUERY}`, 10),
    leadsPerCompany: parseInt(getValue('--leads-per-company') || `${DEFAULT_LEADS_PER_COMPANY}`, 10),
    maxCompanies: parseInt(getValue('--max-companies') || '0', 10),
    runName: sanitise(getValue('--run-name')),
    skipSearch: hasFlag('--skip-search'),
    searchFile: sanitise(getValue('--search-file')),
    searchRun: sanitise(getValue('--search-run')),
    skipExtraction: hasFlag('--skip-extraction'),
    skipGemini: hasFlag('--skip-gemini'),
    companiesFile: sanitise(getValue('--companies-file'))
  };
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function titleCase(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function deriveCompanyNameFromTitle(title) {
  const cleaned = sanitise(title)
    .replace(/\s*\|\s+.*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+·\s+.*$/, '')
    .trim();
  if (cleaned && cleaned.length <= 120) return cleaned;
  return titleCase(cleaned.split(' ').slice(0, 5).join(' '));
}

function deriveCompanyFromDomain(domain) {
  if (!domain) return '';
  const base = domain
    .replace(/\.[a-z]{2,}$/i, '')
    .replace(/-/g, ' ')
    .replace(/_/g, ' ');
  return titleCase(base);
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

function normalizeApifySearchResults(rawResults) {
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

function extractCompaniesFromSearchResults(results) {
  console.log('\n🏢 Extracting companies from Google search results...');
  const companiesMap = new Map();

  results.forEach((item) => {
    const url = item.url || item.link || '';
    const domain = normalizeDomain(url);
    if (!domain) return;
    if (shouldIgnoreDomain(domain)) return;

    const title = deriveCompanyNameFromTitle(item.title || item.pageTitle || domain);
    const description = sanitise(item.description || item.snippet || '');

    if (!companiesMap.has(domain)) {
      companiesMap.set(domain, {
        companyName: title || deriveCompanyFromDomain(domain),
        website: domain,
        searchTitle: item.title || '',
        searchSnippet: description,
        queries: new Set(),
        resultUrls: new Set()
      });
    }

    const entry = companiesMap.get(domain);
    entry.resultUrls.add(url);
    if (item.query) entry.queries.add(item.query);
    if (description && !entry.searchSnippet) entry.searchSnippet = description;
    if (item.title && !entry.searchTitle) entry.searchTitle = item.title;
  });

  const companies = Array.from(companiesMap.values()).map((company) => ({
    ...company,
    queries: Array.from(company.queries),
    resultUrls: Array.from(company.resultUrls)
  }));

  console.log(`✅ Unique domains discovered: ${companies.length}`);
  return companies;
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

async function resolveSearchPath(options, fallbackPath) {
  const candidates = [];
  if (options.searchFile) {
    candidates.push(path.isAbsolute(options.searchFile) ? options.searchFile : path.join(__dirname, options.searchFile));
  }
  if (options.searchRun) {
    candidates.push(path.join(OUTPUT_ROOT, options.searchRun, 'search-results.json'));
  }
  if (fallbackPath) candidates.push(fallbackPath);

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await fsp.access(candidate, fs.constants.R_OK);
      return candidate;
    } catch (error) {
      // keep scanning other candidates
    }
  }

  throw new Error('Unable to locate Google search file. Provide --search-file or --search-run.');
}

async function runGoogleSearch(client, options) {
  const queryList = options.queries.length ? options.queries : DEFAULT_QUERIES;
  const actorInput = {
    queries: queryList.join('\n'),
    maxPagesPerQuery: Math.max(options.maxPagesPerQuery, 1),
    maxResultsPerQuery: Math.max(options.maxResultsPerQuery, 1),
    includeUnfilteredResults: true,
    saveHtml: false,
    saveHtmlToKeyValueStore: false
  };

  if (options.searchCountries.length) actorInput.gl = options.searchCountries[0];
  if (options.searchLanguages.length) actorInput.hl = options.searchLanguages[0];

  console.log('\n🔍 Running Google search actor with input:');
  console.log(JSON.stringify(actorInput, null, 2));

  const run = await client.actor(GOOGLE_SEARCH_ACTOR_ID).call(actorInput);
  const dataset = client.dataset(run.defaultDatasetId);
  const { items } = await dataset.listItems({ clean: true });
  const results = Array.isArray(items) ? items : [];
  const resolvedQueries = queryList;

  const annotated = results.map((item) => {
    const queryIndex = typeof item.queryIndex === 'number' ? item.queryIndex : null;
    const fallbackQuery = queryIndex !== null && resolvedQueries[queryIndex]
      ? resolvedQueries[queryIndex]
      : resolvedQueries[0];
    return {
      ...item,
      query: item.query || item.searchQuery || item.inputQuery || fallbackQuery
    };
  });

  console.log(`📥 Retrieved ${annotated.length} search result item(s).`);
  return annotated;
}

async function main() {
  const options = parseArgs();
  const token = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
  if (!token) {
    console.error('🔴 Missing Apify API token. Set APIFY_TOKEN in .env');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runLabel = options.runName || `hospitality-construction-${timestamp}`;
  const runDir = path.join(OUTPUT_ROOT, runLabel);
  ensureDir(runDir);

  console.log(`📁 Run directory: ${runDir}`);
  console.log('\n⚙️ Configuration:');
  console.log(`   Queries: ${options.queries.join(', ')}`);
  console.log(`   Decision titles: ${options.decisionTitles.join(', ')}`);
  console.log(`   Search countries: ${options.searchCountries.length ? options.searchCountries.join(', ') : 'Default'}`);
  console.log(`   Search languages: ${options.searchLanguages.length ? options.searchLanguages.join(', ') : 'Default'}`);
  console.log(`   Max pages per query: ${options.maxPagesPerQuery}`);
  console.log(`   Max results per query: ${options.maxResultsPerQuery}`);
  console.log(`   Contact locations: ${options.contactLocations.length ? options.contactLocations.join(', ') : 'None'}`);
  console.log(`   Leads per company: ${options.leadsPerCompany}`);
  console.log(`   Max companies: ${options.maxCompanies > 0 ? options.maxCompanies : 'Unlimited'}`);

  const client = new ApifyClient({ token });

  let searchResults = [];
  const searchPath = path.join(runDir, 'search-results.json');

  if (options.skipExtraction) {
    console.log('⏩ Skipping search and extraction steps.');
  } else {
    if (options.skipSearch) {
      try {
        const resolved = await resolveSearchPath(options, searchPath);
        const raw = await fsp.readFile(resolved, 'utf8');
        const rawData = JSON.parse(raw);
        searchResults = normalizeApifySearchResults(rawData);
        console.log(`📥 Loaded ${searchResults.length} search result(s) from ${resolved}`);
      } catch (error) {
        console.error(`🔴 Failed to load search results: ${error.message}`);
        process.exit(1);
      }
    } else {
      searchResults = await runGoogleSearch(client, options);
      await writeJson(searchPath, searchResults);
    }

    if (!Array.isArray(searchResults) || !searchResults.length) {
      console.error('🔴 No Google search results available to extract companies.');
      process.exit(1);
    }
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
    extractedCompanies = extractCompaniesFromSearchResults(searchResults).filter((company) => normalizeDomain(company.website));
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
    qualifiedCompanies = await qualifyCompaniesWithGemini(extractedCompanies);
    rejectedCompanies = extractedCompanies.filter(
      (company) => !qualifiedCompanies.includes(company)
    );
    await writeJson(companiesPath, qualifiedCompanies);
    await writeJson(path.join(runDir, 'companies-rejected.json'), rejectedCompanies);
  }

  if (!qualifiedCompanies.length) {
    console.error('🔴 No companies matched the hospitality construction criteria.');
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
    await writeLeadsCsv(path.join(companyDir, 'leads.csv'), leads, company.companyName || deriveCompanyFromDomain(domain));

    allLeads.push(...leads);
    summary.push({
      companyName: company.companyName,
      website: company.website,
      queries: company.queries || [],
      resultUrls: company.resultUrls || [],
      leadsScraped: leads.length
    });
  }

  await writeJson(path.join(runDir, 'all-leads.json'), allLeads);
  await writeLeadsCsv(path.join(runDir, 'all-leads.csv'), allLeads, 'All Companies');
  await writeJson(path.join(runDir, 'summary.json'), {
    runLabel,
    generatedAt: new Date().toISOString(),
    searchResultsCollected: searchResults.length,
    companiesCollected: extractedCompanies.length,
    companiesQualified: qualifiedCompanies.length,
    companiesRejected: rejectedCompanies.length,
    companiesProcessed: selectedCompanies.length,
    leadsCollected: allLeads.length,
    decisionTitles: options.decisionTitles,
    contactLocations: options.contactLocations,
    queries: options.queries,
    summary
  });

  console.log('\n🎯 Flow completed.');
  console.log(`   Search results collected: ${searchResults.length}`);
  console.log(`   Companies collected: ${extractedCompanies.length}`);
  console.log(`   Companies qualified: ${qualifiedCompanies.length}`);
  console.log(`   Companies processed: ${selectedCompanies.length}`);
  console.log(`   Leads collected: ${allLeads.length}`);
  console.log(`\n📁 Artifacts stored in ${runDir}`);
}

main().catch((error) => {
  console.error('🔴 Hospitality construction flow failed:', error);
  process.exit(1);
});
