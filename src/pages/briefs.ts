import '../styles/briefs-dossier.css';
import { createElement } from '../utils/dom.ts';
import { pageShell } from '../ui/kit/index.ts';
import { escapeHtml, renderBriefBody } from '../utils/briefRenderer.ts';
import { setPageSeo, setJsonLd, PAGE_SEO } from '../utils/seo.ts';

/**
 * Brief archive pages — Light Intel Dossier styling (Track A.10).
 *
 * Site-facing counterpart to the email template rendered by
 * api/cron/daily-brief.ts. Shares the palette and typography tokens via
 * src/styles/briefs-dossier.css, which mirrors src/styles/email-tokens.ts.
 *
 * Routes:
 *   /#/briefs         → renderBriefs(): archive listing, newest first
 *   /#/brief/:date    → renderBrief():  single-day full brief
 *
 * The /brief/:date clean URL (without the hash) is served by the
 * api/brief/og.ts endpoint, which returns an HTML page with proper
 * Open Graph meta tags for social crawlers, then bounces human
 * visitors to this SPA via a meta-refresh to #/brief/:date.
 */

interface BriefListItem {
  date?: string;
  brief_date?: string;
  preview?: string;
  summary?: string;
  generatedAt?: string;
}

interface BriefDetailResponse {
  brief_date: string;
  summary: string | null;
  content?: unknown;
  generated_at: string | null;
}

// ---------------------------------------------------------------------------
// Markdown → dossier-HTML rendering
// ---------------------------------------------------------------------------
//
// Lives in src/utils/briefRenderer.ts as a shared module so the archive
// page AND the in-map brief panel (src/ui/briefPanel.ts) produce
// identical output. See that file for the section parser, inline
// markdown handling, and Why-it-matters callout treatment. The
// authoritative email renderer is still in api/cron/daily-brief.ts —
// the three must stay aesthetically locked.

// ---------------------------------------------------------------------------
// Archive listing page — /#/briefs
// ---------------------------------------------------------------------------

export function renderBriefs(root: HTMLElement): void {
  const main = pageShell(root, { active: '/briefs' });

  setPageSeo(PAGE_SEO.briefs);

  const page = createElement('div', { className: 'briefs-dossier' });
  page.innerHTML = `

    <header class="dossier-header">
      <div class="dossier-kicker">SITUATION BRIEF · DAILY</div>
      <h1 class="dossier-title">The NexusWatch Brief</h1>
      <p class="dossier-subtitle">Daily geopolitical intelligence. Three-minute scans of what changed overnight, why it matters, and what to watch.</p>
      <div class="dossier-divider"></div>
      <form class="dossier-subscribe" id="briefs-subscribe">
        <input type="email" placeholder="your@email.com" required class="dossier-email">
        <button type="submit" class="dossier-subscribe-btn">Get it free</button>
      </form>
      <div class="dossier-subscribe-status" id="briefs-sub-status" role="status" aria-live="polite"></div>
    </header>

    <main class="dossier-list" id="briefs-list">
      <div class="dossier-loading">Loading briefs…</div>
    </main>

  `;

  main.appendChild(page);

  wireSubscribe('briefs-subscribe', 'briefs-sub-status', 'briefs-archive');

  const listEl = document.getElementById('briefs-list');
  if (!listEl) return;
  const PAGE_SIZE = 20;
  let allBriefs: BriefListItem[] = [];
  let visibleCount = PAGE_SIZE;

  const renderBriefCard = (b: BriefListItem): string => {
    const date = String(b.date || b.brief_date || '').split('T')[0];
    const summary = String(b.preview || b.summary || '');
    const previewText = summary
      .replace(/<[^>]+>/g, '')
      .replace(/^##\s*[^\n]*\n+/, '')
      .trim()
      .slice(0, 240);
    const dayName = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return `
      <a href="#/brief/${encodeURIComponent(date)}" class="dossier-card">
        <div class="dossier-card-date">${escapeHtml(dayName)}</div>
        <h2 class="dossier-card-headline">Situation Brief · ${escapeHtml(date)}</h2>
        <p class="dossier-card-preview">${escapeHtml(previewText)}…</p>
        <div class="dossier-card-read">Read full brief →</div>
      </a>
    `;
  };

  const renderBriefList = () => {
    const visible = allBriefs.slice(0, visibleCount);
    const remaining = allBriefs.length - visibleCount;

    listEl.innerHTML = visible.map(renderBriefCard).join('');

    if (remaining > 0) {
      const loadMore = document.createElement('button');
      loadMore.className = 'dossier-load-more';
      loadMore.textContent = `Load ${Math.min(remaining, PAGE_SIZE)} more briefs`;
      loadMore.style.cssText =
        'display:block;margin:24px auto;padding:10px 24px;background:transparent;border:1px solid var(--nw-border, #222);color:var(--nw-text-secondary, #999);border-radius:6px;cursor:pointer;font-size:13px;font-family:var(--nw-font-body, Inter, sans-serif)';
      loadMore.addEventListener('click', () => {
        visibleCount += PAGE_SIZE;
        renderBriefList();
      });
      listEl.appendChild(loadMore);
    }
  };

  void fetch('/api/briefs')
    .then((r) => r.json())
    .then((data: { briefs?: BriefListItem[] }) => {
      allBriefs = data.briefs ?? [];
      if (allBriefs.length === 0) {
        // 2026-05-02 P2.4: try Haiku-synthesized samples; fall back to static.
        listEl.innerHTML = renderSampleHero(SAMPLE_BRIEFS);
        void fetch('/api/briefs-sample')
          .then((r) => r.json())
          .then((data: { samples?: SampleBrief[] }) => {
            if (data.samples && data.samples.length > 0) {
              listEl.innerHTML = renderSampleHero(data.samples);
            }
          })
          .catch(() => {
            /* keep static fallback */
          });
        return;
      }
      renderBriefList();
    })
    .catch(() => {
      listEl.innerHTML = `<p class="dossier-empty">Failed to load briefs. <button class="dossier-retry" style="background:none;border:none;color:var(--nw-accent);cursor:pointer;text-decoration:underline;font-size:inherit">Try again</button></p>`;
      const retryBtn = listEl.querySelector('.dossier-retry');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          listEl.innerHTML = '<div class="dossier-loading">Loading briefs\u2026</div>';
          void fetch('/api/briefs')
            .then((r) => r.json())
            .then((data: { briefs?: BriefListItem[] }) => {
              allBriefs = data.briefs ?? [];
              if (allBriefs.length === 0) {
                listEl.innerHTML = `<p class="dossier-empty">No briefs yet.</p>`;
                return;
              }
              renderBriefList();
            })
            .catch(() => {
              listEl.innerHTML = `<p class="dossier-empty">Still unable to load. Check <a href="#/status" style="color:var(--nw-accent)">status page</a>.</p>`;
            });
        });
      }
    });
}

// ---------------------------------------------------------------------------
// Sample-hero — shown when no briefs are in the archive yet.
// 2026-05-02 W6: replaces the bare "No briefs yet" placeholder.
// Hand-curated samples for the empty pre-launch state. Once the daily
// cron runs and seeds real briefs, the listEl renders those instead and
// this hero is bypassed.
// ---------------------------------------------------------------------------

interface SampleBrief {
  theme: string;
  title: string;
  excerpt: string;
  themeColor: string;
}

const SAMPLE_BRIEFS: SampleBrief[] = [
  {
    theme: 'CHOKEPOINT',
    title: 'Strait of Hormuz transit at 14-month low',
    excerpt:
      'Vessel transits through Hormuz fell to 38 ships/day this week — lowest since 2025. AIS data shows three VLCCs rerouting Cape of Good Hope. Brent +2.3% on the week.',
    themeColor: 'var(--nw-accent, var(--color-tension-high))',
  },
  {
    theme: 'CONFLICT',
    title: 'Sahel instability index +6.2 points in 30 days',
    excerpt:
      'ACLED logged 247 conflict events across Mali, Burkina Faso, Niger — a 41% MoM rise. GDELT cross-reference confirms the surge. Three coup-vulnerability indicators flashing yellow.',
    themeColor: 'var(--color-signal-critical)',
  },
  {
    theme: 'TRADE',
    title: 'Taiwan Strait shipping density holds steady — for now',
    excerpt:
      'Despite three PLA navy exercises this month, container traffic through the Taiwan Strait is unchanged from baseline. Insurance markets are pricing 12% premium on hull policies.',
    themeColor: '#06b6d4',
  },
];

function renderSampleHero(samples: SampleBrief[] = SAMPLE_BRIEFS): string {
  const cards = samples
    .map(
      (b) => `
    <article class="dossier-sample-card">
      <span class="dossier-sample-theme" style="color:${b.themeColor};border-color:${b.themeColor}">${b.theme}</span>
      <h3 class="dossier-sample-title">${escapeHtml(b.title)}</h3>
      <p class="dossier-sample-excerpt">${escapeHtml(b.excerpt)}</p>
    </article>
  `,
    )
    .join('');

  return `
    <div class="dossier-sample-hero">
      <header class="dossier-sample-header">
        <span class="dossier-sample-eyebrow">PREVIEW — RECENT INTELLIGENCE THEMES</span>
        <h2 class="dossier-sample-headline">A taste of what the daily brief covers</h2>
        <p class="dossier-sample-subtitle">
          Next live brief publishes <strong>5 AM ET</strong> tomorrow. The samples
          below are hand-curated previews — full briefs synthesize fresh CII data
          across 85 scored countries every morning.
        </p>
      </header>
      <div class="dossier-sample-grid">${cards}</div>
      <p class="dossier-sample-cta">
        Subscribe via <a href="https://brief.nexuswatch.dev" target="_blank" rel="noopener">brief.nexuswatch.dev</a> to get tomorrow's first issue in your inbox.
      </p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Single-brief article page — /#/brief/:date
// ---------------------------------------------------------------------------

export function renderBrief(root: HTMLElement, date: string): void {
  const main = pageShell(root, { active: '/briefs' });

  const page = createElement('div', { className: 'briefs-dossier' });
  page.innerHTML = `

    <article class="dossier-article" id="brief-content">
      <div class="dossier-loading">Loading brief for ${escapeHtml(date)}…</div>
    </article>

    <section class="dossier-bottom-cta">
      <h3>Get this in your inbox every morning</h3>
      <p>The NexusWatch Brief — three-minute geopolitical intelligence scan, free.</p>
      <form class="dossier-subscribe" id="brief-subscribe">
        <input type="email" placeholder="your@email.com" required class="dossier-email">
        <button type="submit" class="dossier-subscribe-btn">Subscribe free</button>
      </form>
      <div class="dossier-subscribe-status" id="brief-sub-status" role="status" aria-live="polite"></div>
    </section>

  `;

  main.appendChild(page);

  wireSubscribe('brief-subscribe', 'brief-sub-status', 'brief-page');

  const articleEl = document.getElementById('brief-content');
  if (!articleEl) return;

  void fetch(`/api/v1/brief?date=${encodeURIComponent(date)}`)
    .then((r) => {
      if (!r.ok) throw new Error('Not found');
      return r.json() as Promise<BriefDetailResponse>;
    })
    .then((data) => {
      const briefDate = String(data.brief_date || date).split('T')[0];
      const dayName = new Date(`${briefDate}T12:00:00Z`).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });

      // Prefer briefText (markdown) from content column; fall back to
      // the legacy HTML summary for pre-A.5 historical briefs.
      let content: { briefText?: string } = {};
      if (typeof data.content === 'string') {
        try {
          content = JSON.parse(data.content) as { briefText?: string };
        } catch {
          /* ignore */
        }
      } else if (data.content && typeof data.content === 'object') {
        content = data.content as { briefText?: string };
      }

      const body = content.briefText
        ? renderBriefBody(content.briefText, { dateForImage: briefDate })
        : (data.summary ?? '<p>Brief content unavailable.</p>');

      articleEl.innerHTML = `
        <div class="dossier-kicker">SITUATION BRIEF</div>
        <h1 class="dossier-title">NexusWatch · ${escapeHtml(briefDate)}</h1>
        <div class="dossier-article-date">${escapeHtml(dayName)}</div>
        <div class="dossier-byline" style="font-size:12px;color:#8b8478;margin-top:32px;padding-top:16px;border-top:1px solid var(--color-border);line-height:1.6;">
          Generated by NexusWatch AI · Data from 12+ verified sources (ACLED, USGS, GDELT, WHO, NASA, AIS, OONI, Polymarket).<br>
          Every claim is traced to its source. <a href="#/methodology" style="color:var(--color-accent);">Read our methodology →</a>
        </div>
        <div class="dossier-body">${body}</div>
        <div class="dossier-share" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <span style="font-size:11px;color:#8b8478;font-family:var(--nw-font-mono);letter-spacing:0.5px">SHARE</span>
          <button class="dossier-share-btn" id="share-copy" type="button" style="font-size:12px;padding:6px 14px;background:transparent;border:1px solid #ddd8ce;color:#3d3a35;border-radius:4px;cursor:pointer">Copy link</button>
          <a class="dossier-share-btn" id="share-twitter" href="#" target="_blank" rel="noopener" style="font-size:12px;padding:6px 14px;background:transparent;border:1px solid #ddd8ce;color:#3d3a35;border-radius:4px;cursor:pointer;text-decoration:none">Twitter / X</a>
          <a class="dossier-share-btn" id="share-linkedin" href="#" target="_blank" rel="noopener" style="font-size:12px;padding:6px 14px;background:transparent;border:1px solid #ddd8ce;color:#3d3a35;border-radius:4px;cursor:pointer;text-decoration:none">LinkedIn</a>
        </div>
      `;

      const briefUrl = `${window.location.origin}/brief/${briefDate}`;
      const shareText = `NexusWatch Situation Brief \u2014 ${briefDate}. Geopolitical intelligence you can audit.`;

      const copyBtn = document.getElementById('share-copy');
      copyBtn?.addEventListener('click', () => {
        void navigator.clipboard.writeText(briefUrl).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy link';
          }, 2000);
        });
      });

      const twitterLink = document.getElementById('share-twitter') as HTMLAnchorElement | null;
      if (twitterLink) {
        twitterLink.href = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(briefUrl)}`;
      }

      const linkedinLink = document.getElementById('share-linkedin') as HTMLAnchorElement | null;
      if (linkedinLink) {
        linkedinLink.href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(briefUrl)}`;
      }

      // SEO — update <title> and <meta description> for this brief.
      document.title = `NexusWatch Situation Brief · ${briefDate}`;
      const descMeta = document.querySelector('meta[name="description"]');
      if (descMeta) {
        descMeta.setAttribute(
          'content',
          `NexusWatch geopolitical intelligence brief for ${dayName}. Read the full situation report.`,
        );
      }
      // og:image points at our screenshot endpoint so social link
      // previews get a real map. The clean /brief/:date URL (served
      // by api/brief/og.ts) is the preferred share surface for
      // crawlers, but this in-SPA update helps clients that re-crawl
      // on hash changes.
      upsertMeta('property', 'og:title', `NexusWatch Situation Brief · ${briefDate}`);
      upsertMeta('property', 'og:description', `Daily geopolitical intelligence from NexusWatch — ${dayName}. Free.`);
      upsertMeta(
        'property',
        'og:image',
        `https://nexuswatch.dev/api/og?type=brief&date=${encodeURIComponent(briefDate)}`,
      );
      upsertMeta('property', 'og:url', `https://nexuswatch.dev/brief/${briefDate}`);
      upsertMeta('property', 'og:type', 'article');

      // Article schema for the brief — helps Google News + share unfurls.
      setJsonLd('brief-article', {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: `NexusWatch Situation Brief · ${briefDate}`,
        description: `Daily geopolitical intelligence from NexusWatch — ${dayName}.`,
        image: `https://nexuswatch.dev/api/og?type=brief&date=${encodeURIComponent(briefDate)}`,
        datePublished: `${briefDate}T10:00:00Z`,
        dateModified: `${briefDate}T10:00:00Z`,
        mainEntityOfPage: `https://nexuswatch.dev/brief/${briefDate}`,
        author: { '@type': 'Organization', name: 'NexusWatch' },
        publisher: {
          '@type': 'Organization',
          name: 'NexusWatch',
          logo: { '@type': 'ImageObject', url: 'https://nexuswatch.dev/icons/icon-512.svg' },
        },
        isAccessibleForFree: true,
      });
    })
    .catch(() => {
      articleEl.innerHTML = `
        <div class="dossier-not-found">
          <h2>Brief not found</h2>
          <p>No brief available for ${escapeHtml(date)}. <a href="#/briefs">View all briefs →</a></p>
        </div>
      `;
    });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function wireSubscribe(formId: string, statusId: string, source: string): void {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  const statusEl = document.getElementById(statusId);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const email = input instanceof HTMLInputElement ? input.value : '';
    if (statusEl) {
      statusEl.textContent = 'Subscribing…';
      statusEl.style.color = 'var(--color-text-2)';
    }
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (statusEl) {
        statusEl.textContent = data.success
          ? "✓ You're in. First brief arrives tomorrow morning."
          : (data.error ?? 'Failed');
        statusEl.style.color = data.success ? 'var(--color-up)' : 'var(--color-down)';
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = 'Network error — try again.';
        statusEl.style.color = 'var(--color-down)';
      }
    }
  });
}

function upsertMeta(attr: 'name' | 'property', key: string, value: string): void {
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}
