import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ApifyClient } from 'apify';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_ROOT = path.join(__dirname, 'apify_runs');

const DEFAULT_ACTOR_ID = process.env.APIFY_CONTACT_ACTOR_ID || 'vdrmota/contact-info-scraper';
const DEFAULT_MAX_PAGES = parseInt(process.env.APIFY_CONTACT_MAX_PAGES || '50', 10);
const DEFAULT_MAX_DEPTH = parseInt(process.env.APIFY_CONTACT_MAX_DEPTH || '1', 10);
const DEFAULT_LEADS_ENRICHMENT = parseInt(process.env.APIFY_CONTACT_LEADS_LIMIT || '0', 10);

function parseArgs() {
  const args = process.argv.slice(2);

  const getValue = (flag) => {
    const prefix = `${flag}=`;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg.startsWith(prefix)) {
        return arg.slice(prefix.length);
      }
      if (arg === flag && i + 1 < args.length) {
        return args[i + 1];
      }
    }
    return undefined;
  };

  const hasFlag = (flag) => args.includes(flag);

  const rawUrls = getValue('--urls');
  const urlsFile = getValue('--urls-file');
  let startUrls = [];

  if (rawUrls) {
    startUrls = rawUrls
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
  }

  return {
    actorId: getValue('--actor') || DEFAULT_ACTOR_ID,
    runName: getValue('--run-name'),
    urlsFile,
    startUrls,
    maxPages: parseInt(getValue('--max-pages') || process.env.APIFY_CONTACT_MAX_PAGES || DEFAULT_MAX_PAGES, 10),
    maxDepth: parseInt(getValue('--max-depth') || process.env.APIFY_CONTACT_MAX_DEPTH || DEFAULT_MAX_DEPTH, 10),
    stayInDomain: hasFlag('--stay-in-domain') || process.env.APIFY_CONTACT_STAY_DOMAIN === 'true',
    useResidentialProxy: hasFlag('--residential-proxy') || process.env.APIFY_CONTACT_RESIDENTIAL === 'true',
    useBrowser: hasFlag('--browser') || process.env.APIFY_CONTACT_BROWSER === 'true',
    extraLoadEvent: hasFlag('--wait-extra-load') || process.env.APIFY_CONTACT_WAIT_EXTRA === 'true',
    leadsLimit: parseInt(getValue('--leads-limit') || process.env.APIFY_CONTACT_LEADS_LIMIT || DEFAULT_LEADS_ENRICHMENT, 10),
    departments: getValue('--departments'),
    proxyGroup: getValue('--proxy-group') || process.env.APIFY_PROXY_GROUP,
    rawInputFile: getValue('--input-json'),
    dryRun: hasFlag('--dry-run')
  };
}

async function readUrlsFromFile(filePath) {
  try {
    const raw = await fsp.readFile(path.resolve(filePath), 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    throw new Error(`Unable to read URLs file: ${filePath} (${error.message})`);
  }
}

async function readRawInput(filePath) {
  try {
    const raw = await fsp.readFile(path.resolve(filePath), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON input file ${filePath}: ${error.message}`);
  }
}

function ensureOutputDir(runId) {
  const dir = path.join(OUTPUT_ROOT, runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function summariseContacts(items = []) {
  const totals = {
    pages: items.length,
    emails: 0,
    phones: 0,
    phonesUncertain: 0,
    linkedIns: 0,
    twitters: 0,
    instagrams: 0,
    facebooks: 0,
    youtubes: 0,
    tiktoks: 0,
    pinterests: 0,
    discords: 0,
    snapchats: 0,
    threads: 0,
    telegrams: 0,
    reddits: 0,
    whatsapps: 0
  };

  items.forEach((item) => {
    totals.emails += item.emails?.length || 0;
    totals.phones += item.phones?.length || 0;
    totals.phonesUncertain += item.phonesUncertain?.length || 0;
    totals.linkedIns += item.linkedIns?.length || 0;
    totals.twitters += item.twitters?.length || 0;
    totals.instagrams += item.instagrams?.length || 0;
    totals.facebooks += item.facebooks?.length || 0;
    totals.youtubes += item.youtubes?.length || 0;
    totals.tiktoks += item.tiktoks?.length || 0;
    totals.pinterests += item.pinterests?.length || 0;
    totals.discords += item.discords?.length || 0;
    totals.snapchats += item.snapchats?.length || 0;
    totals.threads += item.threads?.length || 0;
    totals.telegrams += item.telegrams?.length || 0;
    totals.reddits += item.reddits?.length || 0;
    totals.whatsapps += item.whatsapps?.length || 0;
  });

  return totals;
}

function flattenContact(item) {
  const flattenArray = (value) => (Array.isArray(value) ? value.join('; ') : '');
  return {
    url: item.url || '',
    domain: item.domain || '',
    depth: item.depth ?? '',
    emails: flattenArray(item.emails),
    phones: flattenArray(item.phones),
    phonesUncertain: flattenArray(item.phonesUncertain),
    linkedIns: flattenArray(item.linkedIns),
    twitters: flattenArray(item.twitters),
    instagrams: flattenArray(item.instagrams),
    facebooks: flattenArray(item.facebooks),
    youtubes: flattenArray(item.youtubes),
    tiktoks: flattenArray(item.tiktoks),
    pinterests: flattenArray(item.pinterests),
    discords: flattenArray(item.discords),
    snapchats: flattenArray(item.snapchats),
    threads: flattenArray(item.threads),
    telegrams: flattenArray(item.telegrams),
    reddits: flattenArray(item.reddits),
    whatsapps: flattenArray(item.whatsapps),
    originalStartUrl: item.originalStartUrl || '',
    referrerUrl: item.referrerUrl || ''
  };
}

async function writeCsv(filePath, items) {
  if (!items.length) return;
  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'url', title: 'URL' },
      { id: 'domain', title: 'Domain' },
      { id: 'depth', title: 'Depth' },
      { id: 'emails', title: 'Emails' },
      { id: 'phones', title: 'Phones' },
      { id: 'phonesUncertain', title: 'Phones Uncertain' },
      { id: 'linkedIns', title: 'LinkedIns' },
      { id: 'twitters', title: 'Twitters' },
      { id: 'instagrams', title: 'Instagrams' },
      { id: 'facebooks', title: 'Facebooks' },
      { id: 'youtubes', title: 'YouTubes' },
      { id: 'tiktoks', title: 'TikToks' },
      { id: 'pinterests', title: 'Pinterests' },
      { id: 'discords', title: 'Discords' },
      { id: 'snapchats', title: 'Snapchats' },
      { id: 'threads', title: 'Threads' },
      { id: 'telegrams', title: 'Telegrams' },
      { id: 'reddits', title: 'Reddits' },
      { id: 'whatsapps', title: 'WhatsApps' },
      { id: 'originalStartUrl', title: 'Original Start URL' },
      { id: 'referrerUrl', title: 'Referrer URL' }
    ]
  });
  const flattened = items.map(flattenContact);
  await csvWriter.writeRecords(flattened);
}

async function main() {
  const {
    actorId,
    runName,
    urlsFile,
    startUrls,
    maxPages,
    maxDepth,
    stayInDomain,
    useResidentialProxy,
    useBrowser,
    extraLoadEvent,
    leadsLimit,
    departments,
    proxyGroup,
    rawInputFile,
    dryRun
  } = parseArgs();

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.error('🔴 Missing APIFY_TOKEN in environment.');
    process.exit(1);
  }

  let urls = startUrls;
  if (urlsFile) {
    const fileUrls = await readUrlsFromFile(urlsFile);
    urls = urls.concat(fileUrls);
  }
  urls = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean)));

  let actorInput = {
    startUrls: urls.map((url) => ({ url })),
    sameDomain: stayInDomain || undefined,
    maxDepth,
    maxRequests: maxPages,
    maxRequestsPerStartUrl: maxPages,
    useBrowser,
    useResidentialProxy: useResidentialProxy || undefined,
    waitUntil: extraLoadEvent ? 'networkidle' : undefined,
    maximumLeadsEnrichmentRecords: leadsLimit > 0 ? leadsLimit : undefined,
    leadsEnrichmentDepartments: departments ? departments.split(',').map((d) => d.trim()).filter(Boolean) : undefined,
    proxyConfiguration: proxyGroup ? { useApifyProxy: true, groups: [proxyGroup] } : undefined
  };

  if (rawInputFile) {
    const rawOverride = await readRawInput(rawInputFile);
    actorInput = { ...actorInput, ...rawOverride };
  }

  if (!actorInput.startUrls || actorInput.startUrls.length === 0) {
    console.error('🔴 No start URLs specified. Use --urls= or --urls-file= or provide --input-json with startUrls.');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runLabel = runName || `contact-details-${timestamp}`;

  const runDir = ensureOutputDir(runLabel);
  await writeJson(path.join(runDir, 'actor-input.json'), actorInput);

  if (dryRun) {
    console.log('🧪 Dry run - input written, no actor executed.');
    console.log(`📁 Dry run artifacts: ${runDir}`);
    return;
  }

  const client = new ApifyClient({ token });

  console.log(`🚀 Starting Apify actor "${actorId}" with ${actorInput.startUrls.length} start URL(s)...`);
  const run = await client.actor(actorId).call(actorInput);

  const runInfo = {
    id: run.id,
    status: run.status,
    defaultDatasetId: run.defaultDatasetId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    containerUrl: run.containerUrl,
    usage: run.usage,
    actorTaskId: run.actorTaskId
  };

  await writeJson(path.join(runDir, 'actor-run.json'), runInfo);

  if (!run.defaultDatasetId) {
    console.warn('⚠️ Actor run finished but no dataset ID was returned.');
    console.log(`📁 Run artifacts: ${runDir}`);
    return;
  }

  const dataset = await client.dataset(run.defaultDatasetId).listItems({
    clean: true,
    skipHidden: true
  });

  const items = dataset.items || [];
  await writeJson(path.join(runDir, 'results.json'), items);

  const summary = {
    ...runInfo,
    inputStartUrls: actorInput.startUrls,
    totalPages: items.length,
    totals: summariseContacts(items)
  };

  await writeJson(path.join(runDir, 'summary.json'), summary);

  await writeCsv(path.join(runDir, 'results.csv'), items);

  console.log(`✅ Actor finished with status: ${run.status} (${items.length} page(s) scraped)`);
  console.log(`📄 Input: ${path.join(runDir, 'actor-input.json')}`);
  console.log(`📊 Summary: ${path.join(runDir, 'summary.json')}`);
  console.log(`📁 Dataset JSON: ${path.join(runDir, 'results.json')}`);
  console.log(`📈 Dataset CSV: ${path.join(runDir, 'results.csv')}`);
}

main().catch((error) => {
  console.error('🔴 Failed to run Apify Contact Details Scraper:', error);
  process.exit(1);
});
