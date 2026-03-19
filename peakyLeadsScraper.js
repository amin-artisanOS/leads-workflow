#!/usr/bin/env node

import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_ROOT = path.join(__dirname, 'peaky_leads_runs');
const DEFAULT_TOTAL_RESULTS = 2000;
const LEADS_FINDER_ACTOR_ID = 'code_crafter/leads-finder';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitise(value) {
  return (value || '').toString().trim();
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => sanitise(item)).filter(Boolean);
  }
  return value
    .split(/[|,;]/)
    .map((item) => sanitise(item))
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
    titles: parseList(getValue('--titles')),
    seniority: parseList(getValue('--seniority')),
    functions: parseList(getValue('--functions')),
    companyDomains: parseList(getValue('--domains')),
    companyCountry: parseList(getValue('--company-country')),
    companyState: parseList(getValue('--company-state')),
    personCountry: parseList(getValue('--person-country')),
    personState: parseList(getValue('--person-state')),
    employeeSizes: parseList(getValue('--company-size')),
    emailStatus: parseList(getValue('--email-status')),
    totalResults: parseInt(getValue('--total-results') || `${DEFAULT_TOTAL_RESULTS}`, 10),
    includeEmails: hasFlag('--no-emails') ? false : true,
    runName: sanitise(getValue('--run-name'))
  };
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function writeCsv(filePath, records) {
  if (!records.length) return;
  const headers = [
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
    { id: 'companyName', title: 'Company' },
    { id: 'companyWebsite', title: 'Company Website' },
    { id: 'companyLinkedIn', title: 'Company LinkedIn' },
    { id: 'companySize', title: 'Company Size' },
    { id: 'companyIndustry', title: 'Company Industry' }
  ];

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: headers
  });

  const output = records.map((lead) => ({
    fullName: lead.fullName || '',
    firstName: lead.firstName || '',
    lastName: lead.lastName || '',
    email: lead.email || '',
    position: lead.position || '',
    seniority: Array.isArray(lead.seniority) ? lead.seniority.join('; ') : '',
    city: lead.city || '',
    state: lead.state || '',
    country: lead.country || '',
    linkedinUrl: lead.linkedinUrl || '',
    companyName: lead.organization?.name || '',
    companyWebsite: lead.organization?.website || '',
    companyLinkedIn: lead.organization?.linkedinUrl || '',
    companySize: lead.organization?.size || '',
    companyIndustry: lead.organization?.industry || ''
  }));

  await csvWriter.writeRecords(output);
}

async function main() {
  const options = parseArgs();

  const token =
    process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
  if (!token) {
    console.error('🔴 Missing Apify API token. Set APIFY_TOKEN in your environment.');
    process.exit(1);
  }

  if (!options.titles.length && !options.companyDomains.length) {
    console.error('🔴 Provide at least --titles or --domains to scope the search.');
    process.exit(1);
  }

  if (Number.isNaN(options.totalResults) || options.totalResults <= 0) {
    console.error('🔴 Invalid --total-results value.');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runLabel = options.runName || `peaky-leads-${timestamp}`;
  const runDir = path.join(OUTPUT_ROOT, runLabel);
  ensureDir(runDir);

  const actorInput = {
    fetch_count: Math.min(Math.max(options.totalResults, 1), 50000),
    email_status: options.emailStatus.length ? options.emailStatus.map((status) => status.toLowerCase()) : ['validated']
  };

  if (options.titles.length) actorInput.contact_job_title = options.titles;
  if (options.seniority.length) actorInput.seniority_level = options.seniority;
  if (options.functions.length) actorInput.functional_level = options.functions;
  if (options.employeeSizes.length) actorInput.size = options.employeeSizes;
  if (options.personCountry.length) actorInput.contact_location = options.personCountry;
  if (options.personState.length) actorInput.contact_city = options.personState;
  if (options.companyCountry.length) actorInput.company_location = options.companyCountry;
  if (options.companyState.length) actorInput.company_city = options.companyState;
  if (options.companyDomains.length) actorInput.company_domain = options.companyDomains.slice(0, 10);
  if (options.includeEmails === false) actorInput.has_email = false;

  const client = new ApifyClient({ token });

  console.log('🚀 Starting leads scraper actor run...');
  console.log('🎯 Actor input payload:');
  console.log(JSON.stringify(actorInput, null, 2));

  const run = await client.actor(LEADS_FINDER_ACTOR_ID).call(actorInput);

  console.log(`✅ Actor run started. Run ID: ${run.id}`);

  const datasetId = run.defaultDatasetId;
  if (!datasetId) {
    console.log('⚠️ No dataset returned from the actor run.');
    return;
  }

  const dataset = client.dataset(datasetId);
  const { items } = await dataset.listItems({ clean: true, limit: actorInput.totalResults });

  console.log(`📥 Retrieved ${items.length} lead(s).`);
  const sample = items.slice(0, Math.min(items.length, 5));
  if (sample.length) {
    console.log('🧪 Sample lead(s):');
    console.log(JSON.stringify(sample, null, 2));
  } else {
    console.log('🛑 Actor returned no leads.');
  }

  await writeJson(path.join(runDir, 'leads.json'), items);
  await writeCsv(path.join(runDir, 'leads.csv'), items);

  const summary = {
    runLabel,
    generatedAt: new Date().toISOString(),
    totalRequested: actorInput.totalResults,
    leadsReturned: items.length,
    actorInput,
    datasetId
  };

  await writeJson(path.join(runDir, 'summary.json'), summary);

  console.log(`📁 Results saved to ${runDir}`);
}

main().catch((error) => {
  console.error('🔴 Leads scraper failed:', error);
  process.exit(1);
});
