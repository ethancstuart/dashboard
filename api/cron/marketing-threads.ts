import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runDispatch } from '../marketing/lib/dispatcher.js';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Marketing Threads cron — Track M.1
 *
 * Runs daily at 23:00 UTC (evening US window). Threads' algorithm
 * favors casual conversational posts in the late-evening time slot
 * for US-centric content.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host}`;
  const summary = await runDispatch('threads', baseUrl);
  return res.json(summary);
}
