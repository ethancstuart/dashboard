import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvCached } from './_lib/kvCache.js';
import { rateLimit, applyRateLimitHeaders } from './_lib/rateLimit.js';
import { recordAnthropicSpend, type AnthropicUsage } from './_lib/llm-budget.js';

export const config = { runtime: 'nodejs', maxDuration: 25 };

/**
 * Briefs sample hero — synthesizes 3 preview briefs from the live CII
 * top-movers. Used by /#/briefs when the archive is empty (pre-launch
 * cron). 6h KV cache so we make at most 4 LLM calls per day per region.
 *
 * 2026-05-02 P2.4. Replaces the hand-curated SAMPLE_BRIEFS in briefs.ts.
 *
 * GET /api/briefs-sample
 *   → { samples: [{ theme, title, excerpt, themeColor }], generatedAt, source }
 *
 * Falls back to a static set if ANTHROPIC_API_KEY missing or Haiku errors.
 */

interface SampleBrief {
  theme: string;
  title: string;
  excerpt: string;
  themeColor: string;
}

const STATIC_FALLBACK: SampleBrief[] = [
  {
    theme: 'CHOKEPOINT',
    title: 'Strait of Hormuz transit at 14-month low',
    excerpt:
      'Vessel transits through Hormuz fell to 38 ships/day this week — lowest since 2025. AIS data shows three VLCCs rerouting Cape of Good Hope. Brent +2.3% on the week.',
    themeColor: 'var(--nw-accent, #ff6600)',
  },
  {
    theme: 'CONFLICT',
    title: 'Sahel instability index +6.2 points in 30 days',
    excerpt:
      'ACLED logged 247 conflict events across Mali, Burkina Faso, Niger — a 41% MoM rise. GDELT cross-reference confirms the surge. Three coup-vulnerability indicators flashing yellow.',
    themeColor: '#dc2626',
  },
  {
    theme: 'TRADE',
    title: 'Taiwan Strait shipping density holds steady — for now',
    excerpt:
      'Despite three PLA navy exercises this month, container traffic through the Taiwan Strait is unchanged from baseline. Insurance markets are pricing 12% premium on hull policies.',
    themeColor: '#06b6d4',
  },
];

const CACHE_TTL_SEC = 6 * 60 * 60; // 6 hours

interface CIIScore {
  countryCode: string;
  countryName: string;
  score: number;
  delta?: number;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
}

interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  usage?: AnthropicUsage;
}

async function fetchTopMovers(host: string): Promise<CIIScore[]> {
  try {
    const r = await fetch(`https://${host}/api/cii`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return [];
    const data = (await r.json()) as { scores?: CIIScore[] };
    const scores = data.scores || [];
    // Sort by absolute delta first, fall back to highest scores.
    return scores
      .slice()
      .sort((a, b) => {
        const da = Math.abs(a.delta || 0);
        const db = Math.abs(b.delta || 0);
        if (da !== db) return db - da;
        return b.score - a.score;
      })
      .slice(0, 6);
  } catch {
    return [];
  }
}

async function callHaiku(apiKey: string, movers: CIIScore[]): Promise<SampleBrief[] | null> {
  const moversText = movers.length
    ? movers
        .map(
          (m) =>
            `- ${m.countryName} (${m.countryCode}): CII ${m.score}${m.delta ? `, Δ${m.delta > 0 ? '+' : ''}${m.delta}` : ''}`,
        )
        .join('\n')
    : 'No CII top-movers available — write three timeless geopolitical samples (chokepoint, conflict, trade).';

  const prompt = `You write the daily NexusWatch brief, a 3-minute geopolitical intelligence scan.

Below are today's CII top movers. Write 3 SHORT preview cards that show what the daily brief covers. Each card must follow this exact JSON shape:

{
  "theme": "ONE-WORD ALL-CAPS THEME (e.g. CHOKEPOINT, CONFLICT, TRADE, CYBER, SANCTIONS, ELECTIONS)",
  "title": "concrete one-sentence headline (under 70 chars)",
  "excerpt": "2 sentences of factual analysis (under 280 chars total). Reference data points where plausible. No fabrications — if you don't know exact numbers, give qualitative phrasing."
}

Return ONLY a valid JSON array of 3 such objects, nothing else. No prose before or after.

Today's CII movers:
${moversText}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ClaudeResponse;
    await recordAnthropicSpend('claude-haiku-4-5-20251001', data.usage, 'briefs-sample');
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('');
    // Extract JSON array from the response — be lenient about prose around it.
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Array<{ theme?: string; title?: string; excerpt?: string }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const palette = ['var(--nw-accent, #ff6600)', '#dc2626', '#06b6d4', '#a855f7', '#22c55e', '#eab308'];
    return parsed.slice(0, 3).map((b, i) => ({
      theme: String(b.theme || 'BRIEF')
        .slice(0, 20)
        .toUpperCase(),
      title: String(b.title || 'Untitled').slice(0, 100),
      excerpt: String(b.excerpt || '').slice(0, 320),
      themeColor: palette[i % palette.length],
    }));
  } catch {
    return null;
  }
}

interface CachedPayload {
  samples: SampleBrief[];
  source: string;
  generatedAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', 'https://nexuswatch.dev');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 30 req/min — generous for normal browsing; blocks scripted abuse.
  const rl = await rateLimit(req, { key: 'briefs-sample', limit: 30, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) return res.status(429).json({ error: 'rate-limited', retryAfterSec: rl.retryAfterSec });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const host = req.headers.host || 'nexuswatch.dev';

  // 2026-05-02 L1: KV-backed cache. Survives cold starts so we don't
  // burn Anthropic spend on every Vercel function instance.
  const payload = await kvCached<CachedPayload>('nw:briefs-sample:v1', CACHE_TTL_SEC, async () => {
    if (!apiKey) {
      return {
        samples: STATIC_FALLBACK,
        source: 'static-fallback',
        generatedAt: new Date().toISOString(),
      };
    }
    const movers = await fetchTopMovers(host);
    const synthesized = await callHaiku(apiKey, movers);
    if (synthesized && synthesized.length === 3) {
      return { samples: synthesized, source: 'haiku-synthesis', generatedAt: new Date().toISOString() };
    }
    return { samples: STATIC_FALLBACK, source: 'static-fallback', generatedAt: new Date().toISOString() };
  });

  return res.setHeader('Cache-Control', 'public, max-age=21600, s-maxage=21600').json(payload);
}
