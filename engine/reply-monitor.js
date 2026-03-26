import { ImapFlow } from 'imapflow';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool, getActiveInboxes, recordEvent } from './db.js';

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

const WATCH         = process.argv.includes('--watch');
const POLL_INTERVAL = parseInt(getArgValue('--interval') || process.env.IMAP_POLL_MINUTES || '15', 10) * 60_000;
const LOOKBACK_DAYS = parseInt(process.env.IMAP_LOOKBACK_DAYS || '3', 10);

async function checkInbox(inbox) {
  const client = new ImapFlow({
    host: inbox.imap_host,
    port: inbox.imap_port,
    secure: inbox.imap_port === 993,
    auth: { user: inbox.email, pass: inbox.app_password || inbox.oauth_refresh_token },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  let found = 0;

  try {
    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);
    const uids = await client.search({ since });
    if (uids.length === 0) return 0;

    for await (const msg of client.fetch(uids, { envelope: true, headers: ['in-reply-to', 'references'] })) {
      const inReplyTo = msg.headers.get('in-reply-to') || '';
      const references = msg.headers.get('references') || '';
      if (!inReplyTo && !references) continue;

      const msgIds = [inReplyTo, ...references.split(/\s+/)]
        .map(id => id.trim()).filter(Boolean);
      if (msgIds.length === 0) continue;

      const { rows } = await pool.query(
        `SELECT s.id AS send_id, s.lead_id, l.email AS lead_email
         FROM sends s JOIN leads l ON l.id = s.lead_id
         WHERE s.message_id = ANY($1::text[]) AND l.status = 'active' LIMIT 1`,
        [msgIds]
      );
      if (rows.length === 0) continue;

      const { send_id, lead_id, lead_email } = rows[0];
      await pool.query(`UPDATE leads SET status = 'replied' WHERE id = $1 AND status = 'active'`, [lead_id]);
      await recordEvent({ send_id, type: 'reply', metadata: { from: msg.envelope.from?.[0]?.address, subject: msg.envelope.subject } });
      console.log(`  REPLY: ${lead_email} → marked as replied`);
      found++;
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return found;
}

async function runCheck() {
  const now = new Date().toLocaleTimeString();
  process.stdout.write(`[${now}] Checking replies...`);
  const inboxes = await getActiveInboxes();
  let total = 0;
  for (const inbox of inboxes) {
    try { total += await checkInbox(inbox); }
    catch (err) { console.error(`\n  Error on ${inbox.email}: ${err.message}`); }
  }
  console.log(` ${total} new.`);
  return total;
}

if (WATCH) {
  console.log(`Watching for replies — polling every ${POLL_INTERVAL / 60_000} min. Ctrl+C to stop.\n`);
  await runCheck();
  setInterval(runCheck, POLL_INTERVAL);
} else {
  await runCheck();
  process.exit(0);
}
