import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const APIFY_TOKEN =
  process.env.APIFY_TOKEN ||
  process.env.APIFY_API_TOKEN ||
  process.env.APIFY_API_KEY;

if (!APIFY_TOKEN) {
  console.error('🔴 Missing Apify API token. Set APIFY_TOKEN/APIFY_API_TOKEN/APIFY_API_KEY in your environment or .env file.');
  process.exit(1);
}

const client = new ApifyClient({ token: APIFY_TOKEN });

const DEFAULT_URL_TEMPLATE =
  process.env.APOLLO_URL_TEMPLATE ||
  'https://app.apollo.io/#/people?page=1&personTitles[]={{title}}&organizationNames[]={{company}}';

const DEFAULT_LEADS = Math.max(
  parseInt(process.env.APOLLO_NUMBER_OF_LEADS || '200', 10) || 200,
  1
);

const DEFAULT_PER_COMPANY_CAP = Math.max(
  parseInt(process.env.APOLLO_PER_COMPANY_CAP || '0', 10) || 0,
  0
);

const DEFAULT_MAX_TOTAL_LEADS = Math.max(
  parseInt(process.env.APOLLO_MAX_TOTAL_LEADS || '0', 10) || 0,
  0
);

const DEFAULT_OUTPUT_DIR =
  process.env.APOLLO_OUTPUT_DIR || path.join(process.cwd(), 'apollo_runs');

const args = process.argv.slice(2);

function stripQuotes(value = '') {
  return value.replace(/^['"]|['"]$/g, '');
}

function hasFlag(flag) {
  return args.includes(flag);
}

function getArgValue(flag) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith(`${flag}=`)) {
      const [, ...rest] = arg.split('=');
      return stripQuotes(rest.join('='));
    }
    if (arg === flag && i + 1 < args.length) {
      return stripQuotes(args[i + 1]);
    }
  }
  return null;
}

function parseListArg(flag) {
  const value = getArgValue(flag);
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs() {
  const options = {
    template: DEFAULT_URL_TEMPLATE,
    leads: DEFAULT_LEADS,
    jobsFile: null,
    companyField: process.env.APOLLO_COMPANY_FIELD || 'companyName',
    titleField: process.env.APOLLO_TITLE_FIELD || 'jobTitle',
    websiteField: process.env.APOLLO_WEBSITE_FIELD || 'companyUrl',
    locationField: process.env.APOLLO_LOCATION_FIELD || 'location',
    industryField: process.env.APOLLO_INDUSTRY_FIELD || 'industries',
    functionField: process.env.APOLLO_FUNCTION_FIELD || 'jobFunction',
    limit: Math.max(parseInt(process.env.APOLLO_COMPANY_LIMIT || '0', 10) || 0, 0),
    outputDir: DEFAULT_OUTPUT_DIR,
    dryRun: hasFlag('--dry-run'),
    companies: parseListArg('--companies'),
    positions: parseListArg('--positions'),
    websites: parseListArg('--websites'),
    perCompanyCap: DEFAULT_PER_COMPANY_CAP,
    maxTotalLeads: DEFAULT_MAX_TOTAL_LEADS
  };

  const templateValue = getArgValue('--template');
  if (templateValue) {
    options.template = templateValue;
  }

  const leadsValue = getArgValue('--leads');
  if (leadsValue) {
    options.leads = Math.max(parseInt(leadsValue, 10) || DEFAULT_LEADS, 1);
  }

  const limitValue = getArgValue('--limit');
  if (limitValue) {
    options.limit = Math.max(parseInt(limitValue, 10) || 0, 0);
  }

  const outputDirValue = getArgValue('--output-dir');
  if (outputDirValue) {
    options.outputDir = path.resolve(outputDirValue);
  }

  const jobsFileValue = getArgValue('--jobs-file');
  if (jobsFileValue) {
    options.jobsFile = path.resolve(jobsFileValue);
  }

  const perCompanyCapValue = getArgValue('--per-company-cap');
  if (perCompanyCapValue) {
    options.perCompanyCap = Math.max(parseInt(perCompanyCapValue, 10) || 0, 0);
  }

  const maxTotalLeadsValue = getArgValue('--max-total-leads');
  if (maxTotalLeadsValue) {
    options.maxTotalLeads = Math.max(parseInt(maxTotalLeadsValue, 10) || 0, 0);
  }

  const companyFieldValue = getArgValue('--company-field');
  if (companyFieldValue) {
    options.companyField = companyFieldValue;
  }

  const titleFieldValue = getArgValue('--title-field');
  if (titleFieldValue) {
    options.titleField = titleFieldValue;
  }

  const websiteFieldValue = getArgValue('--website-field');
  if (websiteFieldValue) {
    options.websiteField = websiteFieldValue;
  }

  const locationFieldValue = getArgValue('--location-field');
  if (locationFieldValue) {
    options.locationField = locationFieldValue;
  }

  const industryFieldValue = getArgValue('--industry-field');
  if (industryFieldValue) {
    options.industryField = industryFieldValue;
  }

  const functionFieldValue = getArgValue('--function-field');
  if (functionFieldValue) {
    options.functionField = functionFieldValue;
  }

  return options;
}

function getFieldByPath(obj, pathExpression) {
  if (!obj || !pathExpression) return undefined;
  if (!pathExpression.includes('.')) {
    return obj[pathExpression];
  }
  return pathExpression.split('.').reduce((acc, key) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
      return acc[key];
    }
    return undefined;
  }, obj);
}

async function loadJobsFile(filePath, options) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      console.error(`🔴 Failed to parse JSON from jobs file: ${filePath}`);
      throw error;
    }

    const records = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
      ? data.items
      : [];

    if (!records.length) {
      console.warn(`⚠️ No records found in jobs file: ${filePath}`);
      return [];
    }

    const entries = [];
    records.forEach((record, index) => {
      const companyName =
        getFieldByPath(record, options.companyField) ||
        record.companyName ||
        record.company?.name ||
        record.company ||
        '';
      const position =
        getFieldByPath(record, options.titleField) ||
        record.jobTitle ||
        record.title ||
        record.position ||
        '';
      const website =
        getFieldByPath(record, options.websiteField) ||
        record.companyUrl ||
        record.website ||
        record.company?.url ||
        '';
      const location =
        getFieldByPath(record, options.locationField) ||
        record.location ||
        record.personLocation ||
        record.city ||
        record.country ||
        '';
      const industry =
        getFieldByPath(record, options.industryField) ||
        record.industry ||
        record.industries ||
        '';
      const jobFunction =
        getFieldByPath(record, options.functionField) ||
        record.jobFunction ||
        record.jobFunctions ||
        '';

      if (!companyName && !website) {
        return;
      }

      entries.push({
        companyName,
        position,
        website,
        location,
        industry,
        jobFunction,
        source: `jobsFile:${path.basename(filePath)}#${index + 1}`
      });
    });

    console.log(`📥 Loaded ${entries.length} entries from ${filePath}`);
    return entries;
  } catch (error) {
    console.error(`🔴 Unable to read jobs file: ${filePath}`);
    throw error;
  }
}

function buildManualEntries(options) {
  if (!options.companies.length) return [];

  const entries = [];

  options.companies.forEach((company, index) => {
    if (!company) return;
    const website = options.websites[index] || '';
    let positionList;

    if (options.positions.length === options.companies.length) {
      positionList = [options.positions[index] || ''];
    } else if (options.positions.length > 0) {
      positionList = options.positions;
    } else {
      positionList = [''];
    }

    positionList.forEach((position) => {
      entries.push({
        companyName: company,
        position: position || '',
        website,
        source: 'cli'
      });
    });
  });

  return entries;
}

function dedupeEntries(entries) {
  const seen = new Map();
  entries.forEach((entry) => {
    const key = `${(entry.companyName || '').toLowerCase()}::${(entry.position || '').toLowerCase()}`;
    if (!seen.has(key)) {
      seen.set(key, entry);
    }
  });
  return Array.from(seen.values());
}

function encode(value) {
  return encodeURIComponent(value || '');
}

function getWebsiteHost(url) {
  if (!url) return '';
  try {
    const normalized = url.includes('://') ? url : `https://${url}`;
    return new URL(normalized).hostname;
  } catch (error) {
    return '';
  }
}

function buildSearchUrl(template, entry) {
  const replacements = {
    '{{company}}': encode(entry.companyName),
    '{{raw_company}}': entry.companyName || '',
    '{{title}}': encode(entry.position),
    '{{raw_title}}': entry.position || '',
    '{{website}}': encode(entry.website),
    '{{raw_website}}': entry.website || '',
    '{{company_host}}': encode(getWebsiteHost(entry.website)),
    '{{location}}': encode(entry.location || ''),
    '{{raw_location}}': entry.location || '',
    '{{industry}}': encode(entry.industry || ''),
    '{{raw_industry}}': entry.industry || '',
    '{{function}}': encode(entry.jobFunction || ''),
    '{{raw_function}}': entry.jobFunction || ''
  };

  let url = template;
  Object.entries(replacements).forEach(([token, value]) => {
    url = url.replace(new RegExp(token, 'g'), value);
  });
  return url;
}

function slugify(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '- ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'entry';
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function jsonToCsv(items) {
  if (!items || !items.length) return '';
  const headers = [...new Set(items.flatMap((item) => Object.keys(item)))];
  const lines = [headers.join(',')];
  items.forEach((item) => {
    const row = headers.map((header) => {
      let value = item[header] ?? '';
      if (typeof value === 'object' && value !== null) {
        value = JSON.stringify(value);
      }
      return `"${String(value).replace(/"/g, '""')}"`;
    });
    lines.push(row.join(','));
  });
  return lines.join('\n');
}

async function saveEntryResults(entryDir, items) {
  await ensureDir(entryDir);
  const jsonPath = path.join(entryDir, 'results.json');
  await fs.promises.writeFile(jsonPath, JSON.stringify(items, null, 2), 'utf8');

  let csvPath = '';
  if (items.length) {
    const csvData = jsonToCsv(items);
    csvPath = path.join(entryDir, 'results.csv');
    await fs.promises.writeFile(csvPath, csvData, 'utf8');
  }

  return { jsonPath, csvPath };
}

async function validateApiToken() {
  try {
    console.log('🔑 Validating Apify token...');
    const user = await client.user().get();
    console.log(`✅ Connected to Apify as: ${user?.username || 'Unknown user'}`);
    return true;
  } catch (error) {
    console.error('🔴 API token validation failed:', error.message);
    if (error.message.includes('401')) {
      console.error('The provided API token is invalid or has expired.');
    }
    return false;
  }
}

async function collectEntries(options) {
  let entries = [];

  if (options.jobsFile) {
    const fileEntries = await loadJobsFile(options.jobsFile, options);
    entries = entries.concat(fileEntries);
  }

  const manualEntries = buildManualEntries(options);
  entries = entries.concat(manualEntries);

  entries = entries.filter((entry) => entry.companyName);
  entries = dedupeEntries(entries);

  if (options.limit > 0) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function run() {
  const options = parseArgs();
  const entries = await collectEntries(options);

  if (!entries.length) {
    console.error('🔴 No companies provided. Use --companies or --jobs-file to supply input.');
    process.exit(1);
  }

  const isValid = await validateApiToken();
  if (!isValid) {
    process.exit(1);
  }

  await ensureDir(options.outputDir);
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(options.outputDir, `run-${runTimestamp}`);
  await ensureDir(runDir);

  console.log(`🚀 Starting Apollo searches for ${entries.length} company/position combinations...`);
  console.log(`📝 Output directory: ${runDir}`);

  const summary = [];
  let totalLeadsCollected = 0;

  for (const entry of entries) {
    if (options.maxTotalLeads > 0 && totalLeadsCollected >= options.maxTotalLeads) {
      console.log(
        `⏹️  Stopping before ${entry.companyName} because max total leads (${options.maxTotalLeads}) reached.`
      );
      break;
    }

    const searchUrl = buildSearchUrl(options.template, entry);
    const slug = slugify(`${entry.companyName}-${entry.position || 'all'}`);
    const entryDir = path.join(runDir, slug);

    const summaryRow = {
      companyName: entry.companyName,
      position: entry.position || '',
      website: entry.website || '',
      searchUrl,
      leadsRequested: options.leads,
      source: entry.source || 'unknown',
      timestamp: new Date().toISOString()
    };

    if (options.dryRun) {
      console.log(`🧪 Dry run: ${entry.companyName} :: ${entry.position || 'any'} -> ${searchUrl}`);
      summaryRow.status = 'dry_run';
      summaryRow.records = 0;
      summary.push(summaryRow);
      continue;
    }

    try {
      console.log(`🌐 Fetching contacts for ${entry.companyName} :: ${entry.position || 'any'}...`);
      const run = await client.actor('code_crafter/apollo-io-scraper').call({
        url: searchUrl,
        numberOfLeads: options.leads
      });

      console.log(`   🔁 Actor run ${run.id} finished with status: ${run.status}`);

      summaryRow.runId = run.id;
      summaryRow.status = run.status;
      summaryRow.datasetId = run.defaultDatasetId || '';

      if (!run.defaultDatasetId) {
        summaryRow.records = 0;
        summaryRow.error = 'No dataset ID returned from actor run.';
        summary.push(summaryRow);
        continue;
      }

      const dataset = client.dataset(run.defaultDatasetId);
      const { items: retrievedItems = [], total } = await dataset.listItems();
      let items = retrievedItems;

      summaryRow.totalInDataset = typeof total === 'number' ? total : items.length;

      if (options.perCompanyCap > 0 && items.length > options.perCompanyCap) {
        console.log(
          `   ✂️  Capping results for ${entry.companyName} to ${options.perCompanyCap} (had ${items.length}).`
        );
        items = items.slice(0, options.perCompanyCap);
        summaryRow.recordsCapped = true;
      }

      if (
        options.maxTotalLeads > 0 &&
        totalLeadsCollected + items.length > options.maxTotalLeads
      ) {
        const allowed = Math.max(options.maxTotalLeads - totalLeadsCollected, 0);
        if (allowed === 0) {
          console.log(
            `   ✂️  Skipping ${entry.companyName} entirely; max total leads (${options.maxTotalLeads}) already reached.`
          );
          summaryRow.records = 0;
          summaryRow.skippedDueToMaxTotal = true;
          summary.push(summaryRow);
          break;
        }
        console.log(
          `   ✂️  Trimming ${entry.companyName} results to ${allowed} to respect max total leads (${options.maxTotalLeads}).`
        );
        items = items.slice(0, allowed);
        summaryRow.recordsTrimmedForMaxTotal = true;
      }

      summaryRow.records = items.length;

      const { jsonPath: resultsJson, csvPath: resultsCsv } = await saveEntryResults(entryDir, items);
      summaryRow.resultsJson = resultsJson;
      if (resultsCsv) {
        summaryRow.resultsCsv = resultsCsv;
      }

      totalLeadsCollected += items.length;
      summaryRow.totalLeadsCollected = totalLeadsCollected;
    } catch (error) {
      console.error(`🔴 Error fetching contacts for ${entry.companyName}: ${error.message}`);
      summaryRow.status = 'error';
      summaryRow.error = error.message;
    }

    summary.push(summaryRow);

    if (options.maxTotalLeads > 0 && totalLeadsCollected >= options.maxTotalLeads) {
      console.log(`⏹️  Max total leads (${options.maxTotalLeads}) reached. Ending campaign.`);
      break;
    }
  }

  const summaryJsonPath = path.join(runDir, 'summary.json');
  await fs.promises.writeFile(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf8');

  const summaryCsvPath = path.join(runDir, 'summary.csv');
  const summaryCsvContent = jsonToCsv(summary);
  await fs.promises.writeFile(summaryCsvPath, summaryCsvContent, 'utf8');

  console.log('✅ Apollo scraping workflow completed.');
  console.log(`📄 Summary JSON: ${summaryJsonPath}`);
  console.log(`📄 Summary CSV: ${summaryCsvPath}`);
}

run().catch((error) => {
  console.error('🔴 Unhandled error in Apollo scraper:', error);
  process.exit(1);
});