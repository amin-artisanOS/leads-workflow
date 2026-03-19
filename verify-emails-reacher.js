import axios from 'axios';
import fs from 'fs';
import path from 'path';
import createCsvWriter from 'csv-writer';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
// OPTION 1: Reacher Cloud API (FREE - 10k/month, no setup needed)
// Sign up at https://reacher.email and get your API key
// OPTION 2: Self-hosted (requires VPS with port 25 unblocked)

const REACHER_API_URL = process.env.REACHER_API_URL || 'https://api.reacher.email/v0/check_email';
const REACHER_API_KEY = process.env.REACHER_API_KEY || '';

// Rate limiting
const DELAY_BETWEEN_CHECKS_MS = 1000; // 1 second between checks

// Email validation regex
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const cleaned = email.trim().toLowerCase();

    // Filter out obvious junk
    if (cleaned.endsWith('.css') ||
        cleaned.endsWith('.js') ||
        cleaned.endsWith('.png') ||
        cleaned.endsWith('.jpg') ||
        cleaned.endsWith('.gif') ||
        cleaned.includes('example@') ||
        cleaned.includes('your@') ||
        cleaned.includes('xxx@') ||
        cleaned === 'n/a') {
        return false;
    }

    return EMAIL_REGEX.test(cleaned);
}

async function verifyEmail(email) {
    if (!REACHER_API_KEY) {
        return { email, is_reachable: 'no_api_key', status: 'ERROR' };
    }

    try {
        const response = await axios.post(REACHER_API_URL, {
            to_email: email
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${REACHER_API_KEY}`
            },
            timeout: 60000
        });

        const data = response.data;

        return {
            email: email,
            is_reachable: data.is_reachable || 'unknown',
            is_valid_syntax: data.syntax?.is_valid_syntax || false,
            is_disposable: data.misc?.is_disposable || false,
            is_role_account: data.misc?.is_role_account || false,
            mx_exists: data.mx?.accepts_mail || false,
            smtp_can_connect: data.smtp?.can_connect_smtp || false,
            is_catch_all: data.smtp?.is_catch_all || false,
            is_deliverable: data.smtp?.is_deliverable || 'unknown',
            domain: data.syntax?.domain || '',
            provider: data.misc?.gravatar || 'unknown'
        };
    } catch (error) {
        const errMsg = error.response?.data?.error || error.message;
        return {
            email: email,
            is_reachable: 'error',
            error: errMsg
        };
    }
}

async function verifyLeadsFromCSV(inputPath, outputPath) {
    console.log('🔒 REACHER EMAIL VERIFICATION');
    console.log('===============================');
    console.log(`📂 Input: ${inputPath}`);
    console.log(`📂 Output: ${outputPath}`);
    console.log(`🌐 API: ${REACHER_API_URL}`);

    if (!REACHER_API_KEY) {
        console.log('\n⚠️  No REACHER_API_KEY found!');
        console.log('');
        console.log('   👉 Get a FREE API key at: https://reacher.email');
        console.log('   👉 Then add to your .env file:');
        console.log('      REACHER_API_KEY=your_key_here');
        console.log('');
        console.log('   FREE tier: 10,000 verifications/month');
        console.log('');
        return;
    }

    console.log('===============================\n');

    // Read CSV
    const content = fs.readFileSync(inputPath, 'utf8');
    const lines = content.split('\n');

    const leads = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',');
        const domain = parts[0];
        const contact = parts[1];
        const email = parts[2]; // Best Email column

        // Only include valid emails
        if (isValidEmail(email)) {
            leads.push({ domain, contact, email: email.trim().toLowerCase() });
        }
    }

    console.log(`📊 Found ${leads.length} valid emails to verify\n`);

    // Verify emails
    const results = [];
    let verified = 0;
    let valid = 0;
    let invalid = 0;
    let risky = 0;
    let unknown = 0;

    for (const lead of leads) {
        console.log(`🔍 [${verified + 1}/${leads.length}] Verifying: ${lead.email}`);

        const result = await verifyEmail(lead.email);

        // Classify
        let status = 'UNKNOWN';
        if (result.is_reachable === 'safe') {
            status = 'VALID';
            valid++;
        } else if (result.is_reachable === 'invalid') {
            status = 'INVALID';
            invalid++;
        } else if (result.is_reachable === 'risky') {
            status = 'RISKY';
            risky++;
        } else {
            unknown++;
        }

        console.log(`   └─ ${status}`);

        results.push({
            domain: lead.domain,
            contact: lead.contact,
            email: lead.email,
            status: status,
            is_reachable: result.is_reachable,
            is_disposable: result.is_disposable || false,
            is_role_account: result.is_role_account || false,
            is_catch_all: result.is_catch_all || false,
            is_deliverable: result.is_deliverable || 'unknown',
            provider: result.provider || ''
        });

        verified++;

        // Rate limit
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_CHECKS_MS));
    }

    // Write results
    const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: outputPath,
        header: [
            { id: 'domain', title: 'Domain' },
            { id: 'contact', title: 'Contact' },
            { id: 'email', title: 'Email' },
            { id: 'status', title: 'Status' },
            { id: 'is_reachable', title: 'Reachable' },
            { id: 'is_disposable', title: 'Disposable' },
            { id: 'is_role_account', title: 'Role Account' },
            { id: 'is_catch_all', title: 'Catch All' },
            { id: 'is_deliverable', title: 'Deliverable' },
            { id: 'provider', title: 'Provider' }
        ]
    });

    await csvWriter.writeRecords(results);

    console.log('\n\n✅ VERIFICATION COMPLETE');
    console.log('===============================');
    console.log(`📊 Total Verified: ${verified}`);
    console.log(`✅ Valid: ${valid}`);
    console.log(`❌ Invalid: ${invalid}`);
    console.log(`⚠️  Risky: ${risky}`);
    console.log(`❓ Unknown: ${unknown}`);
    console.log(`📄 Results saved to: ${outputPath}`);
}

// Check if running directly
const args = process.argv.slice(2);
if (args.length >= 1) {
    const inputPath = args[0];
    const outputPath = args[1] || inputPath.replace('.csv', '_verified.csv');
    verifyLeadsFromCSV(inputPath, outputPath);
} else {
    console.log('🔒 REACHER EMAIL VERIFICATION');
    console.log('===============================\n');
    console.log('Usage: node verify-emails-reacher.js <input.csv> [output.csv]\n');
    console.log('Example:');
    console.log('  node verify-emails-reacher.js COMMERIUM/artisan_os_all_leads.csv COMMERIUM/verified_leads.csv\n');
    console.log('Setup:');
    console.log('  1. Get FREE API key at: https://reacher.email');
    console.log('  2. Add to .env: REACHER_API_KEY=your_key_here');
    console.log('  3. Run the command above\n');
}

export { verifyEmail, verifyLeadsFromCSV };
