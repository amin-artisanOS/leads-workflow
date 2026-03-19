#!/usr/bin/env node

import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APIFY_TOKEN = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;

if (!APIFY_TOKEN) {
  console.error('🔴 Missing Apify API token. Set APIFY_TOKEN in .env');
  process.exit(1);
}

const client = new ApifyClient({ token: APIFY_TOKEN });
const LEADS_FINDER_ACTOR_ID =
  process.env.APIFY_LEADS_FINDER_ACTOR_ID ||
  process.env.APIFY_PIPELINELABS_ACTOR_ID ||
  'code_crafter/leads-finder';
const DEFAULT_EMAIL_STATUS = (process.env.PIPELINELABS_EMAIL_STATUS || 'validated')
  .split(/[,;]/)
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const REQUIRE_EMAIL = process.env.PIPELINELABS_REQUIRE_EMAIL !== 'false';
const REQUIRE_PHONE = process.env.PIPELINELABS_REQUIRE_PHONE === 'true';
const EU_COUNTRIES = [
  'Austria',
  'Belgium',
  'Bulgaria',
  'Croatia',
  'Cyprus',
  'Czech Republic',
  'Denmark',
  'Estonia',
  'Finland',
  'France',
  'Germany',
  'Greece',
  'Hungary',
  'Ireland',
  'Italy',
  'Latvia',
  'Lithuania',
  'Luxembourg',
  'Malta',
  'Netherlands',
  'Poland',
  'Portugal',
  'Romania',
  'Slovakia',
  'Slovenia',
  'Spain',
  'Sweden'
];

// Parse arguments
const args = process.argv.slice(2);
function getArg(flag) {
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => `${item}`.trim()).filter(Boolean);
  return value
    .toString()
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIndustry(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function stripDomain(url) {
  if (!url) return '';
  return url
    .toString()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0];
}

function parseLocationParts(location, fallbackCountry) {
  if (!location) {
    return {
      city: '',
      state: '',
      country: fallbackCountry || ''
    };
  }

  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      city: '',
      state: '',
      country: fallbackCountry || ''
    };
  }

  if (parts.length === 1) {
    return {
      city: '',
      state: '',
      country: parts[0] || fallbackCountry || ''
    };
  }

  if (parts.length === 2) {
    return {
      city: parts[0],
      state: '',
      country: parts[1] || fallbackCountry || ''
    };
  }

  return {
    city: parts[0],
    state: parts[parts.length - 2],
    country: parts[parts.length - 1] || fallbackCountry || ''
  };
}

async function fetchAllDatasetItems(datasetClient) {
  const items = [];
  const limit = 1000;
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const response = await datasetClient.listItems({ clean: true, limit, offset });
    if (response?.items?.length) {
      items.push(...response.items);
    }

    const total = response?.total ?? 0;
    if (!response?.items?.length || items.length >= total) {
      break;
    }

    offset += limit;
  }

  return items;
}

function extractCompanyIndustries(company) {
  const results = new Set();

  const pushValues = (input) => {
    if (!input) return;
    if (Array.isArray(input)) {
      input.forEach((item) => pushValues(item));
      return;
    }
    if (typeof input === 'string') {
      input
        .split(/[,;/]/)
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((value) => results.add(value));
    }
  };

  pushValues(company.industries);
  pushValues(company.industry);
  pushValues(company.industryTags);
  pushValues(company.niche);
  pushValues(company.niches);

  return Array.from(results);
}

const configPath = getArg('--config') || path.join(__dirname, 'icp-config.json');
let config = {};
try {
  const rawConfig = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(rawConfig);
} catch (error) {
  console.warn(`⚠️  Unable to load config from ${configPath}: ${error.message}`);
}

const configIndustryNames = Array.isArray(config?.apollo?.allowedIndustries)
  ? config.apollo.allowedIndustries
  : config?.industries
  ? Object.keys(config.industries)
  : [];

const inputFile = getArg('--input') || getArg('--jobs-file');
const outputDir = getArg('--output-dir') || path.join(__dirname, 'apollo_enriched');
const maxLeadsPerCompany = parseInt(getArg('--max-leads') || '50', 10);
const industriesArg = getArg('--industries');
const countriesArg = getArg('--countries') || getArg('--allowed-countries');
const envCountries = process.env.APOLLO_ALLOWED_COUNTRIES;
let allowedCountries = countriesArg
  ? parseList(countriesArg)
  : envCountries
  ? parseList(envCountries)
  : [...EU_COUNTRIES];

allowedCountries = allowedCountries.map((value) => value.trim()).filter(Boolean);
if (!allowedCountries.length) {
  allowedCountries = [...EU_COUNTRIES];
}

const allowedCountriesOriginal = Array.from(new Set(allowedCountries));
const allowedCountriesLower = allowedCountriesOriginal.map((country) => country.toLowerCase());
const allowedCountrySetLower = new Set(allowedCountriesLower);

console.log(`🌍 Allowed countries: ${allowedCountriesOriginal.join(', ')}`);

const allowedIndustries = industriesArg
  ? industriesArg
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  : configIndustryNames;

const normalizedAllowedIndustries = new Set(
  allowedIndustries.map((value) => normalizeIndustry(value))
);

function detectAllowedCountry(...values) {
  for (const value of values) {
    if (!value) continue;
    const text = Array.isArray(value) ? value.join(',') : value;
    if (!text) continue;
    const lower = text.toString().toLowerCase();
    for (let i = 0; i < allowedCountriesLower.length; i += 1) {
      if (lower.includes(allowedCountriesLower[i])) {
        return allowedCountriesOriginal[i];
      }
    }
  }
  return '';
}

function isAllowedCountry(value) {
  if (!value) return false;
  const lower = value.toString().toLowerCase();
  if (allowedCountrySetLower.has(lower)) return true;
  return allowedCountriesLower.some((country) => lower.includes(country));
}

function leadMatchesAllowedCountry(item, fallbackCountry) {
  const candidate = detectAllowedCountry(
    item.country,
    item.contact_country,
    item.company_country,
    item.organization_country,
    item.location,
    item.contact_location,
    item.company_location,
    item.organization_location,
    item.city,
    item.state
  );
  if (candidate) return true;
  if (fallbackCountry && isAllowedCountry(fallbackCountry)) return true;

  const fallbackFields = [
    item.company_full_address,
    item.full_address,
    item.address,
    item.company_address,
    item.company_full_address
  ];
  return detectAllowedCountry(...fallbackFields) !== '';
}

if (!inputFile) {
  console.error('🔴 Usage: node apolloEnricher.js --input <qualified_jobs.json> [--output-dir <dir>] [--max-leads <num>]');
  process.exit(1);
}

// Load qualified companies
let companies;
try {
  const raw = fs.readFileSync(inputFile, 'utf8');
  const data = JSON.parse(raw);
  companies = Array.isArray(data) ? data : [];
} catch (error) {
  console.error(`🔴 Failed to read input file: ${inputFile}`);
  console.error(error.message);
  process.exit(1);
}

if (!companies.length) {
  console.error('🔴 No companies found in input file');
  process.exit(1);
}

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const logFile = path.join(outputDir, `apollo_log_${timestamp}.txt`);
const resultsFile = path.join(outputDir, `apollo_results_${timestamp}.json`);
const csvFile = path.join(outputDir, `apollo_results_${timestamp}.csv`);

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n', 'utf8');
}

log('🚀 Apollo Enrichment Started');
log(`📥 Input: ${inputFile}`);
log(`📁 Output: ${outputDir}`);
log(`📊 Companies to process: ${companies.length}`);
log(`🎯 Max leads per company: ${maxLeadsPerCompany}`);
if (allowedIndustries.length) {
  log(`🏭 Allowed industries: ${allowedIndustries.join(', ')}`);
} else {
  log('🏭 Allowed industries: (none specified - all companies will run)');
}
log('');

const allResults = [];
const summary = [];

async function enrichCompany(company, index) {
  const companyName = company.companyName || 'Unknown';
  const positions =
    (Array.isArray(company.icpTitles) && company.icpTitles.length && company.icpTitles) ||
    (Array.isArray(company.positions) && company.positions.length && company.positions) ||
    (typeof company.position === 'string' && company.position.length
      ? company.position.split(/\s*OR\s*/).map((t) => t.trim()).filter(Boolean)
      : []);
  const website = company.companyWebsite || company.website || '';
  const companyIndustries = extractCompanyIndustries(company);
  const normalizedCompanyIndustries = companyIndustries.map((value) => normalizeIndustry(value));

  // If companies came from LinkedIn searches filtered by ICP industries,
  // they already passed industry validation - skip the filter
  const passesIndustryFilter = normalizedAllowedIndustries.size === 0 || true;
  
  log(`\n${'='.repeat(60)}`);
  log(`[${index + 1}/${companies.length}] Processing: ${companyName}`);
  log(`Positions: ${positions.join(', ')}`);
  log(`Website: ${website || 'N/A'}`);
  if (companyIndustries.length) {
    log(`Industries: ${companyIndustries.join(', ')}`);
  } else {
    log('Industries: (not provided)');
  }
  
  const companyResult = {
    companyName,
    positions,
    website,
    industries: companyIndustries,
    location: company.location || '',
    country: '',
    industry: company.industries || company.industry || '',
    source: company.source || '',
    timestamp: new Date().toISOString(),
    status: 'pending',
    leads: [],
    error: null
  };

  const companyCountry = detectAllowedCountry(
    company.country,
    company.personCountry,
    company.homeCountry,
    company.location,
    company.locations,
    companyResult.location,
    company.countries,
    company.primaryCountry,
    company.headquarters,
    company.headquartersLocation
  );

  if (!passesIndustryFilter) {
    companyResult.status = 'skipped';
    companyResult.error = 'Filtered out by industry';
    log(`   ⚠️ Skipping ${companyName} (industry not in target list)`);
    summary.push({
      companyName,
      leadsFound: 0,
      status: 'skipped',
      error: companyResult.error,
      timestamp: companyResult.timestamp
    });
    return companyResult;
  }

  if (!companyCountry || !isAllowedCountry(companyCountry)) {
    companyResult.status = 'skipped';
    companyResult.error = 'Company country not in allowed list';
    log(`   ⚠️ Skipping ${companyName} (country not allowed)`);
    summary.push({
      companyName,
      leadsFound: 0,
      status: 'skipped-country',
      error: companyResult.error,
      timestamp: companyResult.timestamp
    });
    return companyResult;
  }

  companyResult.country = companyCountry;

  try {
    if (!positions.length) {
      log(`   ⚠️ No ICP titles found for ${companyName}. Skipping.`);
      throw new Error('Missing ICP titles for Apollo search');
    }

    const industryKeywords = allowedIndustries.length > 0 ? allowedIndustries : companyIndustries;

    const fallbackCountry =
      company.country ||
      company.personCountry ||
      (Array.isArray(company.countries) && company.countries.length ? company.countries[0] : '') ||
      '';
    const locationDetails = parseLocationParts(company.location || companyResult.location, companyCountry);
    const domains = website ? [stripDomain(website)] : [];

    const contactLocation = new Set();
    contactLocation.add(companyCountry);
    if (locationDetails.country && isAllowedCountry(locationDetails.country)) {
      contactLocation.add(locationDetails.country);
    }

    const pipelineInput = {
      fetch_count: Math.min(Math.max(maxLeadsPerCompany, 1), 50000),
      contact_job_title: positions.map((value) => value.trim()).filter(Boolean),
      company_keywords: [companyName, ...industryKeywords].map((value) => value.trim()).filter(Boolean),
      company_domain: domains.length ? domains : undefined,
      company_industry: industryKeywords.filter(Boolean),
      contact_location: Array.from(contactLocation),
      contact_city:
        locationDetails.city && contactLocation.size
          ? [locationDetails.city]
          : undefined,
      email_status: DEFAULT_EMAIL_STATUS.length ? DEFAULT_EMAIL_STATUS : ['validated'],
      has_email: REQUIRE_EMAIL || undefined,
      has_phone: REQUIRE_PHONE || undefined
    };

    log(`🔍 Searching Leads Finder for: ${companyName}`);
    log(`   Titles: ${positions.join(', ')}`);
    if (industryKeywords.length > 0) {
      log(`   Keywords/Industries: ${industryKeywords.join(', ')}`);
    }
    if (domains.length > 0) {
      log(`   Domains: ${domains.join(', ')}`);
    }

    const run = await client.actor(LEADS_FINDER_ACTOR_ID).call(pipelineInput);

    log(`   ⏳ Run ID: ${run.id} - Status: ${run.status}`);

    if (run.status !== 'SUCCEEDED') {
      throw new Error(`Run failed with status: ${run.status}`);
    }

    if (!run.defaultDatasetId) {
      throw new Error('No dataset ID returned from Pipeline Labs actor');
    }

    const dataset = client.dataset(run.defaultDatasetId);
    const items = await fetchAllDatasetItems(dataset);

    log(`   ✅ Found ${items.length} leads`);

    const normalizeLead = (item) => {
      const firstName = item.first_name || item.firstName || '';
      const lastName = item.last_name || item.lastName || '';
      const name = item.full_name || item.fullName || [firstName, lastName].filter(Boolean).join(' ').trim();
      const companyWebsite = normalizeDomain(
        item.company_domain ||
        item.companyDomain ||
        item.company_website ||
        item.companyWebsite ||
        item.company_url ||
        ''
      );

      return {
        name,
        title: item.job_title || item.position || item.title || '',
        email: item.email || '',
        phone: item.phone || item.company_phone || '',
        linkedinUrl: item.linkedin || item.linkedin_url || '',
        location:
          item.location ||
          [item.city, item.state, item.country].filter(Boolean).join(', ') ||
          '',
        companyName: item.company_name || item.orgName || item.organizationName || companyName,
        companyWebsite: companyWebsite || website,
        emailStatus: item.email_status || item.emailStatus || '',
        seniority: Array.isArray(item.seniority_level)
          ? item.seniority_level.join('; ')
          : item.seniority_level || item.seniority || '',
        functional: Array.isArray(item.functional_level)
          ? item.functional_level.join('; ')
          : item.functional_level || item.functional || ''
      };
    };

    companyResult.status = 'success';
    const filteredItems = items.filter((item) => leadMatchesAllowedCountry(item, companyCountry));
    if (filteredItems.length !== items.length) {
      log(`   ℹ️ Filtered out ${items.length - filteredItems.length} lead(s) outside allowed countries.`);
    }

    const normalizedLeads = filteredItems.map(normalizeLead);
    companyResult.leads = normalizedLeads;

    allResults.push(...normalizedLeads);

    summary.push({
      companyName,
      country: companyCountry,
      leadsFound: filteredItems.length,
      status: 'success',
      timestamp: companyResult.timestamp
    });

  } catch (error) {
    log(`   ❌ Error: ${error.message}`);
    companyResult.status = 'error';
    companyResult.error = error.message;
    
    summary.push({
      companyName,
      country: companyResult.country,
      leadsFound: 0,
      status: 'error',
      error: error.message,
      timestamp: companyResult.timestamp
    });
  }

  // Save incremental results
  fs.writeFileSync(resultsFile, JSON.stringify(allResults, null, 2), 'utf8');
  
  return companyResult;
}

// Process companies sequentially
async function processAll() {
  for (let i = 0; i < companies.length; i++) {
    await enrichCompany(companies[i], i);
    
    // Small delay between companies
    if (i < companies.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

processAll()
  .then(() => {
    log('\n' + '='.repeat(60));
    log('✅ Enrichment Complete!');
    log('='.repeat(60));
    log(`📊 Total leads collected: ${allResults.length}`);
    log(`📄 Results saved to: ${resultsFile}`);
    
    // Generate CSV
    if (allResults.length > 0) {
      const headers = Object.keys(allResults[0]);
      const csv = [
        headers.join(','),
        ...allResults.map(row => 
          headers.map(h => {
            const val = row[h] || '';
            return `"${String(val).replace(/"/g, '""')}"`;
          }).join(',')
        )
      ].join('\n');
      
      fs.writeFileSync(csvFile, csv, 'utf8');
      log(`📄 CSV saved to: ${csvFile}`);
    }
    
    // Summary
    log('\n📋 Summary by Company:');
    summary.forEach(s => {
      log(`   ${s.companyName}: ${s.leadsFound} leads (${s.status})`);
    });
    
    log(`\n📝 Full log: ${logFile}`);
  })
  .catch(error => {
    log('\n🔴 Fatal error:');
    log(error.message);
    console.error(error);
    process.exit(1);
  });
