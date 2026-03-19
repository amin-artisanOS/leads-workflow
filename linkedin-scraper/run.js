const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from parent directory's .env file
const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

// Debug: Log loaded environment variables
console.log('Environment Variables Loaded:');
console.log(`- JOB_KEYWORDS: ${process.env.JOB_KEYWORDS}`);
console.log(`- JOB_LOCATION: ${process.env.JOB_LOCATION}`);
console.log(`- INDUSTRY_IDS: ${process.env.INDUSTRY_IDS}`);

// Check for required environment variables
if (!process.env.JOB_KEYWORDS || !process.env.JOB_LOCATION) {
    console.error('❌ Error: JOB_KEYWORDS and JOB_LOCATION environment variables are required');
    console.log('\nPlease make sure your .env file in the project root contains:');
    console.log('JOB_KEYWORDS="your job title or keywords"');
    console.log('JOB_LOCATION="desired location"');
    console.log('\nExample:');
    console.log('JOB_KEYWORDS="software engineer"');
    console.log('JOB_LOCATION="United States"');
    console.log('\nCurrent working directory:', process.cwd());
    console.log('Looking for .env at:', envPath);
    process.exit(1);
}

// Build the search URL from environment variables
function buildSearchUrl() {
    const baseUrl = 'https://www.linkedin.com/jobs/search/';
    const params = new URLSearchParams();
    
    // Required parameters
    params.append('keywords', process.env.JOB_KEYWORDS);
    params.append('location', process.env.JOB_LOCATION);
    
    // Optional filters
    if (process.env.EXPERIENCE_LEVEL) {
        process.env.EXPERIENCE_LEVEL.split(',').forEach(level => {
            params.append('f_E', level.trim());
        });
    }
    
    if (process.env.JOB_TYPE) {
        params.append('f_JT', process.env.JOB_TYPE);
    }
    
    if (process.env.REMOTE_ONLY === 'true') {
        params.append('f_WT', '2'); // 2 = Remote
    }
    
    if (process.env.DATE_POSTED) {
        params.append('f_TPR', `r${process.env.DATE_POSTED * 86400}`); // Convert days to seconds
    }
    
    // Add industry filter if specified
    if (process.env.INDUSTRY_IDS) {
        process.env.INDUSTRY_IDS.split(',').forEach(id => {
            params.append('f_I', id.trim());
        });
    }
    
    return `${baseUrl}?${params.toString()}`;
}

// Set the search URL as an environment variable
process.env.LINKEDIN_SEARCH_URL = buildSearchUrl();

// Log the configuration
console.log('🚀 Starting LinkedIn Jobs Scraper with the following configuration:');
console.log(`🔍 Keywords: ${process.env.JOB_KEYWORDS}`);
console.log(`📍 Location: ${process.env.JOB_LOCATION}`);
console.log(`📊 Max Results: ${process.env.MAX_RESULTS || '100'}`);
console.log(`🔧 Debug Mode: ${process.env.DEBUG_LOG === 'true' ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`🌐 Search URL: ${process.env.LINKEDIN_SEARCH_URL}\n`);

// Import the Playwright-based scraper (no Apify dependency)
require('./playwrightScraper');
