import { ApifyClient } from 'apify-client';

// Configuration
const CONFIG = {
    // Replace with your actual Apify API token
    APIFY_TOKEN: process.env.APIFY_TOKEN || 'your_apify_token_here',
    
    // Set to false to run your original complex search
    TEST_SEARCH: true, 
    
    // Output file
    OUTPUT_FILE: 'apollo_results.csv'
};

// Initialize the ApifyClient with API token
const client = new ApifyClient({
    token: CONFIG.APIFY_TOKEN,
});

// Prepare Actor input for "microworlds/apollo-scraper"
function getSearchInput() {
    if (CONFIG.TEST_SEARCH) {
        // Simple test search, updated for the new Actor
        return {
            "url": "https://app.apollo.io/#/people?page=1&personTitles[]=ceo&organizationNumEmployeesRanges[]=10,500",
            "max_result": 1000,  // This Actor uses "max_result". NOTE: It has a minimum charge of 100 leads.
            "contact_email_status_v2_verified": true,
            "contact_email_exclude_catch_all": true
        };
    }
    
    // Original complex search, updated for the new Actor
    return {
        "url": "https://app.apollo.io/#/people?page=1&contactEmailStatusV2[]=verified&personTitles[]=ceo&personTitles[]=owner&personTitles[]=export%20manager&personTitles[]=head%20of%20export&personTitles[]=sales%20director&personTitles[]=commercial%20director&personLocations[]=Europe&organizationNumEmployeesRanges[]=10%2C500&organizationIndustryTagIds[]=5567e1b3736964208b280000&qOrganizationKeywordTags[]=diary&qOrganizationKeywordTags[]=specialty%20food&qOrganizationKeywordTags[]=gourmet%20food&qOrganizationKeywordTags[]=olive%20oil&qOrganizationKeywordTags[]=cheese%20manufacturing&qOrganizationKeywordTags[]=seafood%20processing&includedOrganizationKeywordFields[]=tags&includedOrganizationKeywordFields[]=name&qNotOrganizationKeywordTags[]=wine&qNotOrganizationKeywordTags[]=winery&qNotOrganizationKeywordTags[]=brewery&qNotOrganizationKeywordTags[]=destillery&excludedOrganizationKeywordFields[]=tags&excludedOrganizationKeywordFields[]=name&excludedOrganizationKeywordFields[]=social_media_description&sortAscending=false&sortByField=recommendations_score",
        "max_result": 1000, // This Actor uses "max_result"
        "contact_email_status_v2_verified": true,
        "contact_email_exclude_catch_all": true
    };
}

const input = getSearchInput();

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Function to validate API token
async function validateApiToken() {
    try {
        console.log('🔑 Validating API token...');
        const user = await client.user().get();
        console.log(`✅ Connected to Apify as: ${user?.username || 'Unknown user'}`);
        return true;
    } catch (error) {
        console.error('❌ API token validation failed:', error.message);
        if (error.message.includes('401')) {
            console.error('The provided API token is invalid or has expired.');
        }
        return false;
    }
}

// Function to save results to file
function saveResults(items, filename) {
    try {
        const outputPath = join(__dirname, filename);
        const csvData = jsonToCsv(items);
        fs.writeFileSync(outputPath, csvData);
        console.log(`✅ Results saved to: ${outputPath}`);
        return outputPath;
    } catch (error) {
        console.error('❌ Error saving results:', error);
        throw error;
    }
}

// Helper function to convert JSON to CSV
function jsonToCsv(items) {
    if (!items || items.length === 0) return '';
    try {
        const headers = [...new Set(items.flatMap(item => Object.keys(item)))];
        let csv = headers.join(',') + '\n';
        items.forEach(item => {
            const row = headers.map(header => {
                let value = item[header] ?? '';
                if (typeof value === 'object' && value !== null) {
                    value = JSON.stringify(value);
                }
                return `"${String(value).replace(/"/g, '""')}"`;
            });
            csv += row.join(',') + '\n';
        });
        return csv;
    } catch (error) {
        console.error('❌ Error converting to CSV:', error);
        throw error;
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Main function
(async () => {
    try {
        console.log('🚀 Starting Apollo scraper...');
        const isValidToken = await validateApiToken();
        if (!isValidToken) {
            process.exit(1);
        }
        
        console.log('\n🔍 Search parameters:');
        console.log(`- URL: ${input.url}`);
        console.log(`- Max records requested: ${input.max_result}`); // UPDATED
        
        if (process.env.DEBUG) {
            console.log('\n🔍 Full input object:', JSON.stringify(input, null, 2));
        }
        
        console.log('\n🔄 Running Apollo actor...');
        const actorId = "microworlds/apollo-scraper"; // CORRECT ACTOR ID
        const run = await client.actor(actorId).call(input);
        
        console.log('\n📊 Run details:');
        console.log(`- Run ID: ${run.id}`);
        console.log(`- Status: ${run.status}`);
        console.log(`- Dataset ID: ${run.defaultDatasetId}`);
        
        if (!run.defaultDatasetId) {
            throw new Error('No dataset ID returned from the actor run');
        }
        
        console.log('\n📥 Fetching results...');
        const dataset = client.dataset(run.defaultDatasetId);
        const { items = [], total = 0 } = await dataset.listItems();
        
        console.log('\n📊 Dataset information:');
        console.log(`- Total items in dataset: ${total}`);
        
        if (items && items.length > 0) {
            console.log('\n🔍 Sample item structure:');
            console.log(JSON.stringify(items[0], null, 2));
            
            const outputPath = saveResults(items, CONFIG.OUTPUT_FILE);
            console.log(`✅ Success! Results saved to: ${outputPath}`);
            console.log(`📊 Total records found: ${items.length}`);
            
            if (CONFIG.TEST_SEARCH) {
                console.log('\n🎉 Test search successful! To run the full search, set TEST_SEARCH to false.');
            }
        } else {
            console.log('\n❌ No records found.');
            const outputPath = join(__dirname, CONFIG.OUTPUT_FILE);
            fs.writeFileSync(outputPath, 'No records found for the given search criteria.');
            console.log(`\n📝 Empty results file created at: ${outputPath}`);
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error('\n🔍 Error details:', error);
        process.exit(1);
    }
})();