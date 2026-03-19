#!/usr/bin/env node

import { 
    getProcessedLeadsStats, 
    PROCESSED_LEADS_CSV, 
    HISTORICAL_DATA_DIR 
} from './leadTracker.js';
import { promises as fs } from 'fs';

/**
 * Script to display statistics about processed leads
 * Usage: node leadStats.js
 */

async function displayStats() {
    console.log('📊 Lead Processing Statistics\n');
    console.log('=' .repeat(50));
    
    try {
        // Check if processed leads file exists
        try {
            await fs.access(PROCESSED_LEADS_CSV);
            console.log(`✅ Processed leads file: ${PROCESSED_LEADS_CSV}`);
        } catch (error) {
            console.log(`❌ Processed leads file not found: ${PROCESSED_LEADS_CSV}`);
            console.log('💡 Run leadQualifier.js or millionVerifier.js to start tracking leads');
            return;
        }
        
        // Check historical data directory
        try {
            await fs.access(HISTORICAL_DATA_DIR);
            const files = await fs.readdir(HISTORICAL_DATA_DIR);
            const csvFiles = files.filter(file => file.toLowerCase().endsWith('.csv'));
            console.log(`📁 Historical data directory: ${HISTORICAL_DATA_DIR}`);
            console.log(`   CSV files found: ${csvFiles.length}`);
            if (csvFiles.length > 0) {
                csvFiles.forEach(file => console.log(`   - ${file}`));
            }
        } catch (error) {
            console.log(`📁 Historical data directory not found: ${HISTORICAL_DATA_DIR}`);
        }
        
        console.log('\n' + '-'.repeat(50));
        
        // Get and display statistics
        const stats = await getProcessedLeadsStats();
        
        console.log(`\n📈 TOTAL PROCESSED LEADS: ${stats.totalProcessed}`);
        
        if (Object.keys(stats.byProcessor).length > 0) {
            console.log('\n🔧 BY PROCESSOR:');
            Object.entries(stats.byProcessor).forEach(([processor, count]) => {
                console.log(`   ${processor}: ${count}`);
            });
        }
        
        if (Object.keys(stats.byQualification).length > 0) {
            console.log('\n✅ BY QUALIFICATION:');
            Object.entries(stats.byQualification).forEach(([qualification, count]) => {
                console.log(`   ${qualification}: ${count}`);
            });
        }
        
        if (Object.keys(stats.byVerification).length > 0) {
            console.log('\n📧 BY EMAIL VERIFICATION:');
            Object.entries(stats.byVerification).forEach(([verification, count]) => {
                console.log(`   ${verification}: ${count}`);
            });
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('\n💡 TIPS:');
        console.log('   • To import historical data: node importHistoricalData.js');
        console.log('   • To process new leads: node leadQualifier.js or node millionVerifier.js');
        console.log('   • Historical CSV files go in: historical_leads/');
        
    } catch (error) {
        console.error('🔴 Error getting statistics:', error.message);
        process.exit(1);
    }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    displayStats();
}

export default displayStats;
