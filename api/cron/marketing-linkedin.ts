import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runDispatch } from '../marketing/lib/dispatcher.js';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Marketing LinkedIn cron — Track M.1
 *
 * Runs Mon-Fri at 11:00 UTC. One post per weekday during the 11:00-13:00
 * UTC LinkedIn window. No weekend posts (LinkedIn algorithm penalizes
 * weekend B2B content).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host}`;
  const summary = await runDispatch('linkedin', baseUrl);
  return res.json(summary);
}
