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

const OUTPUT_ROOT = path.join(__dirname, 'linkedin_jobs_to_leads_runs');
const LINKEDIN_ACTOR_ID = process.env.APIFY_LINKEDIN_JOBS_ACTOR_ID || 'hKByXkMQaC5Qt9UMN';
const LEADS_FINDER_ACTOR_ID = 'code_crafter/leads-finder';
const DEFAULT_JOBS_COUNT = 100;
const DEFAULT_LEADS_PER_COMPANY = 500;
const DEFAULT_JOB_FUNCTIONS = 'sale,bd';
const PROCESSED_COMPANIES_FILE = path.join(__dirname, 'processed_companies_history.json');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const DEFAULT_MAX_DOMAINS_PER_CALL = parseInt(process.env.LEADS_FINDER_MAX_DOMAINS_PER_CALL || '5', 10);
const MIN_LEADS_PER_COMPANY = parseInt(process.env.LEADS_FINDER_MIN_LEADS_PER_COMPANY || '25', 10);
const EU_COUNTRIES = [
  'austria',
  'belgium',
  'bulgaria',
  'croatia',
  'cyprus',
  'czech republic',
  'denmark',
  'estonia',
  'finland',
  'france',
  'germany',
  'greece',
  'hungary',
  'ireland',
  'italy',
  'latvia',
  'lithuania',
  'luxembourg',
  'malta',
  'netherlands',
  'poland',
  'portugal',
  'romania',
  'slovakia',
  'slovenia',
  'spain',
  'sweden'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeLocationForLeadsFinder(location) {
  if (!location) return [];

  const rawTokens = Array.isArray(location)
    ? location
    : location
        .toString()
        .split(/[|,;]/)
        .map((value) => value.trim())
        .filter(Boolean);

  const euSynonyms = new Set(['european union', 'eu', 'europe']);
  const mapping = new Map([
    ['united kingdom', 'united kingdom'],
    ['uk', 'united kingdom'],
    ['united states', 'united states'],
    ['usa', 'united states'],
    ['us', 'united states'],
    ['u.s.', 'united states'],
    ['u.s.a.', 'united states']
  ]);

  const results = new Set();

  rawTokens.forEach((token) => {
    const normalized = token.toLowerCase();

    if (euSynonyms.has(normalized)) {
      EU_COUNTRIES.forEach((country) => results.add(country));
      return;
    }

    if (mapping.has(normalized)) {
      results.add(mapping.get(normalized));
      return;
    }

    if (normalized) {
      results.add(normalized);
    }
  });

  return Array.from(results);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function resolvePath(candidate) {
  if (!candidate) return null;
  if (path.isAbsolute(candidate)) return candidate;
  return path.join(__dirname, candidate);
}

async function resolveJobsPath(options, fallbackPath) {
  const candidates = [];

  if (options.jobsFile) {
    candidates.push(resolvePath(options.jobsFile));
  }

  if (options.jobsRun) {
    candidates.push(path.join(OUTPUT_ROOT, options.jobsRun, 'linkedin-jobs.json'));
  }

  candidates.push(fallbackPath);

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await fsp.access(candidate, fs.constants.R_OK);
      return candidate;
    } catch (error) {
      // continue searching
    }
  }

  throw new Error('Unable to locate a stored LinkedIn jobs file. Provide --jobs-file or --jobs-run.');
}

function getLeadDomain(lead) {
  const candidates = [
    lead.companyDomain,
    lead.organization?.website,
    lead.organization?.domain,
    lead.companyWebsite,
    lead.companyDomain,
    lead.company_domain,
    lead.domain,
    lead.website,
    lead.raw?.company_domain,
    lead.raw?.companyDomain,
    lead.raw?.company_website,
    lead.raw?.companyWebsite,
    lead.raw?.organization?.website
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDomain(candidate);
    if (normalized) return normalized;
  }

  return '';
}

function sanitise(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

function isCostLimitError(error) {
  if (!error) return false;
  const message = `${error.message || ''}`.toLowerCase();
  return message.includes('maximum cost per run');
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => sanitise(v)).filter(Boolean);
  return value
    .split(/[|,;]/)
    .map((v) => sanitise(v))
    .filter(Boolean);
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

  return {
    jobTitles: parseList(getValue('--job-titles')),
    location: sanitise(getValue('--location')),
    locationGeoId: sanitise(getValue('--geo-id')),
    industry: sanitise(getValue('--industry') || '23'),
    jobsCount: parseInt(getValue('--jobs-count') || `${DEFAULT_JOBS_COUNT}`, 10),
    decisionMakerTitles: parseList(getValue('--decision-maker-titles')),
    leadsPerCompany: parseInt(getValue('--leads-per-company') || `${DEFAULT_LEADS_PER_COMPANY}`, 10),
    maxCompanies: parseInt(getValue('--max-companies') || '0', 10),
    runName: sanitise(getValue('--run-name')),
    companySizes: parseList(getValue('--company-sizes')),
    skipJobs: hasFlag('--skip-jobs'),
    skipLeads: hasFlag('--skip-leads'),
    jobsFile: sanitise(getValue('--jobs-file')),
    jobsRun: sanitise(getValue('--jobs-run')),
    jobFunctions: parseList(getValue('--job-functions') || DEFAULT_JOB_FUNCTIONS),
    customQueries: parseList(getValue('--search-queries'))
  };
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function loadProcessedCompanies() {
  try {
    const raw = await fsp.readFile(PROCESSED_COMPANIES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return new Set(data.companies || []);
  } catch (error) {
    return new Set();
  }
}

async function saveProcessedCompanies(companiesSet) {
  const data = {
    lastUpdated: new Date().toISOString(),
    companies: Array.from(companiesSet)
  };
  await writeJson(PROCESSED_COMPANIES_FILE, data);
}

async function loadBatchProgress(runDir) {
  const progressPath = path.join(runDir, 'leads-progress.json');
  try {
    const raw = await fsp.readFile(progressPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return { completed: [], inQueue: [] };
  }
}

async function saveBatchProgress(runDir, data) {
  const progressPath = path.join(runDir, 'leads-progress.json');
  await writeJson(progressPath, data);
}

function extractDomain(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
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

function buildLinkedInSearchUrl(rawQuery, { industry, location, geoId, functionFilters }) {
  let url = new URL('https://www.linkedin.com/jobs/search/');
  let params = new URLSearchParams(url.search);

  if (rawQuery) {
    try {
      if (/^https?:\/\//i.test(rawQuery)) {
        url = new URL(rawQuery);
        params = new URLSearchParams(url.search);
      } else {
        params = new URLSearchParams(rawQuery);
      }
    } catch {
      params = new URLSearchParams();
    }
  }

  if (!params.has('position')) params.set('position', '1');
  if (!params.has('pageNum')) params.set('pageNum', '0');

  if (industry) {
    params.set('f_I', industry);
  }

  if (functionFilters && functionFilters.length && !params.has('f_F')) {
    params.set('f_F', functionFilters.join(','));
  }

  if (geoId) {
    params.set('geoId', geoId);
    params.delete('location');
  } else if (location) {
    const normalizedLocation = location.toLowerCase();
    if (normalizedLocation === 'european union' || normalizedLocation === 'eu') {
      params.set('geoId', '91000000');
      params.delete('location');
    } else {
      params.set('location', location);
      params.delete('geoId');
    }
  }

  url.search = params.toString();
  return url.toString();
}

async function searchLinkedInJobs(
  client,
  titles,
  location,
  locationGeoId,
  jobsCount,
  industry,
  functionFilters,
  customQueries
) {
  console.log('\n🔍 Searching LinkedIn jobs...');
  console.log(`   Titles: ${titles.length ? titles.join(', ') : 'None'}`);
  console.log(`   Industry: ${industry}`);
  if (location) console.log(`   Location: ${location}`);
  if (locationGeoId) console.log(`   geoId: ${locationGeoId}`);
  console.log(`   Job functions: ${functionFilters.length ? functionFilters.join(', ') : 'None'}`);
  if (customQueries.length) console.log(`   Custom queries: ${customQueries.length}`);
  console.log(`   Jobs per search: ${jobsCount}`);

  const urls = [];

  if (customQueries.length) {
    customQueries.forEach((rawQuery) => {
      urls.push(
        buildLinkedInSearchUrl(rawQuery, {
          industry,
          location,
          geoId: locationGeoId,
          functionFilters
        })
      );
    });
  } else {
    titles.forEach((title) => {
      const query = new URLSearchParams();
      query.set('keywords', title);
      urls.push(
        buildLinkedInSearchUrl(query.toString(), {
          industry,
          location,
          geoId: locationGeoId,
          functionFilters
        })
      );
    });

    const keywordQuery = new URLSearchParams();
    keywordQuery.set('keywords', 'food production');
    urls.push(
      buildLinkedInSearchUrl(keywordQuery.toString(), {
        industry,
        location,
        geoId: locationGeoId,
        functionFilters
      })
    );
  }

  const uniqueUrls = Array.from(new Set(urls));
  console.log(`   Generated ${uniqueUrls.length} LinkedIn URL(s):`);
  uniqueUrls.forEach((url) => console.log(`     ${url}`));

  const input = {
    urls: uniqueUrls,
    scrapeCompany: true,
    count: Math.max(jobsCount, 100)
  };

  const run = await client.actor(LINKEDIN_ACTOR_ID).call(input);
  console.log(`✅ LinkedIn job search completed. Run ID: ${run.id}`);

  const dataset = client.dataset(run.defaultDatasetId);
  const { items } = await dataset.listItems({ clean: true });

  console.log(`📥 Retrieved ${items.length} job posting(s).`);
  return items;
}

async function qualifyCompanies(companies, industry) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 2048
    }
  });

  const industryDescriptions = {
    '23': 'Food Production (manufacturers, processors, distributors of food products)',
    '31': 'Hospitality (hotels, restaurants, catering services)'
  };

  const industryDesc = industryDescriptions[industry] || `Industry code ${industry}`;

  const qualified = [];
  const batchSize = 10;

  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);
    
    const prompt = `You are a B2B lead qualification expert. Review these companies and determine if they match the target industry: ${industryDesc}.

IMPORTANT: Reject recruitment agencies, job boards, consulting firms, and any company that is NOT directly in the target industry.

Companies to review:
${batch.map((c, idx) => `${idx + 1}. ${c.companyName} (${c.website}) - ${c.jobCount} job posting(s)`).join('\\n')}

For each company, respond with ONLY a JSON array of numbers representing the qualified companies (e.g., [1, 3, 5]).
If none qualify, respond with an empty array: []

Response:`;

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim();
      
      const match = responseText.match(/\[[\d,\s]*\]/);
      if (match) {
        const qualifiedIndices = JSON.parse(match[0]);
        qualifiedIndices.forEach((idx) => {
          if (idx >= 1 && idx <= batch.length) {
            qualified.push(batch[idx - 1]);
          }
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (error) {
      console.error(`   ⚠️ Gemini error for batch ${i / batchSize + 1}: ${error.message}`);
    }
  }

  return qualified;
}

const ALCOHOL_KEYWORDS = [
  'wine',
  'whisky',
  'vodka',
  'beer',
  'brewery',
  'brewing',
  'distillery',
  'distilling',
  'spirits',
  'alcohol',
  'cider',
  'winery',
  'champagne',
  'liqueur',
  'liquor'
];

const PORK_KEYWORDS = [
  'pork',
  'swine',
  'pig',
  'ham',
  'bacon'
];

function containsKeywords(text, keywords) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function shouldExcludeCompany(company) {
  const fieldsToCheck = [
    company.companyName,
    company.website,
    company.linkedinUrl,
    company.description || '',
    ...(company.jobs || []).map((job) => `${job.title || ''} ${job.description || ''}`)
  ]
    .join(' ')
    .toLowerCase();

  if (containsKeywords(fieldsToCheck, ALCOHOL_KEYWORDS)) {
    return true;
  }

  if (containsKeywords(fieldsToCheck, PORK_KEYWORDS)) {
    return true;
  }

  return false;
}

function extractCompaniesFromJobs(jobs) {
  console.log('\n🏢 Extracting companies from job postings...');
  const companiesMap = new Map();

  jobs.forEach((job) => {
    const companyName = sanitise(job.companyName || job.company || '');
    if (!companyName) return;

    const website = normalizeDomain(
      job.companyWebsite || job.companyAddress?.website || job.organization?.website || ''
    );
    if (!website) return;

    const key = website;
    if (!companiesMap.has(key)) {
      companiesMap.set(key, {
        companyName,
        website,
        linkedinUrl: job.companyLinkedinUrl || job.companyAddress?.linkedinUrl || '',
        jobCount: 0,
        jobs: []
      });
    }

    const entry = companiesMap.get(key);
    entry.jobCount += 1;
    entry.jobs.push({
      title: job.title || '',
      location: job.location || '',
      url: job.jobUrl || job.link || ''
    });
  });

  const companies = Array.from(companiesMap.values());
  const filteredCompanies = companies.filter((company) => !shouldExcludeCompany(company));

  const excludedCount = companies.length - filteredCompanies.length;
  console.log(`✅ Found ${filteredCompanies.length} unique companies after filtering.`);
  if (excludedCount > 0) {
    console.log(`   🚫 Excluded ${excludedCount} company(ies) due to alcohol/pork keywords.`);
  }

  return filteredCompanies;
}

async function scrapeLeadsForBatch(
  client,
  companies,
  decisionMakerTitles,
  leadsCount,
  location,
  companySizes,
  runDir
) {
  const normalizedDomains = companies
    .map((company) => normalizeDomain(company.website))
    .filter(Boolean);

  if (!normalizedDomains.length) {
    console.log('   ⚠️  No valid domains in this batch. Skipping.');
    return {
      leadsByDomain: new Map(),
      successfulDomains: new Set()
    };
  }

  console.log(`\n👥 Scraping leads for batch of ${companies.length} company${companies.length === 1 ? 'y' : 'ies'}...`);
  console.log(`   Domains: ${normalizedDomains.join(', ')}`);

  const leadsByDomain = new Map();
  const successfulDomains = new Set();
  for (const domain of normalizedDomains) {
    leadsByDomain.set(domain, []);
  }

  const debugDir = runDir ? path.join(runDir, 'actor-runs') : null;
  if (debugDir) ensureDir(debugDir);

  const companyNameMap = new Map(
    companies.map((company) => [company.companyName.toLowerCase(), normalizeDomain(company.website)])
  );

  const normalizeItem = (item) => {
    const firstName = item.first_name || item.firstName || '';
    const lastName = item.last_name || item.lastName || '';
    const fullName = item.full_name || item.fullName || `${firstName} ${lastName}`.trim();
    const companyDomain = normalizeDomain(
      item.company_domain ||
      item.companyDomain ||
      item.company_website ||
      item.companyWebsite ||
      item.organization?.website ||
      ''
    );
    const companyIndustry = Array.isArray(item.company_industry)
      ? item.company_industry.join('; ')
      : item.company_industry || item.companyIndustry || '';

    const organization = {
      website: companyDomain || '',
      domain: companyDomain || '',
      linkedinUrl: item.company_linkedin || item.companyLinkedIn || '',
      size: item.company_size || item.companySize || '',
      industry: companyIndustry,
      id: item.company_linkedin_uid || item.organizationId || ''
    };

    return {
      fullName,
      firstName,
      lastName,
      email: item.email || '',
      position: item.job_title || item.position || '',
      seniority: Array.isArray(item.seniority_level)
        ? item.seniority_level.join('; ')
        : item.seniority_level || item.seniority || '',
      city: item.city || item.contact_city || item.company_city || '',
      state: item.state || item.contact_state || item.company_state || '',
      country: item.country || item.contact_country || item.company_country || '',
      linkedinUrl: item.linkedin || item.linkedin_url || item.linkedinUrl || '',
      companyWebsite: companyDomain || '',
      companyLinkedIn: organization.linkedinUrl,
      companyDomain,
      companySize: organization.size,
      companyIndustry,
      organization,
      raw: item
    };
  };

  const assignLeadsToDomains = (items, subsetDomains) => {
    for (const lead of items) {
      const domain = getLeadDomain(lead);

      if (domain && leadsByDomain.has(domain)) {
        leadsByDomain.get(domain).push(lead);
        continue;
      }

      const name = (lead.company || lead.companyName || lead.raw?.company_name || '').toLowerCase();
      let matchedDomain = null;
      if (name && companyNameMap.has(name)) {
        matchedDomain = companyNameMap.get(name);
      }

      const fallbackDomain = matchedDomain || subsetDomains[0] || domain;
      if (!fallbackDomain) continue;

      if (!leadsByDomain.has(fallbackDomain)) {
        leadsByDomain.set(fallbackDomain, []);
      }

      leadsByDomain.get(fallbackDomain).push({ ...lead, unmatchedDomain: domain || null });
    }
  };

  const initialChunks = chunkArray(normalizedDomains, DEFAULT_MAX_DOMAINS_PER_CALL).map((domains) => ({
    domains,
    targetLeadsPerCompany: leadsCount
  }));

  const queue = [...initialChunks];

  while (queue.length) {
    const { domains, targetLeadsPerCompany } = queue.shift();
    const effectiveLeadsPerCompany = Math.max(targetLeadsPerCompany, 1);
    const requestedLeadCount = Math.min(effectiveLeadsPerCompany * domains.length, 50000);

    const input = {
      fetch_count: requestedLeadCount,
      contact_job_title: decisionMakerTitles,
      email_status: ['validated'],
      size: ['11-20', '21-50', '51-100', '101-200', '201-500'],
      company_domain: domains
    };

    if (decisionMakerTitles.length) {
      input.contact_job_title = decisionMakerTitles;
    }

    if (location) {
      const normalizedLocations = normalizeLocationForLeadsFinder(location);
      if (normalizedLocations.length) {
        input.contact_location = normalizedLocations;
      }
    }

    if (companySizes.length) {
      input.size = companySizes;
    }

    console.log('   Actor input payload:');
    console.log(JSON.stringify(input, null, 2));

    try {
      const run = await client.actor(LEADS_FINDER_ACTOR_ID).call(input);
      const dataset = client.dataset(run.defaultDatasetId);
      const { items } = await dataset.listItems({ clean: true });

      console.log(`   Actor run ID: ${run.id}`);
      console.log(`   Dataset ID: ${run.defaultDatasetId}`);
      console.log(`   ✅ Retrieved ${items.length} lead(s).`);

      const normalizedItems = items.map(normalizeItem);

      if (debugDir) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const suffix = domains.join('_').replace(/[^a-z0-9_-]+/gi, '-');
        await writeJson(path.join(debugDir, `run-${timestamp}-${suffix}.json`), {
          input,
          run: {
            id: run.id,
            status: run.status,
            defaultDatasetId: run.defaultDatasetId,
            finishedAt: run.finishedAt
          },
          itemsCount: normalizedItems.length,
          sample: normalizedItems.slice(0, 5)
        });
      }

      const sample = normalizedItems.slice(0, Math.min(normalizedItems.length, 3));
      if (sample.length) {
        console.log('   Sample lead(s):');
        console.log(JSON.stringify(sample, null, 2));
      } else {
        console.log('   No leads returned by actor.');
      }

      assignLeadsToDomains(normalizedItems, domains);
      domains.forEach((domain) => {
        successfulDomains.add(domain);
      });
    } catch (error) {
      console.error(`   🔴 Leads Finder error for domains [${domains.join(', ')}]: ${error.message}`);

      if (isCostLimitError(error)) {
        const reducedTarget = Math.max(
          Math.floor(targetLeadsPerCompany / 2),
          Math.min(MIN_LEADS_PER_COMPANY, targetLeadsPerCompany)
        );

        if (targetLeadsPerCompany > MIN_LEADS_PER_COMPANY) {
          console.log('   ⚠️  Reducing leads per company and retrying due to cost limit.');
          queue.unshift({ domains, targetLeadsPerCompany: reducedTarget });
          continue;
        }

        if (domains.length > 1) {
          console.log('   ⚠️  Splitting domain subset to stay within cost limit.');
          const splitDomains = chunkArray(domains, Math.ceil(domains.length / 2));
          splitDomains.reverse().forEach((subset) => {
            queue.unshift({ domains: subset, targetLeadsPerCompany });
          });
          continue;
        }
      }

      console.error('   ⚠️  Skipping these domains due to repeated errors.');
    }
  }

  return {
    leadsByDomain,
    successfulDomains
  };
}

async function writeLeadsCsv(filePath, leads, append = false) {
  if (!leads.length) return;

  const rawKeys = new Set();
  leads.forEach((lead) => {
    if (lead.raw && typeof lead.raw === 'object') {
      Object.keys(lead.raw).forEach((key) => rawKeys.add(key));
    }
  });

  const headers = Array.from(rawKeys).map((key) => ({ id: key, title: key }));

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: headers,
    append
  });

  const records = leads.map((lead) => {
    if (!lead.raw || typeof lead.raw !== 'object') return {};
    const record = {};
    Object.entries(lead.raw).forEach(([key, value]) => {
      record[key] = Array.isArray(value) ? value.join('; ') : value ?? '';
    });
    return record;
  });

  await csvWriter.writeRecords(records);
}

async function main() {
  const options = parseArgs();

  const token = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
  if (!token) {
    console.error('🔴 Missing Apify API token. Set APIFY_TOKEN in .env');
    process.exit(1);
  }

  if (!GEMINI_API_KEY) {
    console.error('🔴 Missing GEMINI_API_KEY in .env for company qualification');
    process.exit(1);
  }

  if (!options.jobTitles.length && !options.customQueries.length && !options.skipJobs) {
    console.error('🔴 Provide --job-titles or --search-queries to search LinkedIn jobs.');
    process.exit(1);
  }

  if (!options.decisionMakerTitles.length) {
    console.error('🔴 Provide --decision-maker-titles for lead scraping.');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runLabel = options.runName || `linkedin-jobs-to-leads-${timestamp}`;
  const runDir = path.join(OUTPUT_ROOT, runLabel);
  ensureDir(runDir);

  console.log(`📁 Run directory: ${runDir}`);
  console.log('\n⚙️  Configuration:');
  console.log(`   Industry: ${options.industry}`);
  console.log(`   Job titles: ${options.jobTitles.join(', ')}`);
  console.log(`   Custom queries: ${options.customQueries.length ? options.customQueries.length : 'None'}`);
  console.log(`   Decision-maker titles: ${options.decisionMakerTitles.join(', ')}`);
  console.log(`   Location: ${options.location || 'No filter'}`);
  console.log(`   Location geoId: ${options.locationGeoId || 'None'}`);
  console.log(`   Jobs per search: ${options.jobsCount}`);
  console.log(`   Leads per company: ${options.leadsPerCompany}`);
  console.log(`   Max companies: ${options.maxCompanies > 0 ? options.maxCompanies : 'Unlimited'}`);
  console.log(`   Company size filter: 11-500 employees`);
  console.log(`   Email status: Verified only`);

  const client = new ApifyClient({ token });

  let jobs = [];
  if (!options.skipJobs) {
    jobs = await searchLinkedInJobs(
      client,
      options.jobTitles,
      options.location,
      options.locationGeoId,
      options.jobsCount,
      options.industry,
      options.jobFunctions,
      options.customQueries
    );
    await writeJson(path.join(runDir, 'linkedin-jobs.json'), jobs);
  } else {
    console.log('⏭️  Skipping LinkedIn job search (--skip-jobs).');
    const fallbackJobPath = path.join(runDir, 'linkedin-jobs.json');
    const jobsPath = await resolveJobsPath(options, fallbackJobPath);

    try {
      const raw = await fsp.readFile(jobsPath, 'utf8');
      jobs = JSON.parse(raw);
      console.log(`📥 Loaded ${jobs.length} jobs from ${jobsPath}`);
    } catch (error) {
      console.error(`🔴 Failed to load jobs from ${jobsPath}: ${error.message}`);
      process.exit(1);
    }
  }

  const companies = extractCompaniesFromJobs(jobs);
  // Qualify companies with Gemini (no local files retained)
  console.log('\n🤖 Qualifying companies with Gemini...');
  const qualifiedCompanies = await qualifyCompanies(companies, options.industry);
  console.log(`✅ Qualified companies: ${qualifiedCompanies.length}`);
  console.log(`❌ Rejected companies: ${companies.length - qualifiedCompanies.length}`);

  // Load processed companies history
  const processedCompanies = await loadProcessedCompanies();
  console.log(`\n📋 Previously processed companies: ${processedCompanies.size}`);

  // Filter out already processed companies from qualified list
  const newCompanies = qualifiedCompanies.filter((company) => !processedCompanies.has(company.website));
  console.log(`✅ New companies to process: ${newCompanies.length}`);
  console.log(`⏭️  Skipping ${qualifiedCompanies.length - newCompanies.length} already processed companies.`);

  if (options.skipLeads) {
    console.log('⏭️  Skipping lead scraping (--skip-leads).');
    console.log(`\n📁 Companies saved to ${runDir}/companies.json`);
    return;
  }

  const allLeads = [];
  const summary = [];
  let processedCount = 0;

  const progress = await loadBatchProgress(runDir);
  let remainingQueue = progress.inQueue.length
    ? progress.inQueue
    : chunkArray(newCompanies, 10).map((batch) => batch.map((company) => company.website));

  const processedWebsites = new Set(progress.completed || []);
  const noLeadWebsites = new Set(progress.noLeads || []);

  while (remainingQueue.length) {
    if (options.maxCompanies > 0 && processedCount >= options.maxCompanies) {
      console.log(`\n🚫 Reached company limit (${options.maxCompanies}).`);
      break;
    }

    const websiteBatch = remainingQueue.shift();
    const batchCompanies = newCompanies.filter((company) => websiteBatch.includes(company.website));
    if (!batchCompanies.length) {
      continue;
    }

    await saveBatchProgress(runDir, {
      completed: Array.from(processedWebsites),
      noLeads: Array.from(noLeadWebsites),
      inQueue: [websiteBatch, ...remainingQueue]
    });

    const { leadsByDomain, successfulDomains } = await scrapeLeadsForBatch(
      client,
      batchCompanies,
      options.decisionMakerTitles,
      options.leadsPerCompany,
      options.location,
      options.companySizes,
      runDir
    );

    for (const company of batchCompanies) {
      const normalizedDomain = normalizeDomain(company.website);
      const leads = leadsByDomain.get(normalizedDomain) || [];

      const annotatedLeads = leads.map((lead) => ({
        ...lead,
        company: company.companyName,
        companyName: company.companyName,
        companyWebsite: company.website,
        companyDomain: normalizedDomain
      }));

      allLeads.push(...annotatedLeads);
      summary.push({
        companyName: company.companyName,
        website: company.website,
        jobsFound: company.jobCount,
        leadsScraped: annotatedLeads.length
      });

      const actorSucceeded = normalizedDomain && successfulDomains.has(normalizedDomain);

      if (annotatedLeads.length > 0 || actorSucceeded) {
        processedCompanies.add(company.website);
        processedWebsites.add(company.website);
        noLeadWebsites.delete(company.website);
        await saveProcessedCompanies(processedCompanies);
        processedCount += 1;
      } else {
        noLeadWebsites.add(company.website);
      }

      if (options.maxCompanies > 0 && processedCount >= options.maxCompanies) break;
    }

    remainingQueue = remainingQueue.filter((queueBatch) =>
      queueBatch.some((website) => !processedWebsites.has(website))
    );

    await saveBatchProgress(runDir, {
      completed: Array.from(processedWebsites),
      noLeads: Array.from(noLeadWebsites),
      inQueue: remainingQueue
    });
  }

  await saveBatchProgress(runDir, {
    completed: Array.from(processedWebsites),
    noLeads: Array.from(noLeadWebsites),
    inQueue: remainingQueue
  });

  await writeLeadsCsv(path.join(runDir, 'leads.csv'), allLeads);

  // Append to master CSV
  const masterCsv = path.join(OUTPUT_ROOT, 'leads-master.csv');
  const masterExists = fs.existsSync(masterCsv);
  if (allLeads.length > 0) {
    await writeLeadsCsv(masterCsv, allLeads, masterExists);
    console.log(`\n📊 Appended ${allLeads.length} leads to master CSV: ${masterCsv}`);
  }

  const finalSummary = {
    runLabel,
    generatedAt: new Date().toISOString(),
    jobsSearched: jobs.length,
    companiesFound: companies.length,
    companiesQualified: qualifiedCompanies.length,
    companiesRejected: companies.length - qualifiedCompanies.length,
    companiesAlreadyProcessed: qualifiedCompanies.length - newCompanies.length,
    companiesProcessed: processedCount,
    totalLeads: allLeads.length,
    summary
  };

  await writeJson(path.join(runDir, 'summary.json'), finalSummary);

  console.log('\n🎯 Pipeline Summary:');
  console.log(`   Jobs found: ${jobs.length}`);
  console.log(`   Companies extracted: ${companies.length}`);
  console.log(`   Companies qualified: ${qualifiedCompanies.length}`);
  console.log(`   Companies rejected: ${companies.length - qualifiedCompanies.length}`);
  console.log(`   Companies processed: ${processedCount}`);
  console.log(`   Total leads scraped: ${allLeads.length}`);
  console.log(`\n📁 All results saved to ${runDir}`);
}

main().catch((error) => {
  console.error('🔴 Pipeline failed:', error);
  process.exit(1);
});
