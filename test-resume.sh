#!/bin/bash
set -e

echo "Testing resume workflow..."
echo ""
echo "1. Resume from Apify dataset (skip search, run extraction + Gemini + leads)"
node hospitalityConstructionLeads.js \
  --skip-search \
  --search-file="hospitality_construction_runs/google-serp-test/dataset_google-search-scraper_2025-10-17_14-48-21-763.json" \
  --run-name="google-serp-test" \
  --max-companies=2

echo ""
echo "✅ Test completed successfully"
