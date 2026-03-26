-- Outreach Platform Schema
-- Run once: psql $PG_CONNECTION_STRING -f engine/schema.sql

CREATE TABLE IF NOT EXISTS inboxes (
  id                  SERIAL PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  app_password        TEXT,
  oauth_refresh_token TEXT,
  smtp_host           TEXT NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port           INTEGER NOT NULL DEFAULT 587,
  imap_host           TEXT NOT NULL DEFAULT 'imap.gmail.com',
  imap_port           INTEGER NOT NULL DEFAULT 993,
  daily_limit         INTEGER NOT NULL DEFAULT 40,
  sends_today         INTEGER NOT NULL DEFAULT 0,
  last_reset_date     DATE,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  track_opens  BOOLEAN NOT NULL DEFAULT TRUE,
  track_clicks BOOLEAN NOT NULL DEFAULT TRUE,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_steps (
  id               SERIAL PRIMARY KEY,
  campaign_id      INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_number      INTEGER NOT NULL,
  delay_days       INTEGER NOT NULL DEFAULT 0,
  subject_template TEXT NOT NULL,
  body_template    TEXT NOT NULL,
  UNIQUE(campaign_id, step_number)
);

CREATE TABLE IF NOT EXISTS leads (
  id                   SERIAL PRIMARY KEY,
  campaign_id          INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email                TEXT NOT NULL,
  first_name           TEXT,
  last_name            TEXT,
  company              TEXT,
  website              TEXT,
  niche                TEXT,
  salutation           TEXT,
  personalized_opening TEXT,
  status               TEXT NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email, campaign_id)
);

CREATE TABLE IF NOT EXISTS sends (
  id               SERIAL PRIMARY KEY,
  lead_id          INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_step_id INTEGER NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
  inbox_id         INTEGER NOT NULL REFERENCES inboxes(id),
  message_id       TEXT,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  open_count       INTEGER NOT NULL DEFAULT 0,
  click_count      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(lead_id, campaign_step_id)
);

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  send_id     INTEGER NOT NULL REFERENCES sends(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata    JSONB
);

CREATE INDEX IF NOT EXISTS idx_leads_campaign_status ON leads(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_sends_lead            ON sends(lead_id);
CREATE INDEX IF NOT EXISTS idx_sends_step            ON sends(campaign_step_id);
CREATE INDEX IF NOT EXISTS idx_sends_message_id      ON sends(message_id);
CREATE INDEX IF NOT EXISTS idx_events_send           ON events(send_id);
CREATE INDEX IF NOT EXISTS idx_inboxes_active        ON inboxes(active);
