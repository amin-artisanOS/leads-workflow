import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const CREDENTIALS_PATH = '/Users/aminb101/leads-workflow/iuh-content-and-ecom-systems-934f3f80d780.json';
const SPREADSHEET_ID = '1_rX2OWFpvSGFyR0EsIVZLuoxTKE5JX66Q5o6Z5_VCrg';
const SHEET_NAME = 'pharmaceutical chemical companies';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const auth = async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: SCOPES,
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
};

async function checkColumns() {
  try {
    const sheets = await auth();
    
    // Read first few rows to check column content
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A1:AZ10`, // Check first 10 rows, columns A-AZ
    });
    
    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('No data found');
      return;
    }
    
    console.log('Header row:', rows[0]);
    console.log('\nChecking for website URLs in different columns...\n');
    
    // Check each column for URLs
    for (let colIndex = 0; colIndex < rows[0].length; colIndex++) {
      const columnLetter = String.fromCharCode(65 + Math.floor(colIndex / 26)) + String.fromCharCode(65 + (colIndex % 26));
      const headerName = rows[0][colIndex] || `Column ${columnLetter}`;
      
      // Check if this column contains URLs
      let urlCount = 0;
      let sampleUrls = [];
      
      for (let rowIndex = 1; rowIndex < Math.min(rows.length, 10); rowIndex++) {
        const cellValue = rows[rowIndex][colIndex];
        if (cellValue && (cellValue.includes('http') || cellValue.includes('www.') || cellValue.includes('.com'))) {
          urlCount++;
          if (sampleUrls.length < 3) {
            sampleUrls.push(cellValue);
          }
        }
      }
      
      if (urlCount > 0) {
        console.log(`Column ${columnLetter} (${headerName}): ${urlCount} URLs found`);
        console.log(`Sample URLs:`, sampleUrls);
        console.log('---');
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkColumns();
