-- ============================================================================
-- Migration: allow a call to be VOIDED
-- Date: 2026-08-23
--
-- A call written under a defective threshold cannot be honestly resolved, and
-- it must not be quietly deleted either — a ledger that removes its
-- inconvenient rows is the thing this table exists to replace. So a fourth
-- status: the row stays, marked void, with the reason on it.
--
-- The trigger: FX thresholds were calibrated on endpoint-to-endpoint 14-day
-- depreciation while the resolver settles on the running maximum across the
-- window. Peak exceedance is strictly greater (24.3% vs 38.2% measured over
-- 5,270 currency-days), so those calls would have resolved at roughly double
-- their stated probability for reasons of construction rather than forecasting.
--
-- Idempotent.
-- ============================================================================

ALTER TABLE calls ADD COLUMN IF NOT EXISTS void_reason TEXT;

DO $$
DECLARE cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'calls'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%pending%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE calls DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE calls ADD CONSTRAINT calls_status_check
  CHECK (status IN ('pending', 'hit', 'miss', 'void'));

COMMENT ON COLUMN calls.void_reason IS
  'Why a call was withdrawn before resolution. Voided calls are never deleted and never scored.';
