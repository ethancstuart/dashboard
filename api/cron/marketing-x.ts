import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runDispatch } from '../marketing/lib/dispatcher.js';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Marketing X cron — Track M.1
 *
 * Runs every 3 hours. Decides whether to draft + post on X based on:
 *   - global pause flag
 *   - per-platform enable flag
 *   - shadow-mode flag
 *   - posting window (12:00-14:00 UTC and 18:00-20:00 UTC preferred)
 *   - topic dedup (no recent identical or overlapping topic)
 *   - 90-min minimum gap between posts (enforced by topic dedup + adapter rate limits)
 *
 * In shadow mode the post is generated and logged but never posted to
 * X. Flip marketing:shadow_mode=false in KV to go live.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host}`;
  const summary = await runDispatch('x', baseUrl);
  return res.json(summary);
}
