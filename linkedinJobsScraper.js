import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const APIFY_TOKEN =
  process.env.APIFY_TOKEN ||
  process.env.APIFY_API_TOKEN ||
  process.env.APIFY_API_KEY;

if (!APIFY_TOKEN) {
  console.error('🔴 Missing Apify API token. Set APIFY_TOKEN in your environment or .env file.');
  process.exit(1);
}

const client = new ApifyClient({ token: APIFY_TOKEN });

const DEFAULT_FILTERS = {
  keywords: '',
  location: '',
  experience: '',
  jobType: '',
  remote: '',
  industry: '',
  datePosted: '',
  companyId: '',
  sort: '',
  position: '1',
  pageNum: '0'
};

function buildLinkedInSearchUrl(filters) {
  const query = new URLSearchParams();

  query.set('position', (filters.position || '1').toString());
  query.set('pageNum', (filters.pageNum || '0').toString());

  if (filters.keywords) query.set('keywords', filters.keywords);
  if (filters.location) query.set('location', filters.location);
  if (filters.experience) query.set('experienceLevel', filters.experience);
  if (filters.jobType) query.set('f_JT', filters.jobType);
  if (filters.remote) query.set('f_WT', filters.remote);
  if (filters.industry) query.set('f_I', filters.industry);
  if (filters.datePosted) query.set('f_TPR', filters.datePosted);
  if (filters.companyId) query.set('f_C', filters.companyId);
  if (filters.sort) query.set('sortBy', filters.sort);

  return `https://www.linkedin.com/jobs/search/?${query.toString()}`;
}

const DEFAULT_INPUT = {
  urls: [buildLinkedInSearchUrl(DEFAULT_FILTERS)],
  scrapeCompany: true,
  count: 100,
  outputDir: process.env.LINKEDIN_JOBS_OUTPUT_DIR || ''
};

function parseArgs() {
  const args = process.argv.slice(2);
  const filters = { ...DEFAULT_FILTERS };
  const options = {
    urls: [],
    scrapeCompany: DEFAULT_INPUT.scrapeCompany,
    count: DEFAULT_INPUT.count,
    outputDir: DEFAULT_INPUT.outputDir
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg.startsWith('--count=')) {
      options.count = parseInt(arg.split('=')[1], 10) || DEFAULT_INPUT.count;
    } else if (arg === '--count' && args[i + 1]) {
      options.count = parseInt(args[i + 1], 10) || DEFAULT_INPUT.count;
      i += 1;
    } else if (arg === '--no-company') {
      options.scrapeCompany = false;
    } else if (arg.startsWith('--keywords=')) {
      filters.keywords = (arg.split('=')[1] || '').trim();
    } else if (arg === '--keywords' && args[i + 1]) {
      filters.keywords = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--location=')) {
      filters.location = (arg.split('=')[1] || '').trim();
    } else if (arg === '--location' && args[i + 1]) {
      filters.location = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--industry=')) {
      filters.industry = (arg.split('=')[1] || '').trim();
    } else if (arg === '--industry' && args[i + 1]) {
      filters.industry = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--sort=')) {
      filters.sort = (arg.split('=')[1] || '').trim();
    } else if (arg === '--sort' && args[i + 1]) {
      filters.sort = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--experience=')) {
      filters.experience = (arg.split('=')[1] || '').trim();
    } else if (arg === '--experience' && args[i + 1]) {
      filters.experience = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--job-type=')) {
      filters.jobType = (arg.split('=')[1] || '').trim();
    } else if (arg === '--job-type' && args[i + 1]) {
      filters.jobType = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--remote=')) {
      filters.remote = (arg.split('=')[1] || '').trim();
    } else if (arg === '--remote' && args[i + 1]) {
      filters.remote = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--date-posted=')) {
      filters.datePosted = (arg.split('=')[1] || '').trim();
    } else if (arg === '--date-posted' && args[i + 1]) {
      filters.datePosted = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--company-id=')) {
      filters.companyId = (arg.split('=')[1] || '').trim();
    } else if (arg === '--company-id' && args[i + 1]) {
      filters.companyId = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = (arg.split('=')[1] || '').trim();
    } else if (arg === '--output-dir' && args[i + 1]) {
      options.outputDir = (args[i + 1] || '').trim();
      i += 1;
    } else if (arg.startsWith('--url=')) {
      const value = arg.slice(arg.indexOf('=') + 1);
      if (value) options.urls = [value];
    } else if (arg === '--url' && args[i + 1]) {
      options.urls = [args[i + 1]];
      i += 1;
    } else if (arg.startsWith('--urls=')) {
      const list = arg.slice(arg.indexOf('=') + 1);
      options.urls = list.split(',').map((u) => u.trim()).filter(Boolean);
    } else if (arg === '--urls' && args[i + 1]) {
      options.urls = args[i + 1].split(',').map((u) => u.trim()).filter(Boolean);
      i += 1;
    }
  }

  if (!options.urls.length) {
    options.urls.push(buildLinkedInSearchUrl(filters));
  }

  return options;
}

function dedupeUrls(urls) {
  return Array.from(new Set(urls.filter(Boolean)));
}

async function run() {
  const options = parseArgs();
  const urls = dedupeUrls(options.urls);

  if (!urls.length) {
    console.error('🔴 No LinkedIn search URLs to process.');
    process.exit(1);
  }

  const count = Math.max(options.count, 100);
  if (count !== options.count) {
    console.log(`⚠️ Adjusted requested count to ${count} (actor minimum is 100).`);
  }

  const input = {
    urls,
    scrapeCompany: options.scrapeCompany,
    count
  };

  console.log('🚀 Starting Linkedin Jobs scraper run...');
  console.log('🔧 Input configuration:', JSON.stringify(input, null, 2));

  try {
    const run = await client.actor('hKByXkMQaC5Qt9UMN').call(input);

    if (!run?.defaultDatasetId) {
      console.warn('⚠️ Run completed but no dataset ID was returned.');
      return;
    }

    console.log(`📦 Run finished (ID: ${run.id}). Fetching dataset ${run.defaultDatasetId}...`);
    const dataset = client.dataset(run.defaultDatasetId);
    const { items } = await dataset.listItems();

    if (!items || !items.length) {
      console.log('📭 No items returned from the dataset.');
      return;
    }

    console.log(`📊 Retrieved ${items.length} items. Sample:`);
    console.dir(items[0], { depth: null });
    if (items.length > 1) {
      console.log('...');
    }

    let outputDir = options.outputDir || process.env.LINKEDIN_JOBS_OUTPUT_DIR || '';
    let outputPath;
    if (outputDir) {
      await fs.promises.mkdir(outputDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `linkedin_jobs_results_${timestamp}.json`;
      outputPath = path.join(outputDir, fileName);
    } else {
      outputPath = process.env.LINKEDIN_JOBS_OUTPUT || 'linkedin_jobs_results.json';
    }

    await fs.promises.writeFile(outputPath, JSON.stringify(items, null, 2), 'utf8');
    console.log(`✅ Results saved to ${outputPath}`);
  } catch (error) {
    console.error('🔴 Error running LinkedIn Jobs scraper:', error.message);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error('🔴 Unhandled error in LinkedIn Jobs scraper:', error);
  process.exit(1);
});
