-- Sanctions collector rebuild, 2026-08-23.
--
-- What the audit found in sanctions_events: 116,717 rows, 1,021 distinct
-- entities — the same UN list re-inserted ~114 times. Every row was
-- change_type='add' (the "diff" was fictional: any snapshot change re-emitted
-- the whole list), every source_date was NULL (which defeats the ON CONFLICT
-- dedup, because NULL never equals NULL in a unique constraint), and the OFAC
-- leg had never written a row because its endpoint 404s.
--
-- 1. The snapshot table a real diff needs: the current list per source.
CREATE TABLE IF NOT EXISTS sanctions_current (
  source           text NOT NULL,
  source_entity_id text NOT NULL,
  entity_name      text NOT NULL,
  entity_type      text,
  country_codes    text[] NOT NULL DEFAULT '{}',
  programs         text[] NOT NULL DEFAULT '{}',
  fingerprint      text NOT NULL,
  first_seen       date NOT NULL DEFAULT CURRENT_DATE,
  last_seen        date NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (source, source_entity_id)
);

COMMENT ON TABLE sanctions_current IS
  'Materialized current sanctions list per source. The collector diffs each fetch against this to emit real add/update/remove events, then replaces it.';

-- 2. Compact the duplicate history: keep the EARLIEST row per
--    (source, source_entity_id, change_type) — that preserves the only real
--    information the duplicates carried (first observation time) and deletes
--    the ~115k identical copies. Not a truncate: nothing unique is lost.
DELETE FROM sanctions_events se
USING sanctions_events keeper
WHERE keeper.source = se.source
  AND keeper.source_entity_id = se.source_entity_id
  AND keeper.change_type = se.change_type
  AND keeper.id < se.id;

-- 3. The brief queries recent deltas by time.
CREATE INDEX IF NOT EXISTS idx_sanctions_events_observed
  ON sanctions_events (observed_at DESC);
