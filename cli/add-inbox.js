#!/usr/bin/env node
// Usage: node cli/add-inbox.js --email=you@domain.com --password=APP_PASS [--daily-limit=40]
//    or: node cli/add-inbox.js --email=you@domain.com --oauth-refresh-token=TOKEN [--daily-limit=40]

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool, addInbox } from '../engine/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function getArgValue(flag) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
  }
  return null;
}

const EMAIL       = getArgValue('--email');
const PASSWORD    = getArgValue('--password');
const OAUTH_TOKEN = getArgValue('--oauth-refresh-token');
const DAILY_LIMIT = parseInt(getArgValue('--daily-limit') || '40', 10);

if (!EMAIL || (!PASSWORD && !OAUTH_TOKEN)) {
  console.error('Usage: node cli/add-inbox.js --email=you@domain.com --password=<app-password> [--daily-limit=40]');
  process.exit(1);
}

const inbox = await addInbox({ email: EMAIL, app_password: PASSWORD, oauth_refresh_token: OAUTH_TOKEN, daily_limit: DAILY_LIMIT });
console.log(`✅ Inbox registered: ${inbox.email} (limit: ${inbox.daily_limit}/day, id: ${inbox.id})`);
await pool.end();
