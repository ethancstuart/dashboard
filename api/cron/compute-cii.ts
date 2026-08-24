import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { cronJitter } from '../_cron-utils.js';
import { BASELINE_CONFLICT, BASELINE_GOVERNANCE, MARKET_RISK } from '../_lib/cii-baselines.js';
import { detectCompoundSignals } from '../_lib/compound-signals.js';
import { buildFingerprint, findPatternMatches } from '../_lib/pattern-fingerprint.js';

export const config = { runtime: 'nodejs', maxDuration: 90 };

// ALL 86 CII countries — synced with client-side MONITORED_COUNTRIES (2026-04-18)
const COUNTRIES: { code: string; name: string; lat: number; lon: number; radius: number }[] = [
  // Core tier (37) — active conflict, G7/G20, strategic flashpoints
  { code: 'UA', name: 'Ukraine', lat: 48.4, lon: 31.2, radius: 6 },
  { code: 'RU', name: 'Russia', lat: 55.8, lon: 37.6, radius: 15 },
  { code: 'IL', name: 'Israel', lat: 31.0, lon: 35.0, radius: 3 },
  { code: 'PS', name: 'Palestine', lat: 31.9, lon: 35.2, radius: 2 },
  { code: 'SY', name: 'Syria', lat: 34.8, lon: 38.9, radius: 4 },
  { code: 'IQ', name: 'Iraq', lat: 33.2, lon: 43.7, radius: 5 },
  { code: 'YE', name: 'Yemen', lat: 15.6, lon: 48.5, radius: 5 },
  { code: 'SD', name: 'Sudan', lat: 15.5, lon: 32.5, radius: 8 },
  { code: 'SS', name: 'South Sudan', lat: 4.9, lon: 31.6, radius: 5 },
  { code: 'ET', name: 'Ethiopia', lat: 9.1, lon: 40.5, radius: 6 },
  { code: 'SO', name: 'Somalia', lat: 2.0, lon: 45.3, radius: 5 },
  { code: 'CD', name: 'DR Congo', lat: -1.5, lon: 29.0, radius: 8 },
  { code: 'MM', name: 'Myanmar', lat: 19.8, lon: 96.1, radius: 5 },
  { code: 'AF', name: 'Afghanistan', lat: 33.9, lon: 67.7, radius: 6 },
  { code: 'LY', name: 'Libya', lat: 26.3, lon: 17.2, radius: 6 },
  { code: 'ML', name: 'Mali', lat: 17.6, lon: -4.0, radius: 5 },
  { code: 'BF', name: 'Burkina Faso', lat: 12.3, lon: -1.5, radius: 4 },
  { code: 'HT', name: 'Haiti', lat: 18.5, lon: -72.3, radius: 3 },
  { code: 'NE', name: 'Niger', lat: 17.6, lon: 8.1, radius: 5 },
  { code: 'CF', name: 'Central African Rep.', lat: 6.6, lon: 20.9, radius: 5 },
  { code: 'US', name: 'United States', lat: 39.8, lon: -98.5, radius: 15 },
  { code: 'CN', name: 'China', lat: 35.9, lon: 104.2, radius: 12 },
  { code: 'IN', name: 'India', lat: 20.6, lon: 78.9, radius: 10 },
  { code: 'JP', name: 'Japan', lat: 36.2, lon: 138.3, radius: 5 },
  { code: 'DE', name: 'Germany', lat: 52.5, lon: 13.4, radius: 5 },
  { code: 'GB', name: 'United Kingdom', lat: 51.5, lon: -0.1, radius: 4 },
  { code: 'FR', name: 'France', lat: 48.9, lon: 2.3, radius: 4 },
  { code: 'BR', name: 'Brazil', lat: -15.8, lon: -47.9, radius: 10 },
  { code: 'SA', name: 'Saudi Arabia', lat: 24.7, lon: 46.7, radius: 8 },
  { code: 'TR', name: 'Turkey', lat: 39.9, lon: 32.9, radius: 5 },
  { code: 'KR', name: 'South Korea', lat: 37.6, lon: 127.0, radius: 3 },
  { code: 'IR', name: 'Iran', lat: 32.4, lon: 53.7, radius: 8 },
  { code: 'TW', name: 'Taiwan', lat: 23.5, lon: 121.0, radius: 3 },
  { code: 'KP', name: 'North Korea', lat: 40.0, lon: 127.0, radius: 4 },
  { code: 'PK', name: 'Pakistan', lat: 30.4, lon: 69.3, radius: 6 },
  { code: 'LB', name: 'Lebanon', lat: 33.9, lon: 35.5, radius: 2 },
  { code: 'VE', name: 'Venezuela', lat: 8.0, lon: -66.0, radius: 5 },
  // Extended tier (37) — regionally significant
  { code: 'NG', name: 'Nigeria', lat: 9.1, lon: 7.5, radius: 6 },
  { code: 'EG', name: 'Egypt', lat: 30.0, lon: 31.2, radius: 5 },
  { code: 'ZA', name: 'South Africa', lat: -30.6, lon: 22.9, radius: 6 },
  { code: 'MX', name: 'Mexico', lat: 19.4, lon: -99.1, radius: 6 },
  { code: 'ID', name: 'Indonesia', lat: -2.5, lon: 118.0, radius: 10 },
  { code: 'PH', name: 'Philippines', lat: 14.6, lon: 121.0, radius: 5 },
  { code: 'BD', name: 'Bangladesh', lat: 23.7, lon: 90.4, radius: 4 },
  { code: 'CO', name: 'Colombia', lat: 4.6, lon: -74.3, radius: 5 },
  { code: 'KE', name: 'Kenya', lat: -1.3, lon: 36.8, radius: 5 },
  { code: 'MZ', name: 'Mozambique', lat: -15.4, lon: 40.5, radius: 5 },
  { code: 'UG', name: 'Uganda', lat: 0.3, lon: 32.6, radius: 4 },
  { code: 'TD', name: 'Chad', lat: 12.1, lon: 15.0, radius: 5 },
  { code: 'CU', name: 'Cuba', lat: 21.5, lon: -80.0, radius: 4 },
  { code: 'TH', name: 'Thailand', lat: 15.9, lon: 100.9, radius: 5 },
  { code: 'VN', name: 'Vietnam', lat: 14.1, lon: 108.3, radius: 5 },
  { code: 'MY', name: 'Malaysia', lat: 4.2, lon: 101.9, radius: 4 },
  { code: 'PL', name: 'Poland', lat: 51.9, lon: 19.1, radius: 4 },
  { code: 'RO', name: 'Romania', lat: 45.9, lon: 24.9, radius: 4 },
  { code: 'AU', name: 'Australia', lat: -25.3, lon: 133.8, radius: 12 },
  { code: 'CA', name: 'Canada', lat: 56.1, lon: -106.3, radius: 15 },
  { code: 'IT', name: 'Italy', lat: 41.9, lon: 12.6, radius: 4 },
  { code: 'ES', name: 'Spain', lat: 40.5, lon: -3.7, radius: 4 },
  { code: 'AR', name: 'Argentina', lat: -38.4, lon: -63.6, radius: 8 },
  { code: 'CL', name: 'Chile', lat: -35.7, lon: -71.5, radius: 6 },
  { code: 'PE', name: 'Peru', lat: -9.2, lon: -75.0, radius: 5 },
  { code: 'DZ', name: 'Algeria', lat: 28.0, lon: 1.7, radius: 6 },
  { code: 'MA', name: 'Morocco', lat: 31.8, lon: -7.1, radius: 4 },
  { code: 'TN', name: 'Tunisia', lat: 33.9, lon: 9.5, radius: 3 },
  // Monitor tier (12) — emerging risk, completeness
  { code: 'GH', name: 'Ghana', lat: 7.9, lon: -1.0, radius: 4 },
  { code: 'SN', name: 'Senegal', lat: 14.5, lon: -14.5, radius: 3 },
  { code: 'CM', name: 'Cameroon', lat: 7.4, lon: 12.4, radius: 4 },
  { code: 'AO', name: 'Angola', lat: -11.2, lon: 17.9, radius: 5 },
  { code: 'TZ', name: 'Tanzania', lat: -6.4, lon: 34.9, radius: 5 },
  { code: 'RW', name: 'Rwanda', lat: -1.9, lon: 29.9, radius: 2 },
  { code: 'ZW', name: 'Zimbabwe', lat: -19.0, lon: 29.2, radius: 4 },
  { code: 'KZ', name: 'Kazakhstan', lat: 48.0, lon: 68.0, radius: 8 },
  { code: 'UZ', name: 'Uzbekistan', lat: 41.3, lon: 64.6, radius: 5 },
  { code: 'GE', name: 'Georgia', lat: 42.3, lon: 43.4, radius: 3 },
  { code: 'AZ', name: 'Azerbaijan', lat: 40.1, lon: 47.6, radius: 3 },
  { code: 'AM', name: 'Armenia', lat: 40.1, lon: 44.5, radius: 2 },
  { code: 'NP', name: 'Nepal', lat: 28.4, lon: 84.1, radius: 3 },
  { code: 'LK', name: 'Sri Lanka', lat: 7.9, lon: 80.8, radius: 3 },
  { code: 'KH', name: 'Cambodia', lat: 12.6, lon: 104.9, radius: 3 },
  { code: 'SG', name: 'Singapore', lat: 1.4, lon: 103.8, radius: 1 },
  { code: 'NZ', name: 'New Zealand', lat: -40.9, lon: 174.9, radius: 4 },
  { code: 'JO', name: 'Jordan', lat: 30.6, lon: 36.2, radius: 3 },
  { code: 'AE', name: 'UAE', lat: 23.4, lon: 53.8, radius: 3 },
  { code: 'QA', name: 'Qatar', lat: 25.4, lon: 51.2, radius: 2 },
];

// Baselines imported from api/_lib/cii-baselines.ts (single source of truth, v2.2.0)
// DO NOT declare local baselines here — they WILL drift. All changes go through cii-baselines.ts.

function isNear(lat1: number, lon1: number, lat2: number, lon2: number, radius: number): boolean {
  return Math.sqrt((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2) < radius;
}

interface GeoEvent {
  lat: number;
  lon: number;
  [key: string]: unknown;
}

async function fetchLayerData(): Promise<Map<string, GeoEvent[]>> {
  const layers = new Map<string, GeoEvent[]>();

  // Fetch DIRECTLY from upstream sources — NOT self-referencing
  // 2026-04-18: Added ACLED (was missing — conflict component ran on baselines only)
  const acledEmail = process.env.ACLED_EMAIL || '';
  const acledKey = process.env.ACLED_PASSWORD || '';
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];

  const fetches = [
    {
      key: 'earthquakes',
      url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      transform: (data: Record<string, unknown>) => {
        const features = (data.features || []) as Array<{
          properties: { mag: number; place: string };
          geometry: { coordinates: [number, number] };
        }>;
        return features.map((f) => ({
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          magnitude: f.properties.mag,
          place: f.properties.place,
        })) as GeoEvent[];
      },
    },
    // ACLED conflict events — covers ALL 86 CII countries globally
    ...(acledEmail && acledKey
      ? [
          {
            key: 'acled',
            url: `https://api.acleddata.com/acled/read?key=${acledKey}&email=${encodeURIComponent(acledEmail)}&limit=2000&event_date=${sevenDaysAgo}|${today}&event_date_where=BETWEEN`,
            transform: (data: Record<string, unknown>) => {
              const rows = (data.data || []) as Array<{
                latitude: string;
                longitude: string;
                fatalities: string;
                event_type: string;
                country: string;
              }>;
              return rows.map((r) => ({
                lat: parseFloat(r.latitude) || 0,
                lon: parseFloat(r.longitude) || 0,
                fatalities: parseInt(r.fatalities, 10) || 0,
                event_type: r.event_type,
                country: r.country,
              })) as GeoEvent[];
            },
          },
        ]
      : []),
    // NASA FIRMS fire hotspots — improves disaster scoring for Amazon, Indonesia, etc.
    {
      key: 'fires',
      url: 'https://firms.modaps.eosdis.nasa.gov/api/country/csv/VIIRS_SNPP_NRT/world/1',
      transform: () => [] as GeoEvent[], // CSV parsing would need dedicated handler; skip for now
    },
  ];

  const results = await Promise.allSettled(
    fetches.map(async (ep) => {
      const res = await fetch(ep.url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { key: ep.key, data: [] as GeoEvent[] };
      const json = (await res.json()) as Record<string, unknown>;
      return { key: ep.key, data: ep.transform(json) };
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      layers.set(result.value.key, result.value.data);
    }
  }

  return layers;
}

async function computeScore(
  country: { code: string; lat: number; lon: number; radius: number },
  layerData: Map<string, GeoEvent[]>,
  dbData: {
    ooni: Map<string, number>;
    fxVolatility: Map<string, number>;
    wikiSpikes: Map<string, number>;
  },
): Promise<{ score: number; deviation: number; components: Record<string, number>; liveSourceCount: number }> {
  let liveSourceCount = 0;

  // ═══════════════════════════════════════════════════════════════════════
  // THE SPLIT (owner decision 2026-08-23): a structural LEVEL and a daily
  // DEVIATION, published side by side and never summed.
  //
  // Measured over 90 days of production history before this change: the
  // conflict component moved in 0 of 85 countries, governance in 7, market
  // in 16 — those three are a slowly-reviewed baseline wearing a live label.
  // Disasters moved in 48 and "sentiment" in 66 — but sentiment was defined
  // as conflict*0.5 + disasters*0.3, an echo of other components, not a
  // signal. The old score summed all of it into one scalar whose daily
  // moves were mostly rolling-24h feed decay narrated as world events.
  // ═══════════════════════════════════════════════════════════════════════

  // ─── STRUCTURAL LEVEL (0–100) — baselines only, vintage-dated ───
  // conflict 0–20 + governance 0–15 + market exposure 0–20, over a 55-point
  // frame, rescaled to 0–100. Changes ONLY when cii-baselines.ts is
  // reviewed. Bands: ≥80 severe (structurally critical states), 60–79
  // elevated, 40–59 mixed, <40 stable.
  const baselineConflict = BASELINE_CONFLICT[country.code] ?? 0;
  const baselineGov = BASELINE_GOVERNANCE[country.code] ?? 0;
  const baselineMarket = MARKET_RISK[country.code] ?? 8;
  const structuralRaw = baselineConflict + baselineGov + baselineMarket;
  const score = Math.round((structuralRaw / 55) * 100);

  // ─── DAILY DEVIATION (points, ≥0) — live signal only ───
  // What today's data adds ON TOP of the level. Reported as "+N today";
  // 0 is a quiet day. Mean-reverts by construction (rolling feeds age out) —
  // measured next-day slope on the disasters component: −0.18/pt, n=7,650.

  // Live conflict events (feed currently returns nothing — api.acleddata.com
  // has no DNS record; kept so a replacement feed lands in the right place).
  const acled = layerData.get('acled') || [];
  const nearbyConflicts = acled.filter(
    (e) => e.lat && e.lon && isNear(e.lat, e.lon, country.lat, country.lon, country.radius),
  );
  const fatalities = nearbyConflicts.reduce((sum, e) => sum + (Number(e.fatalities) || 0), 0);
  const liveConflict = Math.min(20, (nearbyConflicts.length / 5) * 8 + (fatalities / 50) * 12);
  if (nearbyConflicts.length > 0) liveSourceCount++;

  // Disasters (0–15) — earthquakes, rolling 24h.
  const quakes = layerData.get('earthquakes') || [];
  const nearbyQuakes = quakes.filter(
    (e) => e.lat && e.lon && isNear(e.lat, e.lon, country.lat, country.lon, country.radius),
  );
  const maxMag = Math.max(0, ...nearbyQuakes.map((e) => Number(e.magnitude) || 0));
  const disasters = Math.min(15, nearbyQuakes.length * 1.5 + (maxMag > 5 ? (maxMag - 5) * 4 : 0));
  if (nearbyQuakes.length > 0) liveSourceCount++;

  // Attention (0–8) — Wikipedia pageview z-spikes ONLY. The old "sentiment"
  // blended in conflict*0.5 + disasters*0.3, double-counting both and making
  // the effective conflict weight 30/100 while methodology said 20.
  const wikiZScore = dbData.wikiSpikes.get(country.code) || 0;
  const attention = wikiZScore > 1 ? Math.min(8, wikiZScore * 2) : 0;
  if (attention > 0) liveSourceCount++;

  // Censorship / infrastructure (0–15) — OONI confirmed blocks, 3 days.
  let infrastructure = 0;
  const ooniBlocked = dbData.ooni.get(country.code) || 0;
  if (ooniBlocked > 50) {
    infrastructure = 12;
    liveSourceCount++;
  } else if (ooniBlocked > 10) {
    infrastructure = 7;
    liveSourceCount++;
  } else if (ooniBlocked > 0) {
    infrastructure = 3;
    liveSourceCount++;
  }
  const outages = layerData.get('internet-outages') || [];
  const outageMatch = outages.find((o) => (o as Record<string, unknown>).code === country.code);
  if (outageMatch) {
    const severity = (outageMatch as Record<string, unknown>).severity as string;
    const outageScore = severity === 'critical' ? 15 : severity === 'high' ? 10 : severity === 'moderate' ? 5 : 1;
    infrastructure = Math.max(infrastructure, outageScore);
  }

  // FX stress (0–6) — 90-day distribution of volatility_7d: p50 0.17,
  // p90 0.57, p99 8.6. The >3 gate fires only in genuine currency stress,
  // which is the point.
  let fxStress = 0;
  const fxVol = dbData.fxVolatility.get(country.code) || 0;
  if (fxVol > 5) {
    fxStress = 6;
    liveSourceCount++;
  } else if (fxVol > 3) {
    fxStress = 3;
    liveSourceCount++;
  } else if (fxVol > 1) {
    liveSourceCount++;
  }

  const deviation = Math.round((liveConflict + disasters + attention + infrastructure + fxStress) * 10) / 10;

  return {
    score,
    deviation,
    components: {
      // Structural parts (native scales; the level is their rescaled sum)
      conflict: Math.round(baselineConflict * 10) / 10,
      governance: Math.round(baselineGov * 10) / 10,
      marketExposure: Math.round(baselineMarket * 10) / 10,
      // Deviation parts
      liveConflict: Math.round(liveConflict * 10) / 10,
      disasters: Math.round(disasters * 10) / 10,
      attention: Math.round(attention * 10) / 10,
      infrastructure: Math.round(infrastructure * 10) / 10,
      fxStress: Math.round(fxStress * 10) / 10,
      // Back-compat alias: consumers that read "sentiment" get attention.
      sentiment: Math.round(attention * 10) / 10,
    },
    liveSourceCount,
  };
}

/** Pre-fetch all DB-stored data sources into Maps for fast per-country lookup. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDbData(sql: any): Promise<{
  ooni: Map<string, number>;
  fxVolatility: Map<string, number>;
  wikiSpikes: Map<string, number>;
}> {
  const ooni = new Map<string, number>();
  const fxVolatility = new Map<string, number>();
  const wikiSpikes = new Map<string, number>();

  // OONI censorship — confirmed blocks in last 3 days
  try {
    const rows = await sql`
      SELECT country_code, SUM(confirmed_blocked) as total_blocked
      FROM ooni_measurements
      WHERE measurement_date > CURRENT_DATE - INTERVAL '3 days'
      GROUP BY country_code
    `;
    for (const r of rows) ooni.set(String(r.country_code), Number(r.total_blocked) || 0);
  } catch {
    /* table may not exist yet */
  }

  // FX volatility — latest 7-day vol per country
  try {
    const rows = await sql`
      SELECT DISTINCT ON (country_code) country_code, volatility_7d
      FROM fx_rates
      WHERE volatility_7d IS NOT NULL
      ORDER BY country_code, date DESC
    `;
    for (const r of rows) fxVolatility.set(String(r.country_code), Number(r.volatility_7d) || 0);
  } catch {
    /* table may not exist yet */
  }

  // Wikipedia pageview spikes — max z-score per country in last 2 days
  try {
    const rows = await sql`
      SELECT country_code, MAX(z_score) as max_z
      FROM wikipedia_pageviews
      WHERE date > CURRENT_DATE - INTERVAL '2 days'
        AND z_score > 1
      GROUP BY country_code
    `;
    for (const r of rows) wikiSpikes.set(String(r.country_code), Number(r.max_z) || 0);
  } catch {
    /* table may not exist yet */
  }

  return { ooni, fxVolatility, wikiSpikes };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret (Vercel sends this header for cron invocations)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL?.includes('localhost')) {
    // Allow without auth for now (cron secret optional)
  }

  // Stagger cron execution to prevent thundering herd on upstream APIs
  await cronJitter(20);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.status(500).json({ error: 'DATABASE_URL not configured' });
  }

  try {
    // Fetch live layer data directly from upstream sources
    const layerData = await fetchLayerData();

    // Compute CII for all countries
    const sql = neon(dbUrl);

    // Pre-fetch all DB-stored data sources (OONI, FX, Wikipedia) in one batch
    const dbData = await fetchDbData(sql);
    let totalLiveSources = 0;

    // Compute all scores first (pure computation, no I/O)
    const scored: Array<{
      country: (typeof COUNTRIES)[0];
      score: number;
      deviation: number;
      components: Record<string, number>;
      liveSourceCount: number;
      grade: string;
    }> = [];

    for (const country of COUNTRIES) {
      const { score, deviation, components, liveSourceCount } = await computeScore(country, layerData, dbData);
      totalLiveSources += liveSourceCount;
      const grade = liveSourceCount >= 4 ? 'A' : liveSourceCount >= 2 ? 'B' : liveSourceCount >= 1 ? 'C' : 'D';
      scored.push({ country, score, deviation, components, liveSourceCount, grade });
    }

    // Write dedupe. This cron runs every 5 minutes and used to insert all 86
    // rows every run — measured at ~279 rows per country per DAY, nearly all
    // of them identical. A row is written only when the score or deviation
    // changed, or the country's latest row is older than 6 hours (so
    // time-windowed "as of yesterday" queries always find a recent row).
    const latest = (await sql`
      SELECT DISTINCT ON (country_code) country_code, score,
             (components->>'deviation')::float AS deviation,
             "timestamp"
      FROM country_cii_history
      ORDER BY country_code, "timestamp" DESC
    `) as unknown as Array<{ country_code: string; score: number; deviation: number | null; timestamp: string }>;
    const latestBy = new Map(latest.map((r) => [r.country_code, r]));

    let inserted = 0;
    for (const s of scored) {
      const prev = latestBy.get(s.country.code);
      const ageMs = prev ? Date.now() - new Date(prev.timestamp).getTime() : Infinity;
      const unchanged = prev !== undefined && prev.score === s.score && (prev.deviation ?? 0) === s.deviation;
      if (unchanged && ageMs < 6 * 3600_000) continue;
      const enrichedComponents = {
        ...s.components,
        deviation: s.deviation,
        liveSourceCount: s.liveSourceCount,
        dataQuality: s.grade,
      };
      await sql`
        INSERT INTO country_cii_history (country_code, country_name, score, components)
        VALUES (${s.country.code}, ${s.country.name}, ${s.score}, ${JSON.stringify(enrichedComponents)})
      `;
      inserted++;
    }

    // ═══ Compound Signals — multi-source convergence detection ═══
    const compoundSignals = detectCompoundSignals(dbData);
    if (compoundSignals.length > 0) {
      console.log(`[compute-cii] ${compoundSignals.length} compound signals detected:`);
      for (const sig of compoundSignals) {
        console.log(
          `  ${sig.severity.toUpperCase()}: ${sig.name} — ${sig.countryCode} (confidence: ${sig.confidence}%, boost: +${sig.ciiBoost})`,
        );
        // Store compound signals in crisis_triggers for the alert system
        try {
          await sql`
            INSERT INTO crisis_triggers (country_code, playbook_key, trigger_type, cii_score, magnitude, dedup_key, notes)
            VALUES (${sig.countryCode}, ${sig.id}, ${'compound-signal'}, ${sig.confidence}, ${sig.ciiBoost},
                    ${`compound-${sig.id}-${new Date().toISOString().split('T')[0]}`},
                    ${sig.description.slice(0, 500)})
            ON CONFLICT (dedup_key) DO NOTHING
          `;
        } catch {
          /* dedup insert is best-effort */
        }
      }
    }

    // ═══ Pattern Fingerprinting — "This looks like pre-invasion Ukraine 2022" ═══
    // Uses in-memory scored[] array instead of 86 individual DB SELECTs (perf fix)
    const patternMatches: Array<{ country: string; match: string; similarity: number }> = [];
    for (const s of scored) {
      const country = s.country;
      const comp = s.components;
      const ooniBlocked = dbData.ooni.get(country.code) || 0;
      const fxVol = dbData.fxVolatility.get(country.code) || 0;
      const wikiZ = dbData.wikiSpikes.get(country.code) || 0;
      const acledNearby = (layerData.get('acled') || []).filter(
        (e) => e.lat && e.lon && Math.sqrt((e.lat - country.lat) ** 2 + (e.lon - country.lon) ** 2) < country.radius,
      ).length;

      const vector = buildFingerprint(
        {
          conflict: comp.conflict || 0,
          disasters: comp.disasters || 0,
          sentiment: comp.sentiment || 0,
          infrastructure: comp.infrastructure || 0,
          governance: comp.governance || 0,
          marketExposure: comp.marketExposure || 0,
        },
        { fxVolatility: fxVol, ooniBlocked, wikiZScore: wikiZ, acledEventCount: acledNearby },
      );

      const matches = findPatternMatches(vector, country.code, 0.82);
      for (const m of matches) {
        patternMatches.push({ country: country.code, match: m.crisis.name, similarity: m.similarity });
        // Store high-confidence matches as crisis triggers for the alert system
        if (m.similarity >= 0.88) {
          try {
            await sql`
              INSERT INTO crisis_triggers (country_code, playbook_key, trigger_type, cii_score, magnitude, dedup_key, notes)
              VALUES (${country.code}, ${m.crisis.id}, ${'pattern-match'}, ${Math.round(m.similarity * 100)}, ${m.similarity},
                      ${`pattern-${country.code}-${m.crisis.id}-${new Date().toISOString().split('T')[0]}`},
                      ${`${country.code} signature ${Math.round(m.similarity * 100)}% similar to ${m.crisis.name}. ${m.crisis.outcome.slice(0, 200)}`})
              ON CONFLICT (dedup_key) DO NOTHING
            `;
          } catch {
            /* dedup insert best-effort */
          }
        }
      }
    }
    if (patternMatches.length > 0) {
      console.log(`[compute-cii] ${patternMatches.length} pattern matches detected:`);
      for (const pm of patternMatches.slice(0, 5)) {
        console.log(`  ${pm.country}: ${Math.round(pm.similarity * 100)}% similar to "${pm.match}"`);
      }
    }

    // Also cache GDELT conflict + news data (GDELT blocks Vercel IPs on direct calls)
    let gdeltCached = 0;
    try {
      // Conflict articles
      const conflictRes = await fetch(
        'https://api.gdeltproject.org/api/v2/doc/doc?query=attack%20OR%20airstrike%20OR%20missile%20OR%20protest%20OR%20military%20OR%20war%20OR%20conflict&mode=artlist&maxrecords=100&timespan=1440min&format=json&sort=DateDesc',
        { signal: AbortSignal.timeout(12000) },
      );
      if (conflictRes.ok) {
        const text = await conflictRes.text();
        if (!text.startsWith('Please limit')) {
          const data = JSON.parse(text);
          await sql`
            INSERT INTO cached_layer_data (layer_id, data, feature_count, updated_at)
            VALUES ('gdelt-conflict', ${JSON.stringify(data)}, ${(data.articles || []).length}, NOW())
            ON CONFLICT (layer_id) DO UPDATE SET data = ${JSON.stringify(data)}, feature_count = ${(data.articles || []).length}, updated_at = NOW()
          `;
          gdeltCached++;
        }
      }
    } catch {
      /* GDELT unavailable */
    }

    // News articles (separate query, wait 6 seconds for rate limit)
    try {
      await new Promise((r) => setTimeout(r, 6000));
      const newsRes = await fetch(
        'https://api.gdeltproject.org/api/v2/doc/doc?query=conflict%20OR%20crisis%20OR%20earthquake%20OR%20attack%20OR%20protest&mode=artlist&maxrecords=75&timespan=1440min&format=json&sort=DateDesc',
        { signal: AbortSignal.timeout(12000) },
      );
      if (newsRes.ok) {
        const text = await newsRes.text();
        if (!text.startsWith('Please limit')) {
          const data = JSON.parse(text);
          await sql`
            INSERT INTO cached_layer_data (layer_id, data, feature_count, updated_at)
            VALUES ('gdelt-news', ${JSON.stringify(data)}, ${(data.articles || []).length}, NOW())
            ON CONFLICT (layer_id) DO UPDATE SET data = ${JSON.stringify(data)}, feature_count = ${(data.articles || []).length}, updated_at = NOW()
          `;
          gdeltCached++;
        }
      }
    } catch {
      /* GDELT unavailable */
    }

    const avgLiveSources = inserted > 0 ? Math.round((totalLiveSources / inserted) * 10) / 10 : 0;
    console.log(
      `[compute-cii] scored=${inserted}, avgLiveSources=${avgLiveSources}, ` +
        `ooni=${dbData.ooni.size}, fx=${dbData.fxVolatility.size}, wiki=${dbData.wikiSpikes.size}, ` +
        `gdelt=${gdeltCached}`,
    );

    return res.json({
      success: true,
      countriesScored: inserted,
      gdeltCached,
      liveDataSources: {
        acledEvents: (layerData.get('acled') || []).length,
        earthquakes: (layerData.get('earthquakes') || []).length,
        ooniCountries: dbData.ooni.size,
        fxCountries: dbData.fxVolatility.size,
        wikiSpikeCountries: dbData.wikiSpikes.size,
      },
      avgLiveSourcesPerCountry: avgLiveSources,
      compoundSignals: compoundSignals.length,
      compoundSignalDetails: compoundSignals.map((s) => ({
        name: s.name,
        country: s.countryCode,
        severity: s.severity,
        confidence: s.confidence,
      })),
      patternMatches: patternMatches.length,
      patternMatchDetails: patternMatches.slice(0, 10),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('CII cron error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'CII computation failed' });
  }
}
