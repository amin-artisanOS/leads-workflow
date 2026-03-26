import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.PG_CONNECTION_STRING, max: 5 });
export async function closePool() { await pool.end(); }

// ── Inboxes ────────────────────────────────────────────────────────────────
export async function getActiveInboxes() {
  const { rows } = await pool.query(`SELECT * FROM inboxes WHERE active = TRUE ORDER BY id`);
  return rows;
}

export async function addInbox({ email, app_password, oauth_refresh_token, smtp_host, smtp_port, imap_host, imap_port, daily_limit }) {
  const { rows } = await pool.query(
    `INSERT INTO inboxes (email, app_password, oauth_refresh_token, smtp_host, smtp_port, imap_host, imap_port, daily_limit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (email) DO UPDATE SET app_password = EXCLUDED.app_password, daily_limit = EXCLUDED.daily_limit, active = TRUE
     RETURNING *`,
    [email, app_password || null, oauth_refresh_token || null,
     smtp_host || 'smtp.gmail.com', smtp_port || 587,
     imap_host || 'imap.gmail.com', imap_port || 993,
     daily_limit || 40]
  );
  return rows[0];
}

export async function resetDailyCounters() {
  await pool.query(
    `UPDATE inboxes SET sends_today = 0, last_reset_date = CURRENT_DATE
     WHERE last_reset_date IS NULL OR last_reset_date < CURRENT_DATE`
  );
}

export async function incrementInboxSendCount(inboxId) {
  await pool.query(`UPDATE inboxes SET sends_today = sends_today + 1 WHERE id = $1`, [inboxId]);
}

// ── Campaigns ──────────────────────────────────────────────────────────────
export async function createCampaign({ name, track_opens = true, track_clicks = true }) {
  const { rows } = await pool.query(
    `INSERT INTO campaigns (name, track_opens, track_clicks) VALUES ($1,$2,$3) RETURNING *`,
    [name, track_opens, track_clicks]
  );
  return rows[0];
}

export async function getCampaign(id) {
  const { rows } = await pool.query(
    `SELECT c.*, json_agg(cs.* ORDER BY cs.step_number) AS steps
     FROM campaigns c LEFT JOIN campaign_steps cs ON cs.campaign_id = c.id
     WHERE c.id = $1 GROUP BY c.id`,
    [id]
  );
  return rows[0];
}

export async function listCampaigns() {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.status, c.created_at, COUNT(DISTINCT l.id) AS lead_count
     FROM campaigns c LEFT JOIN leads l ON l.campaign_id = c.id
     GROUP BY c.id ORDER BY c.created_at DESC`
  );
  return rows;
}

export async function addCampaignStep({ campaign_id, step_number, delay_days, subject_template, body_template }) {
  const { rows } = await pool.query(
    `INSERT INTO campaign_steps (campaign_id, step_number, delay_days, subject_template, body_template)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [campaign_id, step_number, delay_days, subject_template, body_template]
  );
  return rows[0];
}

// ── Leads ──────────────────────────────────────────────────────────────────
export async function upsertLead(lead) {
  const { rows } = await pool.query(
    `INSERT INTO leads (campaign_id, email, first_name, last_name, company, website, niche, salutation, personalized_opening)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (email, campaign_id) DO NOTHING RETURNING *`,
    [lead.campaign_id, lead.email, lead.first_name, lead.last_name,
     lead.company, lead.website, lead.niche, lead.salutation, lead.personalized_opening]
  );
  return rows[0] || null;
}

export async function markLeadStatus(leadId, status) {
  await pool.query(`UPDATE leads SET status = $1 WHERE id = $2`, [status, leadId]);
}

// ── Sends ──────────────────────────────────────────────────────────────────
export async function recordSend({ lead_id, campaign_step_id, inbox_id, message_id }) {
  const { rows } = await pool.query(
    `INSERT INTO sends (lead_id, campaign_step_id, inbox_id, message_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT (lead_id, campaign_step_id) DO NOTHING RETURNING *`,
    [lead_id, campaign_step_id, inbox_id, message_id || null]
  );
  return rows[0] || null;
}

export async function incrementSendOpenCount(sendId) {
  await pool.query(`UPDATE sends SET open_count = open_count + 1 WHERE id = $1`, [sendId]);
}

export async function incrementSendClickCount(sendId) {
  await pool.query(`UPDATE sends SET click_count = click_count + 1 WHERE id = $1`, [sendId]);
}

// ── Events ─────────────────────────────────────────────────────────────────
export async function recordEvent({ send_id, type, metadata }) {
  await pool.query(
    `INSERT INTO events (send_id, type, metadata) VALUES ($1,$2,$3)`,
    [send_id, type, metadata ? JSON.stringify(metadata) : null]
  );
}

// ── Scheduling ─────────────────────────────────────────────────────────────
export async function getLeadsDueForStep(campaignId, stepNumber, delayDays) {
  if (stepNumber === 1) {
    const { rows } = await pool.query(
      `SELECT l.* FROM leads l
       WHERE l.campaign_id = $1 AND l.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM sends s
           JOIN campaign_steps cs ON cs.id = s.campaign_step_id
           WHERE s.lead_id = l.id AND cs.campaign_id = $1
         )`,
      [campaignId]
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT l.* FROM leads l
     JOIN sends prev_send ON prev_send.lead_id = l.id
     JOIN campaign_steps prev_cs ON prev_cs.id = prev_send.campaign_step_id
     WHERE l.campaign_id = $1
       AND l.status = 'active'
       AND prev_cs.step_number = $2
       AND prev_send.sent_at <= NOW() - ($3 || ' days')::INTERVAL
       AND NOT EXISTS (
         SELECT 1 FROM sends s
         JOIN campaign_steps cs ON cs.id = s.campaign_step_id
         WHERE s.lead_id = l.id AND cs.step_number = $4 AND cs.campaign_id = $1
       )`,
    [campaignId, stepNumber - 1, String(delayDays), stepNumber]
  );
  return rows;
}

// ── Stats ──────────────────────────────────────────────────────────────────
export async function getCampaignStats(campaignId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(DISTINCT l.id)                                        AS total_leads,
       COUNT(DISTINCT s.lead_id)                                   AS contacted,
       COUNT(DISTINCT CASE WHEN l.status='replied' THEN l.id END)  AS replied,
       COALESCE(SUM(s.open_count), 0)                              AS total_opens,
       COALESCE(SUM(s.click_count), 0)                             AS total_clicks,
       COUNT(DISTINCT s.id)                                        AS total_sends
     FROM leads l LEFT JOIN sends s ON s.lead_id = l.id
     WHERE l.campaign_id = $1`,
    [campaignId]
  );
  return rows[0];
}

export async function getInboxStats() {
  const { rows } = await pool.query(
    `SELECT i.email, i.daily_limit, i.sends_today, i.active, COUNT(s.id) AS total_sends_ever
     FROM inboxes i LEFT JOIN sends s ON s.inbox_id = i.id
     GROUP BY i.id ORDER BY i.email`
  );
  return rows;
}
