import type { VercelRequest, VercelResponse } from '@vercel/node';
import { colors } from '../../src/styles/email-tokens.js';
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'nodejs', maxDuration: 10 };

/**
 * Map of the Day — Public image endpoint (Track A.7).
 *
 *   GET /api/brief/screenshot
 *     → 302 redirect (or SVG fallback) for the latest brief
 *
 *   GET /api/brief/screenshot?date=YYYY-MM-DD[&size=email|og]
 *     → image for a specific historical brief
 *
 * Used as:
 *   - <img> src inside the Light Intel Dossier "Map of the Day" module
 *     (rendered by api/cron/daily-brief.ts renderDossierEmail)
 *   - beehiiv post featured image
 *   - og:image for /brief/:date shareable permalinks
 *
 * PUBLIC by design — beehiiv's servers pull this to render post previews,
 * email clients pull it when recipients open the brief, and social
 * crawlers pull it for link unfurls. No auth cookie.
 *
 * Two rendering paths:
 *   1. Mapbox Static Images API when MAPBOX_TOKEN is set. Returns a
 *      302 redirect to the Mapbox URL — Mapbox's CDN handles caching
 *      and we keep this function fast + stateless.
 *   2. Branded SVG fallback when MAPBOX_TOKEN is unset or the country
 *      can't be resolved. Deterministic, zero dependencies, uses the
 *      same Light Intel Dossier palette as the email template.
 *
 * The SVG fallback is not a "broken state" — it's a legitimate
 * alternative output that signals "map unavailable" without breaking
 * the email layout. In testing and in low-config deploys it's what
 * ships.
 */

// ---------------------------------------------------------------------------
// Country → map center lookup
// ---------------------------------------------------------------------------
//
// Self-contained small table covering the countries the CII typically
// surfaces as top-risk. Not comprehensive — the goal is "reasonable
// center for the top story country," not "authoritative GIS lookup."
// If a country isn't in the table, the endpoint falls back to a
// world-view SVG.
//
// zoom values are tuned for Mapbox Static Images API at 1200x630: ~4
// for large countries, ~5 for medium, ~6 for small.

interface CountryPoint {
  lat: number;
  lon: number;
  zoom: number;
}

const COUNTRY_CENTERS: Record<string, CountryPoint> = {
  UA: { lat: 49.0, lon: 32.0, zoom: 4.5 },
  RU: { lat: 60.0, lon: 80.0, zoom: 2.5 },
  CN: { lat: 35.0, lon: 104.0, zoom: 3.5 },
  TW: { lat: 23.7, lon: 121.0, zoom: 6 },
  IR: { lat: 32.4, lon: 53.7, zoom: 4.5 },
  IQ: { lat: 33.2, lon: 43.7, zoom: 5 },
  SY: { lat: 34.8, lon: 38.9, zoom: 5.5 },
  IL: { lat: 31.5, lon: 35.0, zoom: 7 },
  PS: { lat: 31.9, lon: 35.2, zoom: 8 },
  LB: { lat: 33.9, lon: 35.9, zoom: 7 },
  JO: { lat: 31.2, lon: 36.5, zoom: 6 },
  YE: { lat: 15.6, lon: 48.5, zoom: 5 },
  SA: { lat: 24.0, lon: 45.0, zoom: 4 },
  EG: { lat: 26.8, lon: 30.8, zoom: 5 },
  LY: { lat: 26.3, lon: 17.2, zoom: 4.5 },
  SD: { lat: 15.5, lon: 30.0, zoom: 4.5 },
  SS: { lat: 7.0, lon: 30.0, zoom: 5 },
  ET: { lat: 9.1, lon: 40.5, zoom: 4.5 },
  SO: { lat: 5.0, lon: 46.0, zoom: 4.5 },
  CD: { lat: -1.5, lon: 23.0, zoom: 4 },
  NG: { lat: 9.1, lon: 8.7, zoom: 5 },
  MM: { lat: 21.0, lon: 96.0, zoom: 4.5 },
  AF: { lat: 33.9, lon: 67.7, zoom: 5 },
  PK: { lat: 30.4, lon: 69.3, zoom: 4.5 },
  IN: { lat: 22.0, lon: 79.0, zoom: 4 },
  KP: { lat: 40.0, lon: 127.0, zoom: 5.5 },
  KR: { lat: 36.5, lon: 128.0, zoom: 6 },
  JP: { lat: 36.2, lon: 138.3, zoom: 4.5 },
  ID: { lat: -2.5, lon: 118.0, zoom: 3.5 },
  PH: { lat: 12.9, lon: 122.0, zoom: 5 },
  VE: { lat: 8.0, lon: -66.0, zoom: 5 },
  MX: { lat: 23.6, lon: -102.6, zoom: 4 },
  HT: { lat: 19.0, lon: -72.5, zoom: 6.5 },
  BR: { lat: -14.2, lon: -51.9, zoom: 3 },
  AR: { lat: -34.0, lon: -64.0, zoom: 4 },
  US: { lat: 39.8, lon: -98.5, zoom: 3 },
  CA: { lat: 56.0, lon: -106.0, zoom: 3 },
  GB: { lat: 54.0, lon: -2.0, zoom: 5 },
  FR: { lat: 46.2, lon: 2.2, zoom: 5 },
  DE: { lat: 51.2, lon: 10.4, zoom: 5 },
  TR: { lat: 38.9, lon: 35.2, zoom: 5 },
  GR: { lat: 39.0, lon: 22.0, zoom: 5.5 },
  AU: { lat: -25.3, lon: 133.8, zoom: 3 },
};

// ---------------------------------------------------------------------------
// Size presets
// ---------------------------------------------------------------------------

interface SizePreset {
  width: number;
  height: number;
  retina: 1 | 2;
}

const SIZES: Record<string, SizePreset> = {
  // Email: 1x is safe for Apple Mail / Gmail image weight caps (~100KB).
  email: { width: 1200, height: 630, retina: 1 },
  // og:image / social share cards: 2x for retina-quality link previews.
  og: { width: 1200, height: 630, retina: 2 },
};

// ---------------------------------------------------------------------------
// SVG fallback
// ---------------------------------------------------------------------------

/**
 * Deterministic branded SVG shipped when we can't render a real map
 * (missing MAPBOX_TOKEN, unresolved country, or fetch failure). Keeps
 * the Light Intel Dossier aesthetic so the email doesn't break
 * visually even in low-config deploys.
 *
 * Inline SVG instead of a PNG because SVG is lossless, tiny, and
 * renders cleanly in every email client that supports `<img>`.
 */
function renderFallbackSvg(opts: {
  width: number;
  height: number;
  countryName: string;
  score: number;
  date: string;
}): string {
  const { width, height, countryName, score, date } = opts;
  const safeName = countryName.replace(/[<>"']/g, '');
  const safeDate = date.replace(/[<>"']/g, '');

  // IMPORTED, not duplicated (2026-09-06). The old comment argued the copy
  // was cheaper than an import chain — but email-tokens.ts has zero imports,
  // ssr-shell and og.ts already import it from api/, and rule 8 exists
  // because a private palette copy is exactly how an identity change strands
  // a public surface. This was the sixth copy; now there is one source.
  const bgPage = colors.bgPage;
  const textPrimary = colors.textPrimary;
  const textTertiary = colors.textTertiary;
  const accent = colors.accent;
  const divider = colors.divider;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${bgPage}"/>
  <!-- parchment gold rule at top -->
  <rect x="0" y="${Math.round(height * 0.18)}" width="${width}" height="2" fill="${divider}"/>
  <!-- NEXUSWATCH kicker -->
  <text x="${width / 2}" y="${Math.round(height * 0.14)}" font-family="'JetBrains Mono','SF Mono',Menlo,monospace" font-size="${Math.round(height * 0.035)}" letter-spacing="4" fill="${accent}" text-anchor="middle" font-weight="700">NEXUSWATCH · SITUATION BRIEF</text>
  <!-- Map of the Day headline -->
  <text x="${width / 2}" y="${Math.round(height * 0.38)}" font-family="'Tiempos Headline','Georgia','Times New Roman',serif" font-size="${Math.round(height * 0.095)}" fill="${textPrimary}" text-anchor="middle" font-weight="600">Map of the Day</text>
  <!-- Country name -->
  <text x="${width / 2}" y="${Math.round(height * 0.58)}" font-family="'Inter','Helvetica Neue',Arial,sans-serif" font-size="${Math.round(height * 0.065)}" fill="${textPrimary}" text-anchor="middle" font-weight="500">${safeName}</text>
  <!-- CII badge -->
  <text x="${width / 2}" y="${Math.round(height * 0.72)}" font-family="'JetBrains Mono','SF Mono',Menlo,monospace" font-size="${Math.round(height * 0.045)}" fill="${textTertiary}" text-anchor="middle" letter-spacing="2">CII ${score}/100</text>
  <!-- bottom date -->
  <text x="${width / 2}" y="${Math.round(height * 0.92)}" font-family="'JetBrains Mono','SF Mono',Menlo,monospace" font-size="${Math.round(height * 0.03)}" fill="${textTertiary}" text-anchor="middle" letter-spacing="2">${safeDate}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Mapbox Static Images URL builder
// ---------------------------------------------------------------------------

/**
 * Build a Mapbox Static Images API URL for the given center + zoom +
 * size. Uses mapbox/dark-v11 as the style since it harmonizes well with
 * the oxblood Light Intel Dossier accent (also matches the dark terminal
 * product surface, so the brand reads coherent across mediums).
 *
 * Overlays the top-risk country with an oxblood marker pin. More
 * sophisticated overlays (chokepoint icons, dark-vessel flags) are
 * Track A.7 follow-ups — v1 ships the centered map with a single pin.
 */
function buildMapboxUrl(opts: {
  token: string;
  lat: number;
  lon: number;
  zoom: number;
  width: number;
  height: number;
  retina: 1 | 2;
}): string {
  const { token, lat, lon, zoom, width, height, retina } = opts;
  // Oxblood pin (#9A1B1B) via pin-l marker. Mapbox static markers use
  // named colors or 3/6-char hex without the leading hash.
  const marker = `pin-l+9A1B1B(${lon},${lat})`;
  const retinaSuffix = retina === 2 ? '@2x' : '';
  const style = 'mapbox/dark-v11';
  return `https://api.mapbox.com/styles/v1/${style}/static/${marker}/${lon},${lat},${zoom},0/${width}x${height}${retinaSuffix}?access_token=${encodeURIComponent(token)}&logo=false&attribution=false`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface BriefRow {
  brief_date: string;
  content: unknown;
}
interface CountryHit {
  code?: string;
  name?: string;
  score?: number;
}
interface BriefContent {
  topRiskCountries?: CountryHit[];
}

function sendSvg(res: VercelResponse, svg: string) {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  // Modest cache — these are keyed by brief_date so older dates are
  // immutable, but "latest" changes daily. We pick a middle value and
  // let Vercel's edge cache absorb the duplicate requests.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return res.status(200).send(svg);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const dateParam = typeof req.query.date === 'string' ? req.query.date : null;
  const sizeParam = typeof req.query.size === 'string' ? req.query.size : 'email';

  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return res.status(400).json({ error: 'invalid_date_format' });
  }
  const size = SIZES[sizeParam] ?? SIZES.email;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    // No DB — render a generic fallback rather than a 500, so the email
    // template's <img> doesn't break even in misconfigured deploys.
    return sendSvg(
      res,
      renderFallbackSvg({
        width: size.width,
        height: size.height,
        countryName: 'Global Situation',
        score: 0,
        date: dateParam ?? '—',
      }),
    );
  }

  let row: BriefRow | null;
  try {
    const sql = neon(dbUrl);
    const rows = dateParam
      ? ((await sql`
          SELECT brief_date, content FROM daily_briefs
          WHERE brief_date = ${dateParam} LIMIT 1
        `) as unknown as BriefRow[])
      : ((await sql`
          SELECT brief_date, content FROM daily_briefs
          ORDER BY brief_date DESC LIMIT 1
        `) as unknown as BriefRow[]);
    row = rows[0] ?? null;
  } catch (err) {
    console.error('[brief/screenshot] DB query failed:', err instanceof Error ? err.message : err);
    // Soft-fail to the fallback SVG — we'd rather serve SOMETHING than
    // leave the email with a broken image.
    return sendSvg(
      res,
      renderFallbackSvg({
        width: size.width,
        height: size.height,
        countryName: 'Global Situation',
        score: 0,
        date: dateParam ?? '—',
      }),
    );
  }

  if (!row) {
    return sendSvg(
      res,
      renderFallbackSvg({
        width: size.width,
        height: size.height,
        countryName: 'Global Situation',
        score: 0,
        date: dateParam ?? 'unknown',
      }),
    );
  }

  // Parse the content JSON blob.
  let content: BriefContent;
  try {
    content =
      typeof row.content === 'string'
        ? (JSON.parse(row.content) as BriefContent)
        : ((row.content as BriefContent) ?? {});
  } catch {
    content = {};
  }

  const top = content.topRiskCountries?.[0];
  const countryName = top?.name ?? 'Global Situation';
  const countryCode = top?.code ?? '';
  const score = top?.score ?? 0;
  const coords = COUNTRY_CENTERS[countryCode];

  const token = process.env.MAPBOX_TOKEN;

  // Primary path: Mapbox Static Images API if both the token and the
  // country coordinates are available.
  if (token && coords) {
    const url = buildMapboxUrl({
      token,
      lat: coords.lat,
      lon: coords.lon,
      zoom: coords.zoom,
      width: size.width,
      height: size.height,
      retina: size.retina,
    });
    // 302 redirect — Mapbox's CDN caches aggressively, so we keep this
    // function stateless and fast. The <img src="..."> in the email
    // will follow the redirect and the client's image cache will
    // handle the rest.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return res.redirect(302, url);
  }

  // Fallback path.
  return sendSvg(
    res,
    renderFallbackSvg({
      width: size.width,
      height: size.height,
      countryName,
      score,
      date: row.brief_date,
    }),
  );
}
