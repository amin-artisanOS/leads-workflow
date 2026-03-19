import { google } from 'googleapis';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Setup ---
dotenv.config();

// Config
const CREDENTIALS_PATH = '/Users/aminb101/leads-workflow/iuh-content-and-ecom-systems-934f3f80d780.json';
const SPREADSHEET_ID = '1_rX2OWFpvSGFyR0EsIVZLuoxTKE5JX66Q5o6Z5_VCrg';
const SHEET_TITLE = '#1 clean machinery producers eu';
const INPUT_COLUMN_LETTER = 'AC'; // source column to clean
const DEFAULT_OUTPUT_COLUMN_LETTER = process.argv.find(a => a.startsWith('--out='))?.split('=')[1] || 'AC';
const START_ROW = parseInt((process.argv.find(a => a.startsWith('--start='))?.split('=')[1]) || '2', 10);
const END_ROW = parseInt((process.argv.find(a => a.startsWith('--end='))?.split('=')[1]) || '1001', 10); // inclusive upper bound for range end
const BATCH_SIZE = 25;

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Auth
async function sheetsAuth() {
  const auth = new google.auth.GoogleAuth({ keyFile: CREDENTIALS_PATH, scopes: SCOPES });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

// Column helpers
function letterToColumn(letter) {
  let col = 0;
  for (let i = 0; i < letter.length; i++) col = col * 26 + (letter.charCodeAt(i) - 64);
  return col - 1;
}
function columnToLetter(column) {
  let temp, letter = '';
  while (column >= 0) { temp = column % 26; letter = String.fromCharCode(temp + 65) + letter; column = Math.floor(column / 26) - 1; }
  return letter || 'A';
}

// Gemini
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  console.error('🔴 Missing GEMINI_API_KEY in .env');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  generationConfig: { maxOutputTokens: 256, temperature: 0.2 },
  safetySettings: [
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
  ]
});

const CLEAN_PROMPT = (name) => `You clean company names for a spreadsheet. Return ONLY the normalized company name with no extra words.
Rules:
- Trim whitespace and fix casing (Title Case for names, preserve all-caps acronyms like "IBM").
- Remove legal suffixes (Ltd, LLC, Incorporated, Inc., GmbH, AG, SA, SAS, BV, Sp. z o.o., Oy, AB, S.A., S.p.A., K.K., Co., KG, LLP, PLC, NV, Sarl, SARL, EOOD, OÜ, Kft, ApS, A/S, S.A.S.).
- Remove country/region tags in parentheses or after commas (e.g., "(France)", ", Germany").
- Remove descriptors like "Group", "Holdings", "International" ONLY if they appear as trailing corporate suffixes and the core brand remains clear. Keep them if part of official brand (use judgment).
- Remove emails, URLs, and contact words.
- If input is empty or clearly not a company, return empty string.
Input: ${name}`;

async function cleanName(raw) {
  const input = (raw || '').toString().trim();
  if (!input) return '';
  try {
    const resp = await model.generateContent(CLEAN_PROMPT(input));
    const text = (await resp.response).text().trim();
    // Safety: strip quotes
    return text.replace(/^"|"$/g, '').trim();
  } catch (e) {
    return input; // fallback to original on error
  }
}

async function run() {
  try {
    const sheets = await sheetsAuth();
    const readRange = `'${SHEET_TITLE}'!${INPUT_COLUMN_LETTER}${START_ROW}:${INPUT_COLUMN_LETTER}${END_ROW}`;
    const read = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: readRange });
    const rows = read.data.values || [];
    if (rows.length === 0) {
      console.log('No values found to clean.');
      return;
    }

    console.log(`Cleaning ${rows.length} names from ${SHEET_TITLE} ${INPUT_COLUMN_LETTER}${START_ROW}-${INPUT_COLUMN_LETTER}${END_ROW} -> ${DEFAULT_OUTPUT_COLUMN_LETTER}`);

    const cleanedRows = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map(r => (r && r[0]) ? r[0] : '');
      const results = await Promise.all(batch.map(cleanName));
      cleanedRows.push(...results.map(v => [v]));
    }

    const writeRange = `'${SHEET_TITLE}'!${DEFAULT_OUTPUT_COLUMN_LETTER}${START_ROW}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: writeRange,
      valueInputOption: 'RAW',
      resource: { values: cleanedRows }
    });

    console.log(`✅ Wrote ${cleanedRows.length} cleaned names to column ${DEFAULT_OUTPUT_COLUMN_LETTER}.`);
  } catch (err) {
    console.error('🔴 Error:', err.message);
    process.exit(1);
  }
}

run();
