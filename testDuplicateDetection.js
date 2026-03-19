#!/usr/bin/env node

import { 
    loadProcessedLeads, 
    isDuplicateLead, 
    createLeadIdentifier 
} from './leadTracker.js';

/**
 * Test script to demonstrate duplicate detection functionality
 * Usage: node testDuplicateDetection.js
 */

async function testDuplicateDetection() {
    console.log('🧪 Testing Duplicate Detection System\n');
    console.log('=' .repeat(50));
    
    try {
        // Load existing processed leads
        console.log('📊 Loading processed leads...');
        const processedLeads = await loadProcessedLeads();
        console.log(`   Loaded ${processedLeads.size} processed leads\n`);
        
        // Test cases
        const testCases = [
            {
                name: 'Exact Email Match',
                companyName: 'Different Company Name',
                website: 'differentwebsite.com',
                email: 'info@acmefood.com', // This email exists in our sample data
                expectedDuplicate: true
            },
            {
                name: 'Exact Website Match',
                companyName: 'Different Company Name',
                website: 'acmefood.com', // This website exists in our sample data
                email: 'different@email.com',
                expectedDuplicate: true
            },
            {
                name: 'Exact Company Match',
                companyName: 'Acme Food Corp', // This company exists in our sample data
                website: 'differentwebsite.com',
                email: 'different@email.com',
                expectedDuplicate: true
            },
            {
                name: 'Website with www prefix',
                companyName: 'New Company',
                website: 'www.acmefood.com', // Should match acmefood.com
                email: 'new@email.com',
                expectedDuplicate: true
            },
            {
                name: 'Website with https prefix',
                companyName: 'New Company',
                website: 'https://europeandairy.eu', // Should match europeandairy.eu
                email: 'new@email.com',
                expectedDuplicate: true
            },
            {
                name: 'Case insensitive company match',
                companyName: 'ACME FOOD CORP', // Should match "Acme Food Corp"
                website: 'newwebsite.com',
                email: 'new@email.com',
                expectedDuplicate: true
            },
            {
                name: 'Completely New Lead',
                companyName: 'Brand New Company',
                website: 'brandnew.com',
                email: 'contact@brandnew.com',
                expectedDuplicate: false
            },
            {
                name: 'Empty Data',
                companyName: '',
                website: '',
                email: '',
                expectedDuplicate: false
            }
        ];
        
        console.log('🔍 Running Test Cases:\n');
        
        let passed = 0;
        let failed = 0;
        
        for (const testCase of testCases) {
            const isDuplicate = isDuplicateLead(
                processedLeads, 
                testCase.companyName, 
                testCase.website, 
                testCase.email
            );
            
            const identifier = createLeadIdentifier(
                testCase.companyName, 
                testCase.website, 
                testCase.email
            );
            
            const result = isDuplicate === testCase.expectedDuplicate ? '✅ PASS' : '❌ FAIL';
            
            console.log(`${result} ${testCase.name}`);
            console.log(`   Company: "${testCase.companyName}"`);
            console.log(`   Website: "${testCase.website}"`);
            console.log(`   Email: "${testCase.email}"`);
            console.log(`   Identifier: "${identifier}"`);
            console.log(`   Expected: ${testCase.expectedDuplicate ? 'DUPLICATE' : 'NEW'}`);
            console.log(`   Actual: ${isDuplicate ? 'DUPLICATE' : 'NEW'}\n`);
            
            if (isDuplicate === testCase.expectedDuplicate) {
                passed++;
            } else {
                failed++;
            }
        }
        
        console.log('=' .repeat(50));
        console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
        
        if (failed === 0) {
            console.log('🎉 All tests passed! Duplicate detection is working correctly.');
        } else {
            console.log('⚠️ Some tests failed. Please review the duplicate detection logic.');
        }
        
        // Show some existing identifiers for reference
        console.log('\n📋 Sample of existing lead identifiers:');
        let count = 0;
        for (const identifier of processedLeads) {
            if (count < 5) {
                console.log(`   ${identifier}`);
                count++;
            } else {
                break;
            }
        }
        if (processedLeads.size > 5) {
            console.log(`   ... and ${processedLeads.size - 5} more`);
        }
        
    } catch (error) {
        console.error('🔴 Error during testing:', error.message);
        process.exit(1);
    }
}

// Run the test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testDuplicateDetection();
}

export default testDuplicateDetection;
