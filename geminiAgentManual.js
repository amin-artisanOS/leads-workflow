// /Users/aminb101/leads-workflow/geminiAgentManual.js
// Import necessary libraries
import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Basic Setup ---
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
// HARDCODED: Path to your Google Service Account credentials JSON file.
const CREDENTIALS_PATH = '/Users/aminb101/leads-workflow/iuh-content-and-ecom-systems-934f3f80d780.json';
// HARDCODED: Your Google Sheet ID.
const SPREADSHEET_ID = '1_rX2OWFpvSGFyR0EsIVZLuoxTKE5JX66Q5o6Z5_VCrg';
const SHEET_NAME = 'eu machine producers _2025-08-25T14_44_07.462Z';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Fixed column indices (0-based)
const COLUMNS = {
    // Input columns
    WEBSITE: 24,  // Column Y (0-based: 24)
    LINKEDIN: 9,  // Column J (0-based: 9)
    // Output columns
    AGENT_OUTPUT: 19,  // Column T (0-based: 19)
    QUALIFIED: 18      // Column S (0-based: 18)
};

// --- Batching and Rate Limiting ---
const BATCH_SIZE = 10; // Process 10 URLs at a time
const DELAY_MS = 1000; // 1-second delay between each API call to avoid rate limits

// --- Gemini AI Initialization ---
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  console.error("🔴 Error: GEMINI_API_KEY not found in .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(geminiApiKey);

// Model for summarizing URLs with Google Search
const modelForSummary = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
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
  model: "gemini-2.5-flash-lite",
  generationConfig: {
    maxOutputTokens: 512,
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

// --- Utility Functions ---

// Helper function to add a delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Converts a column number to a letter (e.g., 0 -> A, 25 -> Z, 26 -> AA)
 * @param {number} columnNumber - 0-based column number
 * @returns {string} Column letter
 */
function columnToLetter(columnNumber) {
  let letter = '';
  while (columnNumber >= 0) {
    letter = String.fromCharCode((columnNumber % 26) + 65) + letter;
    columnNumber = Math.floor(columnNumber / 26) - 1;
  }
  return letter;
}

// Ensure text written to a Google Sheets cell stays under the 50,000 char limit
function sanitizeForSheet(text, maxLen = 49000) {
  if (!text) return '';
  const cleaned = String(text).replace(/\u0000/g, ''); // remove null chars
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, Math.max(0, maxLen - 15)) + '... [truncated]';
}

// Clamp all cells in a values matrix to a safe length
function clampMatrix(valuesMatrix, maxLen = 49000) {
  if (!Array.isArray(valuesMatrix)) return [];
  return valuesMatrix.map(row => [sanitizeForSheet(row?.[0] ?? '', maxLen)]);
}

// --- Core Logic ---

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
  const prompt = `You are an expert B2B market researcher specializing in company profiling for the high-tech industrial machinery sector. Your task is to extract specific, structured information about a company by crawling its website and LinkedIn profile. Your analysis will help determine if this company is an industrial machinery producer potentially affected by US tariffs.

  Crawl the company's website and LinkedIn profile to extract the following details:
  
  1.  **Company Name:** The official name of the company.
  2.  **Location:** The country where the company is headquartered.
  3.  **Business Model:** State if they are primarily a "Producer/Manufacturer," a "Distributor/Sales Agent," or "Service/Integrator." This is crucial. Look for words like "we manufacture," "our production facility," "engineering" (Producer) versus "we distribute," "official partner of," "we sell" (Distributor) or "we install," "we service," "we integrate" (Service/Integrator).
  4.  **Company Size:** The number of employees. Specify the source (e.g., LinkedIn).
  5.  **Products:** A concise list of their main machinery products (e.g., "5-axis CNC Machining Centers," "Industrial Robots (Welding, Assembly)," "Laser Cutting Systems," "Automated Packaging Lines," "Metal Stamping Presses").
  6.  **Key Industries Served:** The primary customer industries they sell to (e.g., "Aerospace & Defense," "Automotive," "Medical Devices," "Semiconductors," "Packaging").
  7.  **Social Proof:** List any specific certifications (like ISO 9001), major industry awards, or key OEM partnerships mentioned (e.g., "Official supplier to BMW").
  
  **Company Website:** ${websiteUrl}
  **Company LinkedIn URL:** ${linkedinUrl || 'Not Provided'}
  
  **Rules:**
  - Output only the structured text based on the fields above.
  - If you cannot find a specific piece of information for a field, output "Unable to locate".
  - Never make up or infer information.
  - If you cannot access or scrape the provided URLs, output ONLY "FAIL TO SCRAPE".`;

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

    const prompt = `You are an expert market analyst specializing in the high-tech industrial machinery and manufacturing technology sector. Your task is to analyze the following structured company data and determine if they are a strong candidate for a lead generation service. This service helps machinery producers expand into new international markets due to recent 15-25% US tariffs on their equipment.

Analyze the data based on these strict rules:

**Rule 1: Location (Crucial)**
The "Location" MUST be a key industrial country known for high-tech machinery. The list includes: Germany, Japan, Italy, Switzerland, South Korea, Taiwan, Austria, France, Spain, or Sweden. If it is outside this list or "Unable to locate", the company is NOT a good fit.

**Rule 2: Business Model**
The "Business Model" MUST be "Producer/Manufacturer." A "Distributor/Sales Agent" or "Service/Integrator" is NOT a good fit.

**Rule 3: High-Value Indicators**
The company must meet Rule 1 and Rule 2, AND the "Products" or "Key Industries Served" must indicate high-value, high-precision equipment. Keywords like "CNC," "5-axis," "Robotics," "Automation," "Laser," "Aerospace," or "Medical Devices" are strong positive indicators.

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
async function processSheet() {
  try {
    const sheets = await auth();
    const spreadsheetId = SPREADSHEET_ID;
    
    console.log(`\nProcessing sheet: "${SHEET_NAME}"`);
    
    // Read all data
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAME}'!A:AH`,  // Extended range to include all needed columns
        majorDimension: 'ROWS'
    });
    
    const rows = response.data.values || [];
    if (rows.length <= 1) {
        console.log('No data rows found to process.');
        return;
    }
    
    // Skip header row
    const rowsToProcess = rows.slice(1);
    
    // Process rows in batches
    for (let i = 0; i < rowsToProcess.length; i += BATCH_SIZE) {
        const batch = rowsToProcess.slice(i, i + BATCH_SIZE);
        console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} (rows ${i + 2}-${Math.min(i + BATCH_SIZE + 1, rowsToProcess.length + 1)})`);
        
        const structuredDataBatchResults = [];
        const analysisBatchResults = [];

        // Process each row in the batch
        for (let j = 0; j < batch.length; j++) {
            const row = batch[j];
            const rowNum = i + j + 2; // +2 for 1-based index and header row
            const websiteUrl = (row && row[COLUMNS.WEBSITE]) ? row[COLUMNS.WEBSITE].trim() : null;
            const linkedinUrl = (row && row[COLUMNS.LINKEDIN]) ? row[COLUMNS.LINKEDIN].trim() : null;
            const existingAgentOutput = (row && row[COLUMNS.AGENT_OUTPUT]) ? String(row[COLUMNS.AGENT_OUTPUT]).trim() : '';
            const existingQualified = (row && row[COLUMNS.QUALIFIED]) ? String(row[COLUMNS.QUALIFIED]).trim() : '';
            
            // Resume logic: if both outputs already exist, keep them and skip processing
            if (existingAgentOutput && existingQualified) {
                console.log(`   ⏩ Skipping row ${rowNum} - Already processed`);
                structuredDataBatchResults.push([existingAgentOutput]);
                analysisBatchResults.push([existingQualified]);
                continue;
            }
            
            // If no website, preserve existing values and skip
            if (!websiteUrl) {
                console.log(`   ⏩ Skipping row ${rowNum} - No website URL`);
                structuredDataBatchResults.push([existingAgentOutput]);
                analysisBatchResults.push([existingQualified]);
                continue;
            }
            
            // If agent output exists but qualified is missing, only compute qualification
            if (existingAgentOutput && !existingQualified) {
                console.log(`   🔄 Completing analysis for row ${rowNum} using existing agent output`);
                try {
                    const qualifiedStatus = await analyzeExtractedData(existingAgentOutput);
                    structuredDataBatchResults.push([existingAgentOutput]);
                    analysisBatchResults.push([qualifiedStatus]);
                    console.log(`   ✅ Completed analysis for row ${rowNum}`);
                    await delay(DELAY_MS);
                } catch (error) {
                    console.error(`   ❌ Error completing analysis for row ${rowNum}:`, error.message);
                    structuredDataBatchResults.push([existingAgentOutput || 'Error processing']);
                    analysisBatchResults.push(['Error']);
                }
                continue;
            }
            
            console.log(`   🔍 Processing row ${rowNum}: ${websiteUrl}`);
            
            try {
                // Step 1: Extract structured data
                const agentOutput = await extractCompanyData(websiteUrl, linkedinUrl);
                structuredDataBatchResults.push([agentOutput]);
                
                // Step 2: Get qualified status
                const qualifiedStatus = await analyzeExtractedData(agentOutput);
                analysisBatchResults.push([qualifiedStatus]);
                
                console.log(`   ✅ Processed row ${rowNum}`);
                
                // Add delay between individual requests
                await delay(DELAY_MS);
            } catch (error) {
                console.error(`   ❌ Error processing row ${rowNum}:`, error.message);
                structuredDataBatchResults.push(['Error processing']);
                analysisBatchResults.push(['Error']);
            }
        }

        // Write structured data results to column T
        const startRow = i + 2; // +2 for 1-based index and header row
        const dataWriteRange = `'${SHEET_NAME}'!${columnToLetter(COLUMNS.AGENT_OUTPUT)}${startRow}`;
        if (structuredDataBatchResults.length > 0) {
            const safeStructured = clampMatrix(structuredDataBatchResults, 49000);
            try {
              await sheets.spreadsheets.values.update({
                  spreadsheetId,
                  range: dataWriteRange,
                  valueInputOption: 'RAW',
                  resource: { values: safeStructured },
              });
            } catch (e) {
              if (String(e?.message || '').includes('maximum of 50000')) {
                console.warn('   ⚠️ Batch write exceeded limit. Retrying per-row with tighter clamp.');
                for (let r = 0; r < safeStructured.length; r++) {
                  const singleRange = `'${SHEET_NAME}'!${columnToLetter(COLUMNS.AGENT_OUTPUT)}${startRow + r}`;
                  const singleVal = clampMatrix([safeStructured[r]], 48000);
                  await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: singleRange,
                    valueInputOption: 'RAW',
                    resource: { values: singleVal },
                  });
                }
              } else {
                throw e;
              }
            }
            console.log(`   📝 Writing ${structuredDataBatchResults.length} structured data results to column ${columnToLetter(COLUMNS.AGENT_OUTPUT)}.`);
        }

        // Write analysis results to column S
        const analysisWriteRange = `'${SHEET_NAME}'!${columnToLetter(COLUMNS.QUALIFIED)}${startRow}`;
        if (analysisBatchResults.length > 0) {
            const safeAnalysis = clampMatrix(analysisBatchResults, 49000);
            try {
              await sheets.spreadsheets.values.update({
                  spreadsheetId,
                  range: analysisWriteRange,
                  valueInputOption: 'RAW',
                  resource: { values: safeAnalysis },
              });
            } catch (e) {
              if (String(e?.message || '').includes('maximum of 50000')) {
                console.warn('   ⚠️ Batch write (analysis) exceeded limit. Retrying per-row with tighter clamp.');
                for (let r = 0; r < safeAnalysis.length; r++) {
                  const singleRange = `'${SHEET_NAME}'!${columnToLetter(COLUMNS.QUALIFIED)}${startRow + r}`;
                  const singleVal = clampMatrix([safeAnalysis[r]], 48000);
                  await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: singleRange,
                    valueInputOption: 'RAW',
                    resource: { values: singleVal },
                  });
                }
              } else {
                throw e;
              }
            }
            console.log(`   📝 Writing ${analysisBatchResults.length} analysis results to column ${columnToLetter(COLUMNS.QUALIFIED)}.`);
        }
        
        console.log(`   ✅ Batch written successfully.`);
        
        // Add delay between batches
        if (i + BATCH_SIZE < rowsToProcess.length) {
            console.log('   ⏳ Waiting before next batch...');
            await delay(DELAY_MS);
        }
    }

    console.log(`\n✅ Success! All processing complete.`);
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