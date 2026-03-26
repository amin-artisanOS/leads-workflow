import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool, getActiveInboxes, resetDailyCounters, incrementInboxSendCount, recordSend } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TRACKING_URL = process.env.TRACKING_URL || 'http://localhost:3001';

// ── Transporter cache ──────────────────────────────────────────────────────
const _cache = new Map();

async function getTransporter(inbox) {
  if (_cache.has(inbox.id)) return _cache.get(inbox.id);

  let transport;
  if (inbox.oauth_refresh_token && process.env.GMAIL_CLIENT_ID) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: inbox.oauth_refresh_token });
    const { token } = await oauth2Client.getAccessToken();
    transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { type: 'OAuth2', user: inbox.email,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: inbox.oauth_refresh_token,
        accessToken: token }
    });
  } else {
    transport = nodemailer.createTransport({
      host: inbox.smtp_host,
      port: inbox.smtp_port,
      secure: inbox.smtp_port === 465,
      auth: { user: inbox.email, pass: inbox.app_password }
    });
  }

  _cache.set(inbox.id, transport);
  return transport;
}

// ── Round-robin inbox selection ────────────────────────────────────────────
let _inboxes = [];
let _rrIndex = 0;

export async function loadInboxes() {
  await resetDailyCounters();
  _inboxes = await getActiveInboxes();
  if (_inboxes.length === 0) throw new Error('No active inboxes. Add one with: node cli/add-inbox.js');
  _rrIndex = 0;
}

export function pickInbox() {
  for (let i = 0; i < _inboxes.length; i++) {
    const inbox = _inboxes[_rrIndex % _inboxes.length];
    _rrIndex = (_rrIndex + 1) % _inboxes.length;
    if (inbox.sends_today < inbox.daily_limit) return inbox;
  }
  return null;
}

// ── Template rendering ─────────────────────────────────────────────────────
export function renderTemplate(template, lead) {
  return template
    .replace(/\{\{FirstName\}\}/gi,            lead.first_name           || '')
    .replace(/\{\{LastName\}\}/gi,             lead.last_name            || '')
    .replace(/\{\{Company\}\}/gi,              lead.company              || '')
    .replace(/\{\{Website\}\}/gi,              lead.website              || '')
    .replace(/\{\{Niche\}\}/gi,                lead.niche                || '')
    .replace(/\{\{Salutation\}\}/gi,           lead.salutation           || lead.first_name || '')
    .replace(/\{\{Personalized_Opening\}\}/gi, lead.personalized_opening || '');
}

// ── Tracking injection ─────────────────────────────────────────────────────
export function injectTracking(html, sendId, trackOpens, trackClicks) {
  let body = html;
  if (trackClicks) {
    let i = 0;
    body = body.replace(/href="(https?:\/\/[^"]+)"/g, (_m, url) => {
      const t = `${TRACKING_URL}/click/${sendId}/${i}?url=${encodeURIComponent(url)}`;
      i++;
      return `href="${t}"`;
    });
  }
  if (trackOpens) {
    body += `<img src="${TRACKING_URL}/pixel/${sendId}.gif" width="1" height="1" style="display:none" alt=""/>`;
  }
  return body;
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Core send ──────────────────────────────────────────────────────────────
export async function sendSequenceEmail({ lead, step, campaign, dryRun = false }) {
  const inbox = pickInbox();
  if (!inbox) return { success: false, error: 'All inboxes at daily limit' };

  const subject  = renderTemplate(step.subject_template, lead);
  const rawBody  = renderTemplate(step.body_template, lead);
  const htmlBody = rawBody.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
  const plainText = htmlToText(rawBody);

  if (dryRun) {
    console.log(`  [DRY RUN] → ${lead.email} via ${inbox.email} | "${subject}"`);
    return { success: true, dry_run: true, inbox_email: inbox.email };
  }

  // Insert send record first to get the ID for tracking URLs
  const sendRecord = await recordSend({
    lead_id: lead.id, campaign_step_id: step.id, inbox_id: inbox.id, message_id: null
  });
  if (!sendRecord) return { success: false, error: 'Already sent (duplicate)' };

  const finalHtml = injectTracking(htmlBody, sendRecord.id, campaign.track_opens, campaign.track_clicks);

  try {
    const transporter = await getTransporter(inbox);
    const result = await transporter.sendMail({
      from: inbox.email, to: lead.email, subject, text: plainText, html: finalHtml
    });

    await pool.query(`UPDATE sends SET message_id = $1 WHERE id = $2`, [result.messageId, sendRecord.id]);
    inbox.sends_today++;
    await incrementInboxSendCount(inbox.id);

    return { success: true, send_id: sendRecord.id, message_id: result.messageId, inbox_email: inbox.email };
  } catch (err) {
    await pool.query(`DELETE FROM sends WHERE id = $1`, [sendRecord.id]);
    return { success: false, error: err.message };
  }
}
