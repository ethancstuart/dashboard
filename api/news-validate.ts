import type { VercelRequest, VercelResponse } from '@vercel/node';
import Parser from 'rss-parser';

export const config = { runtime: 'nodejs' };

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit by IP
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const rl = rateLimitMap.get(ip);
  if (rl && rl.resetAt > now && rl.count >= 10) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }
  if (!rl || rl.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 3600000 });
  } else {
    rl.count++;
  }

  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    new URL(url); // validate URL format
  } catch {
    return res.status(400).json({ valid: false, error: 'Invalid URL format' });
  }

  try {
    const parser = new Parser({ timeout: 5000 });
    const feed = await parser.parseURL(url);
    return res.json({
      valid: true,
      title: feed.title || 'Untitled Feed',
      itemCount: (feed.items || []).length,
    });
  } catch {
    return res.json({ valid: false, error: 'Could not parse RSS feed at this URL' });
  }
}
