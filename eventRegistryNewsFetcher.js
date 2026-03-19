import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = 'https://eventregistry.org/api/v1/article/getArticles';
const OUTPUT_ROOT = path.join(__dirname, 'event_registry_runs');

const DEFAULT_KEYWORDS = [
  'food companies',
  'Trump tariffs',
  'Europe'
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

  const parseList = (value, separator = ',') => {
    if (!value) return [];
    return value
      .split(separator)
      .map((item) => item.trim())
      .filter(Boolean);
  };

  return {
    keywords: parseList(getValue('--keywords') || process.env.EVENT_REGISTRY_KEYWORDS || DEFAULT_KEYWORDS.join('|'), '|'),
    ignoreKeywords: parseList(getValue('--ignore-keywords') || process.env.EVENT_REGISTRY_IGNORE_KEYWORDS || '', '|'),
    ignoreSources: parseList(
      getValue('--ignore-sources') || process.env.EVENT_REGISTRY_IGNORE_SOURCES || 'wikipedia.org',
      '|'
    ),
    sourceLocations: parseList(getValue('--source-locations') || process.env.EVENT_REGISTRY_SOURCE_LOCATIONS || '', '|'),
    languages: parseList(getValue('--languages') || process.env.EVENT_REGISTRY_LANG || 'eng', '|'),
    dataTypes: parseList(getValue('--data-types') || process.env.EVENT_REGISTRY_DATA_TYPES || 'news', '|'),
    dateStart: getValue('--date-start') || process.env.EVENT_REGISTRY_DATE_START,
    dateEnd: getValue('--date-end') || process.env.EVENT_REGISTRY_DATE_END,
    pageCount: parseInt(getValue('--pages') || process.env.EVENT_REGISTRY_PAGES || '1', 10),
    pageSize: parseInt(getValue('--count') || process.env.EVENT_REGISTRY_COUNT || '50', 10),
    sortBy: getValue('--sort-by') || process.env.EVENT_REGISTRY_SORT_BY || 'date',
    sortAsc: hasFlag('--sort-asc') || process.env.EVENT_REGISTRY_SORT_ASC === 'true',
    runName: getValue('--run-name') || process.env.EVENT_REGISTRY_RUN_NAME,
    summaryOnly: hasFlag('--summary-only') || process.env.EVENT_REGISTRY_SUMMARY_ONLY === 'true',
    dryRun: hasFlag('--dry-run') || process.env.EVENT_REGISTRY_DRY_RUN === 'true'
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function sanitiseBody(body) {
  if (!body) return '';
  return body.replace(/\s+/g, ' ').trim();
}

async function writeCsv(filePath, articles) {
  if (!articles.length) return;

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'title', title: 'Title' },
      { id: 'url', title: 'URL' },
      { id: 'date', title: 'Published At' },
      { id: 'sourceTitle', title: 'Source' },
      { id: 'sourceUri', title: 'Source URI' },
      { id: 'language', title: 'Language' },
      { id: 'sentiment', title: 'Sentiment' },
      { id: 'summary', title: 'Summary' }
    ]
  });

  const records = articles.map((article) => ({
    title: article.title || '',
    url: article.url || '',
    date: article.date || article.dateTime || '',
    sourceTitle: article.source?.title || '',
    sourceUri: article.source?.uri || '',
    language: article.lang || '',
    sentiment: article.sentiment ?? '',
    summary: sanitiseBody(article.body || article.snippet || '')
  }));

  await csvWriter.writeRecords(records);
}

function buildBasePayload(options, apiKey) {
  const {
    keywords,
    ignoreKeywords,
    ignoreSources,
    sourceLocations,
    languages,
    dataTypes,
    dateStart,
    dateEnd,
    pageSize,
    sortBy,
    sortAsc,
    summaryOnly
  } = options;

  const payload = {
    action: 'getArticles',
    resultType: summaryOnly ? 'sourceAggr' : 'articles',
    articlesCount: Math.min(Math.max(pageSize, 1), 100),
    articlesSortBy: sortBy,
    articlesSortByAsc: !!sortAsc,
    articleBodyLen: -1,
    dataType: dataTypes.length === 1 ? dataTypes[0] : dataTypes,
    forceMaxDataTimeWindow: 31,
    includeArticleTitle: true,
    includeArticleBody: true,
    includeArticleAuthors: true,
    includeArticleSentiment: true,
    includeArticleImage: false,
    includeSourceTitle: true,
    includeArticleConcepts: false,
    includeArticleLinks: false,
    apiKey
  };

  if (keywords.length) {
    payload.keyword = keywords.length === 1 ? keywords[0] : keywords;
    if (keywords.length > 1) payload.keywordOper = 'and';
    payload.keywordLoc = 'body,title';
  }

  if (ignoreKeywords.length) {
    payload.ignoreKeyword = ignoreKeywords.length === 1 ? ignoreKeywords[0] : ignoreKeywords;
  }

  if (ignoreSources.length) {
    payload.ignoreSourceUri = ignoreSources.length === 1 ? ignoreSources[0] : ignoreSources;
  }

  if (sourceLocations.length) {
    payload.sourceLocationUri = sourceLocations;
  }

  if (languages.length) {
    payload.lang = languages.length === 1 ? languages[0] : languages;
  }

  if (dateStart) payload.dateStart = dateStart;
  if (dateEnd) payload.dateEnd = dateEnd;

  return payload;
}

async function fetchArticles(basePayload, options, runDir) {
  const { pageCount } = options;
  const totalPages = Math.max(pageCount, 1);
  const allArticles = [];
  const pageSummaries = [];

  for (let page = 1; page <= totalPages; page += 1) {
    const body = { ...basePayload, articlesPage: page };
    const requestPath = path.join(runDir, `request-page-${page}.json`);
    await writeJson(requestPath, body);

    const { data } = await axios.post(API_URL, body, {
      headers: { 'Content-Type': 'application/json' }
    });

    const responsePath = path.join(runDir, `response-page-${page}.json`);
    await writeJson(responsePath, data);

    if (basePayload.resultType === 'articles') {
      const pageArticles = data?.articles?.results || [];
      allArticles.push(...pageArticles);
      pageSummaries.push({
        page,
        returned: pageArticles.length,
        totalResults: data?.articles?.totalResults ?? null
      });
      if (!pageArticles.length) break;
    } else {
      pageSummaries.push({ page, returned: data?.results?.length || 0 });
      break;
    }
  }

  return { articles: allArticles, pageSummaries };
}

async function main() {
  const options = parseArgs();
  const apiKey = process.env.EVENT_REGISTRY_API_KEY;

  if (!apiKey) {
    console.error('🔴 Missing EVENT_REGISTRY_API_KEY in environment.');
    process.exit(1);
  }

  if (!options.keywords.length) {
    console.error('🔴 No keywords provided. Use --keywords="kw1|kw2" or set EVENT_REGISTRY_KEYWORDS.');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runLabel = options.runName || `event-registry-${timestamp}`;
  const runDir = path.join(OUTPUT_ROOT, runLabel);
  ensureDir(runDir);

  const basePayload = buildBasePayload(options, apiKey);
  await writeJson(path.join(runDir, 'base-request.json'), basePayload);

  if (options.dryRun) {
    console.log('🧪 Dry run - wrote request payload only.');
    console.log(`📁 Inspect: ${runDir}`);
    return;
  }

  try {
    const { articles, pageSummaries } = await fetchArticles(basePayload, options, runDir);

    const summary = {
      runLabel,
      generatedAt: new Date().toISOString(),
      keywords: options.keywords,
      ignoreKeywords: options.ignoreKeywords,
      ignoreSources: options.ignoreSources,
      sourceLocations: options.sourceLocations,
      languages: options.languages,
      dataTypes: options.dataTypes,
      pageSize: basePayload.articlesCount,
      pagesRequested: options.pageCount,
      pageSummaries,
      totalArticles: articles.length
    };

    await writeJson(path.join(runDir, 'summary.json'), summary);

    if (basePayload.resultType === 'articles') {
      await writeJson(path.join(runDir, 'articles.json'), articles);
      await writeCsv(path.join(runDir, 'articles.csv'), articles);
    }

    console.log(`✅ Retrieved ${articles.length} article(s) across ${pageSummaries.length} page(s).`);
    console.log(`📁 Run artifacts: ${runDir}`);
    if (articles.length) {
      console.log(`📈 CSV: ${path.join(runDir, 'articles.csv')}`);
      console.log(`📰 JSON: ${path.join(runDir, 'articles.json')}`);
    }
  } catch (error) {
    const errPayload = {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    };
    await writeJson(path.join(runDir, 'error.json'), errPayload);
    console.error('🔴 Event Registry request failed. See error.json for details.');
    process.exit(1);
  }
}

main();
