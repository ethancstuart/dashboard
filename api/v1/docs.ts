import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs' };

/**
 * GET /api/v1/docs — what this API actually is.
 *
 * FOUR CLAIMS WERE REMOVED FROM HERE ON 2026-08-30 BECAUSE NONE OF THEM WAS
 * TRUE. Each was verified against the deployed API before deletion, not
 * inferred:
 *
 *   1. `pro: $99/month` and 2. `analyst: $249/month`. Stripe is in test mode
 *      ("no real revenue", api/cron/cost-summary.ts), the `api_keys` table is
 *      EMPTY, and api/v1/keys.ts hardcodes `tier: 'free'` on every key it
 *      issues. There was no path by which anyone could buy either tier.
 *
 *   3. `rateLimit: '10/min (free), 100/min (pro)'` on all twelve endpoints.
 *      NOT ONE `/api/v1/*` handler calls `rateLimit()` or any auth helper.
 *      Measured: 15 requests to /api/v1/cii in a few seconds returned 15x200
 *      and no 429.
 *
 *   4. `authentication: { type: 'Bearer token' }`. Nothing reads an
 *      Authorization header on any v1 route. A developer could have built
 *      against a scheme that does not exist.
 *
 * This is governance rule 6: when a claim can only be met by inventing
 * something, the honest output is the gap. An API with no tiers and no
 * enforced limit is a true statement; a priced one with neither is a false
 * one, and it was sitting on the most machine-readable surface we publish.
 *
 * Removing the paid tiers also matters for a reason beyond honesty: SEVEN
 * wired upstream sources carry non-commercial terms (OONI CC BY-NC-SA,
 * Cloudflare Radar, WHO, Open-Meteo, TwelveData, Polymarket, OpenSky).
 * Advertising a commercial tier over that data was the exposure; not
 * advertising one clears all seven at once.
 *
 * STILL OWED, deliberately not done here: upstream ATTRIBUTION. The repo
 * carries zero occurrences of "Creative Commons", "BY-NC-SA" or "CC BY". That
 * is a separate change and it needs the owner's voice sign-off.
 */

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  return res.json({
    name: 'NexusWatch Intelligence API',
    version: '1.0.0',
    description: 'Real-time geopolitical intelligence, risk scoring, and event data.',
    baseUrl: 'https://nexuswatch.dev/api/v1',
    access: {
      authentication: 'none',
      note:
        'This API is currently open and unauthenticated. No API key is required, ' +
        'and no per-key rate limit is enforced today. Please be reasonable — ' +
        'this runs on a hobby budget, and limits will be introduced before they are advertised.',
    },
    endpoints: {
      'GET /api/v1/cii': {
        description: 'Country Instability Index — 50 countries scored 0-100',
        params: { country: 'Optional 2-letter country code for single country + history' },
      },
      'GET /api/v1/tension': {
        description: 'Global tension index — composite risk score',
      },
      'GET /api/v1/events': {
        description: 'Unified event stream across all data layers',
        params: {
          layer:
            'Optional layer filter: earthquakes, acled, fires, ships, flights, launches, satellites, disease-outbreaks, internet-outages, displacement, weather-alerts, air-quality, predictions',
        },
      },
      'GET /api/v1/correlations': {
        description: 'Cross-domain correlation alerts — auto-detected event connections',
      },
      'GET /api/v1/brief': {
        description: 'AI-generated daily intelligence briefing',
        params: { date: 'Optional YYYY-MM-DD for historical brief' },
      },
      'GET /api/v1/timeline': {
        description: '90-day historical event timeline',
        params: {
          from: 'ISO timestamp (default: 24h ago)',
          to: 'ISO timestamp (default: now)',
          layer: 'Optional layer filter',
        },
      },
      'GET /api/v1/market': {
        description: 'Real-time market data — stocks, commodities, FX, crypto',
      },
    },
    // No tiers. There is one level of access and it is the one you are using.
    // Anything else here would be a price for something nobody can buy.
    tiers: null,
  });
}
