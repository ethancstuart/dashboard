-- The email the subscriber receives is a FULL document (masthead, footer,
-- unsubscribe); the archive `summary` is an embeddable fragment. They were
-- the same column, so every real subscriber got the fragment — no
-- unsubscribe link (which also pointed at a route that never existed).
-- Applied by hand per repo practice; code probes for these columns and
-- falls back to the legacy path when absent, so deploy order is not
-- load-bearing.
BEGIN;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS email_html text;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS plain_text text;
COMMIT;
