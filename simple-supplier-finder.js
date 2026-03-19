#!/usr/bin/env node

import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { ApifyClient } from 'apify-client';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import nodemailer from 'nodemailer';
import createCsvWriter from 'csv-writer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load simple config
let config;
try {
    const configPath = path.join(__dirname, 'simple-config.json');
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('✅ Loaded base configuration from simple-config.json');

    // Override with .env values if they exist
    if (process.env.GEMINI_API_KEY) {
        config.apiKeys.gemini = process.env.GEMINI_API_KEY;
    }
    if (process.env.APIFY_TOKEN) {
        config.apiKeys.apify = process.env.APIFY_TOKEN;
    }
    if (process.env.APOLLO_API_KEY) {
        config.apiKeys.apollo = process.env.APOLLO_API_KEY;
    }
    if (process.env.EMAIL_USER) {
        config.emailSettings.user = process.env.EMAIL_USER;
    }
    if (process.env.EMAIL_APP_PASSWORD) {
        config.emailSettings.appPassword = process.env.EMAIL_APP_PASSWORD;
    }

    console.log('✅ Merged API keys from .env file');
} catch (error) {
    console.error('❌ Failed to load simple-config.json:', error.message);
    console.error('Please run: node setupEmailInfrastructure.js');
    process.exit(1);
}

const app = express();
const port = 3004;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Serve static files
app.use(express.static(__dirname));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Initialize clients
const apifyClient = new ApifyClient({
    token: config.apiKeys.apify,
});

// Email transporter
let emailTransporter = null;
async function getEmailTransporter() {
    if (!emailTransporter) {
        emailTransporter = nodemailer.createTransporter({
            service: config.emailSettings.service,
            auth: {
                user: config.emailSettings.user,
                pass: config.emailSettings.appPassword
            }
        });
    }
    return emailTransporter;
}

// Initialize Gemini
let geminiModel = null;
async function getGeminiModel() {
    if (!geminiModel) {
        const genAI = new GoogleGenerativeAI(config.apiKeys.gemini);
        geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    }
    return geminiModel;
}

// Search Google Maps for businesses
async function searchGoogleMaps(product, country) {
    console.log(`🔍 Searching Google Maps for "${product}" in ${country}...`);

    try {
        // Use Apify's Google Maps scraper - compass/crawler-google-places
        const input = {
            "searchStringsArray": [
                `${product} manufacturer`,
                `${product} supplier`,
                `${product} wholesale`,
                `${product} company`
            ],
            "locationQuery": country,
            "maxCrawledPlacesPerSearch": config.searchSettings.maxBusinessesPerSearch,
            "language": "en",
            "skipClosedPlaces": false,
            "placeMinimumStars": "",
            "website": "allPlaces",
            "searchMatching": "all"
        };

        const run = await apifyClient.actor('lukaskrivka/google-maps-with-contact-details').call(input);
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

        console.log(`✅ Found ${items.length} businesses on Google Maps`);

        // Filter and clean results
        const businesses = items
            .filter(item => item.title && item.address && item.website)
            .map(item => ({
                name: item.title,
                address: item.address,
                website: item.website,
                phone: item.phone || item.phoneNumber || '',
                email: item.email || '', // This actor might include emails directly
                rating: item.rating || item.totalScore || 0,
                reviews: item.reviewsCount || item.totalScore || 0,
                category: item.categoryName || item.category || '',
                country: country
            }))
            .slice(0, config.searchSettings.maxBusinessesPerSearch);

        console.log(`📊 Filtered to ${businesses.length} valid businesses with websites`);
        return businesses;

    } catch (error) {
        console.error('❌ Google Maps search failed:', error.message);
        return [];
    }
}

// Get country code for Google Maps
function getCountryCode(country) {
    const codes = {
        'China': 'CN',
        'Vietnam': 'VN',
        'India': 'IN',
        'Turkey': 'TR',
        'Italy': 'IT',
        'Spain': 'ES',
        'Brazil': 'BR',
        'Mexico': 'MX',
        'Germany': 'DE',
        'France': 'FR',
        'Portugal': 'PT'
    };
    return codes[country] || '';
}

// Get emails via Apollo.io (only for businesses without emails)
async function getEmailsFromApollo(businesses) {
    console.log(`📧 Getting emails for ${businesses.length} businesses via Apollo...`);

    const results = [];
    let successCount = 0;
    let skippedCount = 0;

    for (const business of businesses) {
        // If business already has email from Google Maps actor, skip Apollo
        if (business.email && business.email.includes('@')) {
            console.log(`⏭️  Skipping ${business.name} - already has email: ${business.email}`);
            results.push({
                ...business,
                contactName: business.contactName || '',
                contactTitle: business.contactTitle || '',
                linkedin: business.linkedin || ''
            });
            skippedCount++;
            continue;
        }

        try {
            // Use Apollo's People API to find contacts
            const response = await axios.get('https://api.apollo.io/api/v1/people/search', {
                headers: {
                    'Authorization': `Bearer ${config.apiKeys.apollo}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    q_organization_domains: business.website,
                    page: 1,
                    per_page: 3
                }
            });

            if (response.data.people && response.data.people.length > 0) {
                const person = response.data.people[0]; // Get first contact
                results.push({
                    ...business,
                    contactName: `${person.first_name} ${person.last_name}`.trim(),
                    contactTitle: person.title || 'Contact',
                    email: person.email || '',
                    linkedin: person.linkedin_url || ''
                });
                successCount++;
            } else {
                // No contacts found, add business without email
                results.push({
                    ...business,
                    contactName: '',
                    contactTitle: '',
                    email: '',
                    linkedin: ''
                });
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.log(`⚠️ Failed to get email for ${business.name}: ${error.message}`);
            results.push({
                ...business,
                contactName: '',
                contactTitle: '',
                email: '',
                linkedin: ''
            });
        }
    }

    console.log(`✅ Found emails for ${successCount}/${businesses.length} businesses (${skippedCount} had emails from Google Maps)`);
    return results;
}

// Generate personalized email
async function generateEmail(business, product) {
    try {
        const model = await getGeminiModel();

        const prompt = `Write a professional cold email to a potential supplier.

Your Company: ${config.yourCompany.name}
Your Name: ${config.yourCompany.contact.name}
Your Title: ${config.yourCompany.contact.title}
Your Store Description: ${config.yourCompany.description}

Supplier Company: ${business.name}
Product you're interested in: ${product}
Their location: ${business.country}

Write a short email (under 150 words) asking if they would be interested in supplying this product to your ecommerce store. Be professional and mention that you found them through their online presence.

Output format:
Subject: [subject line]
Body: [email body]

Keep it under 150 words total. Use the actual company and contact names provided.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();

        // Parse subject and body
        const subjectMatch = text.match(/Subject:\s*(.+?)(?:\n|$)/i);
        const bodyMatch = text.match(/Body:\s*(.+)/is);

        const subject = subjectMatch ? subjectMatch[1].trim() : `Interest in supplying ${product}`;
        const body = bodyMatch ? bodyMatch[1].trim() : text;

        return { subject, body };
    } catch (error) {
        console.log(`⚠️ Email generation failed for ${business.name}, using template`);
        return {
            subject: `Interest in supplying ${product}`,
            body: `Hi,

I hope this email finds you well. I came across your company ${business.name} and was impressed by your products.

I'm ${config.yourCompany.contact.name}, ${config.yourCompany.contact.title} at ${config.yourCompany.name}, ${config.yourCompany.description}.

We're looking for suppliers of ${product}. Would you be interested in discussing a potential partnership?

Looking forward to hearing from you.

Best regards,
${config.yourCompany.contact.name}
${config.yourCompany.contact.title}
${config.yourCompany.name}`
        };
    }
}

// Send email
async function sendEmail(business, emailContent) {
    try {
        const transporter = await getEmailTransporter();

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: business.email,
            subject: emailContent.subject,
            text: emailContent.body,
            html: emailContent.body.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>')
        };

        const result = await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${business.name} (${business.email})`);
        return { success: true, messageId: result.messageId };

    } catch (error) {
        console.log(`❌ Failed to send email to ${business.name}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Main API endpoint
app.post('/api/find-suppliers', async (req, res) => {
    console.log('📡 API Request received:', req.body);

    const { product, country } = req.body;

    if (!product || !country) {
        console.error('❌ Missing product or country:', { product, country });
        return res.status(400).json({ error: 'Product and country are required' });
    }

    console.log(`\n🚀 Starting supplier search for "${product}" in ${country}`);
    console.log('='.repeat(60));

    // Validate API keys
    if (config.apiKeys.apify === 'your-apify-token' || !config.apiKeys.apify) {
        console.error('❌ Apify token not configured');
        return res.status(500).json({
            error: 'API configuration error',
            details: 'Apify token not configured. Please update simple-config.json with your actual API keys.'
        });
    }

    if (config.apiKeys.apollo === 'your-apollo-api-key' || !config.apiKeys.apollo) {
        console.error('❌ Apollo API key not configured');
        return res.status(500).json({
            error: 'API configuration error',
            details: 'Apollo API key not configured. Please update simple-config.json with your actual API keys.'
        });
    }

    if (config.apiKeys.gemini === 'your-gemini-api-key' || !config.apiKeys.gemini) {
        console.error('❌ Gemini API key not configured');
        return res.status(500).json({
            error: 'API configuration error',
            details: 'Gemini API key not configured. Please update simple-config.json with your actual API keys.'
        });
    }

    try {
        // Step 1: Search Google Maps
        const businesses = await searchGoogleMaps(product, country);
        if (businesses.length === 0) {
            return res.status(404).json({ error: 'No businesses found' });
        }

        // Step 2: Get emails via Apollo (for businesses without emails from Google Maps)
        const businessesWithContacts = await getEmailsFromApollo(businesses);
        const businessesWithEmails = businessesWithContacts.filter(b => b.email);
        const businessesWithEmailsFromGMaps = businesses.filter(b => b.email && b.email.includes('@')).length;

        console.log(`📧 Found ${businessesWithEmails.length} businesses with email contacts`);
        console.log(`   - ${businessesWithEmailsFromGMaps} emails from Google Maps actor`);
        console.log(`   - ${businessesWithEmails.length - businessesWithEmailsFromGMaps} emails from Apollo.io`);

        // Step 3: Generate and send emails
        let emailsSent = 0;
        const results = [];

        for (const business of businessesWithEmails.slice(0, config.searchSettings.maxEmailsToSend)) {
            console.log(`\n📧 Processing ${business.name}...`);

            // Generate personalized email
            const emailContent = await generateEmail(business, product);

            // Send email
            const sendResult = await sendEmail(business, emailContent);

            results.push({
                business: business.name,
                email: business.email,
                sent: sendResult.success,
                error: sendResult.error
            });

            if (sendResult.success) {
                emailsSent++;
            }

            // Rate limiting between emails
            await new Promise(resolve => setTimeout(resolve, config.searchSettings.emailDelaySeconds * 1000));
        }

        // Save results to CSV
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const csvFile = path.join(__dirname, `supplier_campaign_${timestamp}.csv`);

        const csvWriter = createCsvWriter.createObjectCsvWriter({
            path: csvFile,
            header: [
                { id: 'name', title: 'Business Name' },
                { id: 'website', title: 'Website' },
                { id: 'email', title: 'Email' },
                { id: 'country', title: 'Country' },
                { id: 'contactName', title: 'Contact Name' },
                { id: 'contactTitle', title: 'Contact Title' },
                { id: 'sent', title: 'Email Sent' }
            ]
        });

        await csvWriter.writeRecords(
            businessesWithContacts.map(b => ({
                name: b.name,
                website: b.website,
                email: b.email,
                country: b.country,
                contactName: b.contactName,
                contactTitle: b.contactTitle,
                sent: results.find(r => r.business === b.name)?.sent ? 'Yes' : 'No'
            }))
        );

        console.log(`\n✅ Campaign complete!`);
        console.log(`📊 Businesses found: ${businesses.length}`);
        console.log(`📧 Emails found: ${businessesWithEmails.length}`);
        console.log(`📨 Emails sent: ${emailsSent}`);
        console.log(`💾 Results saved to: ${csvFile}`);

        res.json({
            success: true,
            suppliersFound: businessesWithContacts.length,
            emailsFound: businessesWithEmails.length,
            emailsFromGoogleMaps: businessesWithEmailsFromGMaps,
            emailsFromApollo: businessesWithEmails.length - businessesWithEmailsFromGMaps,
            emailsSent: emailsSent,
            csvFilename: `supplier_campaign_${timestamp}.csv`,
            csvFile: csvFile
        });

    } catch (error) {
        console.error('❌ Error in supplier search:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download CSV endpoint
app.get('/api/download-csv/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, filename);

    // Security check - only allow CSV files in the root directory
    if (!filename.startsWith('supplier_campaign_') || !filename.endsWith('.csv')) {
        return res.status(403).json({ error: 'Invalid filename' });
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    // Clean up old CSV files (keep only last 10)
    cleanupOldCsvFiles();
});

function cleanupOldCsvFiles() {
    try {
        const files = fs.readdirSync(__dirname)
            .filter(file => file.startsWith('supplier_campaign_') && file.endsWith('.csv'))
            .map(file => ({
                name: file,
                path: path.join(__dirname, file),
                stats: fs.statSync(path.join(__dirname, file))
            }))
            .sort((a, b) => b.stats.mtime - a.stats.mtime);

        // Keep only the 10 most recent files
        if (files.length > 10) {
            files.slice(10).forEach(file => {
                fs.unlinkSync(file.path);
                console.log(`🗑️ Cleaned up old CSV: ${file.name}`);
            });
        }
    } catch (error) {
        console.log('⚠️ Error cleaning up old CSV files:', error.message);
    }
}

// Serve the main UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'supplier-finder.html'));
});

// Check configuration status
app.get('/api/config-status', (req, res) => {
    const status = {
        apify: config.apiKeys.apify && config.apiKeys.apify !== 'your-apify-token' && config.apiKeys.apify.startsWith('apify_api_'),
        apollo: config.apiKeys.apollo && config.apiKeys.apollo !== 'your-apollo-api-key' && config.apiKeys.apollo.length > 10,
        gemini: config.apiKeys.gemini && config.apiKeys.gemini !== 'your-gemini-api-key' && config.apiKeys.gemini.startsWith('AIzaSy'),
        email: config.emailSettings.user && config.emailSettings.user !== 'your@email.com' &&
               config.emailSettings.appPassword && config.emailSettings.appPassword !== 'your-gmail-app-password'
    };

    const allConfigured = Object.values(status).every(Boolean);

    res.json({
        configured: allConfigured,
        status: status,
        message: allConfigured ?
            'All API keys configured ✓' :
            'Some API keys need to be configured. Check .env file or simple-config.json'
    });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`\n🏪 Supplier Finder UI running at:`);
    console.log(`   Local: http://localhost:${port}`);
    console.log(`   Network: http://0.0.0.0:${port}`);
    console.log('📱 Open your browser and start finding suppliers!\n');

    console.log('💡 Usage:');
    console.log(`1. Open http://localhost:${port} in your browser`);
    console.log(`2. Or try http://127.0.0.1:${port}`);
    console.log('3. Enter what you want to sell (in any language)');
    console.log('4. Choose a country');
    console.log('5. Click "Find Suppliers & Send Emails"');
    console.log('6. The system will automatically find businesses and send outreach emails\n');

    console.log('🔧 Troubleshooting:');
    console.log('- Make sure no firewall is blocking the connection');
    console.log('- Try a different browser');
    console.log('- Check if another application is using port', port);
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down Supplier Finder...');
    process.exit(0);
});
