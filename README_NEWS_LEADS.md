# News-Triggered Lead Generation Pipeline

Turn breaking news into high-intent sales leads with automated company extraction and personalized email generation.

## Overview

This pipeline monitors news for companies experiencing challenges (tariffs, supply chain issues, regulatory changes) and converts them into qualified leads with context-aware outreach emails.

## Workflow

```
Event Registry API → Extract Companies → Check Duplicates → Generate Emails
     (articles)          (Gemini AI)      (leadTracker)      (Gemini AI)
```

## Setup

### 1. Environment Variables

Add to `.env`:

```bash
# Event Registry (required)
EVENT_REGISTRY_API_KEY=your_key_here

# Gemini AI (required for extraction + email generation)
GEMINI_API_KEY=your_key_here

# Optional: Email personalization defaults
YOUR_COMPANY_NAME="Your Company"
YOUR_VALUE_PROP="international market expansion services"
SENDER_NAME="Your Name"
SENDER_TITLE="Business Development"
EMAIL_TONE="professional"
```

### 2. Install Dependencies

Already included in `package.json`:
- `axios` (Event Registry API)
- `@google/generative-ai` (Gemini)
- `csv-writer` (output formatting)

## Usage

### Step 1: Fetch News Articles

```bash
# Basic usage
node eventRegistryNewsFetcher.js \
  --keywords="food companies|Trump tariffs|Europe" \
  --ignore-sources="wikipedia.org" \
  --languages=eng \
  --pages=2 \
  --count=50 \
  --run-name=food-tariffs

# Or use npm script
npm run news-fetch -- --keywords="..." --run-name=my-search
```

**Output:** `event_registry_runs/food-tariffs/articles.json`

**Key Parameters:**
- `--keywords`: Pipe-separated search terms (AND logic)
- `--ignore-keywords`: Exclude articles mentioning these terms
- `--ignore-sources`: Exclude domains (default: wikipedia.org)
- `--source-locations`: Filter by geography (e.g., `http://en.wikipedia.org/wiki/Europe`)
- `--date-start` / `--date-end`: Date range (YYYY-MM-DD)
- `--pages`: Number of result pages (100 articles per page)
- `--dry-run`: Preview request without API call

### Step 2: Extract Company Leads

```bash
# Extract companies from articles
node newsLeadExtractor.js \
  --run=event_registry_runs/food-tariffs \
  --output-name=tariff-leads

# Or use npm script
npm run news-extract -- --run=event_registry_runs/food-tariffs
```

**Output:** `news_leads/tariff-leads/leads.csv`

**What it does:**
1. Reads articles from Event Registry run
2. Uses Gemini to extract:
   - Company names
   - Specific pain points
   - Estimated website domains
3. Checks `processed_leads.csv` for duplicates
4. Logs new leads to tracker

**Key Parameters:**
- `--run`: Path to Event Registry run directory
- `--output-name`: Custom output folder name
- `--include-duplicates`: Include already-processed companies
- `--dry-run`: Preview without extraction

**CSV Columns:**
- `Company Name`, `Website`, `Pain Point`
- `Article Title`, `Article URL`, `Article Date`
- `Source`, `Sentiment`, `Is Duplicate`

### Step 3: Generate Personalized Emails

```bash
# Generate outreach emails
node newsEmailGenerator.js \
  --leads=news_leads/tariff-leads/leads.json \
  --campaign-name=tariff-outreach \
  --your-company="Acme Corp" \
  --your-value="supply chain optimization" \
  --sender-name="John Doe" \
  --sender-title="VP Sales" \
  --tone="conversational" \
  --max-leads=50

# Or use npm script
npm run news-emails -- --leads=news_leads/tariff-leads/leads.json
```

**Output:** `email_campaigns/tariff-outreach/emails.csv`

**What it does:**
1. Reads extracted leads JSON
2. Filters out duplicates automatically
3. Uses Gemini to generate:
   - Personalized subject lines
   - Context-aware email bodies referencing the article
4. Outputs ready-to-send emails

**Key Parameters:**
- `--leads`: Path to leads JSON file
- `--campaign-name`: Custom campaign folder name
- `--your-company`: Your company name
- `--your-value`: Your value proposition
- `--sender-name` / `--sender-title`: Email signature
- `--tone`: Email style (professional, conversational, friendly)
- `--max-leads`: Limit number of emails generated
- `--dry-run`: Preview without generation

**CSV Columns:**
- `Company Name`, `Website`, `Pain Point`, `Article URL`
- `Email Subject`, `Email Body`

## Example Workflow

```bash
# 1. Find companies struggling with tariffs
npm run news-fetch -- \
  --keywords="food companies|tariffs|supply chain" \
  --ignore-sources="wikipedia.org" \
  --pages=3 \
  --run-name=tariff-crisis-oct

# 2. Extract leads (auto-checks duplicates)
npm run news-extract -- \
  --run=event_registry_runs/tariff-crisis-oct \
  --output-name=tariff-leads-oct

# 3. Generate personalized emails
npm run news-emails -- \
  --leads=news_leads/tariff-leads-oct/leads.json \
  --campaign-name=tariff-outreach-oct \
  --your-company="GlobalTrade Solutions" \
  --your-value="tariff mitigation and supply chain consulting" \
  --max-leads=100

# 4. Review emails
open email_campaigns/tariff-outreach-oct/emails.csv
```

## Advanced Use Cases

### 1. Expansion Signals
```bash
npm run news-fetch -- \
  --keywords="food companies|expansion|new market|investment" \
  --source-locations="http://en.wikipedia.org/wiki/Europe" \
  --run-name=expansion-signals
```

### 2. Executive Changes (Buying Windows)
```bash
npm run news-fetch -- \
  --keywords="food companies|new CEO|leadership change|appointment" \
  --run-name=exec-changes
```

### 3. Negative Sentiment Filter
```bash
npm run news-fetch -- \
  --keywords="food companies|challenges|losses|decline" \
  --ignore-keywords="success|growth|profit" \
  --run-name=struggling-companies
```

### 4. Weekly Monitoring
```bash
# Run every Monday
npm run news-fetch -- \
  --keywords="food companies|tariffs" \
  --date-start=$(date -d '7 days ago' +%Y-%m-%d) \
  --run-name=weekly-$(date +%Y-%m-%d)
```

## Integration with Existing Pipeline

### Option 1: Manual Enrichment
After generating `news_leads/*/leads.csv`, feed company names into Apollo:

```bash
# Create input CSV with company names
# Then enrich with Apollo
node apolloEnricher.js --input=news_leads/tariff-leads-oct/leads.csv
```

### Option 2: Automated Pipeline
Modify `runLeadPipeline.js` to include news leads as a source.

## Output Structure

```
event_registry_runs/
  food-tariffs/
    base-request.json          # API payload
    request-page-1.json        # Request for page 1
    response-page-1.json       # Raw API response
    articles.json              # Parsed articles
    articles.csv               # Flattened articles
    summary.json               # Run statistics

news_leads/
  tariff-leads/
    extraction-summary.json    # Extraction stats
    leads.json                 # Structured leads
    leads.csv                  # Leads spreadsheet

email_campaigns/
  tariff-outreach/
    campaign-summary.json      # Campaign stats
    emails.json                # Generated emails
    emails.csv                 # Email templates
```

## Duplicate Prevention

All extracted leads are automatically logged to `processed_leads.csv` with:
- `processor: newsLeadExtractor`
- `sheetName: [Article Source]`
- `rowNumber: [Article URL]`

This prevents re-contacting companies from future news searches.

## Cost Estimation

### Event Registry
- Free tier: $5 credit (~2,500 articles)
- Paid: $0.002 per article

### Gemini AI
- Free tier: 1,500 requests/day
- Paid: ~$0.0001 per request

**Example:** 100 articles → 50 companies → 50 emails = ~$0.20 + 150 Gemini calls

## Tips

1. **Timing:** Reach out within 3-5 days of article publication for maximum relevance
2. **Specificity:** Use narrow keywords to reduce noise (e.g., "pharmaceutical tariffs" vs "tariffs")
3. **Source Quality:** Exclude low-quality sources with `--ignore-sources`
4. **Batch Processing:** Process 50-100 leads at a time to maintain quality
5. **A/B Testing:** Generate multiple email variants by adjusting `--tone`

## Troubleshooting

**No companies extracted:**
- Check article quality (some are too generic)
- Verify Gemini API key is valid
- Review `extraction-summary.json` for errors

**Too many duplicates:**
- Use `--include-duplicates` to see all matches
- Check `processed_leads.csv` for existing entries
- Adjust keywords to find new segments

**Email generation fails:**
- Ensure `GEMINI_API_KEY` is set
- Check rate limits (1 request/second)
- Review `campaign-summary.json` for errors

## Next Steps

1. **Enrich with Apollo:** Get decision-maker contacts for extracted companies
2. **Automate:** Schedule weekly news fetches with cron
3. **Track Results:** Log email responses back to `processed_leads.csv`
4. **Refine Prompts:** Customize Gemini prompts in `newsLeadExtractor.js` and `newsEmailGenerator.js`
