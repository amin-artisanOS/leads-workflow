#!/usr/bin/env node
// Usage: node cli/run-campaign.js --campaign=1 [--dry-run]

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool } from '../engine/db.js';
import { runCampaignSequences } from '../engine/sequences.js';

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

const CAMPAIGN_ID = parseInt(getArgValue('--campaign') || '0', 10);
const DRY_RUN     = process.argv.includes('--dry-run');

if (!CAMPAIGN_ID) {
  console.error('Usage: node cli/run-campaign.js --campaign=<id> [--dry-run]');
  process.exit(1);
}

console.log(`\nCampaign #${CAMPAIGN_ID}${DRY_RUN ? ' [DRY RUN]' : ''}`);
console.log('═'.repeat(50));

const stats = await runCampaignSequences(CAMPAIGN_ID, { dryRun: DRY_RUN });

console.log('\n' + '═'.repeat(50));
console.log(`✅ Sent:    ${stats.sent}`);
console.log(`⏭  Skipped: ${stats.skipped}`);
console.log(`❌ Failed:  ${stats.failed}`);

await pool.end();
