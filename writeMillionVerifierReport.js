import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

// --- Basic Setup ---
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const CREDENTIALS_PATH = '/Users/aminb101/leads-workflow/iuh-content-and-ecom-systems-934f3f80d780.json';
const SPREADSHEET_ID = '1_rX2OWFpvSGFyR0EsIVZLuoxTKE5JX66Q5o6Z5_VCrg';
const SHEET_NAME = 'pharma chem companies 1st 500';
const OUTPUT_COLUMN = 'AV'; // Column to write MillionVerifier results
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// --- Google Sheets Authentication ---
const auth = async () => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: SCOPES,
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
  } catch (err) {
    console.error(`🔴 Error loading service account credentials from: ${CREDENTIALS_PATH}`);
    console.error("Hint: Ensure the path is correct and you have shared your Google Sheet with the service account's client_email.");
    process.exit(1);
  }
};

// Helper to convert column index to letter (e.g., 0 -> 'A')
function columnToLetter(column) {
  let temp, letter = '';
  while (column >= 0) {
    temp = column % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = Math.floor(column / 26) - 1;
  }
  return letter || 'A';
}

// Reads emails from the sheet and builds a map email(lowercased) -> row number
async function readEmailsFromSheet() {
  const sheets = await auth();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!1:501`, // 1 header + 500 rows
  });
  const rows = response.data.values || [];
  if (rows.length === 0) throw new Error('No data found in the sheet');

  const headers = rows[0];
  const emailColumnIndex = headers.findIndex(h => h && h.toLowerCase().includes('email'));
  if (emailColumnIndex === -1) throw new Error('No email column found');
  console.log(`📧 Found email column: ${headers[emailColumnIndex]} (Column ${columnToLetter(emailColumnIndex)})`);

  const emails = [];
  const emailRowMap = new Map();
  for (let i = 1; i < rows.length; i++) {
    const val = rows[i] && rows[i][emailColumnIndex] ? rows[i][emailColumnIndex].trim() : '';
    const email = val.toLowerCase();
    if (email && email.includes('@')) {
      emails.push(email);
      emailRowMap.set(email, i + 1); // 1-indexed
    }
  }
  console.log(`📊 Found ${emails.length} valid email addresses in sheet`);
  return { emails, emailRowMap };
}

// Parses MillionVerifier CSV and writes results to the sheet
async function writeResultsFromLocalCSV(csvPath, emailRowMap) {
  const sheets = await auth();
  const resolved = path.isAbsolute(csvPath) ? csvPath : path.join(__dirname, csvPath);
  console.log(`📄 Reading local report: ${resolved}`);
  const raw = await fsp.readFile(resolved, 'utf8');

  // Handle BOM and JSON error bodies
  const text = typeof raw === 'string' ? raw : String(raw);
  if (text.trim().startsWith('{')) {
    throw new Error(`Local report appears to be JSON: ${text}`);
  }
  const cleaned = text.replace(/^\ufeff/, '');
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error('Local report seems empty');

  // Detect delimiter
  const headerLine = lines[0];
  const delimiter = headerLine.includes(',') ? ',' : (headerLine.includes(';') ? ';' : '\t');
  const headers = headerLine.split(delimiter).map(h => h.replace(/^\"|\"$/g, '').trim());
  console.log(`🧾 Results headers: ${headers.join(' | ')}`);
  console.log(`🔎 Detected delimiter: '${delimiter === '\t' ? 'TAB' : delimiter}'`);

  // Columns and target field selection
  const emailIdx = headers.findIndex(h => h.toLowerCase().includes('email'));
  const argField = (process.argv || []).find(a => a.startsWith('--field='));
  const requestedField = argField ? argField.split('=')[1].toLowerCase() : 'quality'; // default to 'quality'
  // Try to locate the requested field first
  const findHeaderIndex = (predicate) => headers.findIndex(h => predicate(h.toLowerCase()));
  let targetIdx = -1;
  if (requestedField === 'quality') {
    targetIdx = findHeaderIndex(s => s.includes('quality'));
    if (targetIdx === -1) {
      // fallback to result-like fields
      targetIdx = findHeaderIndex(s => s.includes('result') || s.includes('status') || s.includes('verdict') || s.includes('grade') || s.includes('state'));
    }
  } else if (requestedField === 'result') {
    targetIdx = findHeaderIndex(s => s.includes('result') || s.includes('status') || s.includes('verdict') || s.includes('grade') || s.includes('state'));
    if (targetIdx === -1) {
      // fallback to quality
      targetIdx = findHeaderIndex(s => s.includes('quality'));
    }
  } else {
    // generic: try exact match, then quality, then result-like
    targetIdx = findHeaderIndex(s => s === requestedField);
    if (targetIdx === -1) targetIdx = findHeaderIndex(s => s.includes('quality'));
    if (targetIdx === -1) targetIdx = findHeaderIndex(s => s.includes('result') || s.includes('status') || s.includes('verdict') || s.includes('grade') || s.includes('state'));
  }

  if (emailIdx === -1 || targetIdx === -1) {
    throw new Error(`Could not find email or target column ('${requestedField}') in local report. Headers: ${headers.join(' | ')}`);
  }
  console.log(`📝 Writing field: '${headers[targetIdx]}' -> column ${OUTPUT_COLUMN}`);

  // Check if we should only write 'ok' values (others blank)
  const okOnly = (process.argv || []).some(a => a === '--ok-only');

  // Prepare updates
  const updates = [];
  let matched = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.replace(/^\"|\"$/g, '').trim());
    if (cols.length <= Math.max(emailIdx, targetIdx)) continue;
    const email = (cols[emailIdx] || '').toLowerCase();
    let result = (cols[targetIdx] || 'unknown').trim();
    if (okOnly) {
      result = result.toLowerCase() === 'ok' ? 'ok' : '';
    }
    const rowNumber = emailRowMap.get(email);
    if (rowNumber) {
      updates.push({ range: `'${SHEET_NAME}'!${OUTPUT_COLUMN}${rowNumber}`, values: [[result]] });
      matched++;
    }
  }

  if (updates.length === 0) {
    console.warn('⚠️ No matching rows found to update. Check headers/delimiter and email casing. Sample:');
    const sample = lines.slice(0, Math.min(5, lines.length));
    sample.forEach((l, idx) => console.warn(`${idx}: ${l}`));
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { valueInputOption: 'RAW', data: updates },
  });
  console.log(`✅ Updated ${updates.length} rows (matched ${matched} emails) into column ${OUTPUT_COLUMN} on '${SHEET_NAME}'.`);
}

async function main() {
  try {
    // Determine CSV path
    const arg = (process.argv || []).find(a => a.startsWith('--report='));
    const csvPath = arg ? arg.split('=')[1] : 'emails_FULL_REPORT_MILLIONVERIFIER.COM.csv';

    console.log('📖 Reading emails from Google Sheets...');
    const { emailRowMap } = await readEmailsFromSheet();

    await writeResultsFromLocalCSV(csvPath, emailRowMap);
    console.log('🎉 Done.');
  } catch (err) {
    console.error(`🔴 Error: ${err.message}`);
    process.exit(1);
  }
}

main();
