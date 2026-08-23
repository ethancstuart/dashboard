-- ============================================================================
-- Migration: governance_indicators
-- Date: 2026-08-22
-- Plan: ~/.claude/plans/shiny-kindling-petal.md (Phase 3 — make the CII's
--       political components real)
--
-- WHY. The CII's governance component is 15% of the score and is computed as
--   max(BASELINE_GOVERNANCE[code], f(conflict)) + ooni_bump
-- where BASELINE_GOVERNANCE is a hardcoded table covering 20 of 85 countries.
-- For the other 65 it starts at zero. So the political component of a political
-- risk index is either a constant somebody typed or a function of the conflict
-- score — which is also why the index is piecewise-constant and why a naive
-- persistence baseline beats the ensemble that tries to forecast it.
--
-- `vdem_indicators` was meant to fix this and holds ZERO rows. Reading
-- api/cron/source-vdem.ts explains why, and it is not a bug: V-Dem's only free
-- distribution is a ~200MB zipped CSV / binary .rds, so the cron is a scaffold
-- that returns {skipped: true} every month by design, waiting on a VDEM_DATA_URL
-- nobody ever set.
--
-- DEVIATION, FLAGGED. This uses World Bank Worldwide Governance Indicators
-- rather than V-Dem. Same intent — a real, independent, per-country governance
-- measure instead of a hardcoded table — via a mechanism that actually works
-- from a serverless function: free, no API key, JSON, six dimensions, 2024
-- data, and 84 of our 85 CII countries covered (Taiwan is the exception; the
-- World Bank does not list it).
--
-- Idempotent: IF NOT EXISTS, and the primary key makes re-ingestion an upsert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS governance_indicators (
  country_code TEXT        NOT NULL,
  year         INT         NOT NULL,
  -- One of the six WGI dimensions, stored under a readable name rather than
  -- the vendor's code so a future second source can populate the same rows.
  indicator    TEXT        NOT NULL,
  -- WGI estimates run approximately -2.5 (weak) to +2.5 (strong).
  value        NUMERIC(8,5) NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'worldbank-wgi',
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (country_code, year, indicator, source)
);

CREATE INDEX IF NOT EXISTS idx_governance_country_year
  ON governance_indicators (country_code, year DESC);

CREATE INDEX IF NOT EXISTS idx_governance_observed
  ON governance_indicators (observed_at DESC);

COMMENT ON TABLE governance_indicators IS
  'Per-country governance measures from an external source. Replaces the hardcoded BASELINE_GOVERNANCE table in api/_lib/cii-baselines.ts.';
COMMENT ON COLUMN governance_indicators.value IS
  'World Bank WGI estimate, approximately -2.5 (weak) to +2.5 (strong). Higher is better governance, so it is INVERTED where it feeds a risk score.';
