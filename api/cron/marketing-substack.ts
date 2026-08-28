import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runDispatch } from '../marketing/lib/dispatcher.js';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 90 };

/**
 * Marketing Substack cron — Track M.1
 *
 * Runs Sundays 12:00 UTC (long-form weekly issue) and Wednesdays 16:00
 * UTC (short midweek post). The dispatcher picks topics; Substack adapter
 * formats them as a markdown email-to-post.
 *
 * Long-form generation uses Sonnet (configured per platform in
 * contentGenerator.ts). Sonnet adds ~$0.30 per long-form draft vs Haiku.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host}`;
  const summary = await runDispatch('substack', baseUrl);
  return res.json(summary);
}
