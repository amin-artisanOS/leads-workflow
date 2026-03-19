import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_ROOT = path.join(__dirname, 'email_campaigns');

function parseArgs() {
  const args = process.argv.slice(2);

  const getValue = (flag) => {
    const prefix = `${flag}=`;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg.startsWith(prefix)) return arg.slice(prefix.length);
      if (arg === flag && i + 1 < args.length) return args[i + 1];
    }
    return undefined;
  };

  const hasFlag = (flag) => args.includes(flag);

  return {
    leadsPath: getValue('--leads') || getValue('--leads-path'),
    campaignName: getValue('--campaign-name'),
    yourCompany: getValue('--your-company') || process.env.YOUR_COMPANY_NAME || 'Your Company',
    yourValue: getValue('--your-value') || process.env.YOUR_VALUE_PROP || 'international market expansion services',
    senderName: getValue('--sender-name') || process.env.SENDER_NAME || 'Your Name',
    senderTitle: getValue('--sender-title') || process.env.SENDER_TITLE || 'Business Development',
    tone: getValue('--tone') || process.env.EMAIL_TONE || 'professional',
    maxLeads: parseInt(getValue('--max-leads') || process.env.EMAIL_MAX_LEADS || '999', 10),
    dryRun: hasFlag('--dry-run')
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeCsv(filePath, emails) {
  if (!emails.length) return;

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'companyName', title: 'Company Name' },
      { id: 'website', title: 'Website' },
      { id: 'painPoint', title: 'Pain Point' },
      { id: 'articleUrl', title: 'Article URL' },
      { id: 'subject', title: 'Email Subject' },
      { id: 'body', title: 'Email Body' }
    ]
  });

  await csvWriter.writeRecords(emails);
}

function initGemini() {
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
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
    ]
  });
}

async function generateEmailForLead(model, lead, config) {
  const { yourCompany, yourValue, senderName, senderTitle, tone } = config;

  const prompt = `You are an expert B2B cold email copywriter. Write a personalized outreach email based on a recent news trigger.

**Lead Details:**
- Company: ${lead.companyName}
- Pain Point: ${lead.painPoint}
- Article Title: ${lead.articleTitle}
- Article URL: ${lead.articleUrl}
- Article Date: ${lead.articleDate}
- Source: ${lead.source}

**Your Company:** ${yourCompany}
**Your Value Proposition:** ${yourValue}
**Sender:** ${senderName}, ${senderTitle}
**Tone:** ${tone}

**Task:**
Write a cold outreach email that:
1. References the specific article and pain point naturally (no generic "I saw your company in the news")
2. Shows genuine understanding of their challenge
3. Briefly hints at how ${yourCompany} can help (without being salesy)
4. Includes a soft CTA (e.g., "Would you be open to a brief conversation?")
5. Keeps it under 150 words
6. Uses a compelling subject line (max 60 chars)

**Output Format (JSON):**
{
  "subject": "Subject line here",
  "body": "Email body here (use \\n\\n for paragraph breaks)"
}

**Rules:**
- Do NOT use placeholder brackets like [Company] or [Name]
- Use actual company name: ${lead.companyName}
- Reference the article naturally without sounding like a bot
- Be conversational and ${tone}
- Do NOT include signature block (will be added separately)
- Output ONLY valid JSON, no explanations

**Output:**`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    // Extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*?\})/);
    if (!jsonMatch) {
      console.warn(`   ⚠️ No JSON found in response for ${lead.companyName}`);
      return {
        subject: `Re: ${lead.companyName} and recent market challenges`,
        body: `Hi,\n\nI came across the recent article about ${lead.companyName}'s challenges with ${lead.painPoint}. Given our work helping companies with ${yourValue}, I thought it might be worth connecting.\n\nWould you be open to a brief conversation?\n\nBest regards,\n${senderName}\n${senderTitle}\n${yourCompany}`
      };
    }

    const email = JSON.parse(jsonMatch[1]);
    return {
      subject: email.subject || `Re: ${lead.companyName}`,
      body: email.body || ''
    };
  } catch (error) {
    console.error(`   🔴 Error generating email for ${lead.companyName}: ${error.message}`);
    return {
      subject: `Re: ${lead.companyName}`,
      body: `[Error generating email: ${error.message}]`
    };
  }
}

async function processLeads(leads, model, config, maxLeads) {
  const emails = [];
  const leadsToProcess = leads.slice(0, maxLeads);

  for (let i = 0; i < leadsToProcess.length; i += 1) {
    const lead = leadsToProcess[i];
    console.log(`\n📧 Generating email ${i + 1}/${leadsToProcess.length}: ${lead.companyName}`);

    const email = await generateEmailForLead(model, lead, config);

    emails.push({
      companyName: lead.companyName,
      website: lead.website,
      painPoint: lead.painPoint,
      articleUrl: lead.articleUrl,
      subject: email.subject,
      body: email.body
    });

    console.log(`   ✅ Subject: ${email.subject}`);

    // Rate limit: 1 request per second
    if (i < leadsToProcess.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return emails;
}

async function main() {
  const options = parseArgs();

  if (!options.leadsPath) {
    console.error('🔴 Missing --leads or --leads-path parameter. Specify path to news leads JSON file.');
    console.error('   Example: node newsEmailGenerator.js --leads=news_leads/news-leads-2025-10-02/leads.json');
    process.exit(1);
  }

  const leadsPath = path.resolve(options.leadsPath);

  try {
    await fsp.access(leadsPath);
  } catch {
    console.error(`🔴 Leads file not found: ${leadsPath}`);
    process.exit(1);
  }

  const leads = await readJson(leadsPath);
  console.log(`📚 Loaded ${leads.length} lead(s) from ${leadsPath}`);

  if (!leads.length) {
    console.log('⚠️ No leads to process.');
    return;
  }

  // Filter out duplicates if isDuplicate field exists
  const newLeads = leads.filter((lead) => lead.isDuplicate !== 'Yes');
  console.log(`   ✨ ${newLeads.length} new lead(s) (${leads.length - newLeads.length} duplicates excluded)`);

  if (!newLeads.length) {
    console.log('⚠️ No new leads to generate emails for.');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const campaignLabel = options.campaignName || `email-campaign-${timestamp}`;
  const outputDir = path.join(OUTPUT_ROOT, campaignLabel);
  ensureDir(outputDir);

  if (options.dryRun) {
    console.log('\n🧪 Dry run - no email generation performed.');
    console.log(`📁 Output directory prepared: ${outputDir}`);
    return;
  }

  const model = initGemini();
  console.log('\n🤖 Starting email generation with Gemini...');
  console.log(`   Company: ${options.yourCompany}`);
  console.log(`   Value Prop: ${options.yourValue}`);
  console.log(`   Sender: ${options.senderName}, ${options.senderTitle}`);
  console.log(`   Tone: ${options.tone}`);

  const emails = await processLeads(newLeads, model, options, options.maxLeads);

  const summary = {
    campaignLabel,
    generatedAt: new Date().toISOString(),
    sourceLeadsPath: leadsPath,
    totalLeads: leads.length,
    newLeads: newLeads.length,
    emailsGenerated: emails.length,
    config: {
      yourCompany: options.yourCompany,
      yourValue: options.yourValue,
      senderName: options.senderName,
      senderTitle: options.senderTitle,
      tone: options.tone
    }
  };

  await writeJson(path.join(outputDir, 'campaign-summary.json'), summary);
  await writeJson(path.join(outputDir, 'emails.json'), emails);
  await writeCsv(path.join(outputDir, 'emails.csv'), emails);

  console.log('\n✅ Email generation complete!');
  console.log(`📊 Summary:`);
  console.log(`   - Emails generated: ${emails.length}`);
  console.log(`\n📁 Output: ${outputDir}`);
  console.log(`📈 CSV: ${path.join(outputDir, 'emails.csv')}`);
  console.log(`📧 JSON: ${path.join(outputDir, 'emails.json')}`);
}

main().catch((error) => {
  console.error('🔴 Failed to generate emails:', error);
  process.exit(1);
});
