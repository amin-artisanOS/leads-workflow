import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI argument parsing
function getArgValue(flag) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
    if (arg === flag && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return null;
}

const LEADS_FILE = getArgValue('--leads');
const PRODUCTS_ARG = getArgValue('--products');
const CONFIG_FILE = getArgValue('--config') || path.join(__dirname, 'supplier-config.json');
const OUTPUT_DIR = getArgValue('--output-dir') || path.join(__dirname, 'supplier_emails');
const CAMPAIGN_NAME = getArgValue('--campaign-name') || `supplier-outreach-${new Date().toISOString().split('T')[0]}`;
const MAX_LEADS = parseInt(getArgValue('--max-leads') || '999', 10);

if (!LEADS_FILE || !PRODUCTS_ARG) {
  console.error('🔴 Missing required arguments:');
  console.error('   --leads=<path>        Path to qualified suppliers JSON');
  console.error('   --products=<json>     JSON string of products array');
  console.error('   --config=<path>       Path to supplier config (optional)');
  console.error('   --output-dir=<path>   Output directory (optional)');
  process.exit(1);
}

let products;
try {
  products = JSON.parse(PRODUCTS_ARG);
} catch (error) {
  console.error('🔴 Invalid products JSON:', error.message);
  process.exit(1);
}

let config;
try {
  const configRaw = fs.readFileSync(CONFIG_FILE, 'utf8');
  config = JSON.parse(configRaw);
} catch (error) {
  console.error('🔴 Could not load supplier config:', error.message);
  process.exit(1);
}

async function initGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('🔴 Missing GEMINI_API_KEY in environment.');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
      topP: 0.9
    }
  });
}

async function generateSupplierEmail(model, supplier, product, config) {
  const { yourCompany } = config;
  const supplierName = supplier.jobTitle?.includes('CEO') || supplier.jobTitle?.includes('Founder') || supplier.jobTitle?.includes('Owner')
    ? 'CEO/Founder'
    : supplier.jobTitle?.split(' ')[0] || 'Export Manager';

  const prompt = `You are an ecommerce store owner looking to source products from suppliers. Write a personalized cold outreach email to a potential supplier.

**Your Company Details:**
- Name: ${yourCompany.name}
- Description: ${yourCompany.description}
- Website: ${yourCompany.website}
- Your Name: ${yourCompany.contact.name}
- Your Title: ${yourCompany.contact.title}

**Supplier Details:**
- Company: ${supplier.companyName}
- Contact Title: ${supplier.jobTitle}
- Location: ${supplier.location}
- Relevant Product: ${product.name}
- Product Description: ${product.description}
- Target Price Range: ${product.targetPrice}
- Monthly Demand: ${product.monthlyDemand} units

**Task:**
Write a professional, personalized cold email asking if they would be interested in supplying ${product.name} to your ecommerce store. The email should:

1. Introduce yourself and your business briefly
2. Show knowledge of their company and products
3. Explain what you're looking for specifically
4. Highlight mutual benefits (you provide market access, they get sales)
5. Include a clear call-to-action
6. Keep it under 200 words
7. Use a compelling subject line

**Output Format (JSON):**
{
  "subject": "Subject line here",
  "body": "Email body here (use \\n\\n for paragraphs)",
  "keyPoints": ["point1", "point2", "point3"]
}

**Rules:**
- Be professional but friendly
- Reference their location/country
- Mention specific product details
- Show genuine interest in partnership
- Do NOT include signature (added separately)
- Output ONLY valid JSON, no explanations

**Email:**`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const email = JSON.parse(jsonMatch[0]);
    return {
      subject: email.subject || `Interest in Carrying Your ${product.name}`,
      body: email.body || '',
      keyPoints: email.keyPoints || [],
      generated: true
    };

  } catch (error) {
    console.warn(`⚠️ Email generation failed for ${supplier.companyName}: ${error.message}`);
    return {
      subject: `Interest in Carrying Your ${product.name}`,
      body: `Hi,

I hope this email finds you well. I'm ${yourCompany.contact.name}, ${yourCompany.contact.title} at ${yourCompany.name}, an ecommerce store specializing in quality products.

We are expanding our product line and are very interested in your ${product.name}. Our customers are specifically looking for high-quality items in the ${product.targetPrice} range, and we believe your products would be perfect.

Would you be open to discussing a potential partnership where we could carry your ${product.name} in our store? We'd love to explore how we can work together to reach more customers.

Looking forward to hearing from you.

Best regards,
${yourCompany.contact.name}
${yourCompany.contact.title}
${yourCompany.name}
${yourCompany.contact.email}`,
      keyPoints: ['Product interest', 'Partnership inquiry', 'Contact request'],
      generated: false
    };
  }
}

async function main() {
  try {
    // Load qualified suppliers
    console.log(`📚 Loading qualified suppliers from ${LEADS_FILE}`);
    const leadsRaw = fs.readFileSync(LEADS_FILE, 'utf8');
    const leadsData = JSON.parse(leadsRaw);

    // Handle different input formats
    const suppliers = Array.isArray(leadsData) ? leadsData : leadsData.qualified || [];
    console.log(`✅ Loaded ${suppliers.length} qualified suppliers`);

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const campaignDir = path.join(OUTPUT_DIR, CAMPAIGN_NAME);
    if (!fs.existsSync(campaignDir)) {
      fs.mkdirSync(campaignDir, { recursive: true });
    }

    // Initialize Gemini
    const model = await initGemini();
    console.log('🤖 Initialized Gemini AI for email generation');

    const emails = [];
    const suppliersToProcess = suppliers.slice(0, MAX_LEADS);

    console.log(`\n📧 Generating emails for ${suppliersToProcess.length} suppliers...`);

    for (let i = 0; i < suppliersToProcess.length; i++) {
      const supplier = suppliersToProcess[i];
      const productName = supplier.relevantProduct;
      const product = products.find(p => p.name === productName) || products[0];

      console.log(`\n📧 Generating email ${i + 1}/${suppliersToProcess.length}: ${supplier.companyName}`);

      const email = await generateSupplierEmail(model, supplier, product, config);

      const emailRecord = {
        supplierId: `supplier_${i + 1}`,
        companyName: supplier.companyName,
        contactName: supplier.jobTitle || 'Export Manager',
        location: supplier.location,
        product: product.name,
        productCategory: product.category,
        emailSubject: email.subject,
        emailBody: email.body,
        keyPoints: email.keyPoints,
        supplierScore: supplier.supplierScore || 0,
        website: supplier.companyWebsite || '',
        generated: email.generated,
        campaignName: CAMPAIGN_NAME,
        generatedAt: new Date().toISOString()
      };

      emails.push(emailRecord);

      console.log(`   ✅ Subject: ${email.subject}`);
      console.log(`   📊 Score: ${supplier.supplierScore}/10`);

      // Rate limiting
      if (i < suppliersToProcess.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Save results
    const summary = {
      campaignName: CAMPAIGN_NAME,
      generatedAt: new Date().toISOString(),
      totalEmails: emails.length,
      products: [...new Set(emails.map(e => e.product))],
      countries: [...new Set(emails.map(e => e.location))],
      averageScore: emails.length > 0 ?
        (emails.reduce((sum, e) => sum + e.supplierScore, 0) / emails.length).toFixed(1) : 0,
      config: {
        yourCompany: config.yourCompany,
        emailTone: config.emailCampaign.tone,
        maxEmailsPerDay: config.emailCampaign.maxEmailsPerDay
      }
    };

    // Save JSON files
    fs.writeFileSync(path.join(campaignDir, 'emails.json'), JSON.stringify(emails, null, 2));
    fs.writeFileSync(path.join(campaignDir, 'campaign-summary.json'), JSON.stringify(summary, null, 2));

    // Save CSV for easy review
    const csvWriter = createCsvWriter.createObjectCsvWriter({
      path: path.join(campaignDir, 'emails.csv'),
      header: [
        { id: 'companyName', title: 'Company Name' },
        { id: 'contactName', title: 'Contact Name' },
        { id: 'location', title: 'Location' },
        { id: 'product', title: 'Product' },
        { id: 'emailSubject', title: 'Email Subject' },
        { id: 'emailBody', title: 'Email Body' },
        { id: 'supplierScore', title: 'Supplier Score' },
        { id: 'website', title: 'Website' }
      ]
    });

    await csvWriter.writeRecords(emails.map(email => ({
      companyName: email.companyName,
      contactName: email.contactName,
      location: email.location,
      product: email.product,
      emailSubject: email.emailSubject,
      emailBody: email.emailBody.replace(/\n\n/g, ' | '),
      supplierScore: email.supplierScore,
      website: email.website
    })));

    console.log('\n✅ Email generation complete!');
    console.log(`📊 Summary:`);
    console.log(`   - Emails generated: ${emails.length}`);
    console.log(`   - Average supplier score: ${summary.averageScore}/10`);
    console.log(`   - Products covered: ${summary.products.join(', ')}`);
    console.log(`   - Countries: ${summary.countries.join(', ')}`);

    console.log(`\n📁 Output saved to: ${campaignDir}`);
    console.log(`📧 JSON: emails.json`);
    console.log(`📊 Summary: campaign-summary.json`);
    console.log(`📋 CSV: emails.csv`);

    console.log('\n🚀 Next Steps:');
    console.log('1. Review and edit emails in emails.csv');
    console.log('2. Extract supplier emails using Apollo or manual research');
    console.log('3. Verify emails with: npm run verify-emails -- --input-csv=emails_with_contacts.csv');
    console.log('4. Set up automated sending infrastructure');

  } catch (error) {
    console.error('🔴 Email generation failed:', error.message);
    process.exit(1);
  }
}

main();
