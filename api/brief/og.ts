import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { markdownToHtml, markdownToText } from '../_lib/markdown.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

/**
 * Server-rendered landing page for `/brief/:date` share links (Track A.10).
 *
 * Wired via a vercel.json rewrite so that `/brief/YYYY-MM-DD` hits this
 * endpoint instead of serving the SPA index.html. Purpose:
 *
 *   1. Return an HTML page with proper Open Graph + Twitter Card meta
 *      tags for social crawlers (Facebook, Twitter, LinkedIn, Slack).
 *      Without this, /brief/:date unfurls would show the generic
 *      landing-page OG image.
 *
 *   2. Set a canonical URL pointing at the clean non-hash path so
 *      search engines index the stable permalink.
 *
 *   3. Bounce human visitors to the SPA at `#/brief/:date` via a
 *      meta-refresh + JS fallback. Crawlers ignore the refresh and
 *      just read the meta tags.
 *
 * Soft-fails: if the DB query fails or the brief doesn't exist, we
 * return a 200 with a generic landing page rather than a 404 — that
 * way any mis-dated social share still renders something share-worthy
 * instead of breaking the unfurl.
 */

interface BriefRow {
  brief_date: string;
  summary: string | null;
  content: unknown;
}

interface BriefContent {
  briefText?: string;
  topRiskCountries?: Array<{ name?: string; score?: number }>;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] || c;
  });
}

function extractHook(briefText: string): string {
  // Pull the Good Morning paragraph as the OG description. Strip
  // markdown markers and limit to ~200 chars so Twitter's preview
  // shows the whole hook instead of truncating mid-sentence.
  const gmMatch = briefText.match(/##\s*☕?\s*Good Morning\s*\n+([\s\S]*?)(?=\n##|$)/i);
  const raw = gmMatch ? gmMatch[1] : briefText;
  return raw
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function renderShell(opts: {
  date: string;
  title: string;
  description: string;
  imageUrl: string;
  canonicalUrl: string;
  spaRedirectUrl: string;
  /** Full brief, already rendered to semantic HTML. Empty when unavailable. */
  bodyHtml?: string;
}): string {
  const { date, title, description, imageUrl, canonicalUrl, spaRedirectUrl, bodyHtml } = opts;
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const img = escapeHtml(imageUrl);
  const canonical = escapeHtml(canonicalUrl);
  const redirect = escapeHtml(spaRedirectUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${t}</title>
  <meta name="description" content="${d}">
  <link rel="canonical" href="${canonical}">

  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:image" content="${img}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="NexusWatch">
  <meta property="article:published_time" content="${escapeHtml(date)}T10:00:00Z">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t}">
  <meta name="twitter:description" content="${d}">
  <meta name="twitter:image" content="${img}">

  <!-- Structured data for search engines -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": ${JSON.stringify(title)},
    "description": ${JSON.stringify(description)},
    "image": ${JSON.stringify(imageUrl)},
    "datePublished": "${escapeHtml(date)}T10:00:00Z",
    "dateModified": "${escapeHtml(date)}T10:00:00Z",
    "author": { "@type": "Organization", "name": "NexusWatch" },
    "publisher": {
      "@type": "Organization",
      "name": "NexusWatch",
      "logo": { "@type": "ImageObject", "url": "https://nexuswatch.dev/icon-512.png" }
    },
    "mainEntityOfPage": ${JSON.stringify(canonicalUrl)}
  }
  </script>

  <!-- No meta refresh. Google treats a zero-second refresh as a redirect and
       passes indexing to the target, which was a hash fragment and therefore
       not indexable — so 132 briefs of real daily writing indexed as nothing.
       The full brief is rendered below instead; this page IS the article. -->
  <style>
    body { background: #faf8f3; color: #12161c; font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif; margin: 0; }
    .wrap { max-width: 680px; margin: 64px auto; padding: 0 32px; }
    .brief { text-align: left; }
    .brief h2 { font-family: 'Tiempos Headline', Georgia, serif; font-size: 22px; margin: 40px 0 12px; }
    .brief h3 { font-size: 17px; margin: 28px 0 8px; }
    .brief p, .brief li { font-size: 17px; line-height: 1.62; color: #12161c; }
    .brief ul, .brief ol { padding-left: 22px; }
    .brief li { margin: 0 0 8px; }
    .brief hr { border: 0; border-top: 1px solid #c9c3b4; margin: 40px 0; }
    .more { margin-top: 48px; }
    .kicker { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.2em; color: #9a1b1b; text-transform: uppercase; margin-bottom: 12px; }
    h1 { font-family: 'Tiempos Headline', Georgia, serif; font-size: 32px; font-weight: 600; margin: 0 0 16px 0; }
    p { font-size: 15px; line-height: 1.6; color: #3b4252; margin: 0 0 24px 0; }
    a { color: #9a1b1b; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; border: 1px solid #c9c3b4; padding: 12px 24px; border-radius: 4px; display: inline-block; }
    a:hover { border-color: #9a1b1b; }
  </style>
</head>
<body>
  <article class="wrap">
    <div class="kicker">SITUATION BRIEF · ${escapeHtml(date)}</div>
    <h1>${t}</h1>
    ${bodyHtml ? `<div class="brief">${bodyHtml}</div>` : `<p>${d}</p>`}
    <p class="more"><a href="${redirect}">Open NexusWatch →</a></p>
  </article>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('method_not_allowed');
  }

  // The rewrite injects the date as a query param (see vercel.json).
  const rawDate = typeof req.query.date === 'string' ? req.query.date : '';
  // Defensive: only accept YYYY-MM-DD shapes; anything else → generic shell.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600');

  if (!date) {
    return res.send(
      renderShell({
        date: new Date().toISOString().slice(0, 10),
        title: 'The NexusWatch Brief — Daily Geopolitical Intelligence',
        description:
          'NexusWatch publishes a daily three-minute geopolitical intelligence scan every morning at 5 AM ET.',
        imageUrl: 'https://nexuswatch.dev/api/brief/screenshot?size=og',
        canonicalUrl: 'https://nexuswatch.dev/briefs',
        spaRedirectUrl: 'https://nexuswatch.dev/briefs',
      }),
    );
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.send(
      renderShell({
        date,
        title: `NexusWatch Situation Brief · ${date}`,
        description: 'Daily geopolitical intelligence from NexusWatch.',
        imageUrl: `https://nexuswatch.dev/api/brief/screenshot?date=${encodeURIComponent(date)}&size=og`,
        canonicalUrl: `https://nexuswatch.dev/brief/${date}`,
        spaRedirectUrl: 'https://nexuswatch.dev/briefs',
      }),
    );
  }

  try {
    const sql = neon(dbUrl);
    const rows = (await sql`
      SELECT brief_date, summary, content
      FROM daily_briefs
      WHERE brief_date = ${date}
      LIMIT 1
    `) as unknown as BriefRow[];

    let title = `NexusWatch Situation Brief · ${date}`;
    let description =
      'Daily geopolitical intelligence from NexusWatch — what changed overnight, why it matters, what to watch.';
    let bodyHtml = '';

    if (rows.length > 0) {
      const row = rows[0];
      let content: BriefContent = {};
      try {
        content =
          typeof row.content === 'string'
            ? (JSON.parse(row.content) as BriefContent)
            : ((row.content as BriefContent) ?? {});
      } catch {
        /* non-JSON content — leave defaults */
      }

      if (content.briefText) {
        const hook = extractHook(content.briefText);
        if (hook) description = hook;
        // The whole point: the article is the page, not a teaser in front of a
        // redirect. markdownToText is the fallback description when there is no
        // "Good Morning" hook to extract.
        bodyHtml = markdownToHtml(content.briefText);
        if (!hook) description = markdownToText(content.briefText).slice(0, 200);
      }

      const top = content.topRiskCountries?.[0];
      if (top?.name) {
        title = `NexusWatch · ${top.name} · ${date}`;
      }
    }

    return res.send(
      renderShell({
        date,
        title,
        description,
        imageUrl: `https://nexuswatch.dev/api/brief/screenshot?date=${encodeURIComponent(date)}&size=og`,
        canonicalUrl: `https://nexuswatch.dev/brief/${date}`,
        spaRedirectUrl: 'https://nexuswatch.dev/briefs',
        bodyHtml,
      }),
    );
  } catch (err) {
    console.error('[brief/og] DB query failed:', err instanceof Error ? err.message : err);
    // Soft-fail to generic shell so the share link still unfurls.
    return res.send(
      renderShell({
        date,
        title: `NexusWatch Situation Brief · ${date}`,
        description: 'Daily geopolitical intelligence from NexusWatch.',
        imageUrl: `https://nexuswatch.dev/api/brief/screenshot?date=${encodeURIComponent(date)}&size=og`,
        canonicalUrl: `https://nexuswatch.dev/brief/${date}`,
        spaRedirectUrl: 'https://nexuswatch.dev/briefs',
      }),
    );
  }
}
