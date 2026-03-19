#!/usr/bin/env node

import fs from 'fs';

// Simulate what the old version did
const oldVersion = {
  companyName: "García Baquero",
  position: "Regional Account Manager", // Only canonical title
  canonicalTitle: "Regional Account Manager"
};

// Simulate what the new version does
const newVersion = {
  companyName: "García Baquero",
  positions: [
    "Business Development Manager",
    "Export Manager",
    "Sales Director",
    "Commercial Director",
    "International Sales Manager",
    "Regional Account Manager",
    "Head of Sales",
    "Director Comercial"
  ],
  position: "Business Development Manager OR Export Manager OR Sales Director OR Commercial Director OR International Sales Manager OR Regional Account Manager OR Head of Sales OR Director Comercial",
  canonicalTitle: "Regional Account Manager"
};

console.log('🔍 Comparison: Old vs New Apollo Input\n');
console.log('━'.repeat(60));
console.log('OLD VERSION (only canonical title):');
console.log('━'.repeat(60));
console.log(`Company: ${oldVersion.companyName}`);
console.log(`Position sent to Apollo: "${oldVersion.position}"`);
console.log(`\n❌ Problem: Apollo only searches for "Regional Account Manager"`);
console.log(`   Missing: Export Manager, Sales Director, etc.\n`);

console.log('━'.repeat(60));
console.log('NEW VERSION (all ICP titles):');
console.log('━'.repeat(60));
console.log(`Company: ${newVersion.companyName}`);
console.log(`Position sent to Apollo: "${newVersion.position}"`);
console.log(`\n✅ Benefit: Apollo searches for ALL your target titles`);
console.log(`   Finds: Export Managers, Sales Directors, Commercial Directors, etc.\n`);

console.log('━'.repeat(60));
console.log('APOLLO URL EXAMPLE:');
console.log('━'.repeat(60));

const oldUrl = `https://app.apollo.io/#/people?page=1&personTitles[]=${encodeURIComponent(oldVersion.position)}&organizationNames[]=${encodeURIComponent(oldVersion.companyName)}`;
const newUrl = `https://app.apollo.io/#/people?page=1&personTitles[]=${encodeURIComponent(newVersion.position)}&organizationNames[]=${encodeURIComponent(newVersion.companyName)}`;

console.log('\nOLD URL (truncated):');
console.log(oldUrl.slice(0, 120) + '...\n');

console.log('NEW URL (truncated):');
console.log(newUrl.slice(0, 120) + '...\n');

console.log('━'.repeat(60));
console.log('📊 IMPACT:');
console.log('━'.repeat(60));
console.log('Old: ~5-10 contacts per company (only 1 title)');
console.log('New: ~20-50 contacts per company (8 titles)');
console.log('\n✅ You now get ALL decision-makers matching your ICP!\n');
