import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('🔴 Missing GEMINI_API_KEY in environment.');
  process.exit(1);
}

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
const DEFAULT_INPUT = path.resolve(process.cwd(), 'job_postings/eu_combined_temp.json');
const DEFAULT_QUALIFIED_OUTPUT = path.resolve(
  process.cwd(),
  'job_postings/eu_qualified_jobs_gemini.json'
);
const DEFAULT_REJECTED_OUTPUT = path.resolve(
  process.cwd(),
  'job_postings/eu_rejected_jobs_gemini.json'
);
const DEFAULT_APOLLO_OUTPUT = path.resolve(
  process.cwd(),
  'job_postings/apollo_input_candidates_gemini.json'
);

const DEFAULT_ALLOWED_TITLES = (process.env.GEMINI_ALLOWED_TITLES ||
  'Business Development Manager,Commercial Director,Regional Account Manager,Account Manager,International Sales Manager,Export Manager,Sales Director,Head of Sales')
  .split(',')
  .map((title) => title.trim())
  .filter(Boolean);

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

function createModel(modelName = DEFAULT_MODEL) {
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: Number(process.env.GEMINI_TEMPERATURE || 0.2),
      topP: Number(process.env.GEMINI_TOP_P || 0.9),
      maxOutputTokens: Number(process.env.GEMINI_MAX_TOKENS || 2048)
    }
  });
}

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

  const allowedTitlesArg = getValue('--titles');
  const allowedNichesArg = getValue('--niches');
  const allowedTitles = allowedTitlesArg
    ? allowedTitlesArg
        .split(',')
        .map((title) => title.trim())
        .filter(Boolean)
    : DEFAULT_ALLOWED_TITLES;

  const allowedNiches = allowedNichesArg
    ? allowedNichesArg
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : DEFAULT_ALLOWED_NICHES;

  return {
    inputPath: path.resolve(getValue('--input') || DEFAULT_INPUT),
    qualifiedOutput: path.resolve(getValue('--output-qualified') || DEFAULT_QUALIFIED_OUTPUT),
    rejectedOutput: path.resolve(getValue('--output-rejected') || DEFAULT_REJECTED_OUTPUT),
    apolloOutput: path.resolve(getValue('--output-apollo') || DEFAULT_APOLLO_OUTPUT),
    limit: Number(getValue('--limit') || 0),
    offset: Number(getValue('--offset') || 0),
    delayMs: Number(getValue('--delay') || process.env.GEMINI_DELAY_MS || 1500),
    dryRun: hasFlag('--dry-run'),
    allowedTitles,
    allowedNiches,
    model: getValue('--model') || DEFAULT_MODEL
  };
}

function sanitizeText(value, maxLength = 4000) {
  if (!value) return '';
  const text = value.toString().replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

const DEFAULT_ALLOWED_NICHES = (process.env.GEMINI_ALLOWED_NICHES ||
  'food producer,food manufacturing,food processing,food and beverage manufacturer,CPG food,metal producer,metal manufacturing,metallurgy,machinery producer,machinery manufacturing,industrial equipment manufacturer,chemical producer,Chemicals,pharmaceutical manufacturing,chemical processing')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function buildPrompt(job, options) {
  const allowedList = options.allowedTitles.map((title) => `- ${title}`).join('\n');
  const nicheList = options.allowedNiches.map((niche) => `- ${niche}`).join('\n');
  const description = sanitizeText(job.descriptionText || job.description || job.summary || '', 1600);
  const bulletSummary = [
    `Company: ${job.companyName || 'Unknown'}`,
    `Location: ${job.location || 'Unknown'}`,
    `Industries: ${sanitizeText(job.industries || job.industry || '', 300) || 'Unknown'}`,
    `Job Function: ${sanitizeText(job.jobFunction || job.jobFunctions || '', 200) || 'Unknown'}`,
    `Original Title: ${sanitizeText(job.title || '', 200) || 'Unknown'}`,
    `Description: ${description || 'Missing'}`
  ].join('\n');

  return `You are a lead qualification analyst for an international market expansion consultancy.

Decide if the following job posting represents a senior commercial or business development decision-maker who would benefit from services that help grow revenue in new markets (focus on B2B, international expansion, export growth).

Return ONLY a JSON object with the following keys:
{
  "qualified": true | false,
  "canonical_title": "<choose one of the allowed titles>",
  "niche_match": true | false,
  "reason": "<succinct 1-2 sentence justification>",
  "notes": "<optional extra context>"
}

Rules:
- Accept only mid-senior, director, or executive roles leading revenue, sales, partnerships, or market expansion.
- Reject staffing, recruiting, or agency postings unless they advertise an in-house leadership role at the end client with the client explicitly named.
- Reject roles outside the EU, roles focused purely on technical delivery, customer support, or non-commercial work.
- Reject if the company is a consumer retail venue or unrelated sector where B2B expansion services are irrelevant.
- The company must operate in one of the allowed lead-generation niches by explicit evidence in the job data: food producers, metal producers, machinery producers, or chemical producers. If the posting lacks evidence, set niche_match to false.
- If the job is qualified but niche_match is false, set qualified to false.
- If uncertain, return qualified: false.

Allowed canonical titles (choose the closest match in English):
${allowedList}

Allowed company niches (must be confirmed in the job data):
${nicheList}

Job posting data:
${bulletSummary}`;
}

async function evaluateJob(job, options, model) {
  const prompt = buildPrompt(job, options);
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    const jsonText = extractJson(text);
    const parsed = JSON.parse(jsonText);

    const nicheMatch = parsed.niche_match === true;
    const qualified = Boolean(parsed.qualified) && nicheMatch;
    const canonicalTitle = normalizeTitle(parsed.canonical_title, options.allowedTitles);
    const reason = sanitizeText(parsed.reason || parsed.notes || '');
    const notes = sanitizeText(parsed.notes || '');

    return {
      qualified,
      nicheMatch,
      canonicalTitle,
      reason,
      notes,
      raw: parsed
    };
  } catch (error) {
    console.error(`🔴 Gemini evaluation failed for ${job.companyName || 'Unknown'} :: ${job.title || 'Unknown'} - ${error.message}`);
    return {
      qualified: false,
      canonicalTitle: '',
      reason: `Gemini error: ${error.message}`,
      notes: ''
    };
  }
}

function extractJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    return match[0];
  }
  throw new Error('Gemini response did not contain JSON.');
}

function normalizeTitle(value, allowedTitles) {
  if (!allowedTitles.length) return value || '';
  if (!value) return allowedTitles[0];

  const normalized = value.toString().trim().toLowerCase();
  const exact = allowedTitles.find((title) => title.toLowerCase() === normalized);
  if (exact) return exact;

  const words = new Set(normalized.split(/[^a-z0-9]+/g).filter(Boolean));
  let bestMatch = allowedTitles[0];
  let bestScore = -1;

  allowedTitles.forEach((title) => {
    const titleWords = title.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
    const score = titleWords.reduce((acc, word) => (words.has(word) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = title;
    }
  });

  return bestMatch;
}

async function ensureDir(filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

async function saveJson(filePath, data) {
  await ensureDir(filePath);
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function prepareApolloEntries(qualifiedJobs, allowedTitles) {
  const map = new Map();
  qualifiedJobs.forEach((job) => {
    const companyKey = (job.companyName || '').toLowerCase();
    if (map.has(companyKey)) return;

    const icpTitles = (Array.isArray(job.icpTitles) && job.icpTitles.length)
      ? job.icpTitles
      : (Array.isArray(allowedTitles) && allowedTitles.length
        ? allowedTitles
        : []);

    const positions = icpTitles.length
      ? icpTitles
      : [job.canonicalTitle || job.title || 'Sales Director'];

    map.set(companyKey, {
      companyName: job.companyName || '',
      companyWebsite: job.companyWebsite || job.companyUrl || job.website || '',
      positions,
      position: positions.join(' OR '),
      icpTitles,
      location: job.location || '',
      link: job.link || job.url || '',
      industries: job.industries || job.industry || '',
      jobFunction: job.jobFunction || job.jobFunctions || '',
      geminiReason: job.geminiReason || '',
      geminiNotes: job.geminiNotes || '',
      source: job.source || ''
    });
  });
  return Array.from(map.values());
}

async function qualifyJobs(options) {
  const effectiveOptions = {
    inputPath: options.inputPath || DEFAULT_INPUT,
    qualifiedOutput: options.qualifiedOutput || DEFAULT_QUALIFIED_OUTPUT,
    rejectedOutput: options.rejectedOutput || DEFAULT_REJECTED_OUTPUT,
    apolloOutput: options.apolloOutput || DEFAULT_APOLLO_OUTPUT,
    limit: Number(options.limit || 0),
    offset: Number(options.offset || 0),
    delayMs: Number(options.delayMs || process.env.GEMINI_DELAY_MS || 1500),
    dryRun: Boolean(options.dryRun),
    allowedTitles: (options.allowedTitles && options.allowedTitles.length)
      ? options.allowedTitles
      : DEFAULT_ALLOWED_TITLES,
    allowedNiches: (options.allowedNiches && options.allowedNiches.length)
      ? options.allowedNiches
      : DEFAULT_ALLOWED_NICHES,
    model: options.model || DEFAULT_MODEL
  };

  const modelInstance = createModel(effectiveOptions.model);

  let raw;
  try {
    raw = await fs.promises.readFile(effectiveOptions.inputPath, 'utf8');
  } catch (error) {
    console.error(`🔴 Unable to read input file: ${effectiveOptions.inputPath}`);
    console.error(error.message);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    console.error(`🔴 Failed to parse JSON from ${effectiveOptions.inputPath}`);
    console.error(error.message);
    process.exit(1);
  }

  const records = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  if (!records.length) {
    console.error('🔴 No records found in input file.');
    process.exit(1);
  }

  const startIndex = Math.max(effectiveOptions.offset, 0);
  let jobs = records.slice(startIndex);
  if (effectiveOptions.limit > 0) {
    jobs = jobs.slice(0, effectiveOptions.limit);
  }

  if (!jobs.length) {
    console.error('🔴 No jobs to process after applying offset/limit.');
    process.exit(1);
  }

  console.log(`🔍 Evaluating ${jobs.length} job postings with Gemini (${effectiveOptions.model})...`);

  const qualified = [];
  const rejected = [];

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const company = job.companyName || 'Unknown company';
    const originalTitle = job.title || 'Unknown title';
    const location = job.location || 'Unknown location';
    console.log(`→ [${i + 1}/${jobs.length}] ${company} :: ${originalTitle} (${location})`);

    if (effectiveOptions.dryRun) {
      console.log('   🧪 Dry run mode - skipping Gemini call.');
      continue;
    }

    const evaluation = await evaluateJob(job, effectiveOptions, modelInstance);

    if (evaluation.qualified) {
      console.log(`   ✅ Qualified as ${evaluation.canonicalTitle}`);
      qualified.push({
        ...job,
        canonicalTitle: evaluation.canonicalTitle,
        nicheMatch: evaluation.nicheMatch,
        geminiReason: evaluation.reason,
        geminiNotes: evaluation.notes,
        icpTitles: effectiveOptions.allowedTitles
      });
    } else {
      console.log(`   ❌ Rejected - ${evaluation.reason || 'Does not fit criteria'}`);
      rejected.push({
        ...job,
        canonicalTitle: evaluation.canonicalTitle,
        nicheMatch: evaluation.nicheMatch,
        geminiReason: evaluation.reason,
        geminiNotes: evaluation.notes
      });
    }

    if (effectiveOptions.delayMs > 0 && i < jobs.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, effectiveOptions.delayMs));
    }
  }

  if (effectiveOptions.dryRun) {
    console.log('🧪 Dry run complete. No files written.');
    return {
      qualified: [],
      rejected: [],
      apolloEntries: [],
      options: effectiveOptions,
      dryRun: true
    };
  }

  await saveJson(effectiveOptions.qualifiedOutput, qualified);
  await saveJson(effectiveOptions.rejectedOutput, rejected);

  const apolloEntries = prepareApolloEntries(qualified, effectiveOptions.allowedTitles);
  await saveJson(effectiveOptions.apolloOutput, apolloEntries);

  console.log('📄 Outputs written:');
  console.log(`   Qualified jobs: ${effectiveOptions.qualifiedOutput} (${qualified.length})`);
  console.log(`   Rejected jobs: ${effectiveOptions.rejectedOutput} (${rejected.length})`);
  console.log(`   Apollo input: ${effectiveOptions.apolloOutput} (${apolloEntries.length})`);

  return {
    qualified,
    rejected,
    apolloEntries,
    options: effectiveOptions,
    dryRun: false
  };
}

export async function runGeminiQualification(overrides = {}) {
  return qualifyJobs(overrides);
}

if (import.meta.url === `file://${__filename}`) {
  const cliOptions = parseArgs();
  runGeminiQualification(cliOptions).catch((error) => {
    console.error('🔴 Unhandled error in Gemini job qualifier:', error);
    process.exit(1);
  });
}
