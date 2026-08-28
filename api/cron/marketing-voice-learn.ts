import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { runVoiceRetune } from '../marketing/lib/marketingVoice.js';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Marketing voice-learn cron — Track M.1
 *
 * Runs Mondays at 04:00 UTC. Looks at the previous 7 days of posts +
 * engagement and:
 *   - Auto-promotes the top-5 to marketing_voice_context with category=loved
 *   - Logs the bottom-5 to marketing_voice_context with category=neutral
 *   - Returns engagement summary by pillar
 *
 * Does NOT auto-mark anything as 'hated' — that requires human judgment
 * via the admin UI.
 *
 * Voice context updates are picked up automatically on the next cron
 * run because buildVoiceProfile() reads marketing_voice_context fresh
 * each call.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  // Honor pause flag even for the learning loop — chairman might want
  // to freeze voice evolution during a sensitive moment.
  if (process.env.MARKETING_AUTOMATION_ENABLED !== 'true') {
    return res.json({ skipped: true, reason: 'env_disabled' });
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = neon(dbUrl);
  try {
    const summary = await runVoiceRetune(sql);
    return res.json(summary);
  } catch (err) {
    console.error('[marketing-voice-learn] error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'voice_learn_failed' });
  }
}
