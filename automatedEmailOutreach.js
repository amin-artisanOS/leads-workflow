#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const OUTREACH_DIR = path.join(__dirname, 'email_outreach');
const LOG_FILE = path.join(OUTREACH_DIR, 'outreach_log.json');
const SENT_EMAILS_FILE = path.join(OUTREACH_DIR, 'sent_emails.csv');

// CLI arguments
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

const COMMAND = process.argv[2];
const CAMPAIGN_FILE = getArgValue('--campaign');
const EMAIL_CSV = getArgValue('--emails');
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_EMAILS = parseInt(getArgValue('--max') || '10', 10);

// Email service configuration
const EMAIL_CONFIG = {
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD, // For Gmail app passwords
  }
};

// Gmail OAuth2 (alternative to app passwords)
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

// Ensure directories exist
if (!fs.existsSync(OUTREACH_DIR)) {
  fs.mkdirSync(OUTREACH_DIR, { recursive: true });
}

// Load outreach log
function loadOutreachLog() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading outreach log:', error.message);
  }
  return { campaigns: {}, sentEmails: [] };
}

// Save outreach log
function saveOutreachLog(log) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// Create email transporter
async function createTransporter() {
  if (GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN) {
    // OAuth2 for Gmail
    const oauth2Client = new google.auth.OAuth2(
      GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: GMAIL_REFRESH_TOKEN
    });

    const accessToken = await oauth2Client.getAccessToken();

    return nodemailer.createTransporter({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: EMAIL_CONFIG.auth.user,
        clientId: GMAIL_CLIENT_ID,
        clientSecret: GMAIL_CLIENT_SECRET,
        refreshToken: GMAIL_REFRESH_TOKEN,
        accessToken: accessToken.token
      }
    });
  } else {
    // Regular SMTP
    return nodemailer.createTransporter(EMAIL_CONFIG);
  }
}

// Send email
async function sendEmail(transporter, to, subject, body, campaignName, supplierId) {
  try {
    const mailOptions = {
      from: EMAIL_CONFIG.auth.user,
      to: to,
      subject: subject,
      text: body,
      html: body.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>')
    };

    if (DRY_RUN) {
      console.log(`📧 DRY RUN - Would send email:`);
      console.log(`   To: ${to}`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Campaign: ${campaignName}`);
      return { success: true, messageId: 'dry-run-' + Date.now() };
    }

    const result = await transporter.sendMail(mailOptions);

    console.log(`✅ Email sent to ${to} (${supplierId})`);
    return { success: true, messageId: result.messageId };

  } catch (error) {
    console.error(`❌ Failed to send email to ${to}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Load campaign emails
function loadCampaignEmails(campaignFile) {
  try {
    const data = fs.readFileSync(campaignFile, 'utf8');
    const campaign = JSON.parse(data);

    // Handle both formats (array of emails or campaign object with emails array)
    const emails = Array.isArray(campaign) ? campaign : campaign.emails || [];

    // Filter out emails without contact information
    return emails.filter(email => email.supplierEmail && email.supplierEmail.includes('@'));
  } catch (error) {
    console.error('Error loading campaign:', error.message);
    return [];
  }
}

// Start email campaign
async function startCampaign() {
  if (!CAMPAIGN_FILE) {
    console.error('❌ Missing --campaign parameter. Specify path to campaign JSON file.');
    console.error('   Example: node automatedEmailOutreach.js start --campaign=supplier_emails/campaign-2025-01-01/emails.json');
    return;
  }

  if (!EMAIL_CONFIG.auth.user || !EMAIL_CONFIG.auth.pass) {
    console.error('❌ Missing email credentials. Set EMAIL_USER and EMAIL_APP_PASSWORD in .env');
    console.error('   For Gmail: Use an App Password, not your regular password');
    return;
  }

  console.log('🚀 Starting Automated Email Outreach');
  console.log('=====================================');

  const campaignPath = path.resolve(CAMPAIGN_FILE);
  const campaignEmails = loadCampaignEmails(campaignPath);

  if (campaignEmails.length === 0) {
    console.error('❌ No valid emails found in campaign file');
    return;
  }

  const campaignName = path.basename(path.dirname(campaignPath));
  console.log(`📧 Campaign: ${campaignName}`);
  console.log(`📊 Emails to send: ${Math.min(campaignEmails.length, MAX_EMAILS)}`);

  const transporter = await createTransporter();
  const log = loadOutreachLog();

  // Initialize campaign in log
  if (!log.campaigns[campaignName]) {
    log.campaigns[campaignName] = {
      started: new Date().toISOString(),
      totalEmails: campaignEmails.length,
      sent: 0,
      failed: 0,
      emails: []
    };
  }

  let sentCount = 0;

  for (const emailData of campaignEmails) {
    if (sentCount >= MAX_EMAILS) break;

    // Check if already sent
    const alreadySent = log.sentEmails.some(sent =>
      sent.campaign === campaignName && sent.supplierId === emailData.supplierId
    );

    if (alreadySent) {
      console.log(`⏭️  Skipping ${emailData.supplierId} - already sent`);
      continue;
    }

    const result = await sendEmail(
      transporter,
      emailData.supplierEmail,
      emailData.emailSubject,
      emailData.emailBody,
      campaignName,
      emailData.supplierId
    );

    const emailLog = {
      campaign: campaignName,
      supplierId: emailData.supplierId,
      companyName: emailData.companyName,
      email: emailData.supplierEmail,
      subject: emailData.emailSubject,
      sentAt: new Date().toISOString(),
      success: result.success,
      messageId: result.messageId,
      error: result.error
    };

    log.sentEmails.push(emailLog);
    log.campaigns[campaignName].emails.push(emailLog);

    if (result.success) {
      log.campaigns[campaignName].sent++;
      sentCount++;
    } else {
      log.campaigns[campaignName].failed++;
    }

    // Rate limiting - avoid being flagged as spam
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  saveOutreachLog(log);
  console.log(`\n✅ Campaign ${campaignName} completed!`);
  console.log(`📊 Sent: ${log.campaigns[campaignName].sent}`);
  console.log(`❌ Failed: ${log.campaigns[campaignName].failed}`);
}

// Show campaign status
function showStatus() {
  const log = loadOutreachLog();

  console.log('📊 Email Outreach Status');
  console.log('========================');

  if (Object.keys(log.campaigns).length === 0) {
    console.log('No campaigns found. Start your first campaign with:');
    console.log('node automatedEmailOutreach.js start --campaign=path/to/emails.json');
    return;
  }

  Object.entries(log.campaigns).forEach(([name, campaign]) => {
    console.log(`\n📧 ${name}`);
    console.log(`   Started: ${new Date(campaign.started).toLocaleDateString()}`);
    console.log(`   Total Emails: ${campaign.totalEmails}`);
    console.log(`   Sent: ${campaign.sent}`);
    console.log(`   Failed: ${campaign.failed}`);
    console.log(`   Success Rate: ${campaign.totalEmails > 0 ? ((campaign.sent / campaign.totalEmails) * 100).toFixed(1) : 0}%`);
  });

  console.log(`\n📈 Overall Stats:`);
  console.log(`   Total Campaigns: ${Object.keys(log.campaigns).length}`);
  console.log(`   Total Emails Sent: ${log.sentEmails.filter(e => e.success).length}`);
  console.log(`   Total Emails Failed: ${log.sentEmails.filter(e => !e.success).length}`);
}

// Export sent emails to CSV
async function exportSentEmails() {
  const log = loadOutreachLog();

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: SENT_EMAILS_FILE,
    header: [
      { id: 'campaign', title: 'Campaign' },
      { id: 'supplierId', title: 'Supplier ID' },
      { id: 'companyName', title: 'Company Name' },
      { id: 'email', title: 'Email' },
      { id: 'subject', title: 'Subject' },
      { id: 'sentAt', title: 'Sent At' },
      { id: 'success', title: 'Success' },
      { id: 'messageId', title: 'Message ID' },
      { id: 'error', title: 'Error' }
    ]
  });

  const records = log.sentEmails.map(email => ({
    campaign: email.campaign,
    supplierId: email.supplierId,
    companyName: email.companyName,
    email: email.email,
    subject: email.subject,
    sentAt: new Date(email.sentAt).toLocaleString(),
    success: email.success ? 'Yes' : 'No',
    messageId: email.messageId || '',
    error: email.error || ''
  }));

  await csvWriter.writeRecords(records);
  console.log(`✅ Exported ${records.length} sent emails to ${SENT_EMAILS_FILE}`);
}

// Schedule follow-ups
function scheduleFollowUps() {
  const log = loadOutreachLog();
  const now = new Date();

  console.log('📅 Follow-up Scheduler');
  console.log('=====================');

  const followUps = [];

  log.sentEmails
    .filter(email => email.success)
    .forEach(email => {
      const sentDate = new Date(email.sentAt);
      const campaign = log.campaigns[email.campaign];

      // Schedule follow-ups at 3, 7, and 14 days
      [3, 7, 14].forEach(days => {
        const followUpDate = new Date(sentDate);
        followUpDate.setDate(followUpDate.getDate() + days);

        if (followUpDate > now) {
          followUps.push({
            supplierId: email.supplierId,
            companyName: email.companyName,
            email: email.email,
            campaign: email.campaign,
            followUpNumber: days === 3 ? 1 : days === 7 ? 2 : 3,
            scheduledFor: followUpDate.toISOString(),
            originalSendDate: email.sentAt
          });
        }
      });
    });

  if (followUps.length === 0) {
    console.log('No pending follow-ups found.');
    return;
  }

  // Group by date
  const followUpsByDate = followUps.reduce((acc, followUp) => {
    const date = new Date(followUp.scheduledFor).toDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(followUp);
    return acc;
  }, {});

  Object.entries(followUpsByDate)
    .sort(([a], [b]) => new Date(a) - new Date(b))
    .forEach(([date, follows]) => {
      console.log(`\n📅 ${date}:`);
      follows.forEach(follow => {
        console.log(`   • ${follow.companyName} (Follow-up ${follow.followUpNumber})`);
      });
    });

  console.log(`\n💡 To send follow-ups, run:`);
  console.log(`   node automatedEmailOutreach.js follow-up --date=${new Date().toISOString().split('T')[0]}`);
}

// Show usage
function showUsage() {
  console.log('\n📧 Automated Email Outreach System');
  console.log('====================================');
  console.log('');
  console.log('USAGE:');
  console.log('  node automatedEmailOutreach.js <command> [options]');
  console.log('');
  console.log('COMMANDS:');
  console.log('  start --campaign=<path> [--max=<number>] [--dry-run]');
  console.log('                           Start sending emails from campaign');
  console.log('  status                   Show outreach status and statistics');
  console.log('  export                   Export sent emails to CSV');
  console.log('  follow-ups               Show scheduled follow-ups');
  console.log('  follow-up --date=<YYYY-MM-DD>  Send follow-ups for specific date');
  console.log('');
  console.log('SETUP:');
  console.log('  1. Configure email credentials in .env:');
  console.log('     EMAIL_USER=your@email.com');
  console.log('     EMAIL_APP_PASSWORD=your-app-password');
  console.log('  2. For Gmail, use App Passwords (not regular password)');
  console.log('  3. Generate campaigns with: npm run supplier-emails');
  console.log('');
  console.log('EXAMPLES:');
  console.log('  node automatedEmailOutreach.js start --campaign=supplier_emails/campaign/emails.json --max=5 --dry-run');
  console.log('  node automatedEmailOutreach.js status');
  console.log('  node automatedEmailOutreach.js follow-ups');
  console.log('');
}

// Main command handling
async function main() {
  switch (COMMAND) {
    case 'start':
      await startCampaign();
      break;

    case 'status':
      showStatus();
      break;

    case 'export':
      await exportSentEmails();
      break;

    case 'follow-ups':
    case 'followups':
      scheduleFollowUps();
      break;

    case 'follow-up':
      console.log('Follow-up sending not yet implemented. Use status to track progress.');
      break;

    default:
      showUsage();
      break;
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
