# Lead Generation Pipeline

Automated end-to-end pipeline for generating qualified B2B leads from LinkedIn job postings.

## Quick Start

### 1. Configure Your ICP (Ideal Customer Profile)

Edit `icp-config.json` to define your target:

```json
{
  "titles": ["Export Manager", "Sales Director", ...],
  "industries": {
    "Food & Beverage Manufacturing": "34",
    "Machinery": "13"
  },
  "locations": ["Spain", "Germany", "France"],
  "experienceLevels": ["4", "5", "6"],
  "scraping": {
    "jobsPerCountry": 100
  },
  "apollo": {
    "leadsPerCompany": 200
  }
}
```

### 2. Run the Full Pipeline

**Run everything (all industries, all countries):**
```bash
node runLeadPipeline.js
```

**Filter by industry:**
```bash
node runLeadPipeline.js --industry "Food & Beverage"
```

**Filter by country:**
```bash
node runLeadPipeline.js --country "Spain,Italy,France"
```

**Combine filters:**
```bash
node runLeadPipeline.js --industry "Food" --country "Spain,Germany"
```

**Skip specific stages:**
```bash
# Skip URL generation (use existing URLs)
node runLeadPipeline.js --skip-generate

# Skip scraping (use existing scraped data)
node runLeadPipeline.js --skip-scrape

# Skip Gemini qualification
node runLeadPipeline.js --skip-qualify

# Skip Apollo enrichment
node runLeadPipeline.js --skip-apollo
```

**Dry run (preview configuration):**
```bash
node runLeadPipeline.js --industry "Food" --country "Spain" --dry-run
```

## Pipeline Stages

### Stage 1: Generate LinkedIn URLs
- Reads `icp-config.json`
- Generates country × industry LinkedIn job search URLs
- Fetches `currentJobId` for each URL using Apify
- Output: `linkedin_urls.json`

### Stage 2: Scrape LinkedIn Jobs
- Scrapes job postings from each generated URL
- Extracts company details, job descriptions, locations
- Output: `scraped_jobs.json`

### Stage 3: Qualify with Gemini AI
- Filters jobs using Gemini AI based on ICP criteria
- Removes recruiters, non-target industries, wrong seniority
- Output: `eu_qualified_jobs_gemini.json`, `eu_rejected_jobs_gemini.json`

### Stage 4: Enrich with Apollo.io
- Extracts decision-maker contacts from qualified companies
- Enriches with emails, phone numbers, LinkedIn profiles
- Output: `apollo_output/` directory with CSV/JSON files

## Output Structure

All pipeline runs are saved to `pipeline_runs/run_TIMESTAMP/`:

```
pipeline_runs/
└── run_2025-09-30T19-45-00/
    ├── config.json                          # Run configuration
    ├── linkedin_urls.json                   # Generated URLs
    ├── scraped_jobs.json                    # All scraped jobs
    ├── eu_qualified_jobs_gemini.json        # Qualified leads
    ├── eu_rejected_jobs_gemini.json         # Rejected leads
    ├── apollo_input_candidates_gemini.json  # Apollo input
    └── apollo_output/                       # Enriched contacts
        ├── apollo_run_TIMESTAMP.json
        └── apollo_run_TIMESTAMP.csv
```

## Configuration Reference

### `icp-config.json`

| Field | Description | Example |
|-------|-------------|---------|
| `titles` | Target job titles | `["Export Manager", "Sales Director"]` |
| `industries` | LinkedIn industry IDs | `{"Food & Beverage Manufacturing": "34"}` |
| `locations` | Target countries | `["Spain", "Germany", "France"]` |
| `experienceLevels` | LinkedIn experience codes | `["4", "5", "6"]` (Mid-Senior, Director, Executive) |
| `companySize.min` | Minimum employees | `50` |
| `companySize.max` | Maximum employees | `500` |
| `scraping.jobsPerCountry` | Jobs to scrape per URL | `100` |
| `apollo.leadsPerCompany` | Contacts per company | `200` |

### LinkedIn Experience Level Codes
- `1` = Internship
- `2` = Entry level
- `3` = Associate
- `4` = Mid-Senior level
- `5` = Director
- `6` = Executive

### LinkedIn Industry IDs (Common)
- `34` = Food & Beverage Manufacturing
- `39` = Food Production
- `23` = Farming
- `56` = Mining & Metals
- `13` = Machinery
- `18` = Chemicals
- `15` = Pharmaceuticals

## CLI Options

| Flag | Description | Example |
|------|-------------|---------|
| `--config` | Custom config file | `--config my-icp.json` |
| `--industry` | Filter industries (comma-separated) | `--industry "Food,Machinery"` |
| `--country` | Filter countries (comma-separated) | `--country "Spain,Italy"` |
| `--skip-generate` | Skip URL generation | |
| `--skip-scrape` | Skip LinkedIn scraping | |
| `--skip-qualify` | Skip Gemini qualification | |
| `--skip-apollo` | Skip Apollo enrichment | |
| `--dry-run` | Preview config without running | |

## Examples

### Example 1: Quick Test (Single Country + Industry)
```bash
node runLeadPipeline.js \
  --industry "Food & Beverage" \
  --country "Spain" \
  --dry-run
```

### Example 2: Full EU Food & Beverage Run
```bash
node runLeadPipeline.js --industry "Food"
```

### Example 3: Re-qualify Existing Data
```bash
# Skip scraping, re-run qualification + Apollo
node runLeadPipeline.js \
  --skip-generate \
  --skip-scrape
```

### Example 4: Custom Config for Machinery Sector
```bash
# Create custom config
cp icp-config.json machinery-config.json
# Edit machinery-config.json to focus on machinery industry

# Run with custom config
node runLeadPipeline.js --config machinery-config.json
```

## Integration with Lead Tracker

The pipeline automatically integrates with the existing lead tracking system:

- **Duplicate Detection**: Before Apollo enrichment, checks `processed_leads.csv` to avoid re-processing companies
- **Audit Trail**: Logs all qualified leads to `processed_leads.csv` with timestamps and source tracking
- **Statistics**: Use `npm run lead-stats` to view pipeline performance metrics

## Troubleshooting

### "No companies provided" error
- Ensure Gemini qualification produced `eu_qualified_jobs_gemini.json`
- Check that qualified jobs file has valid company names

### "Failed to fetch currentJobId"
- Apify actor requires `count >= 100`
- Check Apify token in `.env`
- Some country/industry combinations may have <100 jobs

### Pipeline hangs during scraping
- Large datasets take time (14 countries × 100 jobs = ~20 minutes)
- Monitor Apify dashboard for actor status
- Use `--skip-scrape` to resume from existing data

## Performance

Typical run times (14 countries, 1 industry):
- URL Generation: ~15 minutes (Apify lookups)
- Scraping: ~20 minutes (1,400 jobs)
- Gemini Qualification: ~2 minutes
- Apollo Enrichment: ~10 minutes (depends on company count)

**Total: ~45-50 minutes for full pipeline**

## Next Steps

After pipeline completion:
1. Review qualified leads in `eu_qualified_jobs_gemini.json`
2. Check enriched contacts in `apollo_output/`
3. Import to CRM or outreach tool
4. Use `npm run lead-stats` to track conversion metrics
