import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { getCampaign, getLeadsDueForStep } from './db.js';
import { loadInboxes, sendSequenceEmail } from './sender.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const delay = () => new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

export async function runCampaignSequences(campaignId, { dryRun = false } = {}) {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (campaign.status !== 'active') {
    console.log(`Campaign "${campaign.name}" is ${campaign.status} — skipping.`);
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const steps = (campaign.steps || []).filter(Boolean);
  if (steps.length === 0) {
    console.log('No steps defined for this campaign.');
    return { sent: 0, skipped: 0, failed: 0 };
  }

  await loadInboxes();
  const stats = { sent: 0, skipped: 0, failed: 0 };

  for (const step of steps) {
    console.log(`\nStep ${step.step_number} (delay: ${step.delay_days}d after prev):`);
    const leads = await getLeadsDueForStep(campaignId, step.step_number, step.delay_days);
    console.log(`  ${leads.length} leads due`);

    for (const lead of leads) {
      process.stdout.write(`\r  → ${lead.email}...                    `);
      const result = await sendSequenceEmail({ lead, step, campaign, dryRun });

      if (result.success) {
        stats.sent++;
        process.stdout.write(`\r  ✓ ${lead.email} (${result.inbox_email || 'dry-run'})\n`);
        if (!dryRun) await delay();
      } else if (result.error === 'Already sent (duplicate)') {
        stats.skipped++;
      } else if (result.error === 'All inboxes at daily limit') {
        console.log('\n  All inboxes at daily limit — stopping.');
        return stats;
      } else {
        stats.failed++;
        console.log(`\n  ✗ ${lead.email}: ${result.error}`);
      }
    }
  }

  return stats;
}
