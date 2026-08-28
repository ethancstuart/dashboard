import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Social send worker — Track C.5.
 *
 * The piece that makes the Track C pipeline actually flow to X.
 * Runs every 15 minutes, picks up rows in `social_queue` where
 * status='approved', calls the matching platform's send API, and
 * transitions the row to 'sent' on success or records
 * platform_error on failure.
 *
 * Before C.5, approved rows sat in the queue indefinitely — the
 * Track C.2 dual-write path recorded drafts for audit visibility
 * but nothing drained them. This cron closes that loop.
 *
 * Only supports X (via Buffer GraphQL) in v1. LinkedIn and Reddit
 * rows are skipped with a notice so an accidental LinkedIn draft
 * doesn't block an X draft behind it in the FIFO sort. C.3 and
 * C.4 will add drafters for those platforms; C.5.1+ will add
 * sender implementations.
 *
 * Invariants:
 *   1. Kill switch — SOCIAL_AUTONOMY_ENABLED !== 'true' → halt
 *      immediately, touch nothing, return early.
 *   2. Daily send cap per platform — at most N approved sends
 *      per 24h. Lower than the draft cap because sends are the
 *      load-bearing rate limit.
 *   3. Retry cap per draft — at most 3 failed sends per row.
 *      Past that, leave the row in approved status and log; a
 *      human can manually intervene via the admin queue endpoint.
 *   4. Non-destructive on mid-flight crash — the send call is
 *      before the status UPDATE, so a crash between call and
 *      update leaves the row in approved and the worker retries
 *      next cycle. Accepts a small risk of duplicate sends; v2
 *      (Track C.5.1) will add a 'sending' intermediate status.
 *
 * Audit: every send attempt writes a 'send' row to social_actions
 * with outcome=succeeded or failed, so the existing admin queue
 * history surface shows the full send lifecycle without schema
 * changes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NeonSql = any;

type Platform = 'x' | 'linkedin' | 'reddit' | 'dm';

interface QueueRow {
  id: number;
  platform: Platform;
  action_type: string;
  source: string | null;
  draft_content: string;
  final_content: string | null;
}

// Per-platform 24-hour SEND cap. These are stricter than the draft
// caps in api/social/enqueue-core.ts — the queue is allowed to
// overproduce drafts so the reviewer's queue never sits empty, but
// the number of approved sends reaching the platform is what the
// platform rate limits care about.
//
// Values from the v5 plan Track C.1 rate-limit table:
//   X: approved-send cap 30/day, min 10 min between sends on the
//      same thread (not enforced here; future improvement)
//   LinkedIn: 5/week posts, 20/day replies
//   Reddit: 3/week posts, 10/day comments
//   DM: 5/day DMs
const SEND_CAP_PER_24H: Record<Platform, number> = {
  x: 30,
  linkedin: 5,
  reddit: 3,
  dm: 5,
};

// Max failed send attempts per draft before the worker stops
// retrying and leaves it for human intervention.
const MAX_SEND_RETRIES = 3;

// Batch size per cron run. Small enough to complete within the
// 60s maxDuration with room for per-send API latency; big enough
// to drain a day's queue in a few cycles. Gets tuned based on
// real volume once C.3/C.4 drafters start producing.
const SEND_BATCH_SIZE = 10;

// Buffer channel ID for @NexusWatchDev — hardcoded in daily-brief.ts,
// keeping the same constant here so the two code paths agree on
// which account to post from.
const BUFFER_CHANNEL_ID_X = '69d95485031bfa423cee6b71';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  // Kill switch — the invariant that gates every Track C surface.
  if (process.env.SOCIAL_AUTONOMY_ENABLED !== 'true') {
    return res.json({
      skipped: true,
      reason: 'autonomy_disabled',
      hint: 'SOCIAL_AUTONOMY_ENABLED !== "true". Send worker is a no-op.',
    });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  const sql: NeonSql = neon(dbUrl);
  const summary = {
    picked_up: 0,
    sent: 0,
    failed: 0,
    rate_limited: 0,
    retry_exhausted: 0,
    skipped_unsupported: 0,
    by_platform: {} as Record<string, { sent: number; failed: number }>,
  };

  try {
    // Grab the oldest N approved rows. FIFO so time-sensitive
    // drafts (breaking alerts) that were approved first get sent
    // first. Caller should review time-sensitive stuff quickly.
    const rows = (await sql`
      SELECT id, platform, action_type, source, draft_content, final_content
      FROM social_queue
      WHERE status = 'approved'
      ORDER BY created_at ASC
      LIMIT ${SEND_BATCH_SIZE}
    `) as unknown as QueueRow[];

    summary.picked_up = rows.length;

    for (const row of rows) {
      if (!summary.by_platform[row.platform]) {
        summary.by_platform[row.platform] = { sent: 0, failed: 0 };
      }

      // Retry exhaustion check — count prior failed send attempts
      // for this queue row in social_actions.
      const priorFailures = (await sql`
        SELECT COUNT(*)::int AS c
        FROM social_actions
        WHERE queue_id = ${row.id}
          AND action = 'send'
          AND note LIKE 'failed:%'
      `) as unknown as Array<{ c: number }>;
      const failCount = priorFailures[0]?.c ?? 0;
      if (failCount >= MAX_SEND_RETRIES) {
        summary.retry_exhausted++;
        continue;
      }

      // Per-platform 24h send cap. Count rows that moved to 'sent'
      // in the last 24 hours for this platform.
      const sentRecently = (await sql`
        SELECT COUNT(*)::int AS c
        FROM social_queue
        WHERE platform = ${row.platform}
          AND status = 'sent'
          AND sent_at > NOW() - INTERVAL '24 hours'
      `) as unknown as Array<{ c: number }>;
      const sentCount = sentRecently[0]?.c ?? 0;
      if (sentCount >= SEND_CAP_PER_24H[row.platform]) {
        summary.rate_limited++;
        continue;
      }

      const textToSend = (row.final_content ?? row.draft_content).trim();
      if (!textToSend) {
        // Empty final + empty draft — shouldn't happen but be defensive.
        await recordSendFailure(sql, row.id, 'empty draft content');
        summary.failed++;
        summary.by_platform[row.platform].failed++;
        continue;
      }

      // Dispatch to the platform-specific sender. Only X is wired
      // in C.5 v1; the others log and skip.
      if (row.platform !== 'x') {
        summary.skipped_unsupported++;
        continue;
      }

      const result = await sendToBufferX(textToSend);
      if (result.ok) {
        await sql`
          UPDATE social_queue
          SET status = 'sent',
              sent_at = NOW(),
              platform_post_id = ${result.postId ?? null},
              platform_error = NULL
          WHERE id = ${row.id}
        `;
        await sql`
          INSERT INTO social_actions (queue_id, action, actor, from_status, to_status, note)
          VALUES (${row.id}, 'send', 'system', 'approved', 'sent', ${'succeeded: post_id=' + (result.postId ?? 'unknown')})
        `;
        summary.sent++;
        summary.by_platform[row.platform].sent++;
      } else {
        await sql`
          UPDATE social_queue
          SET platform_error = ${result.error ?? 'unknown'}
          WHERE id = ${row.id}
        `;
        await sql`
          INSERT INTO social_actions (queue_id, action, actor, from_status, to_status, note)
          VALUES (${row.id}, 'send', 'system', 'approved', 'approved', ${'failed: ' + (result.error ?? 'unknown').slice(0, 400)})
        `;
        summary.failed++;
        summary.by_platform[row.platform].failed++;
      }
    }

    return res.json(summary);
  } catch (err) {
    console.error('[social-send] cron error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'social_send_failed' });
  }
}

// ---------------------------------------------------------------------------
// Platform senders
// ---------------------------------------------------------------------------

interface SendResult {
  ok: boolean;
  postId?: string;
  error?: string;
}

/**
 * Send an X post via Buffer's GraphQL createPost mutation. Same
 * flow as the legacy path in api/cron/daily-brief.ts, extracted
 * here so the send worker owns its own copy — when the legacy
 * path eventually disappears, this version keeps working.
 */
async function sendToBufferX(text: string): Promise<SendResult> {
  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;
  if (!bufferToken) {
    return { ok: false, error: 'BUFFER_ACCESS_TOKEN not configured' };
  }

  try {
    const res = await fetch('https://api.buffer.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bufferToken}`,
      },
      body: JSON.stringify({
        query: `mutation CreatePost($text: String!, $channelId: ChannelId!) {
          createPost(input: {
            text: $text,
            channelId: $channelId,
            schedulingType: automatic,
            mode: addToQueue,
            attachment: false
          }) {
            ... on PostActionSuccess { post { id } }
            ... on MutationError { message }
          }
        }`,
        variables: { text, channelId: BUFFER_CHANNEL_ID_X },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `buffer ${res.status}: ${body.slice(0, 200)}` };
    }

    // Buffer returns 200 even on GraphQL-level errors — inspect body.
    let postId: string | undefined;
    let mutationError: string | undefined;
    try {
      const data = (await res.json()) as {
        data?: { createPost?: { post?: { id?: string }; message?: string } };
        errors?: Array<{ message?: string }>;
      };
      postId = data.data?.createPost?.post?.id;
      mutationError = data.data?.createPost?.message || data.errors?.[0]?.message;
    } catch {
      return { ok: false, error: 'buffer returned non-JSON body' };
    }

    if (mutationError) {
      return { ok: false, error: `buffer mutation: ${mutationError}` };
    }
    return { ok: true, postId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function recordSendFailure(sql: NeonSql, queueId: number, errorMsg: string): Promise<void> {
  try {
    await sql`
      UPDATE social_queue
      SET platform_error = ${errorMsg}
      WHERE id = ${queueId}
    `;
    await sql`
      INSERT INTO social_actions (queue_id, action, actor, from_status, to_status, note)
      VALUES (${queueId}, 'send', 'system', 'approved', 'approved', ${'failed: ' + errorMsg.slice(0, 400)})
    `;
  } catch (err) {
    console.error('[social-send] recordSendFailure failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}
