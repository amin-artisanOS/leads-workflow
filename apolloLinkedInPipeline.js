#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';
import createCsvWriter from 'csv-writer';
import csvParser from 'csv-parser';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_ROOT = path.join(__dirname, 'apollo_linkedin_runs');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'icp-config.json');

const APIFY_TOKEN =
  process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
if (!APIFY_TOKEN) {
  console.error('🔴 Missing Apify API token. Set APIFY_TOKEN in .env');
  process.exit(1);
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value
    .split(/[|,;]/)
    .map((item) => sanitise(item))
    .filter(Boolean);
}

function matchCountry(location, allowedLower, allowedOriginal) {
  if (!location) return '';
  const lowerLocation = location.toLowerCase();
  for (let i = 0; i < allowedLower.length; i += 1) {
    if (lowerLocation.includes(allowedLower[i])) {
      return allowedOriginal[i];
    }
  }
  return '';
}

async function loadRecords(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.csv') {
    return new Promise((resolve, reject) => {
      const rows = [];
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => rows.push(row))
        .on('end', () => resolve(rows))
        .on('error', reject);
    });
  }

  const raw = await fsp.readFile(filePath, 'utf8');
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.results)) return data.results;
      if (Array.isArray(data.companies)) return data.companies;
    }
    console.warn(`⚠️ No array results found in ${filePath}. Returning empty array.`);
    return [];
  } catch (error) {
    throw new Error(`Failed to parse JSON file ${filePath}: ${error.message}`);
  }
}

const LINKEDIN_ACTOR_ID =
  process.env.APIFY_LINKEDIN_JOBS_ACTOR_ID || 'hKByXkMQaC5Qt9UMN';
const DEFAULT_JOBS_COUNT = parseInt(process.env.LINKEDIN_JOBS_PER_SEARCH || '100', 10);
const DEFAULT_MAX_LEADS = parseInt(process.env.APOLLO_MAX_LEADS || '50', 10);
const EUROPEAN_COUNTRIES = [
   'Austria', 'Belgium','Croatia', 'Cyprus',  'Denmark', 'Estonia', 'Finland', 'France',  'Germany', 'Greece','Italy', 'Kazakhstan', 'Kosovo', 'Latvia',
  'Liechtenstein', 'Lithuania', 'Luxembourg', 'Netherlands', 'North Macedonia', 'Norway', 'Poland',
  'Portugal', 'Spain', 'Sweden', 'Switzerland', 
  'United Kingdom', 
];

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
    companiesFile:
      getValue('--companies') || getValue('--input') || getValue('--companies-file'),
    configPath: getValue('--config') || DEFAULT_CONFIG_PATH,
    runName: getValue('--run-name'),
    apolloOutputDir: getValue('--apollo-output-dir') || getValue('--apollo-output'),
    apolloMaxLeads: parseInt(getValue('--apollo-max-leads') || `${DEFAULT_MAX_LEADS}`, 10),
    jobsCount: parseInt(getValue('--jobs-count') || `${DEFAULT_JOBS_COUNT}`, 10),
    apolloResultsFile: getValue('--leads-file') || getValue('--apollo-results'),
    allowCountries:
      getValue('--allow-countries') || getValue('--allowed-countries') || getValue('--countries'),
    maxCompanies: parseInt(getValue('--max-companies') || getValue('--company-limit') || '0', 10),
    skipApollo: hasFlag('--skip-apollo'),
    dryRun: hasFlag('--dry-run')
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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

function sanitise(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

function normaliseName(value) {
  return (value || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function deriveLocationCounts(locationsMap) {
  if (!locationsMap || locationsMap.size === 0) return '';
  let best = '';
  let max = 0;
  for (const [location, count] of locationsMap.entries()) {
    if (count > max) {
      best = location;
      max = count;
    }
  }
  return best;
}

function simplifyLocation(location) {
  if (!location) return '';
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return location;
  if (parts.length === 1) return parts[0];
  return parts[parts.length - 1];
}

function stripProtocol(value) {
  return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
}

function pickField(record, keys) {
  if (!record) return '';
  for (const key of keys) {
    const raw = record[key];
    if (!raw) continue;
    if (typeof raw === 'string') {
      const cleaned = sanitise(raw);
      if (cleaned) return cleaned;
    }
  }
  return '';
}

const COMPANY_NAME_LEAD_KEYS = [
  'companyName',
  'organizationName',
  'organization_name',
  'company',
  'company_name',
  'employer',
  'organization',
  'account_name'
];

const COMPANY_NAME_METADATA_KEYS = [
  'companyName',
  'company',
  'organizationName',
  'organization_name',
  'company_name',
  'name',
  'employer',
  'organization'
];

const TITLE_KEYS = [
  'title',
  'jobTitle',
  'job_title',
  'position',
  'position_title',
  'role',
  'headline',
  'current_title'
];

const WEBSITE_KEYS = [
  'companyWebsite',
  'organizationWebsite',
  'organization_website_url',
  'organization_primary_domain',
  'organizationWebsiteUrl',
  'company_website',
  'organization_domain',
  'website',
  'website_url'
];

const LOCATION_KEYS = [
  'location',
  'companyLocation',
  'organizationLocation',
  'company_location',
  'organization_location',
  'formatted_address',
  'formattedAddress'
];

const CITY_KEYS = ['city', 'company_city', 'organization_city', 'companyCity', 'organizationCity'];
const STATE_KEYS = ['state', 'province', 'region', 'company_state', 'organization_state'];
const COUNTRY_KEYS = ['country', 'company_country', 'organization_country'];

function extractCompanyNameFromLead(lead) {
  return pickField(lead, COMPANY_NAME_LEAD_KEYS);
}

function extractCompanyNameFromMetadata(record) {
  return pickField(record, COMPANY_NAME_METADATA_KEYS);
}

function extractTitleFromLead(lead) {
  return pickField(lead, TITLE_KEYS);
}

function extractWebsiteFromLead(lead) {
  const raw = pickField(lead, WEBSITE_KEYS);
  if (!raw) return '';
  return stripProtocol(raw.toLowerCase());
}

function extractLocationFromLead(lead) {
  const direct = pickField(lead, LOCATION_KEYS);
  if (direct) return direct;

  const city = pickField(lead, CITY_KEYS);
  const state = pickField(lead, STATE_KEYS);
  const country = pickField(lead, COUNTRY_KEYS);

  const combined = [city, state, country].filter(Boolean).join(', ');
  if (combined) return sanitise(combined);

  return '';
}

function buildLinkedInSearchUrl(title, companyName, location) {
  const query = new URLSearchParams();
  query.set('position', '1');
  query.set('pageNum', '0');
  query.set('keywords', `${title} "${companyName}"`);
  if (location) {
    query.set('location', location);
  }
  return `https://www.linkedin.com/jobs/search/?${query.toString()}`;
}

async function runApolloEnrichment(companiesFile, outputDir, maxLeads) {
  return new Promise((resolve, reject) => {
    const enricherPath = path.join(__dirname, 'apolloEnricher.js');
    const args = [enricherPath, '--input', companiesFile, '--output-dir', outputDir];
    if (maxLeads) {
      args.push('--max-leads', String(maxLeads));
    }

    console.log('\n🚀 Running Apollo enricher...');
    const proc = spawn(process.execPath, args, {
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Apollo enrichment completed.');
        resolve();
      } else {
        reject(new Error(`Apollo enricher exited with code ${code}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

async function findLatestApolloResults(dir) {
  const files = await fsp.readdir(dir);
  const candidates = files
    .filter((name) => name.startsWith('apollo_results_') && name.endsWith('.json'))
    .sort();
  if (candidates.length === 0) {
    throw new Error(`No apollo_results_*.json files found in ${dir}`);
  }
  return path.join(dir, candidates[candidates.length - 1]);
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function writeJobsCsv(filePath, jobs) {
  if (!jobs.length) return;

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'jobId', title: 'Job ID' },
      { id: 'title', title: 'Title' },
      { id: 'company', title: 'Company' },
      { id: 'location', title: 'Location' },
      { id: 'listedAt', title: 'Listed At' },
      { id: 'workplaceType', title: 'Workplace Type' },
      { id: 'employmentType', title: 'Employment Type' },
      { id: 'jobUrl', title: 'Job URL' },
      { id: 'description', title: 'Description' }
    ]
  });

  const records = jobs.map((job) => ({
    jobId: job.id || job.jobId || job.jobPostingId || '',
    title: job.title || '',
    company: job.companyName || job.company || '',
    location: job.location || '',
    listedAt: job.listedAt || job.date || job.datePosted || job.time || '',
    workplaceType: job.workplaceType || job.workType || job.remote || '',
    employmentType: job.employmentType || job.jobType || '',
    jobUrl: job.jobUrl || job.applyLink || job.link || '',
    description: sanitise(job.descriptionText || job.description || '')
  }));

  await csvWriter.writeRecords(records);
}

function extractCompanyPositions(company) {
  const positions = new Set();

  const pushValues = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => pushValues(item));
      return;
    }
    if (typeof value === 'string') {
      value
        .split(/[,;/]| OR /)
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => positions.add(item));
    }
  };

  pushValues(company.icpTitles);
  pushValues(company.positions);
  pushValues(company.position);

  return Array.from(positions);
}

async function main() {
  const options = parseArgs();

  if (!options.companiesFile) {
    console.error('🔴 Missing --companies <file> argument.');
    process.exit(1);
  }

  const companiesPath = path.resolve(options.companiesFile);
  const configPath = path.resolve(options.configPath || DEFAULT_CONFIG_PATH);

  try {
    await fsp.access(companiesPath);
  } catch (error) {
    console.error(`🔴 Companies file not found: ${companiesPath}`);
    process.exit(1);
  }

  let config;
  try {
    const rawConfig = await fsp.readFile(configPath, 'utf8');
    config = JSON.parse(rawConfig);
  } catch (error) {
    console.error(`🔴 Failed to read config file: ${configPath}`);
    console.error(error.message);
    process.exit(1);
  }

  const defaultTitles = Array.isArray(config?.titles) ? config.titles.filter(Boolean) : [];
  if (defaultTitles.length === 0) {
    console.error('🔴 No titles found in icp-config.json.');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runLabel = options.runName || `apollo-linkedin-${timestamp}`;
  const runDir = path.join(OUTPUT_ROOT, runLabel);
  ensureDir(runDir);

  console.log(`📁 Run directory: ${runDir}`);

  let allowedCountriesOriginal = (options.allowCountries
    ? parseList(options.allowCountries)
    : EUROPEAN_COUNTRIES
  )
    .map((country) => sanitise(country))
    .filter(Boolean);

  if (!allowedCountriesOriginal.length) {
    console.log('⚠️ No allowed countries provided; defaulting to European country list.');
    allowedCountriesOriginal = EUROPEAN_COUNTRIES.map((country) => sanitise(country)).filter(Boolean);
  }

  const allowedCountriesLower = allowedCountriesOriginal.map((country) => country.toLowerCase());

  console.log(`🌍 Allowed countries: ${allowedCountriesOriginal.join(', ')}`);
  if (options.maxCompanies > 0) {
    console.log(`🔢 Company limit: ${options.maxCompanies}`);
  }

  // Load companies metadata to grab custom positions
  let companyMetadata = [];
  try {
    companyMetadata = await loadRecords(companiesPath);
  } catch (error) {
    console.warn(`⚠️ Unable to load companies metadata (${companiesPath}): ${error.message}`);
  }

  const companyPositionsMap = new Map();
  const companyLocationHints = new Map();
  const companyWebsiteHints = new Map();
  const allowedCompaniesSet = new Set();

  companyMetadata.forEach((record) => {
    const rawName = extractCompanyNameFromMetadata(record);
    const name = normaliseName(rawName);
    if (!name) return;

    const positions = extractCompanyPositions(record);
    if (positions.length) {
      companyPositionsMap.set(name, positions);
    }

    const metaLocation = extractLocationFromLead(record);
    if (metaLocation) {
      companyLocationHints.set(name, metaLocation);
    }

    const metaWebsite = extractWebsiteFromLead(record);
    if (metaWebsite) {
      companyWebsiteHints.set(name, metaWebsite);
    }

    allowedCompaniesSet.add(name);
  });

  console.log(`✅ Allowed companies from summary: ${allowedCompaniesSet.size}`);

  const apolloDir = options.apolloOutputDir
    ? path.resolve(options.apolloOutputDir)
    : path.join(runDir, 'apollo_output');
  if (!options.skipApollo) {
    ensureDir(apolloDir);
    const maxLeads = Number.isFinite(options.apolloMaxLeads)
      ? options.apolloMaxLeads
      : DEFAULT_MAX_LEADS;
    if (options.dryRun) {
      console.log('🧪 Dry run: skipping Apollo enrichment execution.');
    } else {
      await runApolloEnrichment(companiesPath, apolloDir, maxLeads);
    }
  } else if (options.apolloOutputDir) {
    try {
      await fsp.access(apolloDir);
    } catch (error) {
      console.error(`🔴 Apollo output directory not found: ${apolloDir}`);
      process.exit(1);
    }
  }

  let apolloResultsPath;
  if (options.apolloResultsFile) {
    apolloResultsPath = path.resolve(options.apolloResultsFile);
  } else {
    apolloResultsPath = await findLatestApolloResults(apolloDir);
  }

  try {
    await fsp.access(apolloResultsPath);
  } catch (error) {
    console.error(`🔴 Apollo results file not found: ${apolloResultsPath}`);
    process.exit(1);
  }

  let leads;
  try {
    leads = await loadRecords(apolloResultsPath);
  } catch (error) {
    console.error(`🔴 Failed to load Apollo leads from ${apolloResultsPath}`);
    console.error(error.message);
    process.exit(1);
  }

  if (!Array.isArray(leads) || leads.length === 0) {
    console.error('🔴 Apollo results contain no leads.');
    process.exit(1);
  }

  console.log(`👥 Loaded ${leads.length} Apollo lead(s).`);

  const companiesMap = new Map();
  leads.forEach((lead) => {
    const companyName = extractCompanyNameFromLead(lead);
    if (!companyName) return;
    const key = normaliseName(companyName);
    if (!companiesMap.has(key)) {
      const seededPositions = companyPositionsMap.has(key)
        ? companyPositionsMap.get(key)
        : defaultTitles;
      const positionSet = new Set(
        (seededPositions || [])
          .map((title) => sanitise(title))
          .filter(Boolean)
      );

      const websiteHint = companyWebsiteHints.get(key);

      companiesMap.set(key, {
        key,
        companyName,
        leads: [],
        websites: new Set(websiteHint ? [stripProtocol(websiteHint.toLowerCase())] : []),
        locationCounts: new Map(),
        positions: positionSet
      });

      const locationHint = companyLocationHints.get(key);
      if (locationHint) {
        companiesMap
          .get(key)
          .locationCounts.set(
            locationHint,
            (companiesMap.get(key).locationCounts.get(locationHint) || 0) + 1
          );
      }
    }
    const entry = companiesMap.get(key);
    entry.leads.push(lead);

    const leadTitle = extractTitleFromLead(lead);
    if (leadTitle) {
      entry.positions.add(leadTitle);
    }

    const website = extractWebsiteFromLead(lead);
    if (website) {
      entry.websites.add(website);
    }

    const location = extractLocationFromLead(lead);
    if (location) {
      entry.locationCounts.set(location, (entry.locationCounts.get(location) || 0) + 1);
    }
  });

  const companies = Array.from(companiesMap.values());
  if (!companies.length) {
    console.error('🔴 No companies were extracted from Apollo leads.');
    process.exit(1);
  }

  console.log(`🏢 Unique companies in leads: ${companies.length}`);

  const filteredCompanies = companies.filter(({ key }) =>
    Array.from(allowedCompaniesSet).some((allowed) =>
      key.startsWith(allowed) || allowed.startsWith(key)
    )
  );

  if (filteredCompanies.length === 0) {
    console.error('🔴 No companies matched the allowed list from summary.csv');
    process.exit(1);
  }

  console.log(`🎯 Companies to process (after whitelist): ${filteredCompanies.length}`);

  const client = new ApifyClient({ token: APIFY_TOKEN });
  const runSummary = [];
  const selectedCompanies = [];
  let processedCount = 0;

  for (const company of filteredCompanies) {
    if (options.maxCompanies > 0 && processedCount >= options.maxCompanies) {
      console.log(`🚫 Reached company limit (${options.maxCompanies}).`);
      break;
    }

    const companyDir = path.join(runDir, slugify(company.companyName));
    ensureDir(companyDir);

    const primaryLocation = deriveLocationCounts(company.locationCounts);
    const fallbackLocation = companyLocationHints.get(company.key) || '';
    const locationForMatch = primaryLocation || fallbackLocation || '';
    const matchedCountry = matchCountry(locationForMatch, allowedCountriesLower, allowedCountriesOriginal);

    if (!matchedCountry) {
      console.log(`⚠️ Skipping ${company.companyName} (no allowed country match).`);
      continue;
    }

    const linkedinLocation = simplifyLocation(locationForMatch || matchedCountry);

    const positionArray = company.positions && company.positions.size
      ? Array.from(company.positions)
      : defaultTitles;

    const urls = Array.from(
      new Set(
        positionArray
          .map((title) => sanitise(title))
          .filter(Boolean)
          .map((title) => buildLinkedInSearchUrl(title, company.companyName, linkedinLocation))
      )
    );

    if (!urls.length) {
      console.warn(`⚠️ No positions found for ${company.companyName}, skipping.`);
      continue;
    }

    const linkedinInput = {
      urls,
      scrapeCompany: true,
      count: Math.max(options.jobsCount, 100)
    };

    const companySnapshot = {
      companyName: company.companyName,
      matchedCountry,
      location: linkedinLocation,
      positions: positionArray,
      urls,
      websites: Array.from(company.websites),
      jobsCount: linkedinInput.count,
      totalLeads: company.leads.length
    };

    await writeJson(path.join(companyDir, 'linkedin-input.json'), companySnapshot);

    selectedCompanies.push(companySnapshot);
    processedCount += 1;

    if (options.dryRun) {
      console.log(`🧪 Dry run: prepared LinkedIn search for ${company.companyName} (${urls.length} URL(s)).`);
      runSummary.push({
        companyName: company.companyName,
        positions: positionArray.length,
        location: linkedinLocation,
        country: matchedCountry,
        jobsFound: 0,
        status: 'dry-run'
      });
      if (options.maxCompanies > 0 && processedCount >= options.maxCompanies) {
        console.log(`🚫 Reached company limit (${options.maxCompanies}).`);
        break;
      }
      continue;
    }

    console.log(`\n🔍 LinkedIn search for ${company.companyName}`);
    console.log(`   Positions: ${positionArray.join(', ')}`);
    if (linkedinLocation) {
      console.log(`   Location filter: ${linkedinLocation}`);
    }
    console.log(`   URLs: ${urls.length}`);
    console.log(`   Matched country: ${matchedCountry}`);

    try {
      const run = await client.actor(LINKEDIN_ACTOR_ID).call(linkedinInput);
      const runInfo = {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        defaultDatasetId: run.defaultDatasetId,
        input: linkedinInput
      };

      await writeJson(path.join(companyDir, 'apify-run.json'), runInfo);

      if (!run.defaultDatasetId) {
        console.warn(`⚠️ No dataset ID returned for ${company.companyName}.`);
        runSummary.push({
          companyName: company.companyName,
          positions: positionArray.length,
          location: linkedinLocation,
          country: matchedCountry,
          jobsFound: 0,
          status: 'no-dataset'
        });
        continue;
      }

      const dataset = client.dataset(run.defaultDatasetId);
      const { items } = await dataset.listItems({ clean: true });
      const jobs = Array.isArray(items) ? items : [];

      await writeJson(path.join(companyDir, 'jobs.json'), jobs);
      await writeJobsCsv(path.join(companyDir, 'jobs.csv'), jobs);

      console.log(`   ✅ Jobs found: ${jobs.length}`);

      runSummary.push({
        companyName: company.companyName,
        positions: positionArray.length,
        location: linkedinLocation,
        country: matchedCountry,
        jobsFound: jobs.length,
        status: 'success'
      });
    } catch (error) {
      console.error(`   🔴 Failed LinkedIn search for ${company.companyName}: ${error.message}`);
      await writeJson(path.join(companyDir, 'error.json'), {
        message: error.message,
        stack: error.stack
      });
      runSummary.push({
        companyName: company.companyName,
        positions: positionArray.length,
        location: linkedinLocation,
        country: matchedCountry,
        jobsFound: 0,
        status: 'error',
        error: error.message
      });
    }

    if (options.maxCompanies > 0 && processedCount >= options.maxCompanies) {
      console.log(`🚫 Reached company limit (${options.maxCompanies}).`);
      break;
    }
  }

  await writeJson(path.join(runDir, 'selected-companies.json'), selectedCompanies);

  const summary = {
    runLabel,
    generatedAt: new Date().toISOString(),
    companiesProcessed: filteredCompanies.length,
    companiesInLeads: companies.length,
    companiesAllowed: allowedCompaniesSet.size,
    apolloResultsPath,
    jobsCountPerSearch: options.jobsCount,
    skipApollo: options.skipApollo,
    dryRun: options.dryRun,
    summary: runSummary
  };

  await writeJson(path.join(runDir, 'summary.json'), summary);

  console.log('\n🎯 LinkedIn job search summary:');
  runSummary.forEach((entry) => {
    console.log(
      `   • ${entry.companyName}: ${entry.jobsFound} job(s) [${entry.status}]${entry.country ? ` (${entry.country})` : ''}${entry.location ? ` @ ${entry.location}` : ''}`
    );
  });

  console.log(`\n📁 All artifacts saved to ${runDir}`);
}

main().catch((error) => {
  console.error('🔴 Apollo → LinkedIn pipeline failed:', error);
  process.exit(1);
});