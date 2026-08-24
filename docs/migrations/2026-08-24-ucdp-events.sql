-- UCDP GED conflict events, 2026-08-24.
--
-- The conflict data the CII never had: api.acleddata.com is DNS-dead and the
-- account's new-API read scope is denied (owner portal action pending). UCDP
-- GED candidate files are tokenless, monthly, curated. Monthly lag means this
-- feeds the STRUCTURAL side (a derived conflict baseline) — not the daily
-- deviation, whose live-conflict slot waits on a real-time feed.
CREATE TABLE IF NOT EXISTS ucdp_events (
  event_id     bigint PRIMARY KEY,
  date_start   date NOT NULL,
  year         int NOT NULL,
  country_name text NOT NULL,
  gw_code      int NOT NULL,
  iso2         text,             -- NULL when the GW code has no ISO mapping
  lat          real NOT NULL DEFAULT 0,
  lon          real NOT NULL DEFAULT 0,
  deaths_best  int NOT NULL DEFAULT 0,
  type_of_violence int NOT NULL DEFAULT 0,
  source_version text NOT NULL,  -- e.g. 'ged26.1' or 'candidate v26_0_7'
  ingested_at  timestamptz NOT NULL DEFAULT NOW()
);
-- Curated annual releases supersede candidate rows for the same event id
-- (the ingest upserts, so the last-written version wins; annual runs last).
CREATE INDEX IF NOT EXISTS idx_ucdp_events_iso_date ON ucdp_events (iso2, date_start DESC);
COMMENT ON TABLE ucdp_events IS
  'UCDP GED + candidate conflict events. Ingested by scripts/ingest-ucdp.ts (backfill) and api/cron/source-ucdp.ts (monthly candidates).';
