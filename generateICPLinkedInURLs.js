import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const ICP_CONFIG = {
  titles: [
    'Business Development Manager',
    'Export Manager',
    'Sales Director',
    'Commercial Director',
    'International Sales Manager',
    'Regional Account Manager',
    'Head of Sales',
    'Director Comercial'
  ],
  industries: {
    'Food & Beverage Manufacturing': '34'
    // 'Food Production': '39',
    // 'Farming': '23',
    // 'Mining & Metals': '56',
    // 'Machinery': '13',
    // 'Chemicals': '18',
    // 'Pharmaceuticals': '15'
  },
  locations: [
    // Culinary legacy anchors
    'Spain',
    'Italy',
    'France',
    'Greece',
    'Portugal',

    // Wealthy EU markets with buying power
    'Germany',
    'Netherlands',
    'Belgium',
    'Austria',
    'Denmark',
    'Sweden',
    'Finland',
    'Ireland',
    'Luxembourg'
  ],
  experienceLevels: ['4', '5', '6'],
  companySize: {
    min: 50,
    max: 500
  }
};

const OUTPUT_BY_NICHE = 'linkedin_icp_urls_by_niche.json';
const OUTPUT_BY_COUNTRY = 'linkedin_icp_urls_by_country_niche.json';

const APIFY_TOKEN =
  process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY || '';

const apifyClient = APIFY_TOKEN ? new ApifyClient({ token: APIFY_TOKEN }) : null;

function buildLinkedInJobSearchUrl({ titles, location, experienceLevels, industryId }) {
  const baseUrl = 'https://www.linkedin.com/jobs/search/';
  const params = new URLSearchParams();

  params.set('position', '1');
  params.set('pageNum', '0');
  params.set('sortBy', 'DD');

  if (titles?.length) {
    params.set('keywords', titles.join(' OR '));
  }

  if (location) {
    params.set('location', location);
  }

  if (experienceLevels?.length) {
    params.set('f_E', experienceLevels.join(','));
  }

  if (industryId) {
    params.set('f_I', industryId);
  }

  return `${baseUrl}?${params.toString()}`;
}

function prependCurrentJobId(url, jobId) {
  if (!jobId) return url;

  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);

  params.delete('currentJobId');
  const ordered = new URLSearchParams();
  ordered.append('currentJobId', jobId);
  params.forEach((value, key) => {
    ordered.append(key, value);
  });

  return `${parsed.origin}${parsed.pathname}?${ordered.toString()}`;
}

async function fetchCurrentJobId(searchUrl) {
  if (!apifyClient) {
    console.warn('⚠️ Skipping currentJobId fetch (missing Apify token).');
    return '';
  }

  try {
    const run = await apifyClient.actor('hKByXkMQaC5Qt9UMN').call({
      urls: [searchUrl],
      scrapeCompany: false,
      count: 100
    });

    if (!run?.defaultDatasetId) {
      console.warn('⚠️ Apify run completed without dataset ID.');
      return '';
    }

    const dataset = apifyClient.dataset(run.defaultDatasetId);
    const { items } = await dataset.listItems({ limit: 1 });
    if (items?.length && items[0]?.id) {
      return String(items[0].id);
    }
  } catch (error) {
    console.warn(`⚠️ Failed to fetch currentJobId for URL: ${searchUrl}`);
    console.warn(error.message);
  }

  return '';
}

async function generateUrlsByNiche(config) {
  const results = [];

  for (const [niche, industryId] of Object.entries(config.industries)) {
    const baseUrl = buildLinkedInJobSearchUrl({
      titles: config.titles,
      location: 'Europe',
      experienceLevels: config.experienceLevels,
      industryId
    });

    const currentJobId = await fetchCurrentJobId(baseUrl);
    results.push({
      niche,
      industryId,
      baseUrl,
      currentJobId,
      url: prependCurrentJobId(baseUrl, currentJobId),
      titles: config.titles,
      experienceLevels: config.experienceLevels,
      generatedAt: new Date().toISOString()
    });
  }

  return results;
}

async function generateUrlsByCountry(config) {
  const results = [];

  for (const location of config.locations) {
    for (const [niche, industryId] of Object.entries(config.industries)) {
      const baseUrl = buildLinkedInJobSearchUrl({
        titles: config.titles,
        location,
        experienceLevels: config.experienceLevels,
        industryId
      });

      const currentJobId = await fetchCurrentJobId(baseUrl);
      results.push({
        niche,
        location,
        industryId,
        baseUrl,
        currentJobId,
        url: prependCurrentJobId(baseUrl, currentJobId),
        titles: config.titles,
        experienceLevels: config.experienceLevels,
        generatedAt: new Date().toISOString()
      });
    }
  }

  return results;
}

function saveUrlsToFile(urls, filename) {
  const outputPath = path.join(process.cwd(), filename);
  fs.writeFileSync(outputPath, JSON.stringify(urls, null, 2), 'utf8');
  console.log(`✅ Saved ${urls.length} URLs to ${outputPath}`);
}

function printUrls(label, urls) {
  console.log(`\n📋 ${label}`);
  urls.forEach((entry, index) => {
    const headerParts = [entry.niche];
    if (entry.location) {
      headerParts.push(entry.location);
    }
    console.log(`${index + 1}. ${headerParts.filter(Boolean).join(' - ')}`);
    console.log(`   ${entry.url}`);
    if (!entry.currentJobId) {
      console.log('   ⚠️ currentJobId missing (check Apify token or search results)');
    }
  });
}

async function main() {
  console.log('🔗 Generating LinkedIn URLs for ICP...');

  if (!apifyClient) {
    console.warn('⚠️ Apify token not found. URLs will be generated without currentJobId.');
  }

  console.log('📊 ICP Configuration:');
  console.log(`   Title: ${ICP_CONFIG.titles.join(', ')}`);
  console.log(`   Industries: ${Object.keys(ICP_CONFIG.industries).join(', ')}`);
  console.log(`   Locations: ${ICP_CONFIG.locations.length} EU countries`);
  console.log(`   Experience Levels: ${ICP_CONFIG.experienceLevels.join(', ')}\n`);

  const nicheUrls = await generateUrlsByNiche(ICP_CONFIG);
  printUrls('Generated niche URLs:', nicheUrls);
  saveUrlsToFile(nicheUrls, OUTPUT_BY_NICHE);

  const countryUrls = await generateUrlsByCountry(ICP_CONFIG);
  printUrls('Generated country × niche URLs:', countryUrls.slice(0, 10));
  saveUrlsToFile(countryUrls, OUTPUT_BY_COUNTRY);

  console.log('\n📝 Next steps:');
  console.log('1. Review the generated JSON files for usable LinkedIn URLs.');
  console.log('2. Test URLs in the browser to confirm they match expected ICP results.');
  console.log('3. Scrape with linkedinJobsScraper.js using the generated URLs.');
  console.log('4. Run Gemini qualification on the scraped dataset before Apollo.');
}

main().catch((error) => {
  console.error('🔴 Failed to generate LinkedIn ICP URLs');
  console.error(error);
  process.exit(1);
});
