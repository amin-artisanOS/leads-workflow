import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';
import axios from 'axios';
import { load as loadHtml } from 'cheerio';
import dotenv from 'dotenv';
import createCsvWriter from 'csv-writer';

import {
  initializeProcessedLeadsCSV,
  loadProcessedLeads,
  isDuplicateLead,
  logProcessedLead
} from './leadTracker.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRAPE_OUTPUT_DIR = path.join(__dirname, 'scraped_sites');
const USER_AGENT = process.env.DEEP_SCRAPER_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const REQUEST_TIMEOUT = parseInt(process.env.DEEP_SCRAPER_TIMEOUT || '20000', 10);
const MAX_INTERNAL_PAGES = Math.max(parseInt(process.env.DEEP_SCRAPER_MAX_PAGES || '6', 10), 1);
const MAX_PAGE_MARKDOWN_CHARS = parseInt(process.env.DEEP_SCRAPER_MAX_PAGE_CHARS || '4000', 10);
const MAX_AGGREGATED_MARKDOWN_CHARS = parseInt(process.env.DEEP_SCRAPER_MAX_AGGREGATED_CHARS || '8000', 10);
const SKIPPED_EXTENSIONS = new Set([
  '.pdf',
  '.zip',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.svg',
  '.webp',
  '.mp4',
  '.mov',
  '.avi',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx'
]);

const args = process.argv.slice(2);

const hasFlag = (flag) => args.includes(flag);

const stripWrappingQuotes = (value = '') => value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');

const getArgValue = (flag) => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(`${flag}=`)) {
      const [, ...rest] = arg.split('=');
      return stripWrappingQuotes(rest.join('='));
    }
    if (arg === flag && i + 1 < args.length) {
      return stripWrappingQuotes(args[i + 1]);
    }
  }
  return null;
};

const manualMode = hasFlag('--manual');
const csvPath = getArgValue('--csv');
const csvWebsiteHeader = getArgValue('--csv-column');
const csvCompanyHeader = getArgValue('--csv-company-column');
const csvEmailHeader = getArgValue('--csv-email-column');
const maxUrls = parseInt(getArgValue('--max-urls') || process.env.DEEP_SCRAPER_MAX_URLS || '0', 10);
const skipLoggedDuplicates = hasFlag('--skip-logged');

if (!manualMode && !csvPath) {
  console.error('🔴 No input source specified. Use --manual or --csv=<path> (or both).');
  process.exit(1);
}

function normalizeWebsite(input = '') {
  if (!input) return '';
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const normalized = parsed.toString().replace(/\/$/, '');
    return normalized;
  } catch (error) {
    return '';
  }
}

function websiteKey(url = '') {
  if (!url) return '';
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

function normalizeUrlForSet(input = '') {
  try {
    const urlObj = new URL(input);
    urlObj.hash = '';
    const normalized = urlObj.toString().replace(/\/$/, '');
    return normalized;
  } catch (error) {
    return '';
  }
}

function hostsMatch(urlA, urlB) {
  if (!urlA || !urlB) return false;
  return websiteKey(urlA) === websiteKey(urlB);
}

function shouldSkipExtension(urlObj) {
  if (!urlObj) return false;
  const ext = path.extname(urlObj.pathname || '').toLowerCase();
  if (!ext) return false;
  return SKIPPED_EXTENSIONS.has(ext);
}

function collectInternalLinksFromPage($, baseUrl) {
  const links = [];
  const seen = new Set();
  let base;
  try {
    base = new URL(baseUrl);
  } catch (error) {
    return links;
  }

  const baseNormalized = normalizeUrlForSet(baseUrl);

  $('a[href]').each((_, el) => {
    const rawHref = ($(el).attr('href') || '').trim();
    if (!rawHref) return;
    const lower = rawHref.toLowerCase();
    if (lower.startsWith('#') || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('javascript:')) {
      return;
    }

    let resolved;
    try {
      resolved = new URL(rawHref, base);
    } catch (error) {
      return;
    }

    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    if (!hostsMatch(resolved.origin, base.origin)) return;
    if (shouldSkipExtension(resolved)) return;

    resolved.hash = '';
    const normalized = resolved.toString().replace(/\/$/, '');
    if (!normalized || normalized === baseNormalized || seen.has(normalized)) return;

    seen.add(normalized);
    links.push(normalized);
  });

  return links;
}

function htmlToMarkdown($) {
  const lines = [];
  $('h1, h2, h3, h4, p, li').each((_, el) => {
    const tag = (el.tagName || '').toLowerCase();
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) return;

    switch (tag) {
      case 'h1':
        lines.push(`# ${text}`);
        break;
      case 'h2':
        lines.push(`## ${text}`);
        break;
      case 'h3':
        lines.push(`### ${text}`);
        break;
      case 'h4':
        lines.push(`#### ${text}`);
        break;
      case 'li':
        lines.push(`- ${text}`);
        break;
      default:
        lines.push(text);
    }
  });

  return lines.join('\n\n');
}

function truncateText(text = '', limit = MAX_PAGE_MARKDOWN_CHARS) {
  if (!limit || limit <= 0) return '';
  if (text.length <= limit) return text;
  const sliceEnd = Math.max(limit - 1, 0);
  const sliced = text.slice(0, sliceEnd);
  return `${sliced}${limit > 1 ? '…' : ''}`;
}

function countWords(text = '') {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function appendWithLimit(current = '', addition = '', limit) {
  if (!addition) return current;
  if (!limit || limit <= 0) return current;
  const available = limit - current.length;
  if (available <= 0) return current;
  if (addition.length <= available) return current + addition;
  const sliceEnd = Math.max(available - 1, 0);
  const truncated = sliceEnd > 0 ? addition.slice(0, sliceEnd) : '';
  return `${current}${truncated}${available > 0 ? '…' : ''}`;
}

function safeFilename(value = '', fallback = 'page') {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || fallback;
}

function extractTopParagraphs($, limit = 10) {
  const paragraphs = [];
  $('p').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
    if (paragraphs.length >= limit) return false;
    return undefined;
  });
  return paragraphs;
}

async function ensureOutputDir() {
  await fsp.mkdir(SCRAPE_OUTPUT_DIR, { recursive: true });
}

async function collectManualUrls() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const entries = [];

    console.log('✍️  Manual mode enabled. Paste website URLs (type DONE on a new line to finish):');

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.toUpperCase() === 'DONE') {
        rl.close();
        return;
      }
      const normalized = normalizeWebsite(trimmed);
      if (!normalized) {
        console.warn(`   ⚠️  Ignored invalid URL: ${trimmed}`);
        return;
      }
      entries.push({
        website: normalized,
        companyName: '',
        email: '',
        source: 'manual'
      });
      console.log(`   ✅ Added: ${normalized}`);
    });

    rl.on('close', () => {
      console.log(`👥 Manual input collected ${entries.length} URLs.`);
      resolve(entries);
    });
  });
}

async function collectCsvUrls(filePath, headerConfig) {
  try {
    await fsp.access(filePath);
  } catch (error) {
    console.error(`🔴 CSV file not found: ${filePath}`);
    process.exit(1);
  }

  const detectedHeaders = {
    website: headerConfig.websiteHeaderName || null,
    company: headerConfig.companyHeaderName || null,
    email: headerConfig.emailHeaderName || null
  };

  const candidates = {
    website: [
      'website',
      'url',
      'domain',
      'company website',
      'companywebsite',
      'website url',
      'organization_primary_domain',
      'organization_website_url'
    ],
    company: ['company', 'company name', 'name', 'organization', 'business name', 'account name'],
    email: ['email', 'contact email', 'primary email']
  };

  const rows = [];

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath).pipe(csvParser());
    let rowIndex = 2; // 1-based index; header assumed row 1

    stream.on('headers', (headers) => {
      const normalized = headers.map((h) => (h || '').toString().trim().toLowerCase());

      const findHeader = (currentValue, list) => {
        if (currentValue) {
          const idx = normalized.findIndex((h) => h === currentValue.toLowerCase());
          if (idx === -1) {
            console.error(`🔴 CSV column "${currentValue}" not found in file.`);
            process.exit(1);
          }
          return headers[idx];
        }
        for (const candidate of list) {
          const idx = normalized.findIndex((h) => h === candidate || h.includes(candidate));
          if (idx !== -1) return headers[idx];
        }
        return null;
      };

      detectedHeaders.website = findHeader(detectedHeaders.website, candidates.website);
      if (!detectedHeaders.website) {
        console.error('🔴 Unable to detect a website/url column in the CSV. Provide --csv-column=<header>.');
        process.exit(1);
      }

      detectedHeaders.company = findHeader(detectedHeaders.company, candidates.company);
      detectedHeaders.email = findHeader(detectedHeaders.email, candidates.email);

      console.log('📑 CSV column mapping:', {
        website: detectedHeaders.website,
        company: detectedHeaders.company || '(not found)',
        email: detectedHeaders.email || '(not found)'
      });
    });

    stream.on('data', (row) => {
      const websiteRaw = row[detectedHeaders.website] || '';
      const website = normalizeWebsite(websiteRaw);
      if (!website) return;

      rows.push({
        website,
        companyName: detectedHeaders.company ? (row[detectedHeaders.company] || '') : '',
        email: detectedHeaders.email ? (row[detectedHeaders.email] || '') : '',
        source: `csv:${path.basename(filePath)}`,
        rowNumber: `${rowIndex}`
      });
      rowIndex += 1;
    });

    stream.on('end', resolve);
    stream.on('error', reject);
  });

  console.log(`📥 Loaded ${rows.length} URLs from CSV: ${filePath}`);
  return rows;
}

function dedupeEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = websiteKey(entry.website);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

function extractEmailsFromHtml(html = '', $) {
  const emails = new Map();

  const addEmail = (value, source = '') => {
    const normalized = normalizeEmail(value)
      .replace(/^mailto:/, '')
      .replace(/\?.*$/, '');
    if (!normalized) return;
    // Basic email sanity check
    if (!EMAIL_REGEX.test(normalized)) return;
    emails.add(JSON.stringify({ email: normalized, source }));
  };

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) addEmail(href, 'mailto');
    const text = $(el).text();
    if (text) addEmail(text, 'mailto-text');
  });

  const plainTextMatches = html.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi) || [];
  plainTextMatches.forEach((match) => addEmail(match, 'text'));

  return Array.from(emails).map((item) => JSON.parse(item));
}

async function fetchPage(url, options = {}) {
  const { timeout = REQUEST_TIMEOUT, headers = {} } = options;
  const response = await axios.get(url, {
    timeout,
    maxRedirects: 10,
    headers: { 'User-Agent': USER_AGENT, ...headers }
  });
  return response.data;
}

async function scrapeWebsite(url, context = {}) {
  const parsed = new URL(url);
  const hostSlug = parsed.hostname.replace(/[^a-z0-9.-]/gi, '_');
  const companyDir = path.join(SCRAPE_OUTPUT_DIR, hostSlug);
  await fsp.mkdir(companyDir, { recursive: true });

  const visited = new Map();
  const queue = [url];
  const emails = new Set();
  const pages = [];
  const errors = [];
  let aggregatedMarkdown = '';

  while (queue.length > 0 && visited.size < MAX_INTERNAL_PAGES) {
    const currentUrl = queue.shift();
    if (!currentUrl) continue;
    if (visited.has(currentUrl)) continue;

    try {
      const html = await fetchPage(currentUrl);
      const filename = safeFilename(`page-${visited.size + 1}`);
      const htmlPath = path.join(companyDir, `${filename}.html`);
      await fsp.writeFile(htmlPath, html, 'utf8');

      const $ = loadHtml(html);
      const title = $('title').text().trim();
      const metaDescription = $('meta[name="description"]').attr('content') || '';
      const topParagraphs = extractTopParagraphs($);
      const pageEmails = extractEmailsFromHtml(html, $).map((item) => ({ ...item, pageUrl: currentUrl }));
      pageEmails.forEach((item) => {
        const key = item.email;
        if (!emails.has(key)) {
          emails.set(key, item);
        }
      });

      const markdownRaw = htmlToMarkdown($);
      const markdown = truncateText(markdownRaw, MAX_PAGE_MARKDOWN_CHARS);
      const markdownPath = path.join(companyDir, `${filename}.md`);
      await fsp.writeFile(markdownPath, markdown, 'utf8');

      aggregatedMarkdown = appendWithLimit(
        aggregatedMarkdown,
        `${aggregatedMarkdown ? '\n\n---\n\n' : ''}# Source: ${currentUrl}\n\n${markdown}`,
        MAX_AGGREGATED_MARKDOWN_CHARS
      );

      const pageSummary = {
        url: currentUrl,
        title,
        metaDescription,
        topParagraphs: topParagraphs.slice(0, 5),
        emailsFound: pageEmails,
        wordCount: countWords(markdown),
        htmlPath,
        markdownPath
      };

      pages.push(pageSummary);
      visited.set(currentUrl, true);

      const links = collectInternalLinksFromPage($, currentUrl);
      for (const link of links) {
        if (visited.has(link) || queue.includes(link)) continue;
        if (visited.size + queue.length >= MAX_INTERNAL_PAGES) break;
        queue.push(link);
      }
    } catch (error) {
      errors.push({ url: currentUrl, error: error.message });
      visited.set(currentUrl, false);
    }
  }

  const emailsArray = Array.from(emails.values());
  const summaryPath = path.join(companyDir, 'summary.json');
  const aggregatedMarkdownPath = path.join(companyDir, 'aggregated.md');

  const summary = {
    url,
    companyName: context.companyName || '',
    source: context.source || '',
    rowNumber: context.rowNumber || '',
    capturedAt: new Date().toISOString(),
    pages,
    emailsFound: emailsArray,
    aggregatedMarkdown,
    aggregatedWordCount: countWords(aggregatedMarkdown),
    errors,
    outputDir: companyDir
  };

  await fsp.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  await fsp.writeFile(aggregatedMarkdownPath, aggregatedMarkdown, 'utf8');

  if (emailsArray.length) {
    console.log(`   📧 Found ${emailsArray.length} email${emailsArray.length === 1 ? '' : 's'}`);
  }

  console.log(
    `   🗂️  Saved ${pages.length} page${pages.length === 1 ? '' : 's'} (${visited.size} visited, ${errors.length} errors)`
  );

  return {
    success: pages.length > 0,
    url,
    companyName: context.companyName || '',
    source: context.source || '',
    rowNumber: context.rowNumber || '',
    pages,
    emails: emailsArray,
    paths: {
      summary: summaryPath,
      aggregatedMarkdown: aggregatedMarkdownPath
    },
    errors
  };
}

async function main() {
  await ensureOutputDir();
  await initializeProcessedLeadsCSV();
  const processedLeads = skipLoggedDuplicates ? await loadProcessedLeads() : new Set();

  let entries = [];
  if (manualMode) {
    const manualEntries = await collectManualUrls();
    entries = entries.concat(manualEntries);
  }

  if (csvPath) {
    const csvEntries = await collectCsvUrls(csvPath, {
      websiteHeaderName: csvWebsiteHeader,
      companyHeaderName: csvCompanyHeader,
      emailHeaderName: csvEmailHeader
    });
    entries = entries.concat(csvEntries);
  }

  entries = dedupeEntries(entries);

  if (maxUrls > 0) {
    entries = entries.slice(0, maxUrls);
  }

  if (entries.length === 0) {
    console.log('⚠️ No URLs to process after de-duplication.');
    process.exit(0);
  }

  console.log(`🚀 Starting website scrape for ${entries.length} URLs...`);

  const runResults = {
    startedAt: new Date().toISOString(),
    total: entries.length,
    successes: [],
    failures: [],
    emailCount: 0,
    emailCsvPath: null
  };

  const emailRows = [];

  for (const entry of entries) {
    const duplicate = isDuplicateLead(processedLeads, entry.companyName, entry.website, entry.email);
    if (duplicate && skipLoggedDuplicates) {
      console.log(`   🔄 Skipping duplicate (already processed): ${entry.website}`);
      continue;
    }
    if (duplicate && !skipLoggedDuplicates) {
      console.log(`   ⚠️  Rerunning duplicate entry: ${entry.website}`);
    }

    console.log(`🌐 Scraping ${entry.website} ...`);
    const result = await scrapeWebsite(entry.website, {
      companyName: entry.companyName,
      source: entry.source,
      rowNumber: entry.rowNumber
    });

    if (result.success) {
      runResults.successes.push({
        ...result,
        companyName: entry.companyName || result.companyName || '',
        source: entry.source || result.source || '',
        rowNumber: entry.rowNumber || result.rowNumber || ''
      });

      await logProcessedLead({
        companyName: entry.companyName,
        website: entry.website,
        email: result.emails?.map((item) => item.email).join('; ') || entry.email,
        country: '',
        state: '',
        processor: 'deepWebsiteScraper',
        qualified: '',
        verificationResult: '',
        employeeCount: '',
        sheetName: entry.source || '',
        rowNumber: entry.rowNumber || ''
      });

      processedLeads.add(`website:${websiteKey(entry.website)}`);

      const pageMap = new Map(result.pages.map((page) => [page.url, page]));
      result.emails.forEach((emailInfo) => {
        const page = emailInfo.pageUrl ? pageMap.get(emailInfo.pageUrl) : null;
        emailRows.push({
          runStartedAt: runResults.startedAt,
          companyName: entry.companyName || '',
          website: entry.website || '',
          email: emailInfo.email,
          source: emailInfo.source || '',
          pageUrl: emailInfo.pageUrl || '',
          pageTitle: page?.title || '',
          sheetName: entry.source || '',
          rowNumber: entry.rowNumber || ''
        });
      });
    } else {
      runResults.failures.push(result);
    }
  }

  runResults.emailCount = emailRows.length;

  const runTimestampSlug = runResults.startedAt.replace(/[:.]/g, '-');

  if (emailRows.length > 0) {
    const emailCsvPath = path.join(SCRAPE_OUTPUT_DIR, `run-emails-${runTimestampSlug}.csv`);
    const emailCsvWriter = createCsvWriter.createObjectCsvWriter({
      path: emailCsvPath,
      header: [
        { id: 'runStartedAt', title: 'Run Started At' },
        { id: 'companyName', title: 'Company Name' },
        { id: 'website', title: 'Website' },
        { id: 'email', title: 'Email' },
        { id: 'source', title: 'Source' },
        { id: 'pageUrl', title: 'Page URL' },
        { id: 'pageTitle', title: 'Page Title' },
        { id: 'sheetName', title: 'Sheet Name' },
        { id: 'rowNumber', title: 'Row Number' }
      ]
    });
    await emailCsvWriter.writeRecords(emailRows);
    console.log(`📧 Email export saved to ${emailCsvPath}`);
    runResults.emailCsvPath = emailCsvPath;
  }

  runResults.finishedAt = new Date().toISOString();
  runResults.processed = runResults.successes.length + runResults.failures.length;

  const summaryPath = path.join(
    SCRAPE_OUTPUT_DIR,
    `run-summary-${runTimestampSlug}.json`
  );

  await fsp.writeFile(summaryPath, JSON.stringify(runResults, null, 2), 'utf8');
  console.log(`📄 Run summary saved to ${summaryPath}`);
  console.log(`✅ Completed. Successes: ${runResults.successes.length}, Failures: ${runResults.failures.length}`);
}

main().catch((error) => {
  console.error('🔴 An unexpected error occurred:', error);
  process.exit(1);
});
