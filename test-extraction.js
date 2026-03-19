#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const datasetPath = path.join(__dirname, 'hospitality_construction_runs/google-serp-test/dataset_google-search-scraper_2025-10-17_14-48-21-763.json');
const rawData = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

console.log('📊 Analyzing Apify dataset...\n');

const IGNORED_DOMAIN_SUFFIXES = [
  'google.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'pinterest.com',
  'wikipedia.org',
  'news.google.com',
  'maps.google.com',
  'bing.com',
  'duckduckgo.com',
  'yahoo.com'
];

function normalizeDomain(value) {
  if (!value) return '';
  return value
    .toString()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .trim();
}

function shouldIgnoreDomain(domain) {
  if (!domain) return true;
  const lc = domain.toLowerCase();
  return IGNORED_DOMAIN_SUFFIXES.some((suffix) => lc === suffix || lc.endsWith(`.${suffix}`));
}

const domains = new Set();
const filtered = new Set();
const kept = new Set();

rawData.forEach((page) => {
  const organicResults = page.organicResults || [];
  organicResults.forEach((item) => {
    const url = item.url || '';
    const domain = normalizeDomain(url);
    if (domain) {
      domains.add(domain);
      if (shouldIgnoreDomain(domain)) {
        filtered.add(domain);
      } else {
        kept.add(domain);
      }
    }
  });
});

console.log(`Total unique domains: ${domains.size}`);
console.log(`Filtered out: ${filtered.size}`);
console.log(`Kept for extraction: ${kept.size}\n`);

if (filtered.size > 0) {
  console.log('🚫 Filtered domains:');
  Array.from(filtered).forEach((d) => console.log(`   - ${d}`));
  console.log('');
}

if (kept.size > 0) {
  console.log('✅ Kept domains:');
  Array.from(kept).forEach((d) => console.log(`   - ${d}`));
} else {
  console.log('⚠️  No domains survived filtering. Consider:');
  console.log('   1. Using construction-focused queries (e.g., "hotel construction contractor dubai")');
  console.log('   2. Relaxing the domain filter to include media sites');
  console.log('   3. Adding a content scraper to extract contractor names from articles');
}
