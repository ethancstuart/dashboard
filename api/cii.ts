import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

const CORS_ORIGIN = 'https://nexuswatch.dev';
function setCors(res: VercelResponse): VercelResponse {
  return res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
}

export const config = { runtime: 'nodejs' };

// Cache CII scores for 5 minutes (computed by cron or on-demand)
let cachedScores: CIIResponse[] = [];
let lastCompute = 0;
const CACHE_TTL = 300_000;

interface CIIResponse {
  countryCode: string;
  countryName: string;
  /** Structural level, 0-100. Changes only when baselines are reviewed. */
  score: number;
  /** Today's live signal on top of the level, in points. 0 = quiet day. */
  deviation: number;
  trend: string;
  components: Record<string, number>;
  topSignals: string[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  const country = req.query.country as string | undefined;

  // Return cached scores if fresh
  if (Date.now() - lastCompute < CACHE_TTL && cachedScores.length > 0) {
    if (country) {
      const match = cachedScores.find((s) => s.countryCode === country.toUpperCase());
      if (!match) return res.status(404).json({ error: 'Country not monitored' });

      // Fetch history for single country
      const history = await fetchHistory(country.toUpperCase());
      return res.json({ ...match, history });
    }
    return res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300').json({
      scores: cachedScores,
      count: cachedScores.length,
      timestamp: lastCompute,
    });
  }

  // Fetch latest scores from database
  try {
    const sql = getDb();
    // LOOSE INDEX SCAN, not DISTINCT ON. Measured against production
    // 2026-08-28: the DISTINCT ON form took 13,620 ms and this one 488 ms —
    // 28x, returning a byte-identical 85-row set (verified by comparing
    // country/score/timestamp keys, not by assumption).
    //
    // WHY THE OLD FORM WAS SLOW. country_cii_history is 3.2M rows. An
    // unqualified DISTINCT ON cannot use idx_cii_country_ts
    // (country_code, timestamp DESC), so Postgres sequentially scanned the
    // whole table and sorted it on disk to return 85 rows. The recursive CTE
    // walks the index one country at a time (a "skip scan"), then takes each
    // country's latest row through a LATERAL — every step index-backed.
    //
    // Do NOT "simplify" the CTE to `SELECT DISTINCT country_code`: that
    // measured 3,685 ms, because the DISTINCT itself seq-scans.
    //
    // This endpoint was paging the owner every 30 minutes — the health check
    // has a 5s timeout and a cold hit measured 12.3s TTFB (0.19s warm), so
    // every cold start read as an outage.
    const rows = await sql`
      WITH RECURSIVE codes AS (
        (SELECT country_code FROM country_cii_history ORDER BY country_code LIMIT 1)
        UNION ALL
        SELECT (SELECT h.country_code FROM country_cii_history h
                WHERE h.country_code > c.country_code
                ORDER BY h.country_code LIMIT 1)
        FROM codes c WHERE c.country_code IS NOT NULL
      )
      SELECT l.country_code, l.country_name, l.score, l.components, l.timestamp
      FROM codes
      CROSS JOIN LATERAL (
        SELECT country_code, country_name, score, components, timestamp
        FROM country_cii_history
        WHERE country_code = codes.country_code
        ORDER BY timestamp DESC
        LIMIT 1
      ) l
      WHERE codes.country_code IS NOT NULL
    `;

    cachedScores = rows.map((r) => ({
      countryCode: r.country_code as string,
      countryName: r.country_name as string,
      score: r.score as number,
      deviation: Number((r.components as Record<string, unknown>)?.deviation ?? 0),
      trend: 'stable',
      components: r.components as Record<string, number>,
      topSignals: [],
    }));
    lastCompute = Date.now();

    if (country) {
      const match = cachedScores.find((s) => s.countryCode === country.toUpperCase());
      if (!match) return res.status(404).json({ error: 'Country not monitored' });
      const history = await fetchHistory(country.toUpperCase());
      return res.json({ ...match, history });
    }

    return res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300').json({
      scores: cachedScores,
      count: cachedScores.length,
      timestamp: lastCompute,
    });
  } catch (err) {
    console.error('CII API error:', err instanceof Error ? err.message : err);
    // Return cached if available
    if (cachedScores.length > 0) {
      return res.json({ scores: cachedScores, count: cachedScores.length, cached: true });
    }
    return res.status(500).json({ error: 'CII computation failed', scores: [] });
  }
}

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

async function fetchHistory(countryCode: string): Promise<Array<{ score: number; timestamp: string }>> {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT score, timestamp
      FROM country_cii_history
      WHERE country_code = ${countryCode}
      ORDER BY timestamp DESC
      LIMIT 168
    `;
    return rows.map((r) => ({ score: r.score as number, timestamp: r.timestamp as string }));
  } catch {
    return [];
  }
}
