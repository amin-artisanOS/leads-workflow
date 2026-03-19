///Users/aminb101/leads-workflow/leadQualifier.js
import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { 
    initializeProcessedLeadsCSV, 
    loadProcessedLeads, 
    isDuplicateLead, 
    logProcessedLead 
} from './leadTracker.js';

// Helper function to convert column letter to number (A=1, B=2, ..., Z=26, AA=27, etc.)
function columnLetterToNumber(letter) {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.toUpperCase().charCodeAt(i) - 64);
  }
  return result;
}

// Helper function to ensure the sheet has enough columns and rows
async function ensureSheetDimensions(sheets, spreadsheetId, sheetName, requiredColumns) {
  // Convert column letters to numbers and find the maximum
  const columnNumbers = Object.values(requiredColumns).map(col => 
    typeof col === 'string' ? columnLetterToNumber(col) : col
  );
  const maxColumn = Math.max(...columnNumbers);
  
  // Get the current sheet properties
  const sheet = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${sheetName}!1:1`],
    fields: 'sheets(properties(gridProperties(columnCount,rowCount)))',
  });
  
  const gridProps = sheet.data.sheets[0].properties.gridProperties;
  const needsResize = gridProps.columnCount < maxColumn;
  
  if (needsResize) {
    console.log(`📏 Resizing sheet to ${maxColumn} columns`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: sheet.data.sheets[0].properties.sheetId,
              gridProperties: {
                rowCount: Math.max(gridProps.rowCount || 1000, 2000), // Ensure enough rows
                columnCount: maxColumn + 10, // Add some buffer
              }
            },
            fields: 'gridProperties(rowCount,columnCount)'
          }
        }]
      }
    });
  }
  
  return true;
}

// --- Basic Setup ---
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CREDENTIALS_PATH = path.resolve(__dirname, 'iuh-content-and-ecom-systems-934f3f80d780.json');

function normalizeCredentialPath(candidate) {
  if (!candidate) return '';
  const trimmed = candidate.trim().replace(/^['"]+|['"]+$/g, '');
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

function buildCredentialCandidates() {
  const rawCandidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.CREDENTIALS_PATH,
    path.join(process.cwd(), 'iuh-content-and-ecom-systems-934f3f80d780.json'),
    DEFAULT_CREDENTIALS_PATH,
  ];

  const seen = new Set();
  const candidates = [];
  for (const raw of rawCandidates) {
    const normalized = normalizeCredentialPath(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push(normalized);
  }
  return candidates;
}

const CREDENTIAL_CANDIDATES = buildCredentialCandidates();

// Log environment variables for debugging (excluding sensitive data)
console.log('Environment variables:', JSON.stringify({
  SPREADSHEET_ID: process.env.SPREADSHEET_ID ? '***' : 'NOT SET',
  SHEET_ID: process.env.SHEET_ID ? '***' : 'NOT SET',
  SHEET_NAME: process.env.SHEET_NAME || 'NOT SET',
  VERTICAL: process.env.VERTICAL || 'NOT SET',
  HAS_CREDENTIALS: !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.CREDENTIALS_PATH),
  IGNORE_DUPLICATE_HISTORY: (process.env.IGNORE_DUPLICATE_HISTORY || 'false').toLowerCase(),
}, null, 2));

// --- Configuration ---
const DEFAULT_SPREADSHEET_ID = '1_rX2OWFpvSGFyR0EsIVZLuoxTKE5JX66Q5o6Z5_VCrg';
const DEFAULT_SHEET_NAME = 'cleaned up food companies eu';
const SPREADSHEET_ID = process.env.SHEET_ID || process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || DEFAULT_SHEET_NAME;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const VERTICAL = (process.env.VERTICAL || '').toLowerCase();
const IGNORE_DUPLICATE_HISTORY = (process.env.IGNORE_DUPLICATE_HISTORY || '').toLowerCase() === 'true';

// Optional static column letters (legacy mode). If not provided, we detect by headers.
const LEGACY_COLUMNS = {
  AGENT_OUTPUT: process.env.COL_AGENT_OUTPUT || 'Q',
  QUALIFIED: process.env.COL_QUALIFIED || 'R',
  EXTRA_NOTES: process.env.COL_EXTRA_NOTES || 'AT',
  EMPLOYEE_COUNT: process.env.COL_EMPLOYEE_COUNT || 'S',
  COMPANY_NAME: process.env.COL_COMPANY_NAME || 'O',
  WEBSITE: process.env.COL_WEBSITE || 'Y',
  STATE: process.env.COL_STATE || 'AH',
  COUNTRY: process.env.COL_COUNTRY || 'AI',
};

// --- Batching and Rate Limiting ---
const BATCH_SIZE = 10; // Process 10 summaries at a time
const DELAY_MS = 1000; // 1-second delay between each API call to avoid rate limits

// --- Gemini AI Initialization ---
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  console.error("🔴 Error: GEMINI_API_KEY not found in .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(geminiApiKey);

// Model for analysis (without search)
const modelForAnalysis = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    // model: "gemini-1.5-flash-8b"
});

// --- Utilities ---

function columnToLetter(column) {
  let temp, letter = '';
  while (column >= 0) {
    temp = column % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = Math.floor(column / 26) - 1;
  }
  return letter || 'A';
}

function letterToColumn(letter) {
  let column = 0;
  for (let i = 0; i < letter.length; i++) {
    column = column * 26 + (letter.charCodeAt(i) - 64);
  }
  return column - 1;
}

// --- Google Sheets API ---
async function resolveCredentialsPath() {
  for (const candidate of CREDENTIAL_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      // Keep iterating through candidates
      console.warn(`⚠️ Credential candidate not accessible: ${candidate} (${error.code || error.message})`);
    }
  }
  return null;
}

async function auth(credentialsPath) {
  console.log('🔑 Authenticating with Google Sheets API...');
  console.log(`   Using credentials from: ${credentialsPath}`);
  
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: SCOPES,
    });
    
    console.log('   Getting auth client...');
    const client = await auth.getClient();
    
    if (!client) {
      throw new Error('Failed to get Google Auth client - returned null/undefined');
    }
    
    console.log('✅ Successfully authenticated with Google Sheets API');
    return google.sheets({ version: 'v4', auth: client });
  } catch (err) {
    console.error('❌ Error authenticating with Google Sheets API:', err.message);
    if (err.message.includes('ENOENT')) {
      console.error(`   Credentials file not found at: ${credentialsPath}`);
      console.error('   Please set GOOGLE_APPLICATION_CREDENTIALS to a valid service account key file.');
    } else if (err.message.includes('invalid_grant')) {
      console.error('   Invalid grant - the service account key may be invalid or expired');
    } else if (err.message.includes('invalid_scope')) {
      console.error('   Invalid scope - check that SCOPES are correctly set');
    }
    console.error('   Full error details:', JSON.stringify({
      code: err.code,
      errors: err.errors,
      stack: err.stack
    }, null, 2));
    process.exit(1);
  }
};

// --- Core Logic ---

// Helper function to add a delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Analyzes a company to determine if they are a good fit for lead generation services
 * to help overcome US tariffs.
 * @param {object} companyData Object containing company information
 * @returns {Promise<string>} "YES", "NO", or an error message.
 */
async function analyzeForLeadQualification(companyData) {
    const {
        agentOutput = '',
        employeeCount = '',
        companyName = '',
        website = '',
        state = '',
        country = '',
        extraNotes = ''
    } = companyData;
    
    // Vertical-specific configuration
    const verticalName = VERTICAL || 'general';
    const contextByVertical = {
      food: {
        service: 'food producers affected by US tariffs (15-25%) seeking buyers in markets like Canada, Japan, and the Middle East',
        criteria: [
          'Product Type: Produces food items potentially affected by US tariffs (e.g., dairy, pork, olive oil, wine, cheese, processed foods)',
          'Business Size: Ideal size 10-500 employees',
          'Export Capability: Some international experience or capacity to export',
          'Product Quality: Premium, specialty, or branded products preferred'
        ],
      },
      metal: {
        service: 'metal producers (fabrication, alloys, components, tooling) affected by US tariffs, seeking export diversification',
        criteria: [
          'Product Type: Manufactures metal products or components with B2B buyers',
          'Business Size: Ideal size 20-1000 employees',
          'Export Capability: Existing export activity or readiness to export (certifications, logistics)',
          'Capacity/Quality: Consistent production capacity and quality standards'
        ],
      },
      chemical: {
        service: 'chemical producers (industrial, specialty, lab/biotech inputs) affected by US tariffs, looking to grow in other markets',
        criteria: [
          'Product Type: Industrial or specialty chemicals with B2B demand',
          'Compliance: Meets regulatory/export compliance in target regions',
          'Business Size: Ideal size 20-1000 employees',
          'Export Capability: Has distributors, export history, or willingness to develop channels'
        ],
      },
      machinery: {
        service: 'machinery producers (industrial equipment, components) affected by US tariffs, seeking demand in alternative markets',
        criteria: [
          'Product Type: Machinery/equipment or components sold B2B',
          'Business Size: Ideal size 20-1000 employees',
          'Export Capability: Sales agents/distributors or ability to support international customers',
          'After-Sales: Service/parts support capability for global customers'
        ],
      },
      general: {
        service: 'companies affected by US tariffs seeking to diversify and grow in non-US markets',
        criteria: [
          'Relevant Offering: Products/services likely impacted by tariffs with B2B demand',
          'Business Size: 10-1000 employees',
          'Export Capability: Some export activity or readiness to export',
          'Market Fit: Clear buyer profiles in alternative markets'
        ],
      }
    };

    const v = contextByVertical[verticalName] || contextByVertical.general;
    const criteriaText = v.criteria.map((c, idx) => `${idx + 1}. ${c}`).join('\n    ');

    const prompt = `You are a lead qualification analyst for a service that helps ${v.service}. Your task is to analyze the following company data and determine if they would be a good fit for our lead generation service.

    **Service Context:** We help companies diversify away from US tariffs by finding buyers in alternative markets.
    
    **Qualification Criteria (${verticalName}):**
    ${criteriaText}
    
    **Decision Guidelines:**
    - If the company meets ALL criteria, output ONLY "YES"
    - If the company clearly doesn't meet the criteria, output "NO"
    
    **Company Information:**
    - Name: ${companyName || 'Not available'}
    - Website: ${website || 'Not available'}
    - Location: ${[state, country].filter(Boolean).join(', ') || 'Not available'}
    - Employee Count: ${employeeCount || 'Not available'}
    - Agent Output: ${agentOutput || 'Not available'}
    - Additional Notes: ${extraNotes || 'None'}
    
    **Analysis Instructions:**
    1. Evaluate against the criteria above for the ${verticalName} vertical
    2. Verify size and export capability
    3. Consider market fit and any quality/certification signals
    4. Consider any notes about export capabilities or challenges
    
    RESPOND WITH ONLY ONE WORD: YES, NO.`;

    try {
      console.log('Prompt:', prompt);
        const result = await modelForAnalysis.generateContent(prompt);
        const response = result.response;
        const text = response.text().trim().toUpperCase();

        // Return a clean response
        const cleanText = text.trim().toUpperCase();
        if (['YES', 'NO'].includes(cleanText)) {
            console.log(`   ✅ Lead Qualification result: ${cleanText}`);
            return cleanText;
        }
        
        console.warn(`   ⚠️ Analysis returned unexpected text: "${text}"`);
        return text; // Return the raw text if it's not one of the expected responses
    } catch (error) {
        console.error(`🔴 Error during lead qualification analysis:`, error.message);
        return 'Error during analysis';
    }
}

/**
 * Main function to authenticate, read from Google Sheet, process summaries, and write back results.
 */
async function processSheet(sheets, spreadsheetId, sheetName = SHEET_NAME) {
  try {
    // Initialize lead tracking system
    await initializeProcessedLeadsCSV();
    const processedLeads = IGNORE_DUPLICATE_HISTORY ? new Set() : await loadProcessedLeads();
    if (IGNORE_DUPLICATE_HISTORY) {
      console.log('⚠️ IGNORE_DUPLICATE_HISTORY enabled: skipping historical duplicate checks');
    } else {
      console.log(`📚 Historical processed leads loaded: ${processedLeads.size}`);
    }
    
    console.log(`📊 Processing sheet: ${sheetName} in spreadsheet ${spreadsheetId}`);

    console.log(`\nProcessing sheet: "${sheetName}" (Spreadsheet ID: ${spreadsheetId})`);

    // Ensure the sheet has enough columns
    await ensureSheetDimensions(sheets, spreadsheetId, sheetName, LEGACY_COLUMNS);

    // Read a wide range to capture all headers and data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!1:1000`,
    });

    const allRows = response.data.values || [];
    if (allRows.length === 0) {
      console.log(`No data found in sheet ${sheetName}. Exiting.`);
      process.exit(0);
    }

    const headerRow = allRows[0] || [];
    const rowsToProcess = allRows.slice(1); // Skip header

    // Detect columns by header names (case-insensitive, flexible matching)
    const normalizeHeader = (s) => (s || '')
      .toString()
      .trim()
      .replace(/^"+|"+$/g, '')
      .toLowerCase();

    const findIndexByKeywords = (keywords) => {
      const set = headerRow.map(h => normalizeHeader(h));
      for (let i = 0; i < set.length; i++) {
        const h = set[i];
        if (!h) continue;
        for (const kw of keywords) {
          if (h === kw || h.includes(kw)) return i;
        }
      }
      return -1;
    };

    let idxCompany = findIndexByKeywords(['organization_name', 'company name', 'company', 'name']);
    let idxWebsite = findIndexByKeywords(['organization_website', 'organization_primary_domain', 'website', 'url', 'domain']);
    let idxPhone = findIndexByKeywords(['organization_phone', 'phone']);
    let idxStreet = findIndexByKeywords(['organization_street_address', 'street address']);
    let idxRawAddress = findIndexByKeywords(['organization_raw_address', 'raw address']);
    let idxAgentOutput = findIndexByKeywords([
      'gemini structured',
      'structured summary',
      'structured data',
      'gemini output',
      'agent output',
      'agent_output',
      'notes summary',
      'analysis summary'
    ]);
    let idxQualified = findIndexByKeywords(['qualified', 'qualification', 'result']);
    let idxEmployees = findIndexByKeywords(['employee count', 'estimated_num_employees', 'employees', 'headcount']);
    let idxState = findIndexByKeywords(['organization_state', 'state', 'region', 'province']);
    let idxCity = findIndexByKeywords(['organization_city', 'city']);
    let idxCountry = findIndexByKeywords(['organization_country', 'country']);
    let idxPostalCode = findIndexByKeywords(['organization_postal_code', 'postal code', 'zip']);
    let idxMarketCap = findIndexByKeywords(['organization_market_cap', 'market cap']);
    let idxExtraNotes = findIndexByKeywords(['gemini analysis', 'analysis', 'extra notes', 'notes', 'remarks']);

    // If company/website missing, try legacy letter mapping by reading that range
    if (idxCompany === -1 || idxWebsite === -1) {
      console.log('ℹ️ Header-based detection incomplete. Falling back to legacy column letters where necessary.');
      // Use letter indices relative to A
      idxCompany = idxCompany !== -1 ? idxCompany : letterToColumn(LEGACY_COLUMNS.COMPANY_NAME);
      idxWebsite = idxWebsite !== -1 ? idxWebsite : letterToColumn(LEGACY_COLUMNS.WEBSITE);
      idxAgentOutput = idxAgentOutput !== -1 ? idxAgentOutput : letterToColumn(LEGACY_COLUMNS.AGENT_OUTPUT);
      idxQualified = idxQualified !== -1 ? idxQualified : letterToColumn(LEGACY_COLUMNS.QUALIFIED);
      idxEmployees = idxEmployees !== -1 ? idxEmployees : letterToColumn(LEGACY_COLUMNS.EMPLOYEE_COUNT);
      idxState = idxState !== -1 ? idxState : letterToColumn(LEGACY_COLUMNS.STATE);
      idxCountry = idxCountry !== -1 ? idxCountry : letterToColumn(LEGACY_COLUMNS.COUNTRY);
      idxExtraNotes = idxExtraNotes !== -1 ? idxExtraNotes : letterToColumn(LEGACY_COLUMNS.EXTRA_NOTES);
    }

    if (rowsToProcess.length === 0) {
      console.log(`No data found to process (after header). Exiting.`);
      process.exit(0);
    }
    
    console.log(`Found ${rowsToProcess.length} rows to analyze.`);

    // Ensure we have a 'Qualified' column; if not, append it
    let qualifiedColumnIndex = idxQualified;
    let headerUpdated = false;
    if (qualifiedColumnIndex === -1) {
      qualifiedColumnIndex = headerRow.length; // append at end
      headerRow.push('Qualified');
      headerUpdated = true;
    }

    const qualifiedColumnLetter = columnToLetter(qualifiedColumnIndex);

    for (let i = 0; i < rowsToProcess.length; i += BATCH_SIZE) {
      const batch = rowsToProcess.slice(i, i + BATCH_SIZE);
      const startRow = i + 2; // +2 because sheets are 1-indexed and we sliced off the header
      console.log(`\n--- Processing batch of ${batch.length} companies (starting from row ${startRow}) ---`);
      
      const qualificationResults = [];

      for (let j = 0; j < batch.length; j++) {
          const row = batch[j];
          const currentRowIndex = i + j;
          const currentRowNumber = startRow + j;
          
          console.log(`[${currentRowIndex + 1}/${rowsToProcess.length}] Analyzing company in row ${currentRowNumber}`);
          
          // Skip if already qualified
          if (idxQualified !== -1 && row[idxQualified] && row[idxQualified].toString().trim() !== '') {
              console.log(`   ⏭️ Already qualified: ${row[idxQualified]}`);
              qualificationResults.push([row[idxQualified]]);
              continue;
          }
          
          // Extract company data for duplicate checking
          const companyName = (idxCompany !== -1 && row[idxCompany]) ? row[idxCompany] : '';
          const website = (idxWebsite !== -1 && row[idxWebsite]) ? row[idxWebsite] : '';
          const email = ''; // leadQualifier doesn't process emails directly
          
          // Check for duplicates
          if (isDuplicateLead(processedLeads, companyName, website, email)) {
              console.log(`   🔄 Duplicate lead detected: ${companyName || website || 'Unknown'}`);
              qualificationResults.push(['DUPLICATE']);
              continue;
          }
          
          const companyData = {
              agentOutput: (idxAgentOutput !== -1 && row[idxAgentOutput]) ? row[idxAgentOutput] : '',
              employeeCount: (idxEmployees !== -1 && row[idxEmployees]) ? row[idxEmployees] : '',
              companyName: companyName || '',
              website: website || '',
              phone: (idxPhone !== -1 && row[idxPhone]) ? row[idxPhone] : '',
              streetAddress: (idxStreet !== -1 && row[idxStreet]) ? row[idxStreet] : '',
              rawAddress: (idxRawAddress !== -1 && row[idxRawAddress]) ? row[idxRawAddress] : '',
              state: (idxState !== -1 && row[idxState]) ? row[idxState] : '',
              city: (idxCity !== -1 && row[idxCity]) ? row[idxCity] : '',
              country: (idxCountry !== -1 && row[idxCountry]) ? row[idxCountry] : '',
              postalCode: (idxPostalCode !== -1 && row[idxPostalCode]) ? row[idxPostalCode] : '',
              marketCap: (idxMarketCap !== -1 && row[idxMarketCap]) ? row[idxMarketCap] : '',
              extraNotes: (idxExtraNotes !== -1 && row[idxExtraNotes]) ? row[idxExtraNotes] : ''
          };
          
          const qualification = await analyzeForLeadQualification(companyData);
          qualificationResults.push([qualification]);
          
          // Log the processed lead
          await logProcessedLead({
              companyName: companyData.companyName,
              website: companyData.website,
              email: '', // leadQualifier doesn't process emails
              country: companyData.country,
              state: companyData.state,
              processor: 'leadQualifier',
              qualified: qualification,
              verificationResult: '',
              employeeCount: companyData.employeeCount,
              sheetName: sheetName,
              rowNumber: currentRowNumber.toString(),
              extraData: {
                phone: companyData.phone,
                streetAddress: companyData.streetAddress,
                rawAddress: companyData.rawAddress,
                city: companyData.city,
                postalCode: companyData.postalCode,
                marketCap: companyData.marketCap,
                agentOutput: companyData.agentOutput,
              }
          });
          
          // Add to processed leads set for this session
          const identifier = companyData.companyName || companyData.website;
          if (identifier) {
              processedLeads.add(`company:${identifier.toLowerCase().trim()}`);
          }
          
          await delay(DELAY_MS);
      }

      // If header needs updating (Qualified column didn't exist), write header cell first
      if (headerUpdated && i === 0) {
        const headerRange = `${sheetName}!${qualifiedColumnLetter}1`;
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: headerRange,
          valueInputOption: 'RAW',
          resource: { values: [[ 'Qualified' ]] },
        });
        console.log(`   📝 Added 'Qualified' header at ${qualifiedColumnLetter}1`);
      }

      // Write qualification results to the determined column
      const writeRange = `${sheetName}!${qualifiedColumnLetter}${startRow}:${qualifiedColumnLetter}${startRow + batch.length - 1}`;
      console.log(`   Writing ${qualificationResults.length} qualifications to range: ${writeRange}`);
      
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: writeRange,
        valueInputOption: 'RAW',
        resource: { values: qualificationResults },
      });

      console.log(`   ✅ Batch written successfully to column ${qualifiedColumnLetter}.`);
    }

    console.log(`\n✅ Success! All lead qualification processing complete.`);
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
(async () => {
  try {
    console.log('🚀 Starting lead qualification process...');
    console.log('   Spreadsheet ID:', SPREADSHEET_ID);
    console.log('   Sheet name:', SHEET_NAME);
    console.log('   Vertical:', VERTICAL || 'Not specified');
    
    // Validate required parameters
    if (!SPREADSHEET_ID) {
      throw new Error('SPREADSHEET_ID is required but not set. Please check your environment variables.');
    }
    
    if (!SHEET_NAME) {
      throw new Error('SHEET_NAME is required but not set. Please check your environment variables.');
    }

    const credentialsPath = await resolveCredentialsPath();
    if (!credentialsPath) {
      throw new Error(`Credentials file not found. Checked the following locations:\n${CREDENTIAL_CANDIDATES.map(p => ` - ${p}`).join('\n')}`);
    }

    console.log('✅ Using credentials file:', credentialsPath);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

    // Initialize Google Sheets client
    const sheets = await auth(credentialsPath);
    
    // Run the main processing
    await processSheet(sheets, SPREADSHEET_ID, SHEET_NAME);
    
    console.log('✅ Lead qualification completed successfully!');
  } catch (error) {
    console.error('❌ Unhandled error in main execution:');
    console.error('   Message:', error.message);
    
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
    }
    
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack.split('\n').slice(0, 5).join('\n') + '\n   ...');
    }
    
    process.exit(1);
  }
})();