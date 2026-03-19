# 🏪 Supplier Outreach System

Automated system for finding suppliers for your ecommerce store, scraping their emails, and sending cold outreach emails asking to sell their products.

## 🎯 What This Does

1. **Product Management**: Track products you want to source
2. **Supplier Discovery**: Find companies that manufacture your products
3. **Email Scraping**: Get contact emails from potential suppliers
4. **Cold Email Outreach**: Send personalized emails asking to become suppliers
5. **Automated Infrastructure**: Schedule and track your outreach campaigns

## 🚀 Quick Start

### 1. Set Up Your Products

Add products you want to source:

```bash
# Interactive product addition
npm run supplier-add-product

# Or add programmatically
node productCatalogManager.js add --name="Wireless Earbuds" --category="Electronics" --price="$15-25" --demand=500 --keywords="wireless,earbuds,bluetooth"
```

### 2. Configure Your Company

Edit `supplier-config.json`:

```json
{
  "yourCompany": {
    "name": "Your Store Name",
    "description": "Online retailer specializing in...",
    "contact": {
      "name": "Your Name",
      "email": "your@email.com"
    }
  },
  "targetCountries": ["China", "Vietnam", "Turkey"],
  "products": [
    {
      "name": "Wireless Earbuds",
      "targetPrice": "$15-25",
      "monthlyDemand": 500
    }
  ]
}
```

### 3. Run the Full Pipeline

```bash
# Generate LinkedIn URLs for supplier discovery
npm run supplier-pipeline

# This will:
# 1. Generate LinkedIn search URLs for your products
# 2. Scrape supplier job postings
# 3. Qualify suppliers with AI
# 4. Enrich with contact data via Apollo.io
# 5. Generate personalized outreach emails
```

### 4. Set Up Email Infrastructure

Configure email credentials in `.env`:

```env
EMAIL_USER=your@email.com
EMAIL_APP_PASSWORD=your-gmail-app-password
```

For Gmail:
1. Enable 2FA on your Google account
2. Generate an App Password: https://support.google.com/accounts/answer/185833
3. Use the App Password (not your regular password)

### 5. Start Automated Outreach

```bash
# Review campaign status
npm run supplier-status

# Start sending emails (max 10 per run to avoid spam filters)
node automatedEmailOutreach.js start --campaign=supplier_outreach_runs/run_2025-01-01T00-00-00/emails.json --max=10

# Or use dry run first
node automatedEmailOutreach.js start --campaign=path/to/emails.json --max=5 --dry-run
```

## 📋 Detailed Workflow

### Phase 1: Product & Configuration Setup

1. **Define Products**: Use `productCatalogManager.js` to build your product catalog
2. **Configure Outreach**: Edit `supplier-config.json` with your company details and target countries
3. **Set Email Credentials**: Configure SMTP settings in `.env`

### Phase 2: Supplier Discovery Pipeline

```bash
# Full pipeline (recommended)
npm run supplier-pipeline

# Step by step:
npm run supplier-pipeline -- --skip-generate    # Skip URL generation
npm run supplier-pipeline -- --skip-scrape     # Skip LinkedIn scraping
npm run supplier-pipeline -- --skip-qualify    # Skip AI qualification
npm run supplier-pipeline -- --skip-apollo     # Skip contact enrichment
npm run supplier-pipeline -- --skip-emails     # Skip email generation
```

**What each step does:**

1. **URL Generation**: Creates LinkedIn search URLs for export managers, sales directors, etc.
2. **LinkedIn Scraping**: Downloads job postings from potential suppliers
3. **AI Qualification**: Uses Gemini AI to score suppliers (0-10) based on export experience and product relevance
4. **Apollo Enrichment**: Gets actual contact emails and phone numbers
5. **Email Generation**: Creates personalized outreach emails for each qualified supplier

### Phase 3: Email Verification & Outreach

```bash
# Verify supplier emails before sending
npm run verify-emails -- --input-csv=supplier_outreach_runs/run_TIMESTAMP/emails.csv

# Start automated outreach
npm run supplier-outreach start --campaign=supplier_outreach_runs/run_TIMESTAMP/emails.json --max=10

# Check status
npm run supplier-status

# Export sent emails for tracking
npm run supplier-outreach export
```

### Phase 4: Follow-ups & Analytics

```bash
# View follow-up schedule
npm run supplier-outreach follow-ups

# Export all outreach data
npm run supplier-outreach export
```

## 🏗️ System Architecture

### Core Components

- **`supplier-config.json`**: Main configuration (products, countries, email templates)
- **`supplierOutreachPipeline.js`**: Main pipeline orchestrator
- **`supplierQualifier.js`**: AI-powered supplier scoring
- **`supplierEmailGenerator.js`**: Personalized email generation
- **`automatedEmailOutreach.js`**: Email sending infrastructure
- **`productCatalogManager.js`**: Product catalog management

### Data Flow

```
Products → LinkedIn URLs → Job Scraping → AI Qualification → Contact Enrichment → Email Generation → Verification → Outreach → Tracking
```

### Output Structure

```
supplier_outreach_runs/
└── run_2025-01-01T00-00-00/
    ├── supplier_config.json           # Run configuration
    ├── supplier_linkedin_urls.json    # Generated URLs
    ├── supplier_jobs.json            # Scraped job postings
    ├── qualified_suppliers.json      # AI-qualified suppliers
    ├── supplier_contacts/            # Apollo.io enriched contacts
    └── supplier_emails/              # Generated outreach emails
        ├── emails.json
        ├── emails.csv
        └── campaign-summary.json
```

## 🎛️ Dashboard

Open `supplier-dashboard.html` in your browser for a visual interface to manage:

- Product catalog
- Campaign status
- Outreach statistics
- Quick actions

## ⚙️ Configuration Options

### Supplier Config (`supplier-config.json`)

```json
{
  "yourCompany": {
    "name": "Your Store Name",
    "website": "https://yourstore.com",
    "contact": {
      "name": "Your Name",
      "email": "your@email.com"
    }
  },
  "targetCountries": ["China", "Vietnam", "India"],
  "supplierTitles": ["Export Manager", "Sales Director"],
  "products": [...],
  "emailCampaign": {
    "tone": "professional",
    "maxEmailsPerDay": 50,
    "followUpDays": [3, 7, 14]
  }
}
```

### Environment Variables (`.env`)

```env
# Email Configuration
EMAIL_USER=your@email.com
EMAIL_APP_PASSWORD=your-app-password

# AI Configuration
GEMINI_API_KEY=your-gemini-key

# LinkedIn/Apollo
APIFY_TOKEN=your-apify-token
APOLLO_API_KEY=your-apollo-key
```

## 📊 Analytics & Reporting

### Campaign Performance

```bash
npm run supplier-status
```

Shows:
- Total campaigns run
- Emails sent/failed
- Success rates
- Supplier scores

### Export Data

```bash
# Export all sent emails
npm run supplier-outreach export

# Export product catalog
node productCatalogManager.js export
```

## 🔧 Troubleshooting

### Common Issues

**"No qualified suppliers found"**
- Check that your product keywords match supplier job descriptions
- Verify LinkedIn searches are returning relevant results
- Adjust qualification criteria in supplierQualifier.js

**"Email sending failed"**
- Verify email credentials in `.env`
- For Gmail: Use App Password, not regular password
- Check spam folder for test emails

**"Pipeline hangs during scraping"**
- LinkedIn blocking? Try different IP or wait a few hours
- Reduce jobsPerCountry in config
- Use --skip-scrape to resume from existing data

**"Low supplier scores"**
- Refine product keywords
- Adjust target countries
- Check supplierTitles list

### Performance Tips

- **Start Small**: Begin with 1-2 products and 1-2 countries
- **Rate Limiting**: Space out email sends (max 50/day recommended)
- **Email Verification**: Always verify emails before mass sending
- **Follow-ups**: Schedule follow-ups at 3, 7, and 14 days
- **A/B Testing**: Test different email templates and subject lines

## 📈 Scaling Up

### Multiple Products
```bash
# Run pipeline for specific products
npm run supplier-pipeline -- --product="Wireless Earbuds"

# Run for multiple products
npm run supplier-pipeline -- --product="Wireless Earbuds,Yoga Mats"
```

### Multiple Countries
```bash
# Target specific countries
npm run supplier-pipeline -- --country="China,Vietnam"
```

### Advanced Email Sequencing
- Initial outreach
- Follow-up 1 (3 days later)
- Follow-up 2 (7 days later)
- Final follow-up (14 days later)

## 🔒 Best Practices

### Email Outreach
- **Personalization**: Reference specific products and company details
- **Value Proposition**: Explain why they'd want to sell to you
- **Compliance**: Include unsubscribe links and your physical address
- **Rate Limiting**: Don't send more than 50 emails per day from one account

### Supplier Qualification
- **Export Experience**: Prioritize companies with international sales experience
- **Company Size**: Look for established companies (50-1000 employees)
- **Product Match**: Ensure they actually manufacture your products
- **Location**: Consider shipping costs and import regulations

### Data Management
- **Regular Backups**: Backup your supplier database regularly
- **Duplicate Prevention**: System automatically prevents duplicate outreach
- **Verification**: Always verify email addresses before sending
- **Compliance**: Follow GDPR and CAN-SPAM regulations

## 🎯 Success Metrics

Track these KPIs:

- **Response Rate**: Percentage of emails that get replies
- **Meeting Rate**: Percentage of responses that lead to meetings
- **Conversion Rate**: Percentage of meetings that result in partnerships
- **Time to First Response**: Average days to get first reply
- **Cost per Acquisition**: Total campaign cost ÷ number of new suppliers

## 🆘 Support

### Getting Help

1. **Check Logs**: Look in `supplier_outreach_runs/` for detailed logs
2. **Dry Runs**: Use `--dry-run` flag to test without actual execution
3. **Status Commands**: Use `npm run supplier-status` to check system state
4. **Documentation**: Refer to this README and individual script comments

### Common Commands

```bash
# Get help
node supplierOutreachPipeline.js --help

# Check system status
npm run supplier-status

# View product catalog
npm run supplier-list-products

# Add new product
npm run supplier-add-product

# Start pipeline
npm run supplier-pipeline

# Generate emails
npm run supplier-emails

# Start outreach
npm run supplier-outreach start --campaign=path/to/emails.json --max=10
```

---

## 🚀 Pro Tips

1. **Start with Research**: Manually verify 5-10 suppliers before automating
2. **Test Email Templates**: Send test emails to yourself first
3. **Monitor Deliverability**: Check spam folders and email bounce rates
4. **Build Relationships**: Focus on quality conversations over quantity
5. **Localize**: Adapt messaging for different countries/cultures
6. **Track Everything**: Use the dashboard to monitor campaign performance
7. **Iterate**: Regularly review what works and refine your approach

Happy supplier hunting! 🏪📧
