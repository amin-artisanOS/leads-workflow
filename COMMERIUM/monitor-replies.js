#!/usr/bin/env node
/**
 * monitor-replies.js
 * Polls Instantly campaign every N minutes and logs new replies to REPLIES_LOG.csv.
 *
 * Usage:
 *   node monitor-replies.js              # runs once
 *   node monitor-replies.js --watch      # polls every 30 min continuously
 *   node monitor-replies.js --watch --interval=60  # poll every 60 min
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const CAMPAIGN = 'fadb7d84-824b-4f24-b859-37e7d2a3eb45';
const LOG_FILE = path.join(__dirname, 'REPLIES_LOG.csv');
const api = axios.create({
    baseURL: 'https://api.instantly.ai',
    headers: { Authorization: 'Bearer ' + process.env.INSTANTLY_API_KEY, 'Content-Type': 'application/json' }
});

const WATCH   = process.argv.includes('--watch');
const interval = (() => {
    const m = process.argv.find(a => a.startsWith('--interval='));
    return m ? parseInt(m.split('=')[1]) * 60_000 : 30 * 60_000;
})();

async function fetchAllLeads() {
    const leads = [];
    let cursor = null;
    do {
        const r = await api.post('/api/v2/leads/list', {
            campaign_id: CAMPAIGN, limit: 100,
            ...(cursor ? { starting_after: cursor } : {})
        });
        leads.push(...(r.data.items || []));
        cursor = r.data.next_starting_after || null;
    } while (cursor);
    return leads;
}

function loadKnownReplies() {
    if (!fs.existsSync(LOG_FILE)) return new Set();
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(1);
    return new Set(lines.map(l => l.split(',')[0]?.replace(/"/g, '').trim()).filter(Boolean));
}

function appendToLog(newReplies) {
    const writeHeader = !fs.existsSync(LOG_FILE);
    const lines = newReplies.map(l =>
        `"${l.email}","${l.first_name || ''}","${l.company_name || ''}","${l.timestamp_last_contact || ''}","${new Date().toISOString()}"`
    );
    if (writeHeader) fs.appendFileSync(LOG_FILE, 'Email,First Name,Company,Last Contacted,Detected At\n');
    if (lines.length) fs.appendFileSync(LOG_FILE, lines.join('\n') + '\n');
}

async function check() {
    const now = new Date().toLocaleTimeString();
    process.stdout.write(`[${now}] Checking for replies...`);

    const leads = await fetchAllLeads();
    const replied = leads.filter(l => l.email_reply_count > 0 || l.status === 6);
    const known = loadKnownReplies();
    const newReplies = replied.filter(l => !known.has(l.email.toLowerCase().trim()));

    if (newReplies.length === 0) {
        console.log(` ${replied.length} total replies, 0 new.`);
    } else {
        console.log(`\n🎉 ${newReplies.length} NEW REPLIES DETECTED!`);
        newReplies.forEach(l => console.log(`   → ${l.email} (${l.company_name || 'unknown company'})`));
        appendToLog(newReplies);
        console.log(`   Saved to REPLIES_LOG.csv`);
    }

    return newReplies.length;
}

// Run
if (WATCH) {
    console.log(`Watching campaign — polling every ${interval / 60_000} min. Press Ctrl+C to stop.\n`);
    await check();
    setInterval(check, interval);
} else {
    const n = await check();
    console.log(`\nDone. ${fs.existsSync(LOG_FILE) ? 'All replies in REPLIES_LOG.csv' : 'No replies yet.'}`);
    process.exit(0);
}
