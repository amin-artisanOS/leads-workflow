import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { 
    initializeProcessedLeadsCSV, 
    loadProcessedLeads, 
    isDuplicateLead, 
    logProcessedLead 
} from './leadTracker.js';

// --- Basic Setup ---
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const API_KEY = "ygYUD9SgBwkewYjzx17Yg7O78"; // MillionVerifier API key
const CREDENTIALS_PATH = '/Users/aminb101/leads-workflow/iuh-content-and-ecom-systems-934f3f80d780.json';
const DEFAULT_SPREADSHEET_ID = '1_rX2OWFpvSGFyR0EsIVZLuoxTKE5JX66Q5o6Z5_VCrg';
const DEFAULT_SHEET_NAME = 'pharma chem companies 1st 500';
const DEFAULT_RESULT_HEADER = 'MillionVerifier Result';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// --- CLI helpers ---
const stripWrappingQuotes = (value = '') => value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');

const getArgValue = (flag) => {
  const args = process.argv.slice(2);
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

const INPUT_CSV = getArgValue('--input-csv') || process.env.MV_INPUT_CSV;
const OUTPUT_CSV = getArgValue('--output-csv') || process.env.MV_OUTPUT_CSV;
const SPREADSHEET_ID = getArgValue('--spreadsheet') || process.env.MV_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
const SHEET_NAME = getArgValue('--sheet') || process.env.MV_SHEET_NAME || DEFAULT_SHEET_NAME;
const RESULT_HEADER = getArgValue('--result-header') || process.env.MV_RESULT_HEADER || DEFAULT_RESULT_HEADER;

if (!INPUT_CSV && !SHEET_NAME) {
  console.error('🔴 Provide either --input-csv=<path> for CSV mode or --sheet="<tab name>" for Google Sheets mode.');
  process.exit(1);
}

// --- API Endpoints ---
const UPLOAD_URL = "https://bulkapi.millionverifier.com/bulkapi/v2/upload";
const FILE_INFO_URL = "https://bulkapi.millionverifier.com/bulkapi/v2/fileinfo";
const DOWNLOAD_URL = "https://bulkapi.millionverifier.com/bulkapi/v2/download";

// Helper function for delays
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

// Helper function to convert column number to letter (e.g., 0 -> 'A', 45 -> 'AT')
function columnToLetter(column) {
    let temp, letter = '';
    while (column >= 0) {
        temp = column % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        column = Math.floor(column / 26) - 1;
    }
    return letter || 'A';
}

// Helper function to convert column letter to number (e.g., 'AT' -> 45)
function letterToColumn(letter) {
    let column = 0;
    for (let i = 0; i < letter.length; i++) {
        column = column * 26 + (letter.charCodeAt(i) - 64);
    }
    return column - 1;
}

// Function to read emails from local CSV file
async function readEmailsFromCSV(csvPath) {
    try {
        await initializeProcessedLeadsCSV();
        const processedLeads = await loadProcessedLeads();
        
        const resolvedPath = path.isAbsolute(csvPath) ? csvPath : path.join(__dirname, csvPath);
        console.log(`📄 Reading emails from CSV: ${resolvedPath}`);
        
        const rows = [];
        const emails = [];
        const emailRowMap = new Map();
        let headers = null;
        let emailColumnName = null;
        
        await new Promise((resolve, reject) => {
            fs.createReadStream(resolvedPath)
                .pipe(csvParser())
                .on('headers', (headerList) => {
                    headers = headerList;
                    emailColumnName = headerList.find(h => h.toLowerCase().includes('email'));
                    if (!emailColumnName) {
                        reject(new Error('No email column found in CSV. Ensure there is a column with "email" in the header.'));
                    }
                    console.log(`📧 Found email column: ${emailColumnName}`);
                })
                .on('data', (row) => {
                    rows.push(row);
                    const emailRaw = row[emailColumnName] || '';
                    const email = emailRaw.toLowerCase().trim();
                    
                    if (email && email.includes('@')) {
                        if (!isDuplicateLead(processedLeads, '', '', email)) {
                            emails.push(email);
                            emailRowMap.set(email, rows.length);
                        } else {
                            console.log(`   🔄 Duplicate email detected: ${email}`);
                        }
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });
        
        console.log(`📊 Found ${emails.length} valid email addresses (duplicates filtered)`);
        return {
            emails,
            emailRowMap,
            emailColumnName,
            processedLeads,
            headers,
            rows
        };
    } catch (error) {
        console.error('🔴 Error reading from CSV:', error.message);
        throw error;
    }
}

// Function to read emails from Google Sheets
async function readEmailsFromSheet() {
    try {
        // Initialize lead tracking system
        await initializeProcessedLeadsCSV();
        const processedLeads = await loadProcessedLeads();
        
        const sheets = await auth();
        
        // Read all data from the sheet to find email column
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!1:501`, // Read first 500 rows (1 header + 500 data rows)
        });
        
        const rows = response.data.values || [];
        if (rows.length === 0) {
            throw new Error('No data found in the sheet');
        }
        
        // Find email column (look for common email column headers)
        const headers = rows[0];
        const emailColumnIndex = headers.findIndex(header => 
            header && header.toLowerCase().includes('email')
        );
        
        if (emailColumnIndex === -1) {
            throw new Error('No email column found. Please ensure there is a column with "email" in the header.');
        }
        
        console.log(`📧 Found email column: ${headers[emailColumnIndex]} (Column ${columnToLetter(emailColumnIndex)})`);

        // Determine result output column (first empty header cell, otherwise append new column)
        let resultColumnIndex = headers.findIndex(header => !header || header.trim() === '');
        if (resultColumnIndex === -1) {
            resultColumnIndex = headers.length;
        }
        const resultColumnLetter = columnToLetter(resultColumnIndex);
        const headerNeedsUpdate = !headers[resultColumnIndex] || headers[resultColumnIndex].trim() === '';
        console.log(`📝 Results will be written to column ${resultColumnLetter} on sheet '${SHEET_NAME}'.`);
        
        // Extract emails from the found column (skip header row)
        const emails = [];
        const emailRowMap = new Map(); // Map to track which row each email came from
        
        for (let i = 1; i < rows.length; i++) {
            const emailRaw = rows[i] && rows[i][emailColumnIndex] ? rows[i][emailColumnIndex].trim() : '';
            const email = emailRaw.toLowerCase();
            if (email && email.includes('@')) {
                // Check for duplicates before adding
                if (!isDuplicateLead(processedLeads, '', '', email)) {
                    emails.push(email);
                    emailRowMap.set(email, i + 1); // +1 because sheets are 1-indexed
                } else {
                    console.log(`   🔄 Duplicate email detected: ${email}`);
                }
            }
        }
        
        console.log(`📊 Found ${emails.length} valid email addresses (duplicates filtered)`);
        return { 
            emails, 
            emailRowMap, 
            emailColumnIndex, 
            processedLeads,
            resultColumnLetter,
            resultColumnIndex,
            headerNeedsUpdate
        };
        
    } catch (error) {
        console.error('🔴 Error reading from Google Sheets:', error.message);
        throw error;
    }
}

// Function to create CSV content from emails
function createCSVContent(emails) {
    const csvHeader = 'email\n';
    const csvRows = emails.map(email => email).join('\n');
    return csvHeader + csvRows;
}

// Function to parse verification results and update Google Sheets
async function updateSheetsWithResults(csvContent, emailRowMap, processedLeads, outputConfig) {
    try {
        const sheets = await auth();
        const { columnLetter, headerNeedsUpdate } = outputConfig;
        // Handle possible BOM and ensure text
        const text = typeof csvContent === 'string' ? csvContent : String(csvContent);
        if (text.trim().startsWith('{')) {
            // API returned JSON error
            throw new Error(`Download returned JSON: ${text}`);
        }
        const cleaned = text.replace(/^\ufeff/, '');
        const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length === 0) throw new Error('Downloaded results are empty');

        // Detect delimiter: prefer comma, else semicolon, else tab
        const headerLine = lines[0];
        const delimiter = headerLine.includes(',') ? ',' : (headerLine.includes(';') ? ';' : '\t');
        const headers = headerLine.split(delimiter).map(h => h.replace(/^\"|\"$/g, '').trim());
        console.log(`🧾 Results headers: ${headers.join(' | ')}`);
        console.log(`🔎 Detected delimiter: '${delimiter === '\t' ? 'TAB' : delimiter}'`);

        // Find email and result columns by header names
        const emailIdx = headers.findIndex(h => h.toLowerCase().includes('email'));
        const resultIdx = headers.findIndex(h => {
            const s = h.toLowerCase();
            return s.includes('result') || s.includes('status') || s.includes('verdict') || s.includes('grade') || s.includes('state');
        });

        if (emailIdx === -1 || resultIdx === -1) {
            console.error(`Headers not recognized. Headers: ${headers.join(' | ')}`);
            throw new Error(`Could not find result column in verification results`);
        }

        console.log(`📝 Updating Google Sheets with verification results in column ${columnLetter}... (writes happen only after verification is finished)`);
        const updates = [];
        if (headerNeedsUpdate) {
            updates.push({
                range: `'${SHEET_NAME}'!${columnLetter}1`,
                values: [[RESULT_HEADER]]
            });
        }
        let matched = 0;

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(delimiter).map(c => c.replace(/^\"|\"$/g, '').trim());
            if (cols.length <= Math.max(emailIdx, resultIdx)) continue;
            const email = (cols[emailIdx] || '').toLowerCase();
            const result = (cols[resultIdx] || 'unknown').trim();
            const rowNumber = emailRowMap.get(email);
            if (rowNumber) {
                updates.push({
                    range: `'${SHEET_NAME}'!${columnLetter}${rowNumber}`,
                    values: [[result]]
                });
                matched++;
                
                // Log the processed lead
                await logProcessedLead({
                    companyName: '',
                    website: '',
                    email: email,
                    country: '',
                    state: '',
                    processor: 'millionVerifier',
                    qualified: '',
                    verificationResult: result,
                    employeeCount: '',
                    sheetName: SHEET_NAME,
                    rowNumber: rowNumber.toString()
                });
                
                // Add to processed leads set for this session
                processedLeads.add(`email:${email}`);
            }
        }
        
        // Batch update the sheet
        if (updates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'RAW',
                    data: updates
                }
            });
            
            console.log(`✅ Updated ${updates.length - (headerNeedsUpdate ? 1 : 0)} rows with verification results (matched ${matched} emails)`);
        } else {
            console.warn('⚠️ No matching rows found to update. Possible header/delimiter mismatch or email normalization issue.');
            // Print a small sample to help debug
            const sample = lines.slice(0, Math.min(5, lines.length));
            console.warn(`Sample of downloaded lines (first ${sample.length}):`);
            sample.forEach((l, idx) => console.warn(`${idx}: ${l}`));
        }
        
    } catch (error) {
        console.error('🔴 Error updating Google Sheets:', error.message);
        throw error;
    }
}

async function verifyEmailList() {
    try {
        let emails, emailRowMap, processedLeads;
        let isCSVMode = false;
        let csvData = null;
        
        // --- 1. Read emails from CSV or Google Sheets ---
        if (INPUT_CSV) {
            console.log(`📖 Reading emails from CSV file...`);
            isCSVMode = true;
            csvData = await readEmailsFromCSV(INPUT_CSV);
            ({ emails, emailRowMap, processedLeads } = csvData);
        } else {
            console.log(`📖 Reading emails from Google Sheets...`);
            const sheetData = await readEmailsFromSheet();
            ({ emails, emailRowMap, processedLeads } = sheetData);
            csvData = sheetData;
        }
        
        if (emails.length === 0) {
            console.log('No emails found to verify.');
            return;
        }
        // --- 2a. If a local report is provided, use it directly (no upload/credits) ---
        const argReport = (process.argv || []).find(a => a.startsWith('--local-report='));
        const localReportPath = argReport ? argReport.split('=')[1] : process.env.LOCAL_REPORT_PATH;
        if (localReportPath) {
            const resolved = path.isAbsolute(localReportPath) ? localReportPath : path.join(__dirname, localReportPath);
            console.log(`🛈 Using local report: ${resolved} (skipping upload and verification)`);
            const csvFromDisk = await fsp.readFile(resolved, 'utf8');
            
            if (isCSVMode) {
                await writeCSVWithResults(csvFromDisk, emailRowMap, processedLeads, csvData);
                const outputPath = OUTPUT_CSV || INPUT_CSV.replace(/\.csv$/i, '_verified.csv');
                console.log(`✅ Wrote results from local report to ${outputPath}`);
            } else {
                await updateSheetsWithResults(csvFromDisk, emailRowMap, processedLeads, {
                    columnLetter: csvData.resultColumnLetter,
                    columnIndex: csvData.resultColumnIndex,
                    headerNeedsUpdate: csvData.headerNeedsUpdate
                });
                console.log(`✅ Wrote results from local report to column ${csvData.resultColumnLetter} on sheet '${SHEET_NAME}'.`);
            }
            return;
        }

        // --- 2b. Create temporary CSV content ---
        const csvContent = createCSVContent(emails);
        const tempFilePath = path.join(__dirname, 'temp_emails.csv');
        await fsp.writeFile(tempFilePath, csvContent);
        
        console.log(`📄 Created temporary CSV file with ${emails.length} emails`);
        
        // --- 3. Upload the CSV File ---
        console.log(`⬆️ Uploading emails to MillionVerifier...`);
        const form = new FormData();
        // Attach file with a filename as required by multipart/form-data
        form.append('file_contents', fs.createReadStream(tempFilePath), {
            filename: 'emails.csv',
            contentType: 'text/csv'
        });

        const uploadResponse = await axios.post(`${UPLOAD_URL}?key=${API_KEY}`, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        // API returns 200 always; check for presence of file_id or error
        const fileId = uploadResponse.data && uploadResponse.data.file_id;
        if (!fileId) {
            throw new Error(`Upload failed: ${typeof uploadResponse.data === 'object' ? JSON.stringify(uploadResponse.data) : String(uploadResponse.data)}`);
        }
        console.log(`✅ File uploaded successfully! File ID: ${fileId}`);

        // --- 4. Check Verification Status ---
        console.log("----------------------------------------");
        console.log("⏳ Checking verification status (this may take a while)...");
        let status = '';
        while (status !== 'finished') {
            const statusResponse = await axios.get(FILE_INFO_URL, {
                params: { key: API_KEY, file_id: fileId }
            });

            status = statusResponse.data.status;
            if (status === 'finished') {
                console.log("✅ Email verification complete!");
                break;
            }

            const progress = (
                typeof statusResponse.data.percent !== 'undefined'
                    ? statusResponse.data.percent
                    : statusResponse.data.progress_in_percent
            );
            console.log(`🔄 Verification in progress: ${progress !== undefined ? progress : '?'}%...`);
            await sleep(30000); // Wait for 30 seconds before checking again
        }

        // --- 5. Download and Process Results ---
        console.log("----------------------------------------");
        console.log("⬇️ Downloading verification results...");

        const downloadResponse = await axios.get(DOWNLOAD_URL, {
            params: { key: API_KEY, file_id: fileId, filter: 'all' },
            responseType: 'text',
        });

        // --- 6. Update Google Sheets or write CSV with Results ---
        if (isCSVMode) {
            await writeCSVWithResults(downloadResponse.data, emailRowMap, processedLeads, csvData);
        } else {
            await updateSheetsWithResults(downloadResponse.data, emailRowMap, processedLeads, {
                columnLetter: csvData.resultColumnLetter,
                columnIndex: csvData.resultColumnIndex,
                headerNeedsUpdate: csvData.headerNeedsUpdate
            });
        }
        
        // --- 7. Cleanup ---
        await fsp.unlink(tempFilePath);
        console.log(`🗑️ Cleaned up temporary file`);
        
        if (isCSVMode) {
            const outputPath = OUTPUT_CSV || INPUT_CSV.replace(/\.csv$/i, '_verified.csv');
            console.log(`\n🎉 Email verification complete! Results written to ${outputPath}`);
        } else {
            console.log(`\n🎉 Email verification complete! Results written to column ${csvData.resultColumnLetter} in '${SHEET_NAME}' sheet.`);
        }

    } catch (error) {
        if (error.response) {
            console.error(`🔴 API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
            console.error(`🔴 An error occurred: ${error.message}`);
        }
    }
}

// Function to write CSV with verification results
async function writeCSVWithResults(csvContent, emailRowMap, processedLeads, csvData) {
    try {
        const text = typeof csvContent === 'string' ? csvContent : String(csvContent);
        const cleaned = text.replace(/^\ufeff/, '');
        const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
        
        if (lines.length === 0) throw new Error('Downloaded results are empty');
        
        const delimiter = lines[0].includes(',') ? ',' : (lines[0].includes(';') ? ';' : '\t');
        const headers = lines[0].split(delimiter).map(h => h.replace(/^\"|\"$/g, '').trim());
        
        const emailIdx = headers.findIndex(h => h.toLowerCase().includes('email'));
        const resultIdx = headers.findIndex(h => {
            const s = h.toLowerCase();
            return s.includes('result') || s.includes('status') || s.includes('verdict') || s.includes('grade') || s.includes('state');
        });
        
        if (emailIdx === -1 || resultIdx === -1) {
            throw new Error('Could not find email or result column in verification results');
        }
        
        console.log(`📝 Writing verification results to CSV...`);
        
        const resultMap = new Map();
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(delimiter).map(c => c.replace(/^\"|\"$/g, '').trim());
            if (cols.length <= Math.max(emailIdx, resultIdx)) continue;
            const email = (cols[emailIdx] || '').toLowerCase();
            const result = (cols[resultIdx] || 'unknown').trim();
            resultMap.set(email, result);
            
            const rowNumber = emailRowMap.get(email);
            if (rowNumber) {
                await logProcessedLead({
                    companyName: '',
                    website: '',
                    email: email,
                    country: '',
                    state: '',
                    processor: 'millionVerifier',
                    qualified: '',
                    verificationResult: result,
                    employeeCount: '',
                    sheetName: INPUT_CSV,
                    rowNumber: rowNumber.toString()
                });
                processedLeads.add(`email:${email}`);
            }
        }
        
        // Build output rows with verification results
        const outputRows = csvData.rows.map(row => {
            const email = (row[csvData.emailColumnName] || '').toLowerCase().trim();
            const result = resultMap.get(email) || '';
            return {
                ...row,
                'MillionVerifier Result': result
            };
        });
        
        const outputPath = OUTPUT_CSV || INPUT_CSV.replace(/\.csv$/i, '_verified.csv');
        const resolvedOutput = path.isAbsolute(outputPath) ? outputPath : path.join(__dirname, outputPath);
        
        // Use csv-writer to properly handle quoted fields
        const csvWriter = createObjectCsvWriter({
            path: resolvedOutput,
            header: [...csvData.headers.map(h => ({ id: h, title: h })), { id: 'MillionVerifier Result', title: 'MillionVerifier Result' }]
        });
        
        await csvWriter.writeRecords(outputRows);
        
        console.log(`✅ Wrote ${resultMap.size} verification results to ${resolvedOutput}`);
    } catch (error) {
        console.error('🔴 Error writing CSV with results:', error.message);
        throw error;
    }
}

verifyEmailList();