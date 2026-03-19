#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV_FILE = path.join(__dirname, '.env');
const EXAMPLE_ENV_FILE = path.join(__dirname, '.env.example');

async function setupEmailInfrastructure() {
  console.log('📧 Email Infrastructure Setup');
  console.log('=============================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    // Check if .env exists
    let envExists = fs.existsSync(ENV_FILE);
    let envContent = '';

    if (envExists) {
      envContent = fs.readFileSync(ENV_FILE, 'utf8');
      console.log('✅ Found existing .env file\n');
    } else {
      console.log('📝 Creating new .env file\n');
    }

    // Email service selection
    console.log('Choose your email service:');
    console.log('1. Gmail (recommended)');
    console.log('2. Outlook/Hotmail');
    console.log('3. Custom SMTP');
    console.log('4. Other (manual config)');

    const serviceChoice = await question('\nEnter choice (1-4): ');
    let emailConfig = {};

    switch (serviceChoice.trim()) {
      case '1':
        console.log('\n🚀 Gmail Setup');
        console.log('==============');
        console.log('For Gmail, you need to:');
        console.log('1. Enable 2-Factor Authentication on your Google account');
        console.log('2. Generate an App Password (NOT your regular password)');
        console.log('3. Visit: https://support.google.com/accounts/answer/185833\n');

        const gmailUser = await question('Your Gmail address: ');
        const gmailAppPassword = await question('Your Gmail App Password: ');

        emailConfig = {
          EMAIL_USER: gmailUser.trim(),
          EMAIL_APP_PASSWORD: gmailAppPassword.trim(),
          EMAIL_SERVICE: 'gmail'
        };

        console.log('\n✅ Gmail configured successfully!\n');
        break;

      case '2':
        console.log('\n📧 Outlook Setup');
        console.log('================');
        console.log('For Outlook/Hotmail, use your regular password or an App Password if 2FA is enabled.\n');

        const outlookUser = await question('Your Outlook/Hotmail address: ');
        const outlookPassword = await question('Your password (or App Password): ');

        emailConfig = {
          EMAIL_USER: outlookUser.trim(),
          EMAIL_APP_PASSWORD: outlookPassword.trim(),
          EMAIL_SERVICE: 'outlook'
        };

        console.log('\n✅ Outlook configured successfully!\n');
        break;

      case '3':
        console.log('\n⚙️  Custom SMTP Setup');
        console.log('====================');

        const smtpHost = await question('SMTP Host (e.g., smtp.gmail.com): ');
        const smtpPort = await question('SMTP Port (e.g., 587): ');
        const smtpUser = await question('SMTP Username: ');
        const smtpPassword = await question('SMTP Password: ');
        const smtpSecure = await question('Use SSL/TLS? (y/n): ');

        emailConfig = {
          EMAIL_HOST: smtpHost.trim(),
          EMAIL_PORT: smtpPort.trim(),
          EMAIL_USER: smtpUser.trim(),
          EMAIL_PASS: smtpPassword.trim(),
          EMAIL_SECURE: smtpSecure.toLowerCase().startsWith('y') ? 'true' : 'false'
        };

        console.log('\n✅ Custom SMTP configured successfully!\n');
        break;

      case '4':
        console.log('\n📝 Manual Configuration');
        console.log('=======================');
        console.log('You\'ll need to manually add email settings to your .env file.');
        console.log('Common variables:');
        console.log('- EMAIL_USER=your@email.com');
        console.log('- EMAIL_APP_PASSWORD=your-password');
        console.log('- EMAIL_SERVICE=gmail|outlook|smtp');
        console.log('- EMAIL_HOST=smtp.host.com (for custom SMTP)');
        console.log('- EMAIL_PORT=587 (for custom SMTP)');
        break;

      default:
        console.log('Invalid choice. Skipping email setup.');
        rl.close();
        return;
    }

    // Check for existing API keys
    const existingEnv = dotenv.parse(envContent);

    // Preserve existing keys and add new ones
    const finalEnv = {
      ...existingEnv,
      ...emailConfig
    };

    // Check for required API keys
    const missingKeys = [];

    if (!finalEnv.GEMINI_API_KEY) {
      console.log('\n🤖 Gemini AI Setup (Required for supplier qualification)');
      console.log('======================================================');
      console.log('1. Visit: https://makersuite.google.com/app/apikey');
      console.log('2. Create a new API key');
      console.log('3. Copy the key below\n');

      const geminiKey = await question('Gemini API Key: ');
      if (geminiKey.trim()) {
        finalEnv.GEMINI_API_KEY = geminiKey.trim();
        console.log('✅ Gemini API configured!\n');
      } else {
        missingKeys.push('GEMINI_API_KEY');
      }
    }

    if (!finalEnv.APIFY_TOKEN) {
      console.log('\n🔍 Apify Setup (Required for LinkedIn scraping)');
      console.log('===============================================');
      console.log('1. Visit: https://console.apify.com/');
      console.log('2. Sign up/login and get your API token');
      console.log('3. Copy the token below\n');

      const apifyToken = await question('Apify API Token: ');
      if (apifyToken.trim()) {
        finalEnv.APIFY_TOKEN = apifyToken.trim();
        console.log('✅ Apify API configured!\n');
      } else {
        missingKeys.push('APIFY_TOKEN');
      }
    }

    // Write .env file
    const envLines = Object.entries(finalEnv).map(([key, value]) => `${key}=${value}`);
    fs.writeFileSync(ENV_FILE, envLines.join('\n') + '\n');

    console.log('🎉 Configuration Complete!');
    console.log('==========================');

    if (missingKeys.length > 0) {
      console.log('\n⚠️  Missing API Keys (you can add them later):');
      missingKeys.forEach(key => console.log(`   - ${key}`));
      console.log('\nEdit your .env file to add these keys.');
    }

    console.log('\n📧 Email Configuration:');
    if (emailConfig.EMAIL_USER) {
      console.log(`   - Service: ${emailConfig.EMAIL_SERVICE || 'Custom'}`);
      console.log(`   - Email: ${emailConfig.EMAIL_USER}`);
      console.log('   - Status: ✅ Configured');
    }

    console.log('\n🤖 AI Configuration:');
    console.log(`   - Gemini API: ${finalEnv.GEMINI_API_KEY ? '✅ Configured' : '❌ Missing'}`);

    console.log('\n🔍 Scraping Configuration:');
    console.log(`   - Apify Token: ${finalEnv.APIFY_TOKEN ? '✅ Configured' : '❌ Missing'}`);

    // Test email configuration
    console.log('\n🧪 Testing Email Configuration...');
    const testResult = await testEmailConfig(finalEnv);
    console.log(`   - Email Test: ${testResult ? '✅ Passed' : '❌ Failed'}`);

    if (testResult) {
      console.log('\n🚀 Ready to start supplier outreach!');
      console.log('Run: npm run supplier-pipeline');
    } else {
      console.log('\n⚠️  Email configuration needs fixing before sending emails.');
      console.log('Check your credentials and try again.');
    }

    // Create example .env file for reference
    createExampleEnvFile();

  } catch (error) {
    console.error('Error during setup:', error.message);
  } finally {
    rl.close();
  }
}

async function testEmailConfig(config) {
  try {
    // Import nodemailer dynamically to avoid issues if not installed
    const nodemailer = await import('nodemailer');

    let transporter;

    if (config.EMAIL_HOST) {
      // Custom SMTP
      transporter = nodemailer.createTransporter({
        host: config.EMAIL_HOST,
        port: parseInt(config.EMAIL_PORT) || 587,
        secure: config.EMAIL_SECURE === 'true',
        auth: {
          user: config.EMAIL_USER,
          pass: config.EMAIL_PASS || config.EMAIL_APP_PASSWORD
        }
      });
    } else {
      // Gmail/Outlook
      transporter = nodemailer.createTransporter({
        service: config.EMAIL_SERVICE || 'gmail',
        auth: {
          user: config.EMAIL_USER,
          pass: config.EMAIL_APP_PASSWORD
        }
      });
    }

    // Try to verify connection
    await transporter.verify();
    return true;
  } catch (error) {
    console.log(`   Email test failed: ${error.message}`);
    return false;
  }
}

function createExampleEnvFile() {
  const exampleContent = `# Email Configuration
EMAIL_USER=your@email.com
EMAIL_APP_PASSWORD=your-app-password
EMAIL_SERVICE=gmail

# For custom SMTP (alternative to service-based config)
# EMAIL_HOST=smtp.gmail.com
# EMAIL_PORT=587
# EMAIL_SECURE=false
# EMAIL_USER=your@email.com
# EMAIL_PASS=your-password

# AI Configuration
GEMINI_API_KEY=your-gemini-api-key

# Scraping Configuration
APIFY_TOKEN=your-apify-token

# Apollo.io (Optional - for contact enrichment)
APOLLO_API_KEY=your-apollo-key

# Google Sheets (Optional - for data export)
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nYOUR_PRIVATE_KEY\\n-----END PRIVATE KEY-----"
`;

  fs.writeFileSync(EXAMPLE_ENV_FILE, exampleContent);
  console.log(`\n📄 Created .env.example for reference`);
}

// Command line interface
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('📧 Email Infrastructure Setup');
  console.log('');
  console.log('Usage: node setupEmailInfrastructure.js');
  console.log('');
  console.log('This script will help you:');
  console.log('- Configure email settings for outreach');
  console.log('- Set up API keys for AI and scraping');
  console.log('- Test email configuration');
  console.log('- Create .env file with all settings');
  console.log('');
  console.log('Required API Keys:');
  console.log('- GEMINI_API_KEY: For AI-powered supplier qualification');
  console.log('- APIFY_TOKEN: For LinkedIn job scraping');
  console.log('- Email credentials: For sending outreach emails');
  process.exit(0);
}

setupEmailInfrastructure();
