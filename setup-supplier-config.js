#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, 'simple-config.json');

async function setupConfig() {
    console.log('🔧 Supplier Finder Configuration Setup');
    console.log('=====================================\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    try {
        // Load existing config
        let config;
        try {
            config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            console.log('✅ Loaded existing configuration\n');
        } catch (error) {
            console.log('📝 Creating new configuration\n');
            config = {
                "yourCompany": {
                    "name": "Your Ecommerce Store",
                    "description": "Online retailer specializing in quality products",
                    "website": "https://yourstore.com",
                    "contact": {
                        "name": "Your Name",
                        "title": "Store Owner",
                        "email": "your@email.com"
                    }
                },
                "emailSettings": {
                    "service": "gmail",
                    "user": "your@email.com",
                    "appPassword": "your-gmail-app-password"
                },
                "apiKeys": {
                    "apify": "your-apify-token",
                    "apollo": "your-apollo-api-key",
                    "gemini": "your-gemini-api-key"
                },
                "searchSettings": {
                    "maxBusinessesPerSearch": 20,
                    "maxEmailsToSend": 10,
                    "emailDelaySeconds": 2
                }
            };
        }

        // API Keys Setup
        console.log('🔑 API Keys Configuration');
        console.log('========================\n');

        // Apify Token
        if (config.apiKeys.apify === 'your-apify-token' || !config.apiKeys.apify) {
            console.log('📍 Apify Token (Required for Google Maps search)');
            console.log('   1. Go to: https://console.apify.com/');
            console.log('   2. Sign up/login and get your API token');
            console.log('   3. It looks like: apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxx\n');

            const apifyToken = await question('Enter your Apify API token: ');
            if (apifyToken.trim()) {
                config.apiKeys.apify = apifyToken.trim();
                console.log('✅ Apify token configured\n');
            }
        } else {
            console.log('✅ Apify token already configured\n');
        }

        // Apollo API Key
        if (config.apiKeys.apollo === 'your-apollo-api-key' || !config.apiKeys.apollo) {
            console.log('📧 Apollo API Key (Required for email finding)');
            console.log('   1. Go to: https://app.apollo.io/');
            console.log('   2. Sign up and get your API key');
            console.log('   3. Find it in Settings > API\n');

            const apolloKey = await question('Enter your Apollo API key: ');
            if (apolloKey.trim()) {
                config.apiKeys.apollo = apolloKey.trim();
                console.log('✅ Apollo API key configured\n');
            }
        } else {
            console.log('✅ Apollo API key already configured\n');
        }

        // Gemini API Key
        if (config.apiKeys.gemini === 'your-gemini-api-key' || !config.apiKeys.gemini) {
            console.log('🤖 Gemini API Key (Required for email generation)');
            console.log('   1. Go to: https://makersuite.google.com/app/apikey');
            console.log('   2. Create a new API key');
            console.log('   3. Copy the key\n');

            const geminiKey = await question('Enter your Gemini API key: ');
            if (geminiKey.trim()) {
                config.apiKeys.gemini = geminiKey.trim();
                console.log('✅ Gemini API key configured\n');
            }
        } else {
            console.log('✅ Gemini API key already configured\n');
        }

        // Email Setup
        console.log('📧 Email Configuration');
        console.log('=====================\n');

        // Check both simple-config.json and .env file
        const hasEnvEmail = process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD &&
                           process.env.EMAIL_USER !== 'your@email.com' &&
                           process.env.EMAIL_APP_PASSWORD !== 'your-gmail-app-password';

        if (config.emailSettings.user === 'your@email.com' ||
            config.emailSettings.appPassword === 'your-gmail-app-password') {

            if (hasEnvEmail) {
                // Use .env values
                config.emailSettings.user = process.env.EMAIL_USER;
                config.emailSettings.appPassword = process.env.EMAIL_APP_PASSWORD;
                console.log('✅ Email configured from .env file\n');
            } else {
                console.log('📧 Gmail Setup (Required for sending emails)');
                console.log('   1. Enable 2-Factor Authentication on Gmail');
                console.log('   2. Generate App Password: https://support.google.com/accounts/answer/185833');
                console.log('   3. Use the App Password (not your regular password)\n');

                const emailUser = await question('Enter your Gmail address: ');
                const emailAppPassword = await question('Enter your Gmail App Password: ');

                if (emailUser.trim() && emailAppPassword.trim()) {
                    config.emailSettings.user = emailUser.trim();
                    config.emailSettings.appPassword = emailAppPassword.trim();

                    // Also update .env file
                    const envPath = path.join(__dirname, '.env');
                    let envContent = '';
                    if (fs.existsSync(envPath)) {
                        envContent = fs.readFileSync(envPath, 'utf8');
                    }

                    // Update or add EMAIL_USER
                    if (envContent.includes('EMAIL_USER=')) {
                        envContent = envContent.replace(/EMAIL_USER=.*/, `EMAIL_USER=${emailUser.trim()}`);
                    } else {
                        envContent += `\nEMAIL_USER=${emailUser.trim()}`;
                    }

                    // Update or add EMAIL_APP_PASSWORD
                    if (envContent.includes('EMAIL_APP_PASSWORD=')) {
                        envContent = envContent.replace(/EMAIL_APP_PASSWORD=.*/, `EMAIL_APP_PASSWORD=${emailAppPassword.trim()}`);
                    } else {
                        envContent += `\nEMAIL_APP_PASSWORD=${emailAppPassword.trim()}`;
                    }

                    fs.writeFileSync(envPath, envContent.trim() + '\n');
                    console.log('✅ Email configured and saved to .env file\n');
                }
            }
        } else {
            console.log('✅ Email already configured\n');
        }

        // Company Info
        console.log('🏪 Company Information');
        console.log('======================\n');

        const companyName = await question(`Company name [${config.yourCompany.name}]: `);
        if (companyName.trim()) {
            config.yourCompany.name = companyName.trim();
        }

        const yourName = await question(`Your name [${config.yourCompany.contact.name}]: `);
        if (yourName.trim()) {
            config.yourCompany.contact.name = yourName.trim();
        }

        const yourTitle = await question(`Your title [${config.yourCompany.contact.title}]: `);
        if (yourTitle.trim()) {
            config.yourCompany.contact.title = yourTitle.trim();
        }

        // Save configuration
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('\n🎉 Configuration Complete!');
        console.log('==========================');

        // Check what's configured
        const status = {
            apify: config.apiKeys.apify !== 'your-apify-token' && config.apiKeys.apify,
            apollo: config.apiKeys.apollo !== 'your-apollo-api-key' && config.apiKeys.apollo,
            gemini: config.apiKeys.gemini !== 'your-gemini-api-key' && config.apiKeys.gemini,
            email: config.emailSettings.user !== 'your@email.com' && config.emailSettings.appPassword !== 'your-gmail-app-password'
        };

        console.log('\n📊 Configuration Status:');
        console.log(`   Apify Token: ${status.apify ? '✅' : '❌'}`);
        console.log(`   Apollo API: ${status.apollo ? '✅' : '❌'}`);
        console.log(`   Gemini API: ${status.gemini ? '✅' : '❌'}`);
        console.log(`   Email Setup: ${status.email ? '✅' : '❌'}`);

        const allConfigured = Object.values(status).every(Boolean);

        if (allConfigured) {
            console.log('\n🚀 All set! You can now run: npm run supplier-finder');
            console.log('   Then open: http://localhost:3004');
        } else {
            const missing = Object.entries(status)
                .filter(([key, value]) => !value)
                .map(([key]) => key)
                .join(', ');
            console.log(`\n⚠️  Still need to configure: ${missing}`);
            console.log('   Run this setup again: node setup-supplier-config.js');
        }

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
    } finally {
        rl.close();
    }
}

// Run setup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    setupConfig();
}

export { setupConfig };
