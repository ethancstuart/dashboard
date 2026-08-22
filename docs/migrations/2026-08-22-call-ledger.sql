-- ============================================================================
-- Migration: the Call Ledger
-- Date: 2026-08-22
-- Plan: ~/.claude/plans/shiny-kindling-petal.md (Phase 2 — make the ledger real)
--
-- WHY. api/cron/record-assessments.ts generates every "prediction" as
-- 0.6*cii + 0.4*(cii + delta7) and then scores it against the CII. The system
-- forecasts its own output. Measured 2026-08-22 over 10,215 scored rows, that
-- pipeline's skill against a naive no-change baseline is -37.3%: worse than
-- assuming nothing changes, on a series that mostly does not change. A closed
-- loop cannot be a track record however many rows it accumulates.
--
-- A row in `calls` is different in exactly one way that matters: NOTHING about
-- its resolution touches NexusWatch's own numbers. It names an external source,
-- a threshold and a date before the fact, and something outside this system
-- decides whether it happened.
--
-- Resolvers available today, both already ingested from primary sources and
-- both political (the brief measures 3.1% politics against 18.5% seismic):
--   sanctions_designation -> sanctions_events   (OFAC/UN, 115,706 rows)
--   censorship_event      -> ooni_measurements  (4,236 rows)
--
-- Idempotent: IF NOT EXISTS throughout, and the unique constraint means
-- re-running the recorder on the same day updates rather than duplicates.
-- ============================================================================

CREATE TABLE IF NOT EXISTS calls (
  id             BIGSERIAL PRIMARY KEY,

  -- Stated before the outcome is known.
  made_on        DATE        NOT NULL,
  kind           TEXT        NOT NULL,
  country_code   TEXT        NOT NULL,
  claim          TEXT        NOT NULL,
  probability    NUMERIC(4,3) NOT NULL CHECK (probability > 0 AND probability < 1),
  horizon_days   INT         NOT NULL CHECK (horizon_days > 0),
  resolves_on    DATE        NOT NULL,

  -- The external authority that decides it, and the bar it has to clear.
  -- Both are fixed at creation so the criterion cannot move after the fact.
  resolver       TEXT        NOT NULL,
  threshold      INT         NOT NULL DEFAULT 1 CHECK (threshold >= 1),

  -- The baseline this call is trying to beat: how often it happens anyway.
  -- Stored per call so skill can be recomputed later without re-deriving history.
  base_rate      NUMERIC(4,3),

  -- Filled only at resolution.
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'hit', 'miss')),
  evidence_count INT,
  resolved_at    TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One call per country per kind per day. Makes the recorder safely re-runnable.
  CONSTRAINT calls_unique_daily UNIQUE (made_on, kind, country_code)
);

-- The resolver sweeps for matured, unresolved calls every day.
CREATE INDEX IF NOT EXISTS idx_calls_pending_due
  ON calls (resolves_on)
  WHERE status = 'pending';

-- The ledger page reads recently resolved calls, newest first.
CREATE INDEX IF NOT EXISTS idx_calls_resolved
  ON calls (resolved_at DESC)
  WHERE status <> 'pending';

CREATE INDEX IF NOT EXISTS idx_calls_country ON calls (country_code, made_on DESC);

COMMENT ON TABLE calls IS
  'Dated, falsifiable predictions resolved against external sources only. See api/_lib/calls.ts.';
COMMENT ON COLUMN calls.base_rate IS
  'P(event) from the country''s own history at the time the call was made. The baseline skill is measured against.';
COMMENT ON COLUMN calls.threshold IS
  'Qualifying external events required for a hit. Fixed at creation so the bar cannot move afterwards.';
