import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runDispatch } from '../marketing/lib/dispatcher.js';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Marketing Bluesky cron — Track M.1
 *
 * Runs twice daily at 13:00 UTC and 19:00 UTC. Bluesky tone is the
 * same calibrated voice as X but with a slightly more conversational
 * register. 300-char limit enforced by the adapter.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host}`;
  const summary = await runDispatch('bluesky', baseUrl);
  return res.json(summary);
}
