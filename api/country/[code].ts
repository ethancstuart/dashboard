import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'nodejs' };

/**
 * SEO Country Page — server-rendered HTML with OG tags and JSON-LD.
 *
 * GET /country/UA → HTML page with Ukraine CII score, components, meta tags.
 * Search engines get indexable content; humans get redirected to the SPA.
 *
 * 86 indexable pages → massive organic search surface for queries like
 * "Ukraine instability index", "Taiwan geopolitical risk", etc.
 */

const NAME_MAP: Record<string, string> = {
  UA: 'Ukraine',
  RU: 'Russia',
  CN: 'China',
  TW: 'Taiwan',
  IR: 'Iran',
  IQ: 'Iraq',
  SY: 'Syria',
  IL: 'Israel',
  PS: 'Palestine',
  YE: 'Yemen',
  SD: 'Sudan',
  SS: 'South Sudan',
  ET: 'Ethiopia',
  SO: 'Somalia',
  CD: 'DR Congo',
  MM: 'Myanmar',
  AF: 'Afghanistan',
  PK: 'Pakistan',
  KP: 'North Korea',
  KR: 'South Korea',
  VE: 'Venezuela',
  NG: 'Nigeria',
  LY: 'Libya',
  LB: 'Lebanon',
  SA: 'Saudi Arabia',
  US: 'United States',
  JP: 'Japan',
  DE: 'Germany',
  GB: 'United Kingdom',
  FR: 'France',
  IN: 'India',
  BR: 'Brazil',
  MX: 'Mexico',
  PH: 'Philippines',
  ID: 'Indonesia',
  TR: 'Turkey',
  EG: 'Egypt',
  ZA: 'South Africa',
  KE: 'Kenya',
  BD: 'Bangladesh',
  TH: 'Thailand',
  PL: 'Poland',
  RO: 'Romania',
  CO: 'Colombia',
  MY: 'Malaysia',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
  AU: 'Australia',
  CA: 'Canada',
  AR: 'Argentina',
  BF: 'Burkina Faso',
  ML: 'Mali',
  NE: 'Niger',
  TD: 'Chad',
  CF: 'Central African Republic',
  MZ: 'Mozambique',
};

function severityLabel(score: number): string {
  if (score >= 70) return 'CRITICAL';
  if (score >= 50) return 'ELEVATED';
  if (score >= 30) return 'WATCH';
  return 'STABLE';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = ((req.query.code as string) || '').toUpperCase();
  if (!code || code.length !== 2) {
    return res.status(400).send('Invalid country code');
  }

  const name = NAME_MAP[code] || code;
  const dbUrl = process.env.DATABASE_URL;

  let score = 0;
  let components: Record<string, number> = {};
  let date = new Date().toISOString().slice(0, 10);

  if (dbUrl) {
    try {
      const sql = neon(dbUrl);
      const rows = (await sql`
        SELECT score, components, timestamp
        FROM country_cii_history
        WHERE country_code = ${code}
        ORDER BY timestamp DESC
        LIMIT 1
      `) as unknown as Array<{ score: number; components: Record<string, number>; timestamp: string }>;

      if (rows.length > 0) {
        score = rows[0].score;
        components = rows[0].components || {};
        date = new Date(rows[0].timestamp).toISOString().slice(0, 10);
      }
    } catch {
      // Fall through with defaults
    }
  }

  const severity = severityLabel(score);
  const title = `${name} Geopolitical Risk | CII ${score}/100 | NexusWatch`;
  const description = `${name} Country Instability Index: ${score}/100 [${severity}]. Real-time risk scoring across conflict, disasters, sentiment, infrastructure, governance, and market exposure.`;
  const url = `https://nexuswatch.dev/country/${code}`;
  const ogImage = `https://nexuswatch.dev/api/og?country=${code}`;

  const componentHtml = Object.entries(components)
    .map(([k, v]) => `<li>${k}: ${typeof v === 'number' ? v.toFixed(1) : v}</li>`)
    .join('');

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${name} Geopolitical Risk`,
    description,
    url,
    dateModified: date,
    publisher: {
      '@type': 'Organization',
      name: 'NexusWatch',
      url: 'https://nexuswatch.dev',
    },
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${url}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${ogImage}">
  <link rel="canonical" href="${url}">
  <script type="application/ld+json">${jsonLd}</script>
  <!-- No meta refresh. Google follows a refresh and passes indexing to the
       target, which was a hash fragment and therefore not indexable — so all
       86 of these pages indexed as nothing. This page is the destination. -->
  <style>
    body { background: #0a0a0a; color: #e0e0e0; font-family: 'JetBrains Mono', monospace; margin: 0; padding: 40px; }
    h1 { color: #ff6600; font-size: 24px; letter-spacing: 0.05em; }
    .score { font-size: 64px; font-weight: 700; color: ${score >= 70 ? '#dc2626' : score >= 50 ? '#ff6600' : score >= 30 ? '#eab308' : '#22c55e'}; }
    .severity { font-size: 14px; letter-spacing: 0.15em; color: #888; }
    .components { list-style: none; padding: 0; }
    .components li { padding: 4px 0; font-size: 13px; border-bottom: 1px solid #1a1a1a; }
    a { color: #ff6600; }
  </style>
</head>
<body>
  <h1>${name} — Country Instability Index</h1>
  <div class="score">${score}</div>
  <div class="severity">${severity} — updated ${date}</div>
  <h2 style="font-size:14px;color:#888;margin-top:24px;letter-spacing:0.1em;">COMPONENTS</h2>
  <ul class="components">${componentHtml || '<li>No component data available</li>'}</ul>
  <!-- V-Dem and Copernicus were listed here and on the landing page, but
       vdem_indicators and copernicus_damage both hold zero rows: the collectors
       are scheduled and returning nothing. Naming a source we do not actually
       ingest is the one claim a transparency product cannot afford. Restored
       when the collectors produce data. -->
  <p>Data sources: ACLED, USGS, NASA FIRMS, GDACS, GDELT, NOAA, OFAC, OONI, UNHCR.</p>
  <p><a href="https://nexuswatch.dev/brief-country/${code}">View full interactive analysis →</a></p>
  <p><a href="https://nexuswatch.dev/accuracy">Prediction accuracy ledger →</a></p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');
  return res.send(html);
}
