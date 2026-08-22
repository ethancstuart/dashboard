/**
 * Landing — editorial rebuild (Track C).
 *
 * Surfaces the "Free." positioning. Hero is the live globe with kinetic
 * typographic overlay; below the fold are restrained editorial sections
 * (feature grid, layer breadth, Cinema preview, sample brief, why-free
 * teaser, newsletter, receipts, footer).
 *
 * Mobile-first. The globe is a decorative background — interactivity is
 * disabled on the landing surface and the desktop boots MapLibre lazily.
 * On mobile we paint a static dark globe (no MapLibre cost) so first paint
 * is measured in milliseconds, not megabytes.
 */

import '../styles/landing.css';
import { createElement } from '../utils/dom.ts';
import { trackEvent } from '../services/analytics.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';

const FALLBACK_BRIEF = {
  date: 'Sample',
  headline: 'A reading on the world, written each morning at 05:00 ET.',
  excerpt:
    'Three minutes. The conflicts that moved overnight, the disasters that landed, the markets that flinched. Each line evidence-chained back to the source — USGS, ACLED, GDELT, AIS — so you can audit anything that smells off. The full archive is open.',
};

interface BriefResponse {
  date?: string;
  headline?: string;
  summary?: string;
}

export function renderLanding(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.landing);
  root.textContent = '';

  // Reduced motion + viewport-based decisions.
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isNarrow = window.matchMedia('(max-width: 767px)').matches;

  // Top-level <main> opts into the marketing surface (Source Serif, generous
  // rhythm). Adding nw-landing-surface on top scopes our overrides.
  const main = createElement('main', { className: 'marketing-surface nw-landing-surface' });
  main.id = 'main-content';
  main.setAttribute('role', 'main');

  main.innerHTML = `
    <nav class="nw-nav" aria-label="Primary">
      <a href="#/" class="nw-nav-brand"><span class="nw-nav-mark">●</span>&nbsp;NexusWatch</a>
      <div class="nw-nav-links">
        <a href="#/intel">Intel Map</a>
        <a href="#/briefs">Briefs</a>
        <a href="#/why-free">Why Free</a>
        <a href="#/about">About</a>
      </div>
    </nav>

    <section class="nw-hero" aria-label="Hero">
      <div class="nw-hero-globe" id="nw-hero-globe" aria-hidden="true"></div>

      <div class="nw-hero-live" aria-hidden="true">
        <span class="nw-hero-live-dot"></span>
        <span>LIVE</span>
      </div>

      <div class="nw-hero-content" id="nw-hero-content">
        <span class="nw-eyebrow">Geopolitical Intelligence</span>
        <h1 class="nw-hero-headline word-stagger" aria-label="The world, watched.">
          <span>The</span> <span>world,</span> <span>watched<span class="nw-hero-period">.</span></span>
        </h1>
        <p class="nw-hero-sub">45+ live data layers. 85 countries scored. Daily AI briefs. Free.</p>
        <a href="#/intel" class="nw-hero-cta" data-cta="hero-primary">
          Open the dashboard <span class="nw-hero-cta-arrow" aria-hidden="true">→</span>
        </a>
        <p class="nw-hero-fineprint">It's the entire site. Free.</p>
      </div>
    </section>

    <section class="nw-reveal" aria-label="What it is">
      <span class="nw-section-eyebrow">What it is</span>
      <h2 class="nw-section-heading">A command center for a moving world.</h2>
      <p class="nw-section-lede">
        Open the dashboard, watch the globe spin, drop pins on what matters. Every layer is live, every score
        traces back to a source, every brief is something you'd actually read.
      </p>
      <div class="nw-features-grid">
        <article class="nw-feature">
          <span class="nw-feature-label">45+ Layers</span>
          <h3 class="nw-feature-title">Live data, every minute.</h3>
          <p class="nw-feature-desc">Earthquakes, conflict, sanctions, shipping, satellites, AI sentiment, dark vessels, undersea cables, and thirty-seven more — refreshed continuously.</p>
        </article>
        <article class="nw-feature">
          <span class="nw-feature-label">85 Countries</span>
          <h3 class="nw-feature-title">A scored world.</h3>
          <p class="nw-feature-desc">The Country Instability Index decomposes into six weighted components with evidence chains and confidence badges. Click a number, see the data behind it.</p>
        </article>
        <article class="nw-feature">
          <span class="nw-feature-label">Daily Brief</span>
          <h3 class="nw-feature-title">Three minutes. Every morning.</h3>
          <p class="nw-feature-desc">A synthesized intelligence report, composed by AI, vetted against the sources you can read for yourself. Free in your inbox or via RSS.</p>
        </article>
        <article class="nw-feature">
          <span class="nw-feature-label">Cinema Mode</span>
          <h3 class="nw-feature-title">Drop it on a TV.</h3>
          <p class="nw-feature-desc">A wall-display loop: globe, alerts, instability deltas, briefings cycling on a slow tempo. Trading floors, ops rooms, your living room.</p>
        </article>
        <article class="nw-feature">
          <span class="nw-feature-label">Open API</span>
          <h3 class="nw-feature-title">Query the firehose.</h3>
          <p class="nw-feature-desc">A v2 REST surface over the same data the dashboard reads. No key required for basic queries. Built so other people can build on top.</p>
        </article>
        <article class="nw-feature">
          <span class="nw-feature-label">Receipts</span>
          <h3 class="nw-feature-title">Open-source, evidence-chained.</h3>
          <p class="nw-feature-desc">MIT-licensed. Every claim traces to a source row and a confidence score. Calls we got wrong stay in the prediction ledger — that's the work.</p>
        </article>
      </div>
    </section>

    <section class="nw-reveal" aria-label="Layers">
      <span class="nw-section-eyebrow">Layers / 45+</span>
      <h2 class="nw-section-heading">The breadth of the surface.</h2>
      <p class="nw-section-lede">
        Five categories, thirty named layers visible above; fifteen more under the hood. Toggle any of them on
        the live map.
      </p>
      <div class="nw-layers-rail" id="nw-layers-rail">
        <article class="nw-layer-card">
          <div class="nw-layer-head">
            <span class="nw-layer-name">Conflict & Military</span>
            <span class="nw-layer-count">7 <span class="nw-layer-dot" aria-hidden="true"></span></span>
          </div>
          <ul class="nw-layer-list">
            <li>ACLED Live Conflicts</li>
            <li>Conflict Zones</li>
            <li>Military Bases (28)</li>
            <li>Cyber Threat Corridors</li>
            <li>OFAC Sanctions</li>
            <li>GPS Jamming Zones</li>
            <li>Frontlines</li>
          </ul>
        </article>
        <article class="nw-layer-card">
          <div class="nw-layer-head">
            <span class="nw-layer-name">Natural Hazards</span>
            <span class="nw-layer-count">5 <span class="nw-layer-dot" aria-hidden="true"></span></span>
          </div>
          <ul class="nw-layer-list">
            <li>Earthquakes (USGS, 1 min)</li>
            <li>Wildfires (NASA FIRMS)</li>
            <li>GDACS Disasters</li>
            <li>WHO Disease Outbreaks</li>
            <li>Weather Alerts</li>
          </ul>
        </article>
        <article class="nw-layer-card">
          <div class="nw-layer-head">
            <span class="nw-layer-name">Infrastructure</span>
            <span class="nw-layer-count">9 <span class="nw-layer-dot" aria-hidden="true"></span></span>
          </div>
          <ul class="nw-layer-list">
            <li>Ship Tracking (26)</li>
            <li>Chokepoint Status (6)</li>
            <li>Undersea Cables (12)</li>
            <li>Oil & Gas Pipelines</li>
            <li>Nuclear Facilities (22)</li>
            <li>Strategic Ports (18)</li>
            <li>Trade Routes</li>
            <li>Space Launches</li>
            <li>Energy Grid</li>
          </ul>
        </article>
        <article class="nw-layer-card">
          <div class="nw-layer-head">
            <span class="nw-layer-name">Intelligence</span>
            <span class="nw-layer-count">7 <span class="nw-layer-dot" aria-hidden="true"></span></span>
          </div>
          <ul class="nw-layer-list">
            <li>GDELT News Events</li>
            <li>Prediction Markets</li>
            <li>Satellites (animated orbits)</li>
            <li>Internet Outages</li>
            <li>Election Calendar</li>
            <li>Refugee Displacement Arcs</li>
            <li>Sentiment</li>
          </ul>
        </article>
        <article class="nw-layer-card">
          <div class="nw-layer-head">
            <span class="nw-layer-name">Environment</span>
            <span class="nw-layer-count">2 <span class="nw-layer-dot" aria-hidden="true"></span></span>
          </div>
          <ul class="nw-layer-list">
            <li>Air Quality AQI (30 cities)</li>
            <li>Live Aircraft (OpenSky)</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="nw-reveal" aria-label="Cinema mode">
      <div class="nw-cinema">
        <div class="nw-cinema-copy">
          <span class="nw-section-eyebrow">Cinema Mode</span>
          <h2 class="nw-section-heading">Drop it on a TV. Watch the world.</h2>
          <p>Cinema is the same intelligence, choreographed for a wall — slow globe rotation, alert pills cycling,
            instability deltas ticking. Set it once. Forget the remote. The world keeps moving.</p>
          <a href="#/intel?cinema=1" class="nw-hero-cta" data-cta="cinema-preview">
            Try Cinema <span class="nw-hero-cta-arrow" aria-hidden="true">→</span>
          </a>
        </div>
        <div class="nw-cinema-stage" aria-hidden="true">
          <span class="nw-cinema-pill">CINEMA / LIVE</span>
          <div class="nw-cinema-bottombar">
            <span>EARTHQUAKE · 6.2 · LUZON</span>
            <span>CII · YE +3 · 84</span>
          </div>
        </div>
      </div>
    </section>

    <section class="nw-reveal" aria-label="Today's brief">
      <span class="nw-section-eyebrow">Today's Brief</span>
      <h2 class="nw-section-heading">A reading on the world, every morning.</h2>
      <article class="nw-brief-card" id="nw-brief-card">
        <div class="nw-brief-meta">
          <span id="nw-brief-date">${FALLBACK_BRIEF.date}</span>
          <span>NexusWatch · Daily Intelligence</span>
        </div>
        <h3 class="nw-brief-headline" id="nw-brief-headline">${FALLBACK_BRIEF.headline}</h3>
        <p class="nw-brief-excerpt" id="nw-brief-excerpt">${FALLBACK_BRIEF.excerpt}</p>
        <a href="#/briefs" class="nw-brief-link">Read the full brief <span aria-hidden="true">→</span></a>
      </article>
    </section>

    <section class="nw-reveal nw-whyfree-teaser" aria-label="Why free">
      <p class="nw-whyfree-teaser-quote">
        "The existing platforms are paywalled and unreadable. Free, forever-ish, no tiers."
      </p>
      <p class="nw-whyfree-teaser-attribution">
        — Ethan, operator
        <a href="#/why-free">Read the full case →</a>
      </p>
    </section>

    <section class="nw-reveal" aria-label="Newsletter">
      <span class="nw-section-eyebrow">Subscribe</span>
      <h2 class="nw-section-heading">Get the daily brief in your inbox. Free.</h2>
      <div class="nw-signup">
        <form class="nw-signup-form" id="nw-subscribe-form" novalidate>
          <label for="nw-subscribe-email" class="sr-only">Email address</label>
          <input
            type="email"
            id="nw-subscribe-email"
            name="email"
            class="nw-signup-input"
            placeholder="you@somewhere.com"
            autocomplete="email"
            required
          />
          <button type="submit" class="nw-signup-button">Subscribe</button>
        </form>
        <p class="nw-signup-status" id="nw-subscribe-status" role="status" aria-live="polite"></p>
      </div>
    </section>

    <section class="nw-reveal" aria-label="Sources and receipts">
      <span class="nw-section-eyebrow">Sources / Receipts</span>
      <h2 class="nw-section-heading">Public data. Public method.</h2>
      <p class="nw-section-lede">
        Everything on the map traces back to one of these. Open repo on GitHub; open API at <code>/api</code>.
      </p>
      <ul class="nw-trust-list">
        <li>USGS</li>
        <li>GDELT</li>
        <li>NASA FIRMS</li>
        <li>ACLED</li>
        <li>OpenSky</li>
        <li>OpenAQ</li>
        <li>GDACS</li>
        <li>WHO</li>
        <li>AIS / Marine Traffic</li>
        <li>Polymarket</li>
        <li>OFAC Sanctions</li>
        <li>OONI</li>
        <li>UNHCR</li>
        <li>Cloudflare Radar</li>
      </ul>
    </section>

    <footer class="nw-footer">
      <div class="nw-footer-top">
        <div class="nw-footer-brand"><span>●</span> NexusWatch</div>
        <div class="nw-footer-links">
          <a href="#/intel">Intel Map</a>
          <a href="#/briefs">Briefs</a>
          <a href="#/why-free">Why Free</a>
          <a href="#/about">About</a>
          <a href="#/api">API</a>
          <a href="https://github.com/ethancstuart/nexus-watch" target="_blank" rel="noopener">GitHub</a>
          <a href="/api/feed" rel="alternate" type="application/rss+xml">RSS</a>
        </div>
      </div>
      <div class="nw-footer-meta">
        © ${new Date().getFullYear()} NexusWatch · MIT License · Built in the open.
      </div>
    </footer>
  `;

  root.appendChild(main);

  // ── Hero globe — lazy MapLibre on desktop, static fallback on mobile ──
  const heroGlobe = main.querySelector<HTMLElement>('#nw-hero-globe');
  if (heroGlobe) {
    if (isNarrow) {
      // Mobile: paint a stylized dark globe. Skip MapLibre entirely.
      heroGlobe.classList.add('nw-hero-globe-static');
    } else {
      // Desktop: dynamic-import MapLibre + boot a decorative globe in the
      // background. The headline paints first; the globe arrives 50–500ms later.
      void bootDecorativeGlobe(heroGlobe, prefersReducedMotion);
    }
  }

  // ── Hero headline dim after 2s so globe stays legible ──
  const heroContent = main.querySelector<HTMLElement>('#nw-hero-content');
  if (heroContent && !prefersReducedMotion) {
    setTimeout(() => heroContent.classList.add('is-dim'), 2400);
  }

  // ── Scroll-reveal sections ──
  const reveals = main.querySelectorAll<HTMLElement>('.nw-reveal');
  if (prefersReducedMotion) {
    reveals.forEach((el) => el.classList.add('is-revealed'));
  } else if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-revealed'));
  }

  // ── Newsletter form ──
  const form = main.querySelector<HTMLFormElement>('#nw-subscribe-form');
  const statusEl = main.querySelector<HTMLElement>('#nw-subscribe-status');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>('input[type=email]');
    const email = input?.value.trim() ?? '';
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      if (statusEl) {
        statusEl.textContent = 'Enter a valid email.';
        statusEl.dataset.state = 'err';
      }
      return;
    }
    if (statusEl) {
      statusEl.textContent = 'Subscribing…';
      statusEl.dataset.state = '';
    }
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'landing-rebuild' }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (statusEl) {
        if (data.success) {
          statusEl.textContent = "You're in. First brief tomorrow.";
          statusEl.dataset.state = 'ok';
          form.reset();
          trackEvent('brief_signup', { source: 'landing-rebuild' });
        } else {
          statusEl.textContent = data.error || "That didn't work — try again.";
          statusEl.dataset.state = 'err';
        }
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = 'Network error. Try again.';
        statusEl.dataset.state = 'err';
      }
    }
  });

  // ── Sample brief — pull today's brief if available ──
  const briefHeadline = main.querySelector<HTMLElement>('#nw-brief-headline');
  const briefExcerpt = main.querySelector<HTMLElement>('#nw-brief-excerpt');
  const briefDate = main.querySelector<HTMLElement>('#nw-brief-date');
  if (briefHeadline && briefExcerpt) {
    fetch('/api/v1/brief')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BriefResponse | null) => {
        if (!data) return;
        if (data.headline) briefHeadline.textContent = data.headline;
        if (data.summary) {
          // Strip markdown/HTML to plain text and trim to ~340 chars
          const text = stripToPlain(data.summary).slice(0, 340);
          briefExcerpt.textContent = text + (data.summary.length > 340 ? '…' : '');
        }
        if (data.date && briefDate) briefDate.textContent = formatBriefDate(data.date);
      })
      .catch(() => {
        // Fallback copy already present.
      });
  }

  // ── Referral capture (preserve from previous landing) ──
  const refParam = new URLSearchParams(window.location.search).get('ref');
  if (refParam && /^[\w-]{1,128}$/.test(refParam)) {
    localStorage.setItem('nw-referral', refParam);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('ref');
    history.replaceState(null, '', cleanUrl.toString());
  }
}

// =============================================================================
// Helpers
// =============================================================================

function stripToPlain(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatBriefDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
  } catch {
    return iso;
  }
}

/**
 * Decorative MapLibre globe for the hero. Non-interactive, slowly auto-
 * rotating. Lazy-imports MapLibre so the marketing surface doesn't pay
 * 1MB of map bundle until after first paint. Falls back silently to the
 * static globe styling on any error.
 */
async function bootDecorativeGlobe(container: HTMLElement, reducedMotion: boolean): Promise<void> {
  // Tag with the static fallback first so if MapLibre fails or is slow,
  // the user always sees the dark globe stylization.
  container.classList.add('nw-hero-globe-static');

  try {
    const maplibreMod = await import('maplibre-gl');
    const maplibregl = maplibreMod.default;

    // Inject MapLibre CSS — same pattern as MapView.
    if (!document.querySelector('link[data-nw-maplibre-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.css';
      link.crossOrigin = 'anonymous';
      link.dataset.nwMaplibreCss = '1';
      document.head.appendChild(link);
    }

    const map = new maplibregl.Map({
      container,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [10, 25],
      zoom: 1.6,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      interactive: false,
      maxZoom: 4,
      minZoom: 1.2,
      fadeDuration: 600,
    });

    // Once the style loads, switch to globe projection + atmosphere.
    map.on('style.load', () => {
      try {
        map.setProjection({ type: 'globe' } as maplibregl.ProjectionSpecification);
      } catch {
        // mercator fallback is fine
      }
      try {
        (map as unknown as { setFog: (opts: Record<string, unknown>) => void }).setFog({
          color: 'rgba(0, 0, 0, 1)',
          'high-color': 'rgba(20, 10, 5, 1)',
          'horizon-blend': 0.12,
          'space-color': 'rgba(0, 0, 0, 1)',
          'star-intensity': 0.55,
        });
      } catch {
        // fog not supported
      }
      // Now that real tiles are coming in, peel back the static painting.
      container.classList.remove('nw-hero-globe-static');
    });

    // Slow ambient rotation, gated on reduced motion.
    if (!reducedMotion) {
      const speed = 0.04; // degrees per frame ≈ 0.05 deg/sec at 60fps roughly
      let rafId: number | null = null;
      const tick = () => {
        const c = map.getCenter();
        map.setCenter([c.lng + speed * 0.04, c.lat]);
        rafId = requestAnimationFrame(tick);
      };
      map.on('load', () => {
        rafId = requestAnimationFrame(tick);
      });
      // Pause on hidden tab to be neighborly.
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        } else if (!document.hidden && !rafId) {
          rafId = requestAnimationFrame(tick);
        }
      });
    }
  } catch (err) {
    // Map failed — the static fallback class is still on the container.
    console.warn('Hero globe failed to boot, using static fallback', err);
  }
}
