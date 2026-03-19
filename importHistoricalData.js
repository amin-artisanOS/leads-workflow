#!/usr/bin/env node

import { 
    initializeProcessedLeadsCSV, 
    initializeHistoricalDataDir, 
    importHistoricalData, 
    getProcessedLeadsStats 
} from './leadTracker.js';

/**
 * Script to import historical CSV data into the processed leads tracking system
 * Usage: node importHistoricalData.js
 * 
 * This script will:
 * 1. Create the historical_leads directory if it doesn't exist
 * 2. Look for CSV files in the historical_leads directory
 * 3. Import all found CSV files into the main processed_leads.csv
 * 4. Display statistics about the imported data
 */

async function main() {
    console.log('🚀 Starting historical data import process...\n');
    
    try {
        // Initialize the tracking system
        console.log('📋 Initializing lead tracking system...');
        await initializeProcessedLeadsCSV();
        await initializeHistoricalDataDir();
        
        // Show initial stats
        console.log('\n📊 Current processed leads statistics:');
        const initialStats = await getProcessedLeadsStats();
        console.log(`   Total processed leads: ${initialStats.totalProcessed}`);
        console.log(`   By processor:`, initialStats.byProcessor);
        console.log(`   By qualification:`, initialStats.byQualification);
        console.log(`   By verification:`, initialStats.byVerification);
        
        // Import historical data
        console.log('\n📥 Importing historical data...');
        const importedCount = await importHistoricalData();
        
        if (importedCount > 0) {
            // Show final stats
            console.log('\n📊 Updated processed leads statistics:');
            const finalStats = await getProcessedLeadsStats();
            console.log(`   Total processed leads: ${finalStats.totalProcessed}`);
            console.log(`   By processor:`, finalStats.byProcessor);
            console.log(`   By qualification:`, finalStats.byQualification);
            console.log(`   By verification:`, finalStats.byVerification);
            
            console.log(`\n✅ Successfully imported ${importedCount} historical records!`);
        } else {
            console.log('\n📂 No historical data found to import.');
            console.log('💡 To import historical data:');
            console.log('   1. Place your CSV files in the historical_leads/ directory');
            console.log('   2. Run this script again');
        }
        
        console.log('\n🎉 Historical data import process complete!');
        
    } catch (error) {
        console.error('\n🔴 Error during historical data import:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default main;
