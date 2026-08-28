import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Marketing engagement-poll cron — Track M.1
 *
 * Runs every 6 hours. For each posted (non-shadow) marketing_post within
 * the last 14 days, polls the platform's engagement API and inserts a
 * row into marketing_engagement.
 *
 * v1 implementation is intentionally minimal: it logs a row with zero
 * metrics so the schema and downstream voice-learn loop can be
 * exercised. Real per-platform metric collection (X API metrics,
 * Bluesky like counts, etc.) is wired in v2.
 *
 * The reason for this scaffolding-only v1: the chairman has not yet
 * provisioned the platform API access tokens (Tier 1 vs Tier 2 in the
 * action list). Without those, real engagement polling would just
 * return errors. The placeholder keeps the table populated so the
 * voice-learn cron has rows to score against, and future work can
 * upgrade the per-adapter pollers without changing the cron contract.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  if (process.env.MARKETING_AUTOMATION_ENABLED !== 'true') {
    return res.status(200).json({ success: true, skipped: true, reason: 'MARKETING_AUTOMATION_ENABLED is not true' });
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = neon(dbUrl);

  try {
    const posts = (await sql`
      SELECT id, platform, platform_post_id
      FROM marketing_posts
      WHERE status = 'posted'
        AND shadow_mode = FALSE
        AND posted_at > NOW() - INTERVAL '14 days'
        AND platform_post_id IS NOT NULL
        AND platform_post_id NOT LIKE 'stub:%'
        AND platform_post_id NOT LIKE 'shadow:%'
      ORDER BY posted_at DESC
      LIMIT 50
    `) as unknown as Array<{ id: number; platform: string; platform_post_id: string }>;

    let polled = 0;
    for (const p of posts) {
      // v1: log a baseline row. v2 will fan out to per-platform polling.
      await sql`
        INSERT INTO marketing_engagement (
          post_id, impressions, likes, reposts, replies, clicks, intel_buyer_signal, raw_data
        )
        VALUES (
          ${p.id}, 0, 0, 0, 0, 0, 0,
          ${JSON.stringify({ note: 'v1 placeholder — real polling pending API credentials', platform: p.platform })}::jsonb
        )
      `;
      polled++;
    }

    return res.json({ posts_seen: posts.length, polled });
  } catch (err) {
    console.error('[marketing-engagement-poll] error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'engagement_poll_failed' });
  }
}
