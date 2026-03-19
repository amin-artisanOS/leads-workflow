import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';
import createCsvWriter from 'csv-writer';

// --- Basic Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const PROCESSED_LEADS_CSV = path.join(__dirname, 'processed_leads.csv');
const HISTORICAL_DATA_DIR = path.join(__dirname, 'historical_leads');

// CSV Headers for tracking processed leads
const CSV_HEADERS = [
    { id: 'timestamp', title: 'Timestamp' },
    { id: 'companyName', title: 'Company Name' },
    { id: 'website', title: 'Website' },
    { id: 'email', title: 'Email' },
    { id: 'country', title: 'Country' },
    { id: 'state', title: 'State' },
    { id: 'processor', title: 'Processor' }, // 'leadQualifier' or 'millionVerifier'
    { id: 'qualified', title: 'Qualified' },
    { id: 'verificationResult', title: 'Verification Result' },
    { id: 'employeeCount', title: 'Employee Count' },
    { id: 'sheetName', title: 'Sheet Name' },
    { id: 'rowNumber', title: 'Row Number' }
];

/**
 * Creates the processed leads CSV file if it doesn't exist
 */
async function initializeProcessedLeadsCSV() {
    try {
        // Check if file exists
        await fsp.access(PROCESSED_LEADS_CSV);
        console.log(`📄 Processed leads CSV already exists: ${PROCESSED_LEADS_CSV}`);
    } catch (error) {
        // File doesn't exist, create it with headers
        const csvWriter = createCsvWriter.createObjectCsvWriter({
            path: PROCESSED_LEADS_CSV,
            header: CSV_HEADERS
        });
        
        await csvWriter.writeRecords([]); // Write just the headers
        console.log(`📄 Created new processed leads CSV: ${PROCESSED_LEADS_CSV}`);
    }
}

/**
 * Creates the historical data directory if it doesn't exist
 */
async function initializeHistoricalDataDir() {
    try {
        await fsp.access(HISTORICAL_DATA_DIR);
        console.log(`📁 Historical data directory already exists: ${HISTORICAL_DATA_DIR}`);
    } catch (error) {
        await fsp.mkdir(HISTORICAL_DATA_DIR, { recursive: true });
        console.log(`📁 Created historical data directory: ${HISTORICAL_DATA_DIR}`);
    }
}

/**
 * Loads all processed leads from the CSV file into a Set for quick duplicate checking
 * @returns {Promise<Set>} Set of unique lead identifiers
 */
async function loadProcessedLeads() {
    const processedLeads = new Set();
    
    try {
        await fsp.access(PROCESSED_LEADS_CSV);
        
        return new Promise((resolve, reject) => {
            fs.createReadStream(PROCESSED_LEADS_CSV)
                .pipe(csvParser())
                .on('data', (row) => {
                    // Create all possible identifiers from company name, website, and email
                    // Handle both camelCase and space-separated column names
                    const companyName = row.companyName || row['Company Name'] || '';
                    const website = row.website || row.Website || '';
                    const email = row.email || row.Email || '';
                    
                    // Normalize and create all possible identifiers
                    const normalizedCompany = (companyName || '').toLowerCase().trim();
                    const normalizedWebsite = (website || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
                    const normalizedEmail = (email || '').toLowerCase().trim();
                    
                    // Add all valid identifiers
                    if (normalizedEmail) {
                        processedLeads.add(`email:${normalizedEmail}`);
                    }
                    if (normalizedWebsite) {
                        processedLeads.add(`website:${normalizedWebsite}`);
                    }
                    if (normalizedCompany) {
                        processedLeads.add(`company:${normalizedCompany}`);
                    }
                })
                .on('end', () => {
                    console.log(`📊 Loaded ${processedLeads.size} processed leads from CSV`);
                    resolve(processedLeads);
                })
                .on('error', (error) => {
                    console.error('🔴 Error reading processed leads CSV:', error);
                    reject(error);
                });
        });
    } catch (error) {
        // File doesn't exist, return empty set
        console.log('📊 No existing processed leads CSV found, starting fresh');
        return processedLeads;
    }
}

/**
 * Creates a unique identifier for a lead based on company name, website, and email
 * @param {string} companyName 
 * @param {string} website 
 * @param {string} email 
 * @returns {string} Unique identifier
 */
function createLeadIdentifier(companyName = '', website = '', email = '') {
    // Normalize inputs
    const normalizedCompany = (companyName || '').toLowerCase().trim();
    const normalizedWebsite = (website || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
    const normalizedEmail = (email || '').toLowerCase().trim();
    
    // Create identifier - prioritize email, then website, then company name
    if (normalizedEmail) {
        return `email:${normalizedEmail}`;
    } else if (normalizedWebsite) {
        return `website:${normalizedWebsite}`;
    } else if (normalizedCompany) {
        return `company:${normalizedCompany}`;
    }
    
    return null; // No valid identifier
}

/**
 * Checks if a lead has already been processed
 * @param {Set} processedLeads Set of processed lead identifiers
 * @param {string} companyName 
 * @param {string} website 
 * @param {string} email 
 * @returns {boolean} True if lead is a duplicate
 */
function isDuplicateLead(processedLeads, companyName, website, email) {
    // Check all possible identifiers, not just the primary one
    const normalizedCompany = (companyName || '').toLowerCase().trim();
    const normalizedWebsite = (website || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
    const normalizedEmail = (email || '').toLowerCase().trim();
    
    // Check email identifier
    if (normalizedEmail) {
        if (processedLeads.has(`email:${normalizedEmail}`)) {
            return true;
        }
    }
    
    // Check website identifier
    if (normalizedWebsite) {
        if (processedLeads.has(`website:${normalizedWebsite}`)) {
            return true;
        }
    }
    
    // Check company identifier
    if (normalizedCompany) {
        if (processedLeads.has(`company:${normalizedCompany}`)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Logs a processed lead to the CSV file
 * @param {object} leadData Lead information to log
 */
async function logProcessedLead(leadData) {
    const {
        companyName = '',
        website = '',
        email = '',
        country = '',
        state = '',
        processor = '',
        qualified = '',
        verificationResult = '',
        employeeCount = '',
        sheetName = '',
        rowNumber = ''
    } = leadData;
    
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: PROCESSED_LEADS_CSV,
        header: CSV_HEADERS,
        append: true
    });
    
    const record = {
        timestamp: new Date().toISOString(),
        companyName,
        website,
        email,
        country,
        state,
        processor,
        qualified,
        verificationResult,
        employeeCount,
        sheetName,
        rowNumber
    };
    
    try {
        await csvWriter.writeRecords([record]);
        console.log(`📝 Logged processed lead: ${companyName || email || website || 'Unknown'}`);
    } catch (error) {
        console.error('🔴 Error logging processed lead:', error);
        throw error;
    }
}

/**
 * Imports historical CSV files from the historical data directory
 * @returns {Promise<number>} Number of leads imported
 */
async function importHistoricalData() {
    try {
        await initializeHistoricalDataDir();
        
        const files = await fsp.readdir(HISTORICAL_DATA_DIR);
        const csvFiles = files.filter(file => file.toLowerCase().endsWith('.csv'));
        
        if (csvFiles.length === 0) {
            console.log('📂 No historical CSV files found to import');
            return 0;
        }
        
        console.log(`📂 Found ${csvFiles.length} historical CSV files to import`);
        
        let totalImported = 0;
        const csvWriter = createCsvWriter.createObjectCsvWriter({
            path: PROCESSED_LEADS_CSV,
            header: CSV_HEADERS,
            append: true
        });
        
        for (const file of csvFiles) {
            const filePath = path.join(HISTORICAL_DATA_DIR, file);
            console.log(`📥 Importing ${file}...`);
            
            const records = [];
            
            await new Promise((resolve, reject) => {
                fs.createReadStream(filePath)
                    .pipe(csvParser())
                    .on('data', (row) => {
                        // Map historical data to our format
                        const record = {
                            timestamp: row.timestamp || row.Timestamp || new Date().toISOString(),
                            companyName: row.companyName || row['Company Name'] || row.company || '',
                            website: row.website || row.Website || row.url || '',
                            email: row.email || row.Email || '',
                            country: row.country || row.Country || '',
                            state: row.state || row.State || '',
                            processor: 'historical_import',
                            qualified: row.qualified || row.Qualified || '',
                            verificationResult: row.verificationResult || row['Verification Result'] || '',
                            employeeCount: row.employeeCount || row['Employee Count'] || '',
                            sheetName: row.sheetName || row['Sheet Name'] || file,
                            rowNumber: row.rowNumber || row['Row Number'] || ''
                        };
                        records.push(record);
                    })
                    .on('end', () => {
                        resolve();
                    })
                    .on('error', (error) => {
                        console.error(`🔴 Error reading ${file}:`, error);
                        reject(error);
                    });
            });
            
            if (records.length > 0) {
                await csvWriter.writeRecords(records);
                totalImported += records.length;
                console.log(`✅ Imported ${records.length} records from ${file}`);
            }
        }
        
        console.log(`🎉 Total historical records imported: ${totalImported}`);
        return totalImported;
        
    } catch (error) {
        console.error('🔴 Error importing historical data:', error);
        throw error;
    }
}

/**
 * Gets statistics about processed leads
 * @returns {Promise<object>} Statistics object
 */
async function getProcessedLeadsStats() {
    try {
        const processedLeads = await loadProcessedLeads();
        const stats = {
            totalProcessed: processedLeads.size,
            byProcessor: {},
            byQualification: {},
            byVerification: {}
        };
        
        // Read detailed stats from CSV
        await new Promise((resolve, reject) => {
            fs.createReadStream(PROCESSED_LEADS_CSV)
                .pipe(csvParser())
                .on('data', (row) => {
                    // Count by processor (handle both formats)
                    const processor = row.processor || row.Processor || row['Processor'] || 'unknown';
                    stats.byProcessor[processor] = (stats.byProcessor[processor] || 0) + 1;
                    
                    // Count by qualification (handle both formats)
                    const qualified = row.qualified || row.Qualified || row['Qualified'] || 'unknown';
                    stats.byQualification[qualified] = (stats.byQualification[qualified] || 0) + 1;
                    
                    // Count by verification result (handle both formats)
                    const verification = row.verificationResult || row['Verification Result'] || row.VerificationResult || 'unknown';
                    stats.byVerification[verification] = (stats.byVerification[verification] || 0) + 1;
                })
                .on('end', () => {
                    resolve();
                })
                .on('error', (error) => {
                    reject(error);
                });
        });
        
        return stats;
    } catch (error) {
        console.error('🔴 Error getting processed leads stats:', error);
        return { totalProcessed: 0, byProcessor: {}, byQualification: {}, byVerification: {} };
    }
}

// Export all functions
export {
    initializeProcessedLeadsCSV,
    initializeHistoricalDataDir,
    loadProcessedLeads,
    createLeadIdentifier,
    isDuplicateLead,
    logProcessedLead,
    importHistoricalData,
    getProcessedLeadsStats,
    PROCESSED_LEADS_CSV,
    HISTORICAL_DATA_DIR
};
