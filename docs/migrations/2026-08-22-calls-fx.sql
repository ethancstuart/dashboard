-- ============================================================================
-- Migration: FX calls — percentage thresholds and a fixed reference point
-- Date: 2026-08-22
--
-- The censorship kind resolves on a COUNT of external events, which `threshold`
-- (an int) expresses fine. An FX call resolves on a PERCENTAGE move from a
-- reference rate, and both of those must be fixed at creation — otherwise the
-- bar can move after the outcome is known, which is the one thing a ledger
-- cannot allow.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================================

ALTER TABLE calls ADD COLUMN IF NOT EXISTS threshold_pct NUMERIC(8,3);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS reference_value NUMERIC(20,6);

COMMENT ON COLUMN calls.threshold_pct IS
  'Percentage move required for a hit, for kinds resolved on magnitude rather than event count. Fixed at creation.';
COMMENT ON COLUMN calls.reference_value IS
  'The observed value when the call was made. Without it "moves more than X%" has no baseline and is unresolvable.';
