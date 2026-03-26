#!/usr/bin/env node
// Usage: node cli/stats.js [--campaign=1]

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool, listCampaigns, getCampaignStats, getInboxStats } from '../engine/db.js';

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

const CAMPAIGN_FILTER = getArgValue('--campaign');

console.log('\nOutreach Platform Stats');
console.log('═'.repeat(55));

const campaigns = await listCampaigns();

if (campaigns.length === 0) {
  console.log('No campaigns yet. Create one with psql or cli/create-campaign.js');
} else {
  for (const c of campaigns) {
    if (CAMPAIGN_FILTER && String(c.id) !== CAMPAIGN_FILTER) continue;
    const s = await getCampaignStats(c.id);
    const contacted   = Number(s.contacted);
    const replied     = Number(s.replied);
    const opens       = Number(s.total_opens);
    const openRate    = contacted > 0 ? ((opens   / contacted) * 100).toFixed(1) : '0.0';
    const replyRate   = contacted > 0 ? ((replied / contacted) * 100).toFixed(1) : '0.0';

    console.log(`\nCampaign: "${c.name}" (id=${c.id}, ${c.status})`);
    console.log(`  Leads total:  ${s.total_leads}`);
    console.log(`  Contacted:    ${contacted}`);
    console.log(`  Total sends:  ${s.total_sends}`);
    console.log(`  Replies:      ${replied} (${replyRate}%)`);
    console.log(`  Opens:        ${opens} (${openRate}% of contacted)`);
    console.log(`  Clicks:       ${s.total_clicks}`);
  }
}

console.log('\nInbox Usage:');
const inboxes = await getInboxStats();
if (inboxes.length === 0) {
  console.log('  No inboxes. Add one with: node cli/add-inbox.js');
} else {
  for (const i of inboxes) {
    const pct = ((i.sends_today / i.daily_limit) * 100).toFixed(0);
    console.log(`  ${i.email.padEnd(40)} today: ${String(i.sends_today).padStart(3)}/${i.daily_limit} (${pct}%) | all-time: ${i.total_sends_ever}`);
  }
}

await pool.end();
