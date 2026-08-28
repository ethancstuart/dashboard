-- ============================================================================
-- Migration: daily_briefs gets its own EMAIL rendering
-- Date: 2026-08-28
--
-- Every brief a real subscriber has received was a FRAGMENT. deliver-briefs.ts
-- sends `daily_briefs.summary` as the message body, and `summary` holds
-- `dossier.beehiivHtml` — inner modules only, by design, because beehiiv adds
-- its own masthead, footer and unsubscribe. Resend adds none of that. So the
-- delivered mail had no masthead, no archive permalink, and NO UNSUBSCRIBE
-- LINK: a CAN-SPAM / Gmail bulk-sender exposure, not a design nit.
--
-- The correct full document (`dossier.emailHtml`) and the text/plain
-- alternative (`dossier.plainText`) were already built on every run and thrown
-- away — only the admin preview endpoint ever saw them.
--
-- `summary` CANNOT be repurposed to carry them: api/briefs.ts and
-- src/ui/briefPanel.ts embed it straight into the archive page's DOM, and a
-- <!DOCTYPE html> document injected into a div breaks that page. Hence two new
-- columns rather than a change to an existing one. Nothing that reads
-- `summary` is affected.
--
-- Columns rather than extra keys inside `content`: api/v1/brief.ts returns its
-- selected row wholesale to unauthenticated callers, so anything added to the
-- `content` JSON would ship the entire rendered email to every public API
-- consumer. Explicit column lists there mean new columns stay out of it.
--
-- NULLABLE ON PURPOSE. Every row written before this migration has no email
-- rendering and never will; deliver-briefs.ts falls back to `summary` when
-- these are NULL, so historical rows keep sending exactly what they send
-- today instead of failing.
--
-- Idempotent.
-- ============================================================================

ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS email_html TEXT;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS plain_text TEXT;

COMMENT ON COLUMN daily_briefs.email_html IS
  'Full standalone HTML email document (masthead + modules + CTA + footer + unsubscribe) sent by deliver-briefs.ts. NULL for rows predating 2026-08-28, which fall back to summary. Never rendered into the archive page — summary is the embeddable fragment.';

COMMENT ON COLUMN daily_briefs.plain_text IS
  'text/plain alternative for the multipart send. NULL for rows predating 2026-08-28, which send without a text part.';
