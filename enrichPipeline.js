#!/usr/bin/env node

import path from 'path';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';
import { spawn } from 'child_process';
import readline from 'readline';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Google credentials and scope
const CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'iuh-content-and-ecom-systems-934f3f80d780.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    title: `Leads Enrichment ${new Date().toISOString().slice(0,10)}`,
    sheetName: 'Leads',
    csvs: [],
    csvDir: '',
    skipVerify: false,
    verifyOutputColumn: process.env.VERIFY_OUTPUT_COLUMN || 'AV',
    vertical: process.env.VERTICAL || '',
  };
  for (const a of args) {
    if (a.startsWith('--title=')) out.title = a.split('=')[1];
    else if (a.startsWith('--sheet-name=')) out.sheetName = a.split('=')[1];
    else if (a.startsWith('--csv=')) out.csvs = a.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
    else if (a.startsWith('--csv-dir=')) out.csvDir = a.split('=')[1];
    else if (a === '--skip-verify') out.skipVerify = true;
    else if (a.startsWith('--verify-output-col=')) out.verifyOutputColumn = a.split('=')[1];
    else if (a.startsWith('--vertical=')) out.vertical = a.split('=')[1];
  }
  return out;
}

async function getSheetsClient() {
  try {
    const auth = new google.auth.GoogleAuth({ keyFile: CREDENTIALS_PATH, scopes: SCOPES });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
  } catch (err) {
    console.error(`Error with Google credentials at ${CREDENTIALS_PATH}:`, err.message);
    process.exit(1);
  }
}

async function addSheetToSpreadsheet(spreadsheetId, sheetName) {
  const sheets = await getSheetsClient();
  
  // First, check if the sheet already exists
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(title))'
    });
    
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
    if (existingSheets.includes(sheetName)) {
      console.log(`📋 Sheet "${sheetName}" already exists, using existing sheet`);
      return spreadsheetId;
    }
  } catch (error) {
    console.error(`❌ Error checking existing sheets: ${error.message}`);
    throw error;
  }
  
  // Add new sheet to existing spreadsheet
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName,
              gridProperties: {
                rowCount: 2000,
                columnCount: 50,
                frozenRowCount: 1
              }
            }
          }
        }]
      }
    });
    
    console.log(`📄 Added new sheet "${sheetName}" to existing spreadsheet`);
    return spreadsheetId;
  } catch (error) {
    console.error(`❌ Error adding sheet: ${error.message}`);
    throw error;
  }
}

function unionHeaders(existing, incoming) {
  const map = new Map();
  const push = (arr) => arr.forEach((h) => { const key = (h || '').toString().trim(); if (key && !map.has(key)) map.set(key, true); });
  push(existing || []);
  push(incoming || []);
  return Array.from(map.keys());
}

async function readAllCSVs(csvPaths) {
  // Read and merge CSV contents; union of headers
  let headers = [];
  const rows = [];

  for (const p of csvPaths) {
    const full = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (!fs.existsSync(full)) {
      console.warn(`⚠️ CSV not found: ${full} (skipping)`);
      continue;
    }
    console.log(`📥 Reading CSV: ${full}`);
    await new Promise((resolve, reject) => {
      const localRows = [];
      let localHeaders = [];
      fs.createReadStream(full)
        .pipe(csvParser())
        .on('headers', (h) => { localHeaders = h; })
        .on('data', (row) => localRows.push(row))
        .on('end', () => {
          headers = unionHeaders(headers, localHeaders);
          rows.push(...localRows);
          resolve();
        })
        .on('error', reject);
    });
  }

  if (rows.length === 0) {
    throw new Error('No CSV rows found to upload.');
  }

  // Normalize rows to full header order
  const values = [ headers ];
  for (const r of rows) {
    const line = headers.map(h => (r[h] ?? '').toString());
    values.push(line);
  }
  return { headers, values };
}

function listCSVsInDir(dirPath) {
  const full = path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath);
  if (!fs.existsSync(full)) return [];
  const entries = fs.readdirSync(full, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.csv'))
    .map((e) => path.join(full, e.name));
}

const VERTICAL_KEYWORDS = {
  food: ['food', 'beverage', 'agricultur', 'dairy', 'meat', 'bakery', 'seafood', 'drink', 'nutrition'],
  metal: ['metal', 'steel', 'aluminum', 'iron', 'fabrication', 'foundry', 'forging', 'smelting', 'welding'],
  chemical: ['chemical', 'pharma', 'pharmaceutical', 'drug', 'biotech', 'laboratory', 'cosmetic', 'petro'],
  machinery: ['machinery', 'machine', 'equipment', 'industrial automation', 'mechanical', 'manufacturing equipment'],
};

function inferVerticalFromIndustry(headers, values, allowedVerticals) {
  const scores = Object.fromEntries(allowedVerticals.map((v) => [v, 0]));
  const industryIdx = headers.findIndex((h) => (h || '').toString().trim().toLowerCase() === 'industry');

  if (industryIdx === -1) {
    return { vertical: null, scores, foundIndustry: false };
  }

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const cell = (row[industryIdx] || '').toString().toLowerCase();
    if (!cell) continue;
    for (const vertical of allowedVerticals) {
      const keywords = VERTICAL_KEYWORDS[vertical] || [];
      if (keywords.some((keyword) => cell.includes(keyword))) {
        scores[vertical] += 1;
      }
    }
  }

  const maxScore = Math.max(...allowedVerticals.map((v) => scores[v] || 0));
  if (maxScore <= 0) {
    return { vertical: null, scores, foundIndustry: true };
  }

  const winners = allowedVerticals.filter((v) => scores[v] === maxScore);
  const vertical = winners.length === 1 ? winners[0] : null;
  return { vertical, scores, foundIndustry: true };
}

async function promptYesNo(question, defaultNo = true) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultNo ? ' (y/N): ' : ' (Y/n): ';
  return new Promise((resolve) => {
    rl.question(question + suffix, (answer) => {
      rl.close();
      const a = (answer || '').trim().toLowerCase();
      if (!a) return resolve(!defaultNo);
      if (['y', 'yes'].includes(a)) return resolve(true);
      if (['n', 'no'].includes(a)) return resolve(false);
      return resolve(!defaultNo);
    });
  });
}

async function promptSelect(question, options, defaultIndex = 0) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(question);
  options.forEach((opt, idx) => console.log(`  ${idx + 1}) ${opt}`));
  const promptText = `Choose 1-${options.length} [${defaultIndex + 1}]: `;
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      const n = parseInt((answer || '').trim(), 10);
      if (!isNaN(n) && n >= 1 && n <= options.length) return resolve(options[n - 1]);
      return resolve(options[defaultIndex]);
    });
  });
}

async function uploadToSheet(spreadsheetId, sheetName, values) {
  const sheets = await getSheetsClient();
  const range = `'${sheetName}'!A1`;
  console.log(`⬆️ Uploading ${values.length - 1} rows to ${sheetName}...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    resource: { values },
  });
  console.log('✅ Upload complete.');
}

function runNodeScript(scriptPath, envVars) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      env: { ...process.env, ...envVars },
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

async function main() {
  try {
    const { title, sheetName, csvs, csvDir, skipVerify, verifyOutputColumn, vertical } = parseArgs();

    // Determine CSV inputs: either explicit list, directory, or default lead_lists/
    let inputCSVs = [...csvs];
    if (csvDir) {
      // If csvDir is provided, use it
      const fullPath = path.isAbsolute(csvDir) ? csvDir : path.join(process.cwd(), csvDir);
      inputCSVs = listCSVsInDir(fullPath);
    } else if (inputCSVs.length === 0) {
      // Default to ./lead_lists if no specific directory provided
      const leadListsDir = path.join(process.cwd(), 'lead_lists');
      if (fs.existsSync(leadListsDir)) {
        inputCSVs = listCSVsInDir(leadListsDir);
      } else {
        // Fallback to csvs for backward compatibility
        const defaultDir = path.join(process.cwd(), 'csvs');
        if (fs.existsSync(defaultDir)) {
          inputCSVs = listCSVsInDir(defaultDir);
        }
      }
    }

    if (inputCSVs.length === 0) {
      console.error('❌ No CSV files found in the lead_lists folder.');
      console.error('   Place your CSV files in the lead_lists/ directory or specify a different location with --csv-dir=folder');
      console.error('\nUsage examples:');
      console.error('  npm run enrich  # Uses all CSVs from lead_lists/');
      console.error('  npm run enrich -- --title="My Leads"  # Custom title');
      console.error('  npm run enrich -- --csv-dir=other_folder  # Use different folder');
      console.error('  npm run enrich -- --skip-verify  # Skip email verification');
      process.exit(1);
    }

    const { headers, values } = await readAllCSVs(inputCSVs);

    // Determine vertical: prefer CLI/env override, otherwise auto-detect via industry column
    const allowedVerticals = ['food', 'metal', 'chemical', 'machinery'];
    let selectedVertical = vertical && allowedVerticals.includes(vertical.toLowerCase())
      ? vertical.toLowerCase()
      : '';

    if (!selectedVertical) {
      const detection = inferVerticalFromIndustry(headers, values, allowedVerticals);
      if (detection.foundIndustry) {
        console.log('🔎 Industry column scores:', detection.scores);
      } else {
        console.log('ℹ️ Industry column not found.');
      }

      if (detection.vertical) {
        selectedVertical = detection.vertical;
        console.log(`✅ Auto-detected vertical: ${selectedVertical}`);
      } else {
        console.log('ℹ️ Unable to auto-detect vertical confidently.');
      }
    }

    if (!selectedVertical) {
      selectedVertical = (await promptSelect('Select vertical for this enrichment run:', allowedVerticals, 0)).toLowerCase();
    }

    console.log(`\n🏷️ Vertical: ${selectedVertical}`);

    // 1) Use existing spreadsheet and add new sheet
    const existingSpreadsheetId = process.env.SPREADSHEET_ID;
    if (!existingSpreadsheetId) {
      console.error('❌ SPREADSHEET_ID not found in environment variables');
      console.error('   Please set SPREADSHEET_ID in your .env file');
      process.exit(1);
    }
    
    // Generate a unique sheet name with timestamp and vertical
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    const uniqueSheetName = `${selectedVertical}_leads_${timestamp}`;
    
    console.log(`📋 Using existing spreadsheet: ${existingSpreadsheetId}`);
    console.log(`📄 Creating new sheet: ${uniqueSheetName}`);
    
    const spreadsheetId = await addSheetToSpreadsheet(existingSpreadsheetId, uniqueSheetName);
    await uploadToSheet(spreadsheetId, uniqueSheetName, values);

    // 1b) Run Gemini research agent to enrich sheet before qualification
    console.log('\n🤖 Running Gemini research agent...');
    const geminiEnv = {
      SPREADSHEET_ID: spreadsheetId,
      SHEET_NAME: uniqueSheetName,
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || CREDENTIALS_PATH,
    };
    await runNodeScript(path.join(__dirname, 'geminiAgent.js'), geminiEnv);

    // 2) Run qualifier with env overrides
    console.log('\n📊 Found columns:', values[0].join(', '));
    console.log('📝 Processing', values.length - 1, 'leads...');
    console.log('\n🚀 Running lead qualification...');
    
    // Ensure all required environment variables are set
    const envVars = {
      // Use SPREADSHEET_ID as the primary variable name
      SPREADSHEET_ID: spreadsheetId,
      // Keep SHEET_ID for backward compatibility
      SHEET_ID: spreadsheetId,
      SHEET_NAME: uniqueSheetName,
      VERTICAL: selectedVertical,
      // Ensure the credentials path is passed through
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || CREDENTIALS_PATH,
      IGNORE_DUPLICATE_HISTORY: 'true',
    };
    
    console.log('Environment variables for lead qualifier:', JSON.stringify({
      SPREADSHEET_ID: '***',
      SHEET_NAME: uniqueSheetName,
      VERTICAL: selectedVertical,
      HAS_CREDENTIALS: !!envVars.GOOGLE_APPLICATION_CREDENTIALS
    }, null, 2));
    
    await runNodeScript(path.join(__dirname, 'leadQualifier.js'), envVars);

    // 3) Optionally run email verification
    let runVerify = !skipVerify;
    if (!skipVerify) {
      // Ask interactively
      runVerify = await promptYesNo('Run email verification now?', true);
    }

    if (runVerify) {
      console.log('\n🚀 Running email verification...');
      await runNodeScript(path.join(__dirname, 'millionVerifier.js'), {
        SHEET_ID: spreadsheetId,
        SPREADSHEET_ID: spreadsheetId, // for compatibility
        SHEET_NAME: uniqueSheetName,
        VERIFY_OUTPUT_COLUMN: verifyOutputColumn,
        VERTICAL: selectedVertical,
        GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || CREDENTIALS_PATH,
      });
    } else {
      console.log('\n⏭️ Skipping email verification as requested.');
    }

    console.log(`\n🎉 Enrichment pipeline complete! Spreadsheet ID: ${spreadsheetId} | Sheet: ${uniqueSheetName}`);
  } catch (err) {
    console.error('🔴 Pipeline failed:', err.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
