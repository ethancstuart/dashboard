import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs', maxDuration: 25 };

/**
 * Cache-warmer cron — pings each cached endpoint once per cache TTL
 * window so the next real user always hits a warm KV cache. Without
 * this, the first request after a TTL expiry pays the full upstream
 * cost (Anthropic, Windy, EIA, etc).
 *
 * Runs every 45 minutes:
 *   - briefs-sample: 6h KV TTL — refreshed every 8th run (~6h)
 *   - webcam-catalog: 1h KV TTL — refreshed every run
 *   - aurora: 5min module cache — refreshed every run
 *   - energy: 30min module cache — refreshed every run
 *
 * For endpoints with longer TTL than our cron interval, calling them
 * is idempotent — the response just comes from KV.
 *
 * 2026-05-02 G3.
 */

// Trimmed to the narrowed product (PR-9): the other three targets were map
// endpoints whose ONLY remaining reference was this warmer — a cache kept
// warm for pages that no longer exist.
const TARGETS = ['/api/briefs-sample', '/api/cii'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const host = req.headers.host || 'nexuswatch.dev';
  const start = Date.now();
  const results = await Promise.all(
    TARGETS.map(async (path) => {
      const t0 = Date.now();
      try {
        const r = await fetch(`https://${host}${path}`, {
          signal: AbortSignal.timeout(20000),
          headers: { 'User-Agent': 'NexusWatch-CacheWarm/1.0' },
        });
        return { path, ok: r.ok, status: r.status, ms: Date.now() - t0 };
      } catch (err) {
        return { path, ok: false, status: 0, ms: Date.now() - t0, error: String(err) };
      }
    }),
  );

  const okCount = results.filter((r) => r.ok).length;
  return res.status(200).json({
    warmed: okCount,
    total: TARGETS.length,
    elapsedMs: Date.now() - start,
    results,
  });
}
