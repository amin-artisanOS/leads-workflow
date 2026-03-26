import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { incrementSendOpenCount, incrementSendClickCount, recordEvent } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PORT = parseInt(process.env.TRACKER_PORT || '3001', 10);

// 1x1 transparent GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const app = express();

app.get('/pixel/:sendId.gif', async (req, res) => {
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.send(PIXEL);

  const sendId = parseInt(req.params.sendId, 10);
  if (!isNaN(sendId)) {
    try {
      await incrementSendOpenCount(sendId);
      await recordEvent({ send_id: sendId, type: 'open', metadata: null });
    } catch (_) {}
  }
});

app.get('/click/:sendId/:linkIndex', async (req, res) => {
  const sendId    = parseInt(req.params.sendId, 10);
  const linkIndex = parseInt(req.params.linkIndex, 10);
  const targetUrl = req.query.url ? decodeURIComponent(req.query.url) : null;

  if (!targetUrl) return res.status(400).send('Missing url');
  res.redirect(302, targetUrl);

  if (!isNaN(sendId)) {
    try {
      await incrementSendClickCount(sendId);
      await recordEvent({ send_id: sendId, type: 'click', metadata: { url: targetUrl, link_index: linkIndex } });
    } catch (_) {}
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date() }));

app.listen(PORT, () => {
  console.log(`Tracking server on port ${PORT}`);
  console.log(`  Opens:  ${process.env.TRACKING_URL}/pixel/{send_id}.gif`);
  console.log(`  Clicks: ${process.env.TRACKING_URL}/click/{send_id}/{index}?url={url}`);
});
