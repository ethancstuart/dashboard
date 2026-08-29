-- ============================================================================
-- Migration: alert state, so one problem is one notification
-- Date: 2026-08-29
--
-- WHY. The alarm was connected on 2026-08-28 and immediately proved its worth:
-- it caught /api/cii timing out, a fault that had been invisible for months.
-- It then sent NINE identical [CRITICAL] emails, one every thirty minutes,
-- for that single continuous condition — 16:31 to 20:30 UTC — followed by two
-- more for a slow endpoint.
--
-- Nine emails for one problem is how a person learns to ignore the alarm. That
-- is worse than the silence it replaced, because silence is at least honest
-- about telling you nothing. This project's own governance names the failure:
-- a check whose result does not reach a person is a log line — and a check
-- that reaches them forty-eight times a day stops reaching them at all.
--
-- It matters on a specific date. From 2026-09-05 the ledger-truth assertion
-- fires whenever a call sits pending past its resolution date. If the resolver
-- has trouble that morning, the unfixed alarm mails every thirty minutes
-- indefinitely, and the one alert that actually matters arrives buried in its
-- own repetitions.
--
-- WHAT THIS STORES. One row per distinct ongoing condition, keyed by a
-- caller-supplied fingerprint. The fingerprint is deliberately NOT a hash of
-- the whole message: bodies carry live numbers ("3934ms") that change on every
-- run, so hashing them would defeat the deduplication entirely and send the
-- flood anyway. Callers key on the STABLE identity of the problem — which
-- endpoints are down, not how slow they were this minute.
--
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_state (
  fingerprint   TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'warning',
  -- When this condition was first observed, and most recently observed. The
  -- gap between them is how long it has been going on, which is the single
  -- most useful thing to put in a re-notification.
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- When a human was last actually told. NULL means detected but never sent.
  last_sent     TIMESTAMPTZ,
  send_count    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_state_last_seen ON alert_state (last_seen DESC);

COMMENT ON TABLE alert_state IS
  'One row per ongoing alert condition. Exists so a single continuous problem '
  'produces one notification plus a paced reminder, not one every cron tick. '
  'Rows are cleared when the condition resolves, which is what makes an '
  'all-clear possible.';

COMMENT ON COLUMN alert_state.fingerprint IS
  'Caller-supplied STABLE identity of the condition — e.g. the sorted set of '
  'affected endpoints. Never a hash of the message body: bodies carry live '
  'numbers that change every run, which would defeat deduplication silently.';
