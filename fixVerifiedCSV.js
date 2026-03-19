import fs from 'fs';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

const INPUT_CSV = 'dataset_leads-finder_2025-10-16_09-33-24-726.csv';
const VERIFICATION_RESULTS = 'verification_results_real.csv';
const OUTPUT_CSV = 'verified_leads_fixed.csv';

async function fixCSV() {
    console.log('📄 Reading original CSV...');
    
    // Read original data
    const originalRows = [];
    const originalHeaders = [];
    
    await new Promise((resolve, reject) => {
        fs.createReadStream(INPUT_CSV)
            .pipe(csvParser())
            .on('headers', (headers) => {
                originalHeaders.push(...headers);
                console.log(`✅ Found ${headers.length} columns in original CSV`);
            })
            .on('data', (row) => {
                originalRows.push(row);
            })
            .on('end', resolve)
            .on('error', reject);
    });
    
    console.log(`✅ Loaded ${originalRows.length} rows from original CSV`);
    
    // Read verification results
    console.log('📄 Reading verification results...');
    const verificationMap = new Map();
    
    await new Promise((resolve, reject) => {
        fs.createReadStream(VERIFICATION_RESULTS)
            .pipe(csvParser())
            .on('data', (row) => {
                const email = (row.email || row.Email || '').toLowerCase().trim();
                const result = row.result || row.Result || row.status || row.Status || 'unknown';
                if (email) {
                    verificationMap.set(email, result.trim());
                }
            })
            .on('end', resolve)
            .on('error', reject);
    });
    
    console.log(`✅ Loaded ${verificationMap.size} verification results`);
    
    // Find email column
    const emailColumn = originalHeaders.find(h => h.toLowerCase().includes('email'));
    if (!emailColumn) {
        throw new Error('No email column found in original CSV');
    }
    
    console.log(`📧 Email column: ${emailColumn}`);
    
    // Merge data
    console.log('🔄 Merging verification results...');
    const outputRows = originalRows.map(row => {
        const email = (row[emailColumn] || '').toLowerCase().trim();
        const verificationResult = verificationMap.get(email) || '';
        return {
            ...row,
            'MillionVerifier Result': verificationResult
        };
    });
    
    // Write output
    console.log(`💾 Writing to ${OUTPUT_CSV}...`);
    const csvWriter = createObjectCsvWriter({
        path: OUTPUT_CSV,
        header: [
            ...originalHeaders.map(h => ({ id: h, title: h })),
            { id: 'MillionVerifier Result', title: 'MillionVerifier Result' }
        ]
    });
    
    await csvWriter.writeRecords(outputRows);
    
    const matched = outputRows.filter(r => r['MillionVerifier Result']).length;
    console.log(`✅ Success! Wrote ${outputRows.length} rows with ${matched} verification results to ${OUTPUT_CSV}`);
    
    // Summary
    const resultCounts = {};
    outputRows.forEach(row => {
        const result = row['MillionVerifier Result'] || 'no_result';
        resultCounts[result] = (resultCounts[result] || 0) + 1;
    });
    
    console.log('\n📊 Verification Summary:');
    Object.entries(resultCounts).sort((a, b) => b[1] - a[1]).forEach(([result, count]) => {
        console.log(`   ${result}: ${count}`);
    });
}

fixCSV().catch(err => {
    console.error('🔴 Error:', err.message);
    process.exit(1);
});
