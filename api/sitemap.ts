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
 *
 * THE COST OF THAT SOFT-FAIL, PAID IN FULL. Measured 2026-08-30: the live
 * sitemap carried 950 URLs and NOT ONE of them was a brief, while 140 briefs
 * existed and /brief/2026-08-27 returned 200. The entire archive had been
 * invisible to search engines for months and nothing reported it, because the
 * section that failed was the only one that failed and it failed quietly.
 *
 * The cause was two bugs in three lines, both from a missing `::text`:
 * `@neondatabase/serverless` returns `date` and `timestamptz` columns as JS
 * Date objects, so `generated_at.slice(0, 10)` threw a TypeError straight into
 * the catch — and had it not thrown, `/brief/${brief_date}` would have
 * rendered `/brief/Sun Aug 30 2026 00:00:00 GMT-0700 ...`. The calls query ten
 * lines below had the cast all along, which is what kept the other 950 URLs
 * working and the failure looking like a design choice.
 *
 * Do not "fix" a Date here with toISOString().slice(0, 10) — that reads the
 * UTC date, which rolls forward a day west of Greenwich. Cast in SQL.
 */

/**
 * Rows as the DRIVER actually hands them over, not as we wish it would.
 *
 * `string | Date` is deliberate and is the guard: it makes the compiler refuse
 * `.slice()` on these values, so the next person cannot reintroduce the
 * TypeError that emptied this sitemap. The SQL casts to text and the builder
 * below normalises anyway — belt and braces, because the failure mode here is
 * silent and lasts months.
 */
interface BriefRow {
  brief_date: string | Date;
  generated_at: string | Date | null;
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
  { path: 'why-free', changefreq: 'monthly', priority: '0.7' },
  { path: 'about', changefreq: 'monthly', priority: '0.5' },
  { path: 'methodology', changefreq: 'monthly', priority: '0.5' },
  { path: 'roadmap', changefreq: 'weekly', priority: '0.4' },
  { path: 'ledger', changefreq: 'daily', priority: '0.9' },
  { path: 'faq', changefreq: 'monthly', priority: '0.4' },
  { path: 'terms', changefreq: 'yearly', priority: '0.2' },
  { path: 'privacy', changefreq: 'yearly', priority: '0.2' },
  { path: 'security', changefreq: 'monthly', priority: '0.4' },
  { path: 'rss/cii', changefreq: 'daily', priority: '0.3' },
];

/**
 * Normalise whatever the driver returned into an ISO date.
 *
 * A Date reaching here means a cast was dropped upstream. It is handled rather
 * than thrown on — an unadvertised archive is a worse outcome than a slightly
 * defensive helper — but it is normalised in UTC-free terms via the local
 * Y/M/D parts, never toISOString(), which reads the UTC date and rolls forward
 * a day for anyone west of Greenwich.
 */
export function isoDate(v: string | Date | null | undefined): string | null {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const y = v.getFullYear();
  const m = String(v.getMonth() + 1).padStart(2, '0');
  const d = String(v.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Exported so the archive's visibility is testable without a database. */
export function buildBriefEntries(rows: BriefRow[], base: string): string[] {
  return rows
    .map((r) => {
      const date = isoDate(r.brief_date);
      // A row we cannot turn into a clean date must not become a URL. A
      // malformed <loc> is worse than a missing one.
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const lastmod = isoDate(r.generated_at) || date;
      return urlEntry(`${base}/brief/${date}`, lastmod, 'yearly', '0.7');
    })
    .filter((e): e is string => e !== null);
}

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
        SELECT brief_date::text AS brief_date, generated_at::text AS generated_at
        FROM daily_briefs
        ORDER BY brief_date DESC
        LIMIT 365
      `) as unknown as BriefRow[];

      briefEntries = buildBriefEntries(rows, base);
      if (briefEntries.length === 0) {
        // A section that returns nothing while the database is plainly
        // reachable is the exact shape that hid this for months. Say so.
        console.error('[sitemap] daily_briefs returned no rows — the brief archive is not being advertised');
      }
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
