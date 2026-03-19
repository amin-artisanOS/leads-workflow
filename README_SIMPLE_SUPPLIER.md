# 🏪 Supplier Finder

**Two ways to find suppliers for your ecommerce store**

## 🚀 Choose Your Mode

### **Option 1: Manual Mode** (No Email Setup Required)
Perfect for users who want to copy-paste emails and send manually.

```bash
npm run supplier-finder-manual
# Then open: http://localhost:3005
```

**Features:**
- ✅ Find suppliers with emails
- ✅ AI-generated email templates
- ✅ Copy-paste emails to your email client
- ✅ Download CSV with all data
- ✅ No Gmail setup required

### **Option 2: Automated Mode** (Full Automation)
The complete automated system that sends emails automatically.

```bash
npm run supplier-finder
# Then open: http://localhost:3004
```

**Features:**
- ✅ Everything in Manual Mode
- ✅ Automated email sending
- ✅ Campaign tracking
- ✅ Follow-up scheduling
- ✅ Requires Gmail setup

## 🚀 Quick Start

### **Choose Your Mode:**

#### **Option A: Manual Mode** (No Email Setup)
```bash
npm run setup-supplier  # Configure API keys
npm run supplier-finder-manual
# Open: http://localhost:3005
```

#### **Option B: Automated Mode** (Requires Gmail Setup)
```bash
npm run setup-supplier  # Configure API keys
# Update .env with EMAIL_USER and EMAIL_APP_PASSWORD
npm run supplier-finder
# Open: http://localhost:3004
```

### **Step 1: Configure API Keys**
```bash
npm run setup-supplier
```
This guides you through setting up Apify, Apollo, and Gemini API keys.

### **Step 2: Choose Your Interface**

**Manual Mode** (`http://localhost:3005`):
- Find suppliers and copy-paste emails
- No Gmail setup required
- Full control over sending

**Automated Mode** (`http://localhost:3004`):
- Automatic email sending
- Campaign tracking
- Requires Gmail App Password

### 2. Start the App
```bash
npm run supplier-finder
```

This starts a web server at `http://localhost:3004`

### 3. Find Suppliers
1. Open `http://localhost:3004` in your browser
2. Enter what you want to sell (e.g., "Azulejos de decoracion de hogar")
3. Choose a country (e.g., Spain 🇪🇸)
4. Click "Find Suppliers & Send Emails"

**That's it!** The system does everything automatically.

## 🔑 API Keys Setup

### 1. Gemini AI (for email generation)
1. Visit: https://makersuite.google.com/app/apikey
2. Create API key
3. Add to `simple-config.json`

### 2. Apify (for Google Maps scraping)
1. Visit: https://console.apify.com/
2. Sign up/login, get API token
3. Add to `simple-config.json`

### 3. Apollo.io (for email finding)
1. Visit: https://app.apollo.io/
2. Sign up, get API key
3. Add to `simple-config.json`

### 4. Gmail App Password (for sending emails)
1. Enable 2FA on Gmail
2. Generate App Password: https://support.google.com/accounts/answer/185833
3. Add to `simple-config.json`

## 🌍 How It Works

### Step 1: Product Input
- Enter any product in any language
- Examples: "Azulejos decorativos", "Wireless Earbuds", "Yoga Mats", "陶瓷花盆"

### Step 2: Country Selection
Choose from popular sourcing countries:
- 🇨🇳 **China** - Electronics, toys, home goods
- 🇻🇳 **Vietnam** - Fashion, furniture, electronics
- 🇮🇳 **India** - Textiles, jewelry, spices
- 🇹🇷 **Turkey** - Textiles, furniture, machinery
- 🇮🇹 **Italy** - Fashion, design, premium goods
- 🇪🇸 **Spain** - Fashion, wine, ceramics
- 🇧🇷 **Brazil** - Coffee, furniture, cosmetics
- 🇲🇽 **Mexico** - Electronics, automotive, textiles

### Step 3: Automatic Processing

The system automatically:

1. **🔍 Searches Google Maps** for businesses matching your product in the selected country using Apify's Google Maps scraper
2. **📧 Gets emails directly from Google Maps data** (when available) and supplements with Apollo.io
3. **🤖 Generates personalized emails** using AI based on your company details
4. **📨 Sends emails** automatically with rate limiting
5. **💾 Saves results** to CSV for tracking

### Step 4: Results
- **CSV Export**: All found businesses with emails
- **Email Tracking**: Which emails were sent successfully
- **Progress Updates**: Real-time progress in the UI

## 📋 Manual Mode Features

### **Perfect for:**
- Users without Gmail App Password setup
- Manual email sending workflows
- Copy-paste into existing email systems
- Quality control before sending

### **What You Get:**
1. **📍 Supplier List** - Businesses found on Google Maps
2. **📧 Contact Emails** - From Google Maps + Apollo.io
3. **🤖 AI Email Templates** - Personalized outreach emails
4. **📋 Copy-Paste Ready** - One-click copy to clipboard
5. **📧 Direct Links** - Open in Gmail/Outlook with pre-filled content
6. **📥 CSV Download** - Complete supplier database

### **How It Works:**
1. Enter product (any language) + select country
2. System finds suppliers and generates emails
3. Click "Copy Email" to copy address
4. Click "Open in Gmail" to open with pre-filled content
5. Send manually from your email client

## ⚡ Automated Mode Features

### **Perfect for:**
- High-volume outreach
- Automated follow-ups
- Campaign tracking
- Set-and-forget operation

### **What You Get:**
- Everything in Manual Mode
- **📨 Automatic Sending** - No manual work
- **📊 Campaign Analytics** - Success tracking
- **⏰ Follow-ups** - Scheduled sequences
- **📈 Performance Reports** - Conversion metrics

### **Additional Setup Required:**
- Gmail App Password configuration
- Email templates customization
- Sending limits configuration

## 📊 What You Get

**Input:** Product name + Country
**Output:**
- List of local businesses in that country
- Contact emails (some from Google Maps data, others from Apollo.io)
- Personalized outreach emails sent automatically
- **📥 Downloadable CSV** with all supplier data and email sources (click download button after campaign)

## 🎯 Example Results

For "Azulejos de decoracion" in Spain:

```
Business: Cerámica Artesanal SL
Email: info@ceramicaartesanal.es
Email Sent: ✅ Yes

Business: Azulejos Tradicionales SA
Email: ventas@azulejostradicionales.com
Email Sent: ✅ Yes

Business: Decoración Cerámica Madrid
Email: contacto@decoracionceramica.es
Email Sent: ✅ Yes
```

## ⚙️ Customization

### Change Search Limits
Edit `simple-config.json`:

```json
"searchSettings": {
  "maxBusinessesPerSearch": 20,    // Businesses to find
  "maxEmailsToSend": 10,           // Emails to send per campaign
  "emailDelaySeconds": 2           // Delay between emails
}
```

### Modify Email Templates
The system uses AI to generate personalized emails based on:
- Your company name and description
- Product you're interested in
- Supplier's location and business

## 📈 Success Tips

### Best Practices
1. **Be Specific**: "Azulejos decorativos de cerámica" instead of just "tiles"
2. **Choose Right Country**: Research which countries specialize in your product
3. **Quality over Quantity**: Start with 10 high-quality emails vs 50 generic ones
4. **Follow Up**: The system tracks sent emails for follow-up campaigns
5. **Test First**: Use the UI to test with small batches

### Expected Response Rates
- **Cold Emails**: 2-5% response rate is excellent
- **Qualified Suppliers**: 10-20% of emails might lead to conversations
- **Successful Partnerships**: 1-2% might result in actual supplier relationships

## 🔧 Troubleshooting

### "Error starting supplier search"
- **API keys not configured**: Run `npm run setup-supplier` to configure your API keys
- Check that `simple-config.json` has your actual API keys (not placeholder values)
- Ensure all required APIs are set up: Apify, Apollo, Gemini, and Gmail

### "No businesses found"
- Try different product wording
- Choose a different country
- Check your Apify token is valid

### "Emails not sending"
- Verify Gmail App Password
- Check email settings in config
- Ensure 2FA is enabled on Gmail

### "API errors"
- Check all API keys in `simple-config.json`
- Verify API keys haven't expired
- Check API rate limits

## 📋 Files Overview

- **`supplier-finder.html`** - Web interface
- **`simple-supplier-finder.js`** - Backend server and scraper
- **`simple-config.json`** - Your configuration
- **`supplier_campaign_*.csv`** - Results from each campaign

## 🚀 Advanced Usage

### Command Line Alternative
```bash
# Direct API call (advanced users)
curl -X POST http://localhost:3004/api/find-suppliers \
  -H "Content-Type: application/json" \
  -d '{"product":"Azulejos decorativos","country":"Spain"}'
```

### Multiple Campaigns
Run multiple searches for different products/countries in the same session.

### CSV Analysis
Use the generated CSV files to:
- Track which suppliers responded
- Build your supplier database
- Plan follow-up campaigns

### Download CSV from Web UI
After each campaign completes, click the **"📥 Download Email List (CSV)"** button to download the complete supplier list with:
- Business names and websites
- Contact emails and names
- Email source (Google Maps or Apollo)
- Whether emails were sent successfully

## 💡 Pro Tips

1. **International Products**: Enter products in local languages (Spanish, Portuguese, etc.)
2. **Country Research**: Each country specializes in different products
3. **Email Personalization**: AI generates unique emails for each supplier
4. **Rate Limiting**: Built-in delays prevent spam flags
5. **CSV Tracking**: Never lose track of your outreach

---

**Ready to find suppliers?** Run `npm run supplier-finder` and open `http://localhost:3004` 🎯
