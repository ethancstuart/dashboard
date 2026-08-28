import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { preflight, recordRun } from '../marketing/lib/flags.js';
import { mediumAdapter } from '../marketing/adapters/mediumAdapter.js';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Marketing Medium cron — Track M.1
 *
 * Runs Sundays at 14:00 UTC — exactly 24h after the Substack Sunday
 * long-form went out. Medium gets the same content as a cross-post
 * with a canonical link back to Substack (SEO hygiene).
 *
 * Unlike the other marketing crons, this one does NOT call the topic
 * selector or content generator. Instead it pulls the most recent
 * Substack post from marketing_posts, rebuilds it with a canonical
 * URL header, and POSTs to Medium.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const pf = await preflight('medium');
  if (!pf.proceed) return res.json({ proceeded: false, reason: pf.reason });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = neon(dbUrl);

  // Atomically claim the most recent un-crossposted Substack row. The
  // CTE-with-INSERT-RETURNING is a single statement, and the partial
  // unique index on (platform, parent_post_id) where parent_post_id IS
  // NOT NULL (see migration 2026-04-15-marketing-crosspost-unique.sql)
  // ensures that if two cron runs race, exactly one wins; the loser's
  // ON CONFLICT DO NOTHING returns zero rows.
  const claim = (await sql`
    WITH target AS (
      SELECT id, content, platform_url, topic_key, entity_keys, pillar
      FROM marketing_posts
      WHERE platform = 'substack'
        AND status = 'posted'
        AND shadow_mode = FALSE
        AND posted_at > NOW() - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM marketing_posts m2
          WHERE m2.platform = 'medium'
            AND m2.parent_post_id = marketing_posts.id
            AND m2.status IN ('posted', 'scheduled')
        )
      ORDER BY posted_at DESC
      LIMIT 1
    )
    INSERT INTO marketing_posts (
      platform, pillar, topic_key, entity_keys, format, content, metadata,
      status, shadow_mode, parent_post_id, scheduled_at
    )
    SELECT
      'medium', target.pillar, target.topic_key, target.entity_keys,
      'longform', target.content,
      jsonb_build_object(
        'canonical_url', target.platform_url,
        'parent_substack_id', target.id
      ),
      'scheduled', ${pf.shadow}, target.id, NOW()
    FROM target
    ON CONFLICT (platform, parent_post_id) WHERE parent_post_id IS NOT NULL
    DO NOTHING
    RETURNING id, content, parent_post_id, (SELECT platform_url FROM target) AS parent_url
  `) as unknown as Array<{
    id: number;
    content: string;
    parent_post_id: number;
    parent_url: string | null;
  }>;

  if (claim.length === 0) {
    // Either nothing to cross-post, or another concurrent run claimed it first.
    await recordRun('medium');
    return res.json({ proceeded: true, shadow: pf.shadow, reason: 'no_substack_to_crosspost_or_raced' });
  }

  const postId = claim[0].id;
  const source = {
    id: claim[0].parent_post_id,
    content: claim[0].content,
    platform_url: claim[0].parent_url,
  };

  const result = await mediumAdapter.post(
    {
      content: source.content,
      format: 'longform',
      metadata: { canonical_url: source.platform_url ?? undefined },
    },
    pf.shadow,
  );

  if (result.ok && postId) {
    await sql`
      UPDATE marketing_posts
      SET status = 'posted',
          posted_at = NOW(),
          platform_post_id = ${result.platform_post_id ?? null},
          platform_url = ${result.platform_url ?? null},
          platform_error = NULL
      WHERE id = ${postId}
    `;
  } else if (postId) {
    await sql`
      UPDATE marketing_posts
      SET status = 'failed', platform_error = ${result.error ?? 'unknown'}
      WHERE id = ${postId}
    `;
  }

  await recordRun('medium');
  return res.json({
    proceeded: true,
    shadow: pf.shadow,
    parent_substack_id: source.id,
    post_id: postId,
    platform_post_id: result.platform_post_id,
    stub: result.stub,
    error: result.error,
  });
}
