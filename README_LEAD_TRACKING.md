# Lead Tracking System

This system tracks all processed leads to prevent duplicates and maintain a comprehensive record of your lead processing workflow.

## Overview

The lead tracking system consists of:
- **processed_leads.csv**: Main CSV file that stores all processed leads
- **historical_leads/**: Directory for importing historical CSV data
- **leadTracker.js**: Core module for lead tracking functionality
- **importHistoricalData.js**: Script to import historical data
- **leadStats.js**: Script to view statistics

## Features

### Duplicate Detection
- Automatically detects duplicate leads based on:
  - Email address (highest priority)
  - Website domain (medium priority)  
  - Company name (lowest priority)
- Prevents processing the same lead multiple times
- Works across both `leadQualifier.js` and `millionVerifier.js`

### Comprehensive Tracking
Each processed lead is logged with:
- Timestamp
- Company name, website, email
- Location (country, state)
- Processor used (leadQualifier or millionVerifier)
- Qualification result (YES/NO/DUPLICATE)
- Email verification result
- Employee count
- Source sheet name and row number

### Historical Data Import
- Import existing CSV files from previous processing runs
- Flexible column mapping supports various CSV formats
- Maintains data integrity and prevents duplicates

## Usage

### 1. Install Dependencies
```bash
npm install
```

### 2. Process New Leads
```bash
# Qualify leads (with duplicate detection)
npm run qualify-leads
# or
node leadQualifier.js

# Verify emails (with duplicate detection)
npm run verify-emails
# or
node millionVerifier.js
```

### 3. Import Historical Data
```bash
# Place your historical CSV files in the historical_leads/ directory
# Then run:
npm run import-historical
# or
node importHistoricalData.js
```

### 4. View Statistics
```bash
npm run lead-stats
# or
node leadStats.js
```

## File Structure

```
leads-workflow/
├── processed_leads.csv          # Main tracking file (auto-created)
├── historical_leads/            # Directory for historical CSV files
│   ├── old_leads_2024_01.csv   # Example historical file
│   └── previous_batch.csv      # Example historical file
├── leadTracker.js              # Core tracking module
├── leadQualifier.js            # Modified to use tracking
├── millionVerifier.js          # Modified to use tracking
├── importHistoricalData.js     # Historical data import script
└── leadStats.js                # Statistics display script
```

## CSV Format

The `processed_leads.csv` file contains these columns:

| Column | Description |
|--------|-------------|
| Timestamp | When the lead was processed |
| Company Name | Name of the company |
| Website | Company website |
| Email | Email address |
| Country | Company country |
| State | Company state/region |
| Processor | Which script processed it (leadQualifier/millionVerifier) |
| Qualified | Qualification result (YES/NO/DUPLICATE) |
| Verification Result | Email verification result |
| Employee Count | Number of employees |
| Sheet Name | Source Google Sheet name |
| Row Number | Row number in the source sheet |

## Historical Data Import

### Supported CSV Formats
The import script automatically maps common column names:
- **Company**: `companyName`, `Company Name`, `company`
- **Website**: `website`, `Website`, `url`
- **Email**: `email`, `Email`
- **Country**: `country`, `Country`
- **State**: `state`, `State`
- **Qualification**: `qualified`, `Qualified`
- **Verification**: `verificationResult`, `Verification Result`
- **Employees**: `employeeCount`, `Employee Count`

### Import Process
1. Place CSV files in `historical_leads/` directory
2. Run `npm run import-historical`
3. Files are processed and data is merged into `processed_leads.csv`
4. Original files remain unchanged in `historical_leads/`

## Duplicate Detection Logic

The system creates unique identifiers for leads using this priority:

1. **Email-based**: `email:user@domain.com`
2. **Website-based**: `website:domain.com` (normalized, no www/https)
3. **Company-based**: `company:company name` (normalized, lowercase)

A lead is considered a duplicate if any of these identifiers match an existing processed lead.

## Integration with Existing Scripts

### leadQualifier.js Changes
- Loads processed leads at startup
- Checks for duplicates before processing
- Logs each processed lead to CSV
- Marks duplicates as "DUPLICATE" in the qualification column

### millionVerifier.js Changes
- Loads processed leads at startup
- Filters out duplicate emails before verification
- Logs each verified email to CSV
- Maintains email-to-row mapping for updates

## Troubleshooting

### Common Issues

1. **CSV file not found**
   - Run any processing script once to auto-create the file
   - Or run `npm run import-historical` to initialize

2. **Historical import not working**
   - Check that CSV files are in `historical_leads/` directory
   - Ensure CSV files have proper headers
   - Check console output for specific error messages

3. **Duplicates not being detected**
   - Verify that the CSV file exists and is readable
   - Check that company names/websites/emails are properly formatted
   - Run `npm run lead-stats` to verify data is being tracked

### Debug Information
- All scripts provide detailed console output
- Use `npm run lead-stats` to verify the system is working
- Check the `processed_leads.csv` file directly for data verification

## Benefits

1. **Prevents Duplicate Processing**: Saves time and API costs
2. **Comprehensive Audit Trail**: Track all processing activities
3. **Historical Data Integration**: Import and merge old data
4. **Cross-Script Compatibility**: Works with both qualification and verification
5. **Flexible Import**: Handles various CSV formats automatically
6. **Easy Monitoring**: Built-in statistics and reporting
