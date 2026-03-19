import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import createCsvWriter from 'csv-writer';
import { loadProcessedLeads, isDuplicateLead, logProcessedLead } from './leadTracker.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_ROOT = path.join(__dirname, 'website_monitor_runs');
const HISTORY_FILE = path.join(__dirname, 'website_monitor_history.json');
const WEBSITE_CRAWLER_ACTOR_ID = 'apify/website-content-crawler';
const LEADS_FINDER_ACTOR_ID = 'code_crafter/leads-finder';
const DEFAULT_DECISION_TITLES = [
  'Director of Interior Design',
  'Head of Interior Design',
  'Interior Design Manager',
  'Head of Purchasing',
  'Purchasing Director',
  'Purchasing Manager',
  'Head of Procurement',
  'Procurement Director',
  'Procurement Manager'
];
const DEFAULT_LEADS_PER_COMPANY = parseInt(process.env.LEADS_MONITOR_LEADS_PER_COMPANY || '100', 10);
const DEFAULT_MAX_DOMAINS_PER_CALL = parseInt(process.env.LEADS_MONITOR_MAX_DOMAINS_PER_CALL || '5', 10);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

function parseArgs() {
  const args = process.argv.slice(2);
  const hasFlag = (flag) => args.includes(flag);
  const getValue = (flag) => {
    const prefix = `${flag}=`;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg.startsWith(prefix)) return arg.slice(prefix.length);
      if (arg === flag && i + 1 < args.length) return args[i + 1];
    }
    return undefined;
  };
  const parseList = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return value
      .split(/[|,;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  };
  return {
    sites: parseList(getValue('--sites')),
    configPath: getValue('--config'),
    runName: getValue('--run-name'),
    decisionTitles: parseList(getValue('--decision-titles')).length
      ? parseList(getValue('--decision-titles'))
      : DEFAULT_DECISION_TITLES,
    leadsPerCompany: parseInt(getValue('--leads-per-company') || `${DEFAULT_LEADS_PER_COMPANY}`, 10),
    maxDomainsPerCall: parseInt(getValue('--max-domains-per-call') || `${DEFAULT_MAX_DOMAINS_PER_CALL}`, 10),
    skipLeads: hasFlag('--skip-leads'),
    skipGemini: hasFlag('--skip-gemini'),
    dryRun: hasFlag('--dry-run')
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function loadHistory() {
  try {
    const raw = await fsp.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveHistory(history) {
  await fsp.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

function slugify(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'site';
}

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    try {
      const parsed = new URL(`https://${url.trim()}`);
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return '';
    }
  }
}

function normalizeDomain(value) {
  if (!value) return '';
  return value
    .toString()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim();
}

function articleKey(url) {
  return normalizeUrl(url);
}

function paginate(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function fetchConfigSites(configPath) {
  if (!configPath) return [];
  const resolved = path.isAbsolute(configPath) ? configPath : path.join(__dirname, configPath);
  try {
    const raw = await fsp.readFile(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.sites)) return parsed.sites;
    return [];
  } catch {
    return [];
  }
}

function prepareSiteEntries(cliSites, configSites) {
  const entries = [];
  const pushSite = (site) => {
    if (!site) return;
    if (typeof site === 'string') {
      const normalized = normalizeUrl(site);
      if (!normalized) return;
      entries.push({ url: normalized, label: normalized });
      return;
    }
    const normalized = normalizeUrl(site.url || site.startUrl || '');
    if (!normalized) return;
    const label = site.label || site.name || normalized;
    const startUrls = Array.isArray(site.startUrls)
      ? site.startUrls.map((item) => ({ url: normalizeUrl(item.url || item) })).filter((item) => item && item.url)
      : [{ url: normalized }];
    entries.push({
      url: normalized,
      label,
      startUrls,
      maxCrawlPages: site.maxCrawlPages,
      includePatterns: site.includePatterns,
      excludePatterns: site.excludePatterns
    });
  };
  cliSites.forEach((site) => pushSite(site));
  configSites.forEach((site) => pushSite(site));
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const key = normalizeUrl(entry.url);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function buildCrawlerInput(site) {
  const startUrls = site.startUrls && site.startUrls.length ? site.startUrls : [{ url: site.url }];
  const input = {
    aggressivePrune: false,
    blockMedia: true,
    clickElementsCssSelector: '[aria-expanded="false"]',
    clientSideMinChangePercentage: 15,
    crawlerType: 'playwright:adaptive',
    debugLog: false,
    debugMode: false,
    expandIframes: true,
    ignoreCanonicalUrl: false,
    ignoreHttpsErrors: false,
    keepUrlFragments: false,
    proxyConfiguration: { useApifyProxy: true },
    readableTextCharThreshold: 100,
    removeCookieWarnings: true,
    removeElementsCssSelector: "nav, footer, script, style, noscript, svg, img[src^='data:'],\n[role=\"alert\"],\n[role=\"banner\"],\n[role=\"dialog\"],\n[role=\"alertdialog\"],\n[role=\"region\"][aria-label*=\"skip\" i],\n[aria-modal=\"true\"]",
    renderingTypeDetectionPercentage: 10,
    respectRobotsTxtFile: true,
    saveFiles: false,
    saveHtml: false,
    saveHtmlAsFile: false,
    saveMarkdown: true,
    saveScreenshots: false,
    startUrls,
    useSitemaps: false
  };
  if (typeof site.maxCrawlPages === 'number') input.maxCrawlPages = site.maxCrawlPages;
  if (Array.isArray(site.includePatterns) && site.includePatterns.length) input.include = site.includePatterns;
  if (Array.isArray(site.excludePatterns) && site.excludePatterns.length) input.exclude = site.excludePatterns;
  return input;
}

async function fetchDatasetItems(client, datasetId) {
  const dataset = client.dataset(datasetId);
  const items = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { items: batch, count } = await dataset.listItems({ offset, limit, clean: true });
    if (!batch.length) break;
    items.push(...batch);
    offset += batch.length;
    if (count < limit) break;
  }
  return items;
}

function collectNewPages(siteKey, pages, history) {
  const result = [];
  const known = history[siteKey] ? new Set(history[siteKey]) : new Set();
  for (const page of pages) {
    const key = articleKey(page.url);
    if (!key) continue;
    if (known.has(key)) continue;
    known.add(key);
    result.push(page);
  }
  history[siteKey] = Array.from(known).slice(-5000);
  return result;
}

function trimMarkdown(markdown) {
  if (!markdown) return '';
  return markdown.length <= 12000 ? markdown : `${markdown.slice(0, 11999)}…`;
}

function extractDomainsFromText(text) {
  if (!text) return [];
  const regex = /https?:\/\/[^\s)"'>]+/gi;
  const domains = new Set();
  let match;
  while ((match = regex.exec(text))) {
    const domain = normalizeDomain(match[0]);
    if (domain) domains.add(domain);
  }
  return Array.from(domains);
}

function deriveCompanyName(title) {
  const sanitized = (title || '').toString().replace(/\s+/g, ' ').trim();
  if (!sanitized) return '';
  const cleaned = sanitized.replace(/\s*\|\s+.*$/, '').replace(/\s+-\s+.*$/, '').replace(/\s+·\s+.*$/, '');
  const limited = cleaned.split(' ').slice(0, 12).join(' ');
  const words = limited.split(' ').filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(' ');
}

async function extractCompaniesWithGemini(model, article) {
  const prompt = `You read hospitality industry news and return companies for outreach.\n\nArticle title: ${article.title || 'N/A'}\nArticle URL: ${article.url || 'N/A'}\n\nArticle body:\n${trimMarkdown(article.markdown || article.text || '')}\n\nReturn a JSON array of objects with keys companyName and website for relevant hotel groups, hospitality brands, or interior design firms mentioned in this article. Use the best-guess website domain if exact URL is missing. Respond with JSON only.`;
  try {
    const result = await model.generateContent(prompt);
    const text = result.response?.text()?.trim() || '';
    const jsonMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || text.match(/(\[[\s\S]*?\])/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        companyName: (item.companyName || item.name || '').toString().trim(),
        website: normalizeDomain(item.website || item.domain || '')
      }))
      .filter((item) => item.companyName || item.website);
  } catch (error) {
    console.error(`🔴 Gemini extraction failed for ${article.url}: ${error.message}`);
    return [];
  }
}

function extractCompanyByHeuristics(article, siteDomain) {
  const titleName = deriveCompanyName(article.title || '');
  const domains = extractDomainsFromText(`${article.markdown || ''}\n${article.text || ''}`);
  const picked = domains.find((domain) => domain !== siteDomain);
  if (picked) return [{ companyName: titleName || picked, website: picked }];
  if (titleName && siteDomain && !titleName.toLowerCase().includes(siteDomain.split('.')[0])) {
    return [{ companyName: titleName, website: '' }];
  }
  return [];
}

function consolidateCompanies(companies) {
  const map = new Map();
  for (const entry of companies) {
    const domain = normalizeDomain(entry.website || '');
    const nameKey = (entry.companyName || '').toLowerCase();
    const key = domain || nameKey;
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        companyName: entry.companyName || '',
        website: domain,
        sourceArticles: new Set(entry.sourceArticles || []),
        articleUrls: new Set(entry.articleUrls || [])
      });
    }
    const record = map.get(key);
    if (entry.companyName && !record.companyName) record.companyName = entry.companyName;
    if (domain && !record.website) record.website = domain;
    if (entry.sourceArticles) entry.sourceArticles.forEach((item) => record.sourceArticles.add(item));
    if (entry.articleUrls) entry.articleUrls.forEach((item) => record.articleUrls.add(item));
  }
  return Array.from(map.values()).map((item) => ({
    companyName: item.companyName,
    website: item.website,
    sourceArticles: Array.from(item.sourceArticles),
    articleUrls: Array.from(item.articleUrls)
  }));
}

function normalizeLead(item) {
  const firstName = item.firstName || item.first_name || '';
  const lastName = item.lastName || item.last_name || '';
  const fullName = item.fullName || item.full_name || `${firstName} ${lastName}`.trim();
  const companyDomain = normalizeDomain(
    item.companyDomain ||
      item.company_domain ||
      item.companyWebsite ||
      item.company_website ||
      item.organization?.website ||
      item.organization?.domain ||
      ''
  );
  const companyIndustry = Array.isArray(item.company_industry)
    ? item.company_industry.join('; ')
    : item.companyIndustry || item.company_industry || '';
  return {
    fullName,
    firstName,
    lastName,
    email: item.email || '',
    position: item.position || item.job_title || '',
    seniority: Array.isArray(item.seniority_level)
      ? item.seniority_level.join('; ')
      : item.seniority || item.seniority_level || '',
    city: item.city || item.contact_city || '',
    state: item.state || item.contact_state || '',
    country: item.country || item.contact_country || '',
    linkedinUrl: item.linkedinUrl || item.linkedin || item.linkedin_url || '',
    companyWebsite: companyDomain,
    companyLinkedIn: item.companyLinkedIn || item.company_linkedin || '',
    companyDomain,
    companySize: item.companySize || item.company_size || '',
    companyIndustry,
    organization: {
      website: companyDomain,
      linkedinUrl: item.companyLinkedIn || item.company_linkedin || '',
      size: item.companySize || item.company_size || '',
      industry: companyIndustry,
      id: item.company_linkedin_uid || item.organizationId || ''
    },
    raw: item
  };
}

function getLeadDomain(lead) {
  const candidates = [
    lead.companyDomain,
    lead.company_domain,
    lead.companyWebsite,
    lead.company_website,
    lead.organization?.domain,
    lead.organization?.website,
    lead.raw?.company_domain,
    lead.raw?.companyWebsite,
    lead.raw?.company_website
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDomain(candidate);
    if (normalized) return normalized;
  }
  return '';
}

async function writeLeadsCsv(filePath, leads, companyName) {
  if (!leads.length) return;
  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'company', title: 'Company' },
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
      { id: 'companyWebsite', title: 'Company Website' },
      { id: 'companyLinkedIn', title: 'Company LinkedIn' },
      { id: 'companySize', title: 'Company Size' },
      { id: 'companyIndustry', title: 'Company Industry' },
      { id: 'organizationId', title: 'Organization ID' }
    ]
  });
  const records = leads.map((lead) => ({
    company: companyName,
    fullName: lead.fullName || '',
    firstName: lead.firstName || '',
    lastName: lead.lastName || '',
    email: lead.email || '',
    position: lead.position || '',
    seniority: lead.seniority || '',
    city: lead.city || '',
    state: lead.state || '',
    country: lead.country || '',
    linkedinUrl: lead.linkedinUrl || '',
    companyWebsite: lead.companyWebsite || '',
    companyLinkedIn: lead.companyLinkedIn || '',
    companySize: lead.companySize || '',
    companyIndustry: lead.companyIndustry || '',
    organizationId: lead.organization?.id || ''
  }));
  await csvWriter.writeRecords(records);
}

async function runCrawlerForSite(client, site) {
  const input = buildCrawlerInput(site);
  const run = await client.actor(WEBSITE_CRAWLER_ACTOR_ID).call(input);
  const datasetItems = await fetchDatasetItems(client, run.defaultDatasetId);
  return { run, datasetItems };
}

async function scrapeLeads(client, companies, decisionTitles, leadsPerCompany, maxDomainsPerCall) {
  if (!companies.length) return new Map();
  const domains = companies
    .map((company) => normalizeDomain(company.website))
    .filter(Boolean);
  if (!domains.length) return new Map();
  const chunks = paginate(domains, Math.max(1, maxDomainsPerCall));
  const leadsByDomain = new Map(domains.map((domain) => [domain, []]));
  for (const chunk of chunks) {
    const input = {
      company_domain: chunk,
      contact_job_title: decisionTitles,
      email_status: ['validated'],
      fetch_count: Math.min(leadsPerCompany * chunk.length, 5000)
    };
    try {
      const run = await client.actor(LEADS_FINDER_ACTOR_ID).call(input);
      const dataset = client.dataset(run.defaultDatasetId);
      const { items } = await dataset.listItems({ clean: true });
      const normalized = items.map(normalizeLead);
      normalized.forEach((lead) => {
        const domain = getLeadDomain(lead) || chunk[0];
        if (!leadsByDomain.has(domain)) leadsByDomain.set(domain, []);
        leadsByDomain.get(domain).push(lead);
      });
    } catch (error) {
      console.error(`🔴 Leads finder failed for domains: ${chunk.join(', ')}: ${error.message}`);
    }
  }
  return leadsByDomain;
}

async function main() {
  const options = parseArgs();
  const configSites = await fetchConfigSites(options.configPath);
  const entries = prepareSiteEntries(options.sites, configSites);
  if (!entries.length) {
    console.error('🔴 No websites provided. Use --sites or --config.');
    process.exit(1);
  }
  ensureDir(OUTPUT_ROOT);
  const runLabel = options.runName || `website-monitor-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(OUTPUT_ROOT, runLabel);
  ensureDir(runDir);
  const history = await loadHistory();
  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    console.error('🔴 Missing APIFY_TOKEN in environment.');
    process.exit(1);
  }
  const client = new ApifyClient({ token: apifyToken });
  const processedLeads = await loadProcessedLeads();
  const articles = [];
  for (const site of entries) {
    const siteSlug = slugify(site.label || site.url);
    const siteDir = path.join(runDir, siteSlug);
    ensureDir(siteDir);
    console.log(`🌐 Crawling ${site.url}`);
    try {
      const { datasetItems } = await runCrawlerForSite(client, site);
      await fsp.writeFile(path.join(siteDir, 'pages.json'), JSON.stringify(datasetItems, null, 2), 'utf8');
      const siteDomain = normalizeDomain(site.url);
      const newPages = collectNewPages(siteDomain, datasetItems, history);
      await fsp.writeFile(path.join(siteDir, 'new-pages.json'), JSON.stringify(newPages, null, 2), 'utf8');
      newPages.forEach((page) => {
        articles.push({
          siteDomain,
          siteLabel: site.label || site.url,
          url: page.url,
          title: page.title || page.pageTitle || '',
          markdown: page.markdown || page.text || '',
          firstSeenAt: new Date().toISOString()
        });
      });
    } catch (error) {
      console.error(`🔴 Failed to crawl ${site.url}: ${error.message}`);
    }
  }
  await saveHistory(history);
  if (!articles.length) {
    console.log('⚠️ No new content discovered.');
    return;
  }
  await fsp.writeFile(path.join(runDir, 'articles.json'), JSON.stringify(articles, null, 2), 'utf8');
  const companies = [];
  const geminiKey = process.env.GEMINI_API_KEY;
  const useGemini = geminiKey && !options.skipGemini;
  const model = useGemini ? new GoogleGenerativeAI(geminiKey).getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.2, topP: 0.9 }
  }) : null;
  for (const article of articles) {
    const siteDomain = article.siteDomain;
    const heuristics = extractCompanyByHeuristics(article, siteDomain).map((entry) => ({
      ...entry,
      sourceArticles: [article.siteLabel],
      articleUrls: [article.url]
    }));
    let resolved = heuristics;
    if (useGemini) {
      const needsGemini = !heuristics.some((entry) => entry.website);
      if (needsGemini) {
        const aiCompanies = await extractCompaniesWithGemini(model, article);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const transformed = aiCompanies.map((entry) => ({
          companyName: entry.companyName,
          website: entry.website,
          sourceArticles: [article.siteLabel],
          articleUrls: [article.url]
        }));
        if (transformed.length) resolved = transformed;
      }
    }
    if (!resolved.length && heuristics.length) resolved = heuristics;
    resolved.forEach((entry) => {
      companies.push({
        companyName: entry.companyName,
        website: entry.website,
        sourceArticles: entry.sourceArticles,
        articleUrls: entry.articleUrls
      });
    });
  }
  const consolidated = consolidateCompanies(companies)
    .map((item) => ({
      ...item,
      website: item.website,
      companyName: item.companyName,
      sourceArticles: item.sourceArticles,
      articleUrls: item.articleUrls,
      isDuplicate: isDuplicateLead(processedLeads, item.companyName, item.website, '')
    }))
    .filter((item) => !item.isDuplicate);
  await fsp.writeFile(path.join(runDir, 'companies.json'), JSON.stringify(consolidated, null, 2), 'utf8');
  if (!consolidated.length) {
    console.log('⚠️ No new companies identified.');
    return;
  }
  if (options.skipLeads || options.dryRun) {
    console.log('ℹ️ Leads scraping skipped.');
    return;
  }
  const leadsByDomain = await scrapeLeads(
    client,
    consolidated,
    options.decisionTitles,
    options.leadsPerCompany,
    options.maxDomainsPerCall
  );
  const leadsOutput = [];
  const companiesWithLeads = new Set();
  for (const company of consolidated) {
    const domain = normalizeDomain(company.website);
    if (!domain) continue;
    const leads = leadsByDomain.get(domain) || [];
    if (!leads.length) continue;
    const companyDir = path.join(runDir, slugify(domain));
    ensureDir(companyDir);
    await writeLeadsCsv(path.join(companyDir, 'leads.csv'), leads, company.companyName || domain);
    await fsp.writeFile(path.join(companyDir, 'leads.json'), JSON.stringify(leads, null, 2), 'utf8');
    leads.forEach((lead) => {
      leadsOutput.push({
        companyDomain: domain,
        companyName: company.companyName,
        lead
      });
    });
    companiesWithLeads.add(domain);
    for (const lead of leads) {
      if (lead.email && isDuplicateLead(processedLeads, company.companyName, company.website, lead.email)) continue;
      await logProcessedLead({
        companyName: company.companyName,
        website: company.website,
        email: lead.email || '',
        country: lead.country || '',
        state: lead.state || '',
        processor: 'websiteContentMonitor',
        qualified: '',
        verificationResult: '',
        employeeCount: company.leadsCount || '',
        sheetName: company.sourceArticles?.join('; ') || '',
        rowNumber: lead.linkedinUrl || ''
      });
      const identifier = lead.email || company.website || company.companyName;
      if (identifier) {
        const leadId = identifier.toLowerCase().trim();
        if (lead.email) processedLeads.add(`email:${leadId}`);
      }
    }
  }
  await fsp.writeFile(path.join(runDir, 'leads-summary.json'), JSON.stringify(leadsOutput, null, 2), 'utf8');
  console.log(`✅ Run complete: ${runDir}`);
  console.log(`🆕 Articles processed: ${articles.length}`);
  console.log(`🏢 Companies identified: ${consolidated.length}`);
  console.log(`👥 Companies with leads: ${companiesWithLeads.size}`);
}

main().catch((error) => {
  console.error('🔴 Website monitor failed:', error);
  process.exit(1);
});
