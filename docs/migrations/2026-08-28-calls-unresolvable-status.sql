-- ============================================================================
-- Migration: a call the resolver could not honestly score is UNRESOLVABLE
-- Date: 2026-08-28
--
-- WHY. `resolve-calls.ts` already refuses to score a call when OONI observed
-- the country zero times in its window — absence of evidence is not evidence
-- of absence. But it expressed that refusal by leaving the row `pending`
-- forever behind a console.error, which means:
--   - the call sits in the open book past its own resolution date,
--   - `next_resolves_on` is computed from a date that has passed,
--   - the ledger-truth assertion (any call past resolves_on still pending
--     pages a human) fires on it permanently, and
--   - no reader can ever see WHY it did not resolve.
--
-- A ledger that silently drops its inconvenient rows is the thing this table
-- exists to replace. So: a fifth status. The row stays, marked unresolvable,
-- with the reason on it, visible and counted separately.
--
-- THE DISTINCTION FROM `void`, because a future reader will find them side by
-- side and reasonably read it as inconsistency:
--   `void`         — WE were wrong. The call was written under a defective
--                    criterion and cannot be honestly resolved at all.
--                    Our defect, withdrawn by us.
--   `unresolvable` — THE WORLD did not supply enough evidence. The criterion
--                    was fine; the resolver could not observe the country
--                    densely enough to score it either way.
-- Both are never scored. Both are never deleted. They differ in whose fault
-- it was, and that distinction is worth publishing.
--
-- LOAD-BEARING, and the reason this migration ships in the same commit as the
-- ledger change: `api/calls/ledger.ts` selects `WHERE status <> 'pending'` and
-- then maps `status === 'hit' ? 1 : 0`. Under that mapping every non-hit row
-- scores as a MISS — so `void` is ALREADY being scored as a miss today, and a
-- new status would silently inherit exactly the false miss this whole change
-- exists to prevent. Adding the status without fixing the aggregation would be
-- worse than not adding it.
--
-- Idempotent.
-- ============================================================================

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
  CHECK (status IN ('pending', 'hit', 'miss', 'void', 'unresolvable'));

-- `void_reason` now carries the reason for ANY non-scored disposition. Reusing
-- it rather than adding a sibling column keeps one place to look for "why is
-- this row not scored", which is the question a reader actually has.
COMMENT ON COLUMN calls.void_reason IS
  'Why a call was not scored. For status=void: our defect, the criterion was unsound. '
  'For status=unresolvable: the resolver did not observe enough evidence to score it '
  'either way. Neither is ever deleted and neither is ever scored.';

-- No backfill. Rows currently stuck pending past their resolution date are
-- left alone deliberately: the resolver will reclassify them on its next run
-- under the published rule, which is a decision with a date and an audit trail
-- rather than an UPDATE nobody can point at.
