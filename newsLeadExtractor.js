import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import createCsvWriter from 'csv-writer';
import { loadProcessedLeads, isDuplicateLead, logProcessedLead } from './leadTracker.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_ROOT = path.join(__dirname, 'news_leads');

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
    runPath: getValue('--run') || getValue('--run-path'),
    outputName: getValue('--output-name'),
    skipDuplicates: !hasFlag('--include-duplicates'),
    dryRun: hasFlag('--dry-run')
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeCsv(filePath, leads) {
  if (!leads.length) return;

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'companyName', title: 'Company Name' },
      { id: 'website', title: 'Website' },
      { id: 'painPoint', title: 'Pain Point' },
      { id: 'articleTitle', title: 'Article Title' },
      { id: 'articleUrl', title: 'Article URL' },
      { id: 'articleDate', title: 'Article Date' },
      { id: 'source', title: 'Source' },
      { id: 'sentiment', title: 'Sentiment' },
      { id: 'isDuplicate', title: 'Is Duplicate' }
    ]
  });

  await csvWriter.writeRecords(leads);
}

function initGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('🔴 Missing GEMINI_API_KEY in environment.');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.3,
      topP: 0.95
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
    ]
  });
}

async function extractCompaniesFromArticle(model, article) {
  const prompt = `You are an expert lead generation analyst. Extract actionable company leads from this news article.

**Article Title:** ${article.title || 'N/A'}
**Published:** ${article.date || article.dateTime || 'N/A'}
**Source:** ${article.source?.title || 'N/A'}
**Article Body:**
${article.body || article.snippet || 'N/A'}

**Task:**
1. Identify all companies mentioned in the article (exclude generic references like "companies" or "firms")
2. For each company, extract:
   - Company name (exact as mentioned)
   - Primary pain point or challenge mentioned (be specific, max 100 chars)
   - Estimated website domain (best guess based on company name, format: example.com)

**Output Format (JSON array):**
[
  {
    "companyName": "Exact Company Name",
    "painPoint": "Specific challenge mentioned in article",
    "website": "bestguess.com"
  }
]

**Rules:**
- Only include companies with clear pain points or challenges
- Exclude: government agencies, NGOs, generic industry references
- If no companies found, return empty array: []
- Do NOT include explanations, only valid JSON

**Output:**`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    // Extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || text.match(/(\[[\s\S]*?\])/);
    if (!jsonMatch) {
      console.warn(`   ⚠️ No JSON found in response for article: ${article.title?.slice(0, 50)}`);
      return [];
    }

    const companies = JSON.parse(jsonMatch[1]);
    return Array.isArray(companies) ? companies : [];
  } catch (error) {
    console.error(`   🔴 Error extracting companies from article "${article.title?.slice(0, 50)}": ${error.message}`);
    return [];
  }
}

async function processArticles(articles, model, processedLeads, skipDuplicates) {
  const allLeads = [];
  let duplicateCount = 0;
  let newLeadCount = 0;

  for (let i = 0; i < articles.length; i += 1) {
    const article = articles[i];
    console.log(`\n📰 Processing article ${i + 1}/${articles.length}: ${article.title?.slice(0, 60)}...`);

    const companies = await extractCompaniesFromArticle(model, article);
    console.log(`   ✅ Found ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}`);

    for (const company of companies) {
      const isDupe = isDuplicateLead(processedLeads, company.companyName, company.website, '');

      if (isDupe && skipDuplicates) {
        console.log(`   🔄 Skipping duplicate: ${company.companyName}`);
        duplicateCount += 1;
        continue;
      }

      const lead = {
        companyName: company.companyName || '',
        website: company.website || '',
        painPoint: company.painPoint || '',
        articleTitle: article.title || '',
        articleUrl: article.url || '',
        articleDate: article.date || article.dateTime || '',
        source: article.source?.title || '',
        sentiment: article.sentiment ?? '',
        isDuplicate: isDupe ? 'Yes' : 'No'
      };

      allLeads.push(lead);

      if (!isDupe) {
        newLeadCount += 1;
        console.log(`   ✨ New lead: ${company.companyName} (${company.painPoint?.slice(0, 40)}...)`);
      } else {
        console.log(`   ⚠️ Duplicate (included): ${company.companyName}`);
      }
    }

    // Rate limit: 1 request per second
    if (i < articles.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { leads: allLeads, duplicateCount, newLeadCount };
}

async function logLeadsToTracker(leads) {
  for (const lead of leads) {
    if (lead.isDuplicate === 'Yes') continue;

    await logProcessedLead({
      companyName: lead.companyName,
      website: lead.website,
      email: '',
      country: '',
      state: '',
      processor: 'newsLeadExtractor',
      qualified: '',
      verificationResult: '',
      employeeCount: '',
      sheetName: lead.source,
      rowNumber: lead.articleUrl
    });
  }
}

async function main() {
  const options = parseArgs();

  if (!options.runPath) {
    console.error('🔴 Missing --run or --run-path parameter. Specify path to Event Registry run directory.');
    console.error('   Example: node newsLeadExtractor.js --run=event_registry_runs/food-tariffs');
    process.exit(1);
  }

  const runPath = path.resolve(options.runPath);
  const articlesPath = path.join(runPath, 'articles.json');

  try {
    await fsp.access(articlesPath);
  } catch {
    console.error(`🔴 Articles file not found: ${articlesPath}`);
    process.exit(1);
  }

  const articles = await readJson(articlesPath);
  console.log(`📚 Loaded ${articles.length} article(s) from ${runPath}`);

  if (!articles.length) {
    console.log('⚠️ No articles to process.');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputLabel = options.outputName || `news-leads-${timestamp}`;
  const outputDir = path.join(OUTPUT_ROOT, outputLabel);
  ensureDir(outputDir);

  console.log('\n🔍 Loading processed leads for duplicate detection...');
  const processedLeads = await loadProcessedLeads();
  console.log(`   ✅ Loaded ${processedLeads.size} existing lead identifiers`);

  if (options.dryRun) {
    console.log('\n🧪 Dry run - no extraction or logging performed.');
    console.log(`📁 Output directory prepared: ${outputDir}`);
    return;
  }

  const model = initGemini();
  console.log('\n🤖 Starting company extraction with Gemini...');

  const { leads, duplicateCount, newLeadCount } = await processArticles(
    articles,
    model,
    processedLeads,
    options.skipDuplicates
  );

  const summary = {
    runLabel: outputLabel,
    generatedAt: new Date().toISOString(),
    sourceRunPath: runPath,
    articlesProcessed: articles.length,
    totalLeadsExtracted: leads.length,
    newLeads: newLeadCount,
    duplicatesSkipped: duplicateCount,
    skipDuplicates: options.skipDuplicates
  };

  await writeJson(path.join(outputDir, 'extraction-summary.json'), summary);
  await writeJson(path.join(outputDir, 'leads.json'), leads);
  await writeCsv(path.join(outputDir, 'leads.csv'), leads);

  console.log('\n📝 Logging new leads to processed_leads.csv...');
  await logLeadsToTracker(leads);

  console.log('\n✅ Extraction complete!');
  console.log(`📊 Summary:`);
  console.log(`   - Articles processed: ${articles.length}`);
  console.log(`   - Total leads extracted: ${leads.length}`);
  console.log(`   - New leads: ${newLeadCount}`);
  console.log(`   - Duplicates ${options.skipDuplicates ? 'skipped' : 'included'}: ${duplicateCount}`);
  console.log(`\n📁 Output: ${outputDir}`);
  console.log(`📈 CSV: ${path.join(outputDir, 'leads.csv')}`);
  console.log(`📰 JSON: ${path.join(outputDir, 'leads.json')}`);
}

main().catch((error) => {
  console.error('🔴 Failed to extract news leads:', error);
  process.exit(1);
});
