import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'nodejs', maxDuration: 10 };

/**
 * Dynamic XML sitemap (Track A.10).
 *
 * Served at `/sitemap.xml` via a vercel.json rewrite. Lists the
 * canonical homepage, the key static routes, and every historical
 * brief at its clean `/brief/:date` permalink. Googlebot and friends
 * crawl this to discover the full archive.
 *
 * Falls back to a static list (no briefs) if the DB is unreachable —
 * a minimal sitemap beats a 500 from a search engine's perspective.
 */

interface BriefRow {
  brief_date: string;
  generated_at: string | null;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return map[c] || c;
  });
}

function urlEntry(loc: string, lastmod: string, changefreq: string, priority: string): string {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <changefreq>${escapeXml(changefreq)}</changefreq>
    <priority>${escapeXml(priority)}</priority>
  </url>`;
}

// Public routes only. Paywall surfaces (/pricing, /billing) are intentionally
// omitted — the product is free, so those URLs would be misleading or stale.
// Admin, settings/private, and any auth-only flows are also excluded.
const STATIC_ROUTES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: '', changefreq: 'daily', priority: '1.0' },
  { path: 'briefs', changefreq: 'daily', priority: '0.9' },
  { path: 'intel', changefreq: 'hourly', priority: '0.9' },
  { path: 'why-free', changefreq: 'monthly', priority: '0.7' },
  { path: 'about', changefreq: 'monthly', priority: '0.5' },
  { path: 'methodology', changefreq: 'monthly', priority: '0.5' },
  { path: 'roadmap', changefreq: 'weekly', priority: '0.4' },
  { path: 'ledger', changefreq: 'daily', priority: '0.9' },
  { path: 'compare', changefreq: 'weekly', priority: '0.5' },
  { path: 'watchlist', changefreq: 'weekly', priority: '0.4' },
  { path: 'feed', changefreq: 'daily', priority: '0.5' },
  { path: 'faq', changefreq: 'monthly', priority: '0.4' },
  { path: 'terms', changefreq: 'yearly', priority: '0.2' },
  { path: 'privacy', changefreq: 'yearly', priority: '0.2' },
  { path: 'security', changefreq: 'monthly', priority: '0.4' },
  { path: 'rss/cii', changefreq: 'daily', priority: '0.3' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('method_not_allowed');
  }

  const base = 'https://nexuswatch.dev';
  const today = new Date().toISOString().slice(0, 10);

  const staticEntries = STATIC_ROUTES.map((r) =>
    urlEntry(`${base}${r.path ? '/' + r.path : ''}`, today, r.changefreq, r.priority),
  );

  let briefEntries: string[] = [];
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const sql = neon(dbUrl);
      const rows = (await sql`
        SELECT brief_date, generated_at
        FROM daily_briefs
        ORDER BY brief_date DESC
        LIMIT 365
      `) as unknown as BriefRow[];

      briefEntries = rows.map((r) => {
        const lastmod = r.generated_at ? r.generated_at.slice(0, 10) : r.brief_date;
        return urlEntry(`${base}/brief/${r.brief_date}`, lastmod, 'yearly', '0.7');
      });
    } catch (err) {
      console.error('[sitemap] DB query failed:', err instanceof Error ? err.message : err);
      // Soft-fail to static-only sitemap.
    }
  }

  // Dynamic country pages — one per country with CII data
  let countryEntries: string[] = [];
  if (dbUrl) {
    try {
      const sql = neon(dbUrl);
      const countries = (await sql`
        SELECT DISTINCT country_code FROM country_cii_history ORDER BY country_code
      `) as unknown as Array<{ country_code: string }>;
      countryEntries = countries.map((r) => urlEntry(`${base}/country/${r.country_code}`, today, 'daily', '0.6'));
    } catch {
      // Soft-fail
    }
  }

  // Per-call pages — the citeable unit. Resolved calls are immutable documents
  // (changefreq yearly); open calls change once, on their resolution date.
  let callEntries: string[] = [];
  if (dbUrl) {
    try {
      const sql = neon(dbUrl);
      const calls = (await sql`
        SELECT id, made_on::text AS made_on, status, resolved_at::text AS resolved_at
        FROM calls ORDER BY made_on DESC LIMIT 5000
      `) as unknown as Array<{ id: number; made_on: string; status: string; resolved_at: string | null }>;
      callEntries = calls.map((c) =>
        urlEntry(
          `${base}/call/${c.id}`,
          c.resolved_at ? c.resolved_at.slice(0, 10) : c.made_on,
          c.status === 'pending' ? 'daily' : 'yearly',
          c.status === 'pending' ? '0.5' : '0.6',
        ),
      );
    } catch {
      // Soft-fail
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticEntries, ...briefEntries, ...countryEntries, ...callEntries].join('\n')}
</urlset>
`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return res.status(200).send(body);
}
