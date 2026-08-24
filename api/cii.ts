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
    const rows = await sql`
      SELECT DISTINCT ON (country_code)
        country_code, country_name, score, components, timestamp
      FROM country_cii_history
      ORDER BY country_code, timestamp DESC
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
