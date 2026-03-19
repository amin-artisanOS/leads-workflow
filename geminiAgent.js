// geminiAgent.js
// Import necessary libraries
import path from 'path';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Basic Setup ---
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const DEFAULT_CREDENTIALS_FILENAME = 'iuh-content-and-ecom-systems-934f3f80d780.json';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    sheetName: process.env.SHEET_NAME || '',
    spreadsheetId: process.env.SPREADSHEET_ID || '',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  };

  for (const arg of args) {
    if (arg.startsWith('--sheet-name=')) config.sheetName = arg.split('=')[1];
    else if (arg.startsWith('--spreadsheet-id=')) config.spreadsheetId = arg.split('=')[1];
    else if (arg.startsWith('--credentials=')) config.credentialsPath = arg.split('=')[1];
  }

  if (!config.credentialsPath) {
    const fallback = path.join(process.cwd(), DEFAULT_CREDENTIALS_FILENAME);
    const alt = path.join(__dirname, DEFAULT_CREDENTIALS_FILENAME);
    config.credentialsPath = fs.existsSync(fallback) ? fallback : alt;
  }

  if (!config.spreadsheetId) {
    throw new Error('SPREADSHEET_ID not provided. Pass --spreadsheet-id= or set SPREADSHEET_ID in the environment.');
  }

  if (!config.sheetName) {
    throw new Error('SHEET_NAME not provided. Pass --sheet-name= or set SHEET_NAME in the environment.');
  }

  return config;
}

const { spreadsheetId: SPREADSHEET_ID, sheetName: SHEET_NAME, credentialsPath: CREDENTIALS_PATH } = parseArgs();

// --- Column Configuration ---
// These will be populated by detecting the actual column indices
let COLUMNS = {
    // Input columns (will be detected)
    WEBSITE: null,
    LINKEDIN: null,
    // Output columns (will be calculated)
    STRUCTURED_DATA: null,
    ANALYSIS: null
};

// Column headers to look for
const COLUMN_HEADERS = {
    WEBSITE: 'Company Website Full',
    LINKEDIN: 'Company LinkedIn Link',
    EMPLOYEE_COUNT: 'Employee Count',
    QUALIFIED: 'Employee Count' // Will use Employee Count column for now since there's no Qualified column
};

// Optional direct column mappings. If not provided, detection will fall back to header names.
const DIRECT_COLUMNS = {
    WEBSITE: process.env.GEMINI_WEBSITE_COLUMN || '',
    LINKEDIN: process.env.GEMINI_LINKEDIN_COLUMN || '',
    EMPLOYEE_COUNT: process.env.GEMINI_EMPLOYEE_COLUMN || '',
    STRUCTURED_DATA: process.env.GEMINI_STRUCTURED_COLUMN || '',
    ANALYSIS: process.env.GEMINI_ANALYSIS_COLUMN || ''
};

// --- Batching and Rate Limiting ---
const BATCH_SIZE = 10; // Process 10 URLs at a time
const DELAY_MS = 1000; // 1-second delay between each API call to avoid rate limits
const MAX_LEADS_PER_RUN = parseInt(process.env.GEMINI_MAX_LEADS || '600', 10);

const LOG_SUMMARY_LENGTH = parseInt(process.env.GEMINI_LOG_SUMMARY_LEN || '200', 10);

function truncateForLog(text = '', maxLen = LOG_SUMMARY_LENGTH) {
  if (!text) return '';
  const cleaned = text.toString().replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen)}…`;
}

// --- Gemini AI Initialization ---
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  console.error("🔴 Error: GEMINI_API_KEY not found in .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(geminiApiKey);

// Model for summarizing URLs with Google Search
const modelForSummary = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    maxOutputTokens: 65535,
    temperature: 1,
    topP: 0.95,
  },
  safetySettings: [
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
  ],
  tools: [{ googleSearch: {} }]
});

// Model for analysis (without search)
const modelForAnalysis = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    maxOutputTokens: 65535,
    temperature: 1,
    topP: 0.95,
  },
  safetySettings: [
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
  ]
});


// --- Google Sheets Authentication (Service Account) ---

/**
 * Initializes Google Sheets API authentication using a service account.
 * @returns {Promise<object>} An authenticated Google Sheets API client.
 */
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


// --- Core Logic ---

// Helper function to add a delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to convert column letter to number (e.g., 'AP' -> 41, 'Z' -> 25)
function letterToColumn(letter) {
    let column = 0;
    for (let i = 0; i < letter.length; i++) {
        column = column * 26 + (letter.charCodeAt(i) - 64);
    }
    return column - 1;
}

// Helper function to convert column index to letter (e.g., 0 -> 'A', 25 -> 'Z', 26 -> 'AA')
function columnToLetter(column) {
    let temp, letter = '';
    while (column >= 0) {
        temp = column % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        column = Math.floor(column / 26) - 1;
    }
    return letter || 'A';
}


/**
 * STEP 1: Extracts structured data from a company's website and LinkedIn.
 * @param {string} websiteUrl The company's website URL.
 * @param {string} linkedinUrl The company's LinkedIn URL.
 * @returns {Promise<string>} A string of structured data or an error message.
 */
async function extractCompanyData(websiteUrl, linkedinUrl) {
  if (!websiteUrl) {
    return 'FAIL TO SCRAPE: Missing website URL.';
  }

  const prompt = `You are an expert data extractor. Your role is to extract specific, structured information about a pharmaceutical/chemical company by using your search capabilities to crawl its website and LinkedIn profile. Your focus is on collecting data to determine if this company is a potential lead for international market expansion services.

Crawl the company's website and LinkedIn profile to extract the following details:

1.  **Location:** The country where the company is headquartered or has its main operations.
2.  **Company Size:** The number of employees. Specify the source if possible (e.g., LinkedIn).
3.  **Products/Services:** A concise list of their main pharmaceutical or chemical products, focusing on drug manufacturing, chemical compounds, or related offerings
4.  **Key Industries Served:** The primary industries their customers are in (healthcare, biotech, etc.)
5.  **Social Proof:** List any awards, certifications (FDA, EMA), or major media coverage mentioned (e.g., "Forbes," "Industry Award 2023").

**Company Website:** ${websiteUrl}
**Company LinkedIn URL:** ${linkedinUrl || 'Not Provided'}

**Rules:**
- Output only the structured text based on the fields above.
- If you cannot find a specific piece of information for a field, output "Unable to locate" for that field.
- Never make up information.
- If you cannot access or scrape the provided URLs, output only "FAIL TO SCRAPE".`;

  try {
    const result = await modelForSummary.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log(`   ✅ Data extracted for: ${websiteUrl}`);
    return text;
  } catch (error) {
    console.error(`🔴 Error during data extraction for ${websiteUrl}:`, error.message);
    return 'Error during data extraction.';
  }
}

/**
 * STEP 2: Analyzes structured data to determine lead generation fit.
 * @param {string} structuredData The structured data extracted in Step 1.
 * @returns {Promise<string>} "YES", "NO", or an error message.
 */
async function analyzeExtractedData(structuredData) {
    if (!structuredData || structuredData.startsWith('Error:') || structuredData.startsWith('FAIL TO SCRAPE')) {
        return 'N/A'; // Cannot analyze invalid data
    }

    const prompt = `You are an expert market analyst specializing in the pharmaceutical and chemical industry. Your task is to analyze the following structured company data and determine if they are a strong candidate for a lead generation service. This service helps pharmaceutical and chemical companies expand into new international markets and find new business opportunities.

Analyze the data based on these strict rules:

**Rule 1: Location (Important)**
The "Location" should preferably be in Europe, North America, or other developed markets. If it is "Unable to locate", consider other factors.

**Rule 2: Business Model**
The "Products/Services" MUST be related to producing, manufacturing, or developing pharmaceutical products, chemical compounds, or related services. They should not be just a distributor or software company.

**Rule 3: High-Value Indicators**
The company must meet Rule 2, AND the "Key Industries Served" or "Products/Services" should suggest they serve healthcare, biotech, or other high-value markets.

**Decision:**
- If the company meets all the requirements (Rule 1, Rule 2, and Rule 3), output ONLY "YES".
- If the company fails ANY of these rules, output ONLY "NO".

**Structured Company Data:**
${structuredData}

DO NOT OUTPUT ANYTHING ELSE.`;

    try {
        const result = await modelForAnalysis.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim().toUpperCase();
        
        if (text.includes('YES')) {
            console.log(`   ✅ Lead Gen Analysis result: YES`);
            return 'YES';
        }
        if (text.includes('NO')) {
            console.log(`   ✅ Lead Gen Analysis result: NO`);
            return 'NO';
        }
        console.warn(`   ⚠️ Lead Gen Analysis returned unexpected text: "${text}"`);
        return text;
    } catch (error) {
        console.error(`🔴 Error during Lead Gen analysis:`, error.message);
        return 'Error during analysis';
    }
}


/**
 * Main function to authenticate, read from sheet, and process both steps.
 */
/**
 * Detects column indices based on header row. If DIRECT_COLUMNS are not provided,
 * uses header keywords. It also ensures two output columns exist at the end and writes their headers.
 */
async function detectColumns(sheets, spreadsheetId, sheetTitle) {
  // Read header row
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!1:1`,
  });
  const headerRow = (headerResp.data.values && headerResp.data.values[0]) || [];
  const norm = (s) => (s || '').toString().trim().replace(/^"+|"+$/g, '').toLowerCase();

  // Helper find by keywords
  const findIdx = (keywords) => {
    const lower = headerRow.map(norm);
    for (let i = 0; i < lower.length; i++) {
      const h = lower[i];
      if (!h) continue;
      for (const kw of keywords) {
        if (h === kw || h.includes(kw)) return i;
      }
    }
    return -1;
  };

  // Inputs: allow env-direct letters first
  if (DIRECT_COLUMNS.WEBSITE) COLUMNS.WEBSITE = letterToColumn(DIRECT_COLUMNS.WEBSITE);
  if (DIRECT_COLUMNS.LINKEDIN) COLUMNS.LINKEDIN = letterToColumn(DIRECT_COLUMNS.LINKEDIN);
  if (DIRECT_COLUMNS.EMPLOYEE_COUNT) COLUMNS.EMPLOYEE_COUNT = letterToColumn(DIRECT_COLUMNS.EMPLOYEE_COUNT);

  if (COLUMNS.WEBSITE == null) {
    COLUMNS.WEBSITE = findIdx(['organization_primary_domain', 'organization_website_url', 'website', 'url', 'domain']);
  }
  if (COLUMNS.LINKEDIN == null) {
    COLUMNS.LINKEDIN = findIdx(['organization_linkedin_url', 'linkedin_url', 'linkedin']);
  }
  if (COLUMNS.EMPLOYEE_COUNT == null) {
    COLUMNS.EMPLOYEE_COUNT = findIdx(['estimated_num_employees', 'employee count', 'employees']);
  }

  // Outputs: use env if provided; else append two new columns at the end
  const currentCols = headerRow.length;
  if (DIRECT_COLUMNS.STRUCTURED_DATA) {
    COLUMNS.STRUCTURED_DATA = letterToColumn(DIRECT_COLUMNS.STRUCTURED_DATA);
  }
  if (DIRECT_COLUMNS.ANALYSIS) {
    COLUMNS.ANALYSIS = letterToColumn(DIRECT_COLUMNS.ANALYSIS);
  }
  let willAppendHeaders = false;
  if (COLUMNS.STRUCTURED_DATA == null || COLUMNS.ANALYSIS == null) {
    // Append at the end
    if (COLUMNS.STRUCTURED_DATA == null) COLUMNS.STRUCTURED_DATA = currentCols; // 0-based
    if (COLUMNS.ANALYSIS == null) COLUMNS.ANALYSIS = currentCols + 1;
    willAppendHeaders = true;
  }

  // If appending, write headers
  if (willAppendHeaders) {
    const startCol = columnToLetter(COLUMNS.STRUCTURED_DATA);
    const headersRange = `'${sheetTitle}'!${startCol}1:${columnToLetter(COLUMNS.ANALYSIS)}1`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headersRange,
      valueInputOption: 'RAW',
      resource: { values: [[ 'Gemini Structured', 'Gemini Analysis' ]] },
    });
    console.log(`📄 Added Gemini output headers at columns ${startCol} and ${columnToLetter(COLUMNS.ANALYSIS)}`);
  }

  console.log('Detected column indices:', {
    website: { index: COLUMNS.WEBSITE, letter: columnToLetter(COLUMNS.WEBSITE) },
    linkedin: { index: COLUMNS.LINKEDIN, letter: columnToLetter(COLUMNS.LINKEDIN) },
    employeeCount: { index: COLUMNS.EMPLOYEE_COUNT, letter: columnToLetter(COLUMNS.EMPLOYEE_COUNT) },
    structuredData: { index: COLUMNS.STRUCTURED_DATA, letter: columnToLetter(COLUMNS.STRUCTURED_DATA) },
    analysis: { index: COLUMNS.ANALYSIS, letter: columnToLetter(COLUMNS.ANALYSIS) },
  });
}

async function processSheet() {
  try {
    const sheets = await auth();
    const spreadsheetId = SPREADSHEET_ID;
    const sheetTitle = SHEET_NAME;

    console.log(`\nProcessing sheet: "${sheetTitle}"`);

    await detectColumns(sheets, spreadsheetId, sheetTitle);

    const lastColumnIndex = Math.max(
      COLUMNS.WEBSITE ?? 0,
      COLUMNS.LINKEDIN ?? 0,
      COLUMNS.EMPLOYEE_COUNT ?? 0,
      COLUMNS.STRUCTURED_DATA ?? 0,
      COLUMNS.ANALYSIS ?? 0
    );
    const lastColumn = columnToLetter(lastColumnIndex);
    const readRange = `'${sheetTitle}'!A2:${lastColumn}`;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: readRange });
    const sheetRows = response.data.values || [];

    if (sheetRows.length === 0) {
      console.log('No data found in website or LinkedIn columns. Exiting.');
      process.exit(0);
    }

    const structuredColLetter = columnToLetter(COLUMNS.STRUCTURED_DATA);
    const analysisColLetter = columnToLetter(COLUMNS.ANALYSIS);

    let skippedAlreadyProcessed = 0;
    let skippedMissingWebsite = 0;
    const rowsToProcess = [];

    for (let idx = 0; idx < sheetRows.length; idx++) {
      if (rowsToProcess.length >= MAX_LEADS_PER_RUN) break;

      const row = sheetRows[idx] || [];
      const rowIndex = idx + 2; // +1 for header, +1 for 1-based indexing
      const websiteCell = (row[COLUMNS.WEBSITE] || '').trim();
      const structuredExisting = (row[COLUMNS.STRUCTURED_DATA] || '').trim();
      const analysisExisting = (row[COLUMNS.ANALYSIS] || '').trim();

      if (structuredExisting || analysisExisting) {
        skippedAlreadyProcessed += 1;
        continue;
      }

      if (!websiteCell) {
        skippedMissingWebsite += 1;
        continue;
      }

      rowsToProcess.push({
        rowIndex,
        websiteUrl: websiteCell,
        linkedinUrl: (row[COLUMNS.LINKEDIN] || '').trim(),
      });
    }

    if (rowsToProcess.length === 0) {
      console.log('No eligible rows left to process. All leads may already be enriched or missing website URLs.');
      if (skippedAlreadyProcessed) {
        console.log(`   Skipped ${skippedAlreadyProcessed} rows that already had Gemini output.`);
      }
      if (skippedMissingWebsite) {
        console.log(`   Skipped ${skippedMissingWebsite} rows without website URLs.`);
      }
      process.exit(0);
    }

    console.log(`Found ${rowsToProcess.length} eligible companies to process (max ${MAX_LEADS_PER_RUN} per run).`);
    if (skippedAlreadyProcessed) {
      console.log(`   Skipped ${skippedAlreadyProcessed} rows with existing Gemini data.`);
    }
    if (skippedMissingWebsite) {
      console.log(`   Skipped ${skippedMissingWebsite} rows without website URLs.`);
    }

    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;
    const updates = [];

    for (let i = 0; i < rowsToProcess.length; i += BATCH_SIZE) {
      const batch = rowsToProcess.slice(i, i + BATCH_SIZE);
      const startRow = batch.length ? batch[0].rowIndex : '?';
      console.log(`\n--- Processing batch of ${batch.length} companies (starting from row ${startRow}) ---`);

      for (const { rowIndex, websiteUrl, linkedinUrl } of batch) {
        processedCount += 1;
        console.log(`[${processedCount}/${rowsToProcess.length}] Processing row ${rowIndex}: ${websiteUrl}`);

        try {
          const structuredData = await extractCompanyData(websiteUrl, linkedinUrl);
          const analysisResult = await analyzeExtractedData(structuredData);

          const structuredPreview = truncateForLog(structuredData);
          const analysisPreview = truncateForLog(analysisResult, Math.min(50, LOG_SUMMARY_LENGTH));
          console.log(`   🧠 Gemini Structured → ${structuredPreview || '(empty)'}`);
          console.log(`   ✅ Gemini Analysis → ${analysisPreview || '(empty)'}`);

          if (structuredData && structuredData.trim()) successCount += 1;

          updates.push({
            rowIndex,
            structuredData,
            analysisResult,
          });

          await delay(DELAY_MS);
        } catch (error) {
          errorCount += 1;
          console.error(`🔴 Error processing row ${rowIndex}:`, error.message);
          updates.push({
            rowIndex,
            structuredData: 'Error processing',
            analysisResult: 'Error',
          });
        }

        if (processedCount >= MAX_LEADS_PER_RUN) break;
      }

      if (processedCount >= MAX_LEADS_PER_RUN) {
        console.log(`   Reached max per run (${MAX_LEADS_PER_RUN}) mid-batch; remaining rows will be handled next run.`);
        break;
      }
    }

    if (updates.length > 0) {
      const data = updates.flatMap(({ rowIndex, structuredData, analysisResult }) => ([
        {
          range: `'${sheetTitle}'!${structuredColLetter}${rowIndex}`,
          values: [[structuredData]],
        },
        {
          range: `'${sheetTitle}'!${analysisColLetter}${rowIndex}`,
          values: [[analysisResult]],
        },
      ]));

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data,
        },
      });
      console.log(`   📤 Wrote ${updates.length} Gemini results (structured + analysis) back to the sheet.`);
    }

    console.log(`\n✅ Gemini research complete. Processed ${processedCount} companies (${successCount} with structured data, ${errorCount} errors).`);
    console.log(`   Structured data column: ${structuredColLetter} | Analysis column: ${analysisColLetter}`);
    if (processedCount >= MAX_LEADS_PER_RUN) {
      console.log(`   Reached max per run (${MAX_LEADS_PER_RUN}). Re-run to continue with remaining leads.`);
    }
    process.exit(0);

  } catch (error) {
    console.error('🔴 An error occurred while processing the sheet:', error.message);
    if (error.code === 403) {
        console.error("Hint: Permission denied. Make sure you have shared your Google Sheet with the service account's email address.");
    } else if (error.code === 404) {
      console.error("Hint: Make sure the Sheet ID is correct.");
    }
    process.exit(1);
  }
}

// --- Run the Script ---
processSheet();
