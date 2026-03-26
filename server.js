// OutreachOS — REST API Server
// Deploy to Render as a web service

import express from 'express';
import dotenv from 'dotenv';
import { Readable } from 'stream';
import csvParser from 'csv-parser';
import {
  pool, listCampaigns, getCampaign, createCampaign, addCampaignStep,
  getCampaignStats, getInboxStats, addInbox, getActiveInboxes,
  upsertLead, incrementSendOpenCount, incrementSendClickCount, recordEvent
} from './engine/db.js';
import { runCampaignSequences } from './engine/sequences.js';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '20mb' }));

// ── Auth ────────────────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  const secret = process.env.API_SECRET;
  if (!secret) return next();
  if (req.headers['x-api-key'] !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// ── Tracking (no auth — called by email clients) ─────────────────────────────
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

app.get('/pixel/:sendId.gif', async (req, res) => {
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.send(PIXEL);
  const id = parseInt(req.params.sendId, 10);
  if (!isNaN(id)) {
    try { await incrementSendOpenCount(id); await recordEvent({ send_id: id, type: 'open' }); } catch (_) {}
  }
});

app.get('/click/:sendId/:idx', async (req, res) => {
  const id  = parseInt(req.params.sendId, 10);
  const idx = parseInt(req.params.idx, 10);
  const url = req.query.url ? decodeURIComponent(req.query.url) : null;
  if (!url) return res.status(400).send('Missing url');
  res.redirect(302, url);
  if (!isNaN(id)) {
    try { await incrementSendClickCount(id); await recordEvent({ send_id: id, type: 'click', metadata: { url, idx } }); } catch (_) {}
  }
});

// ── API ─────────────────────────────────────────────────────────────────────
const api = express.Router();
api.use(requireAuth);

api.get('/health', (_req, res) => res.json({ ok: true, time: new Date() }));

// Campaigns
api.get('/campaigns', async (_req, res) => {
  try {
    const campaigns = await listCampaigns();
    const result = await Promise.all(campaigns.map(async c => ({
      ...c, stats: await getCampaignStats(c.id)
    })));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

api.get('/campaigns/:id', async (req, res) => {
  try {
    const c = await getCampaign(parseInt(req.params.id));
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json({ ...c, stats: await getCampaignStats(c.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

api.post('/campaigns', async (req, res) => {
  try {
    const { name, track_opens = true, track_clicks = true, steps = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const campaign = await createCampaign({ name, track_opens, track_clicks });
    for (const step of steps) {
      await addCampaignStep({ campaign_id: campaign.id, ...step });
    }
    res.status(201).json(await getCampaign(campaign.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

api.post('/campaigns/:id/steps', async (req, res) => {
  try {
    const campaign_id = parseInt(req.params.id);
    const step = await addCampaignStep({ campaign_id, ...req.body });
    res.status(201).json(step);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Campaign run (async fire-and-forget, poll /campaigns/:id/job for status)
const jobs = new Map();

api.post('/campaigns/:id/run', async (req, res) => {
  const id = parseInt(req.params.id);
  const dryRun = req.query.dry_run === 'true';

  if (jobs.get(id)?.status === 'running') {
    return res.json({ message: 'Already running', job: jobs.get(id) });
  }

  const job = { status: 'running', startedAt: new Date().toISOString(), dryRun };
  jobs.set(id, job);
  res.json({ message: 'Campaign run started', job });

  runCampaignSequences(id, { dryRun })
    .then(stats => jobs.set(id, { status: 'done', stats, completedAt: new Date().toISOString(), dryRun }))
    .catch(err  => jobs.set(id, { status: 'error', error: err.message, dryRun }));
});

api.get('/campaigns/:id/job', (req, res) => {
  const id = parseInt(req.params.id);
  res.json(jobs.get(id) || { status: 'idle' });
});

api.get('/campaigns/:id/stats', async (req, res) => {
  try {
    res.json(await getCampaignStats(parseInt(req.params.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Inboxes
api.get('/inboxes', async (_req, res) => {
  try { res.json(await getInboxStats()); } catch (e) { res.status(500).json({ error: e.message }); }
});

api.post('/inboxes', async (req, res) => {
  try {
    const { email, app_password, oauth_refresh_token, daily_limit = 40 } = req.body;
    if (!email || (!app_password && !oauth_refresh_token))
      return res.status(400).json({ error: 'email and app_password (or oauth_refresh_token) required' });
    const inbox = await addInbox({ email, app_password, oauth_refresh_token, daily_limit });
    res.status(201).json(inbox);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

api.delete('/inboxes/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE inboxes SET active = FALSE WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Leads import — accepts JSON array (parsed CSV from frontend)
api.post('/leads/import', async (req, res) => {
  try {
    const { campaign_id, leads } = req.body;
    if (!campaign_id || !Array.isArray(leads)) return res.status(400).json({ error: 'campaign_id and leads[] required' });

    let imported = 0, skipped = 0;
    for (const row of leads) {
      const email = (row.email || row.Email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) { skipped++; continue; }
      const result = await upsertLead({
        campaign_id,
        email,
        first_name:           row.first_name   || row.FirstName   || row['First Name Enriched'] || '',
        last_name:            row.last_name    || row.LastName    || row['Last Name Enriched']  || '',
        company:              row.company      || row.Company_Name || row['Company Clean']       || '',
        website:              row.website      || row.Website     || row['Website Enriched']    || '',
        niche:                row.niche        || row.Niche       || '',
        salutation:           row.salutation   || row.Salutation  || '',
        personalized_opening: row.personalized_opening || row.Personalized_Opening || '',
      });
      if (result) imported++; else skipped++;
    }
    res.json({ imported, skipped, total: leads.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Replies
api.get('/replies', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.email, l.first_name, l.company, e.occurred_at, e.metadata,
              c.name AS campaign_name
       FROM events e
       JOIN sends s ON s.id = e.send_id
       JOIN leads l ON l.id = s.lead_id
       JOIN campaign_steps cs ON cs.id = s.campaign_step_id
       JOIN campaigns c ON c.id = cs.campaign_id
       WHERE e.type = 'reply'
       ORDER BY e.occurred_at DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use('/api', api);

app.listen(PORT, () => console.log(`OutreachOS API running on port ${PORT}`));
