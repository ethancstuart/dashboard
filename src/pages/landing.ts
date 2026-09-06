import '../styles/landing-register.css';
import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';
import { pageShell, capture, sectionRule } from '../ui/kit/index.ts';
import { installSurfaces } from '../ui/kit/surfaces.ts';

/**
 * The landing page, rebuilt register-first (redesign B3, 2026-09-06).
 *
 * What it replaced: 577 lines of platform-era marketing — a decorative
 * MapLibre globe (the dependency's last consumer; it leaves package.json
 * with this file), a Cinema teaser for a deleted surface, a feature grid for
 * layers that no longer exist, and a second subscribe form the kit's
 * capture() was built to retire.
 *
 * Copy comes from docs/copy/landing-narrative.md. The branch preview IS the
 * sign-off surface for these words — nothing here reaches production until
 * the owner has read the page itself.
 *
 * The one rule about numbers: every figure is FETCHED from the ledger at
 * view time. A number typed into this file would be true today and a lie by
 * Friday (the seed-data ruling: true-at-write-time is a bug with a delay
 * fuse). No fallback constants either — if the fetch fails, the strip shows
 * an em-dash, because a stale number dressed as live is worse than a dash.
 */
export function renderLanding(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.landing);
  installSurfaces();
  const main = pageShell(root, { active: '/' });

  // --- Hero -----------------------------------------------------------
  const hero = createElement('section', { className: 'lr-hero' });
  hero.appendChild(
    createElement('div', { className: 'lr-kicker', textContent: 'NEXUSWATCH — A PUBLIC REGISTER OF FORECASTS' }),
  );

  const headline = createElement('h1', { className: 'lr-headline' });
  // Kinetic type: one span per word, stagger driven by --i and the motion
  // tokens. Reading order is untouched; reduced-motion renders it static.
  const words = 'We say what we think will happen. Something that isn’t us decides if we were right.'.split(' ');
  words.forEach((w, i) => {
    const span = createElement('span', { className: 'lr-word', textContent: w });
    span.style.setProperty('--i', String(i));
    headline.appendChild(span);
    headline.appendChild(document.createTextNode(' '));
  });
  hero.appendChild(headline);

  hero.appendChild(
    createElement('p', {
      className: 'lr-sub',
      textContent:
        'Dated, falsifiable calls on censorship and currency moves — each resolved against an external source, on a date fixed before the outcome existed. Rules published first. Misses kept forever.',
    }),
  );

  const strip = createElement('div', { className: 'lr-strip' });
  strip.setAttribute('aria-label', 'The book, live');
  hero.appendChild(strip);

  const ctas = createElement('div', { className: 'lr-ctas' });
  const primary = createElement('a', { className: 'lr-cta-primary', textContent: 'Read the Ledger →' });
  (primary as HTMLAnchorElement).href = '/ledger';
  ctas.appendChild(primary);
  hero.appendChild(ctas);
  main.appendChild(hero);

  // --- How it works ---------------------------------------------------
  main.appendChild(sectionRule({ kicker: 'HOW IT WORKS', title: 'Three moves, none of them ours to fudge' }));
  const beats = createElement('div', { className: 'lr-beats' });
  const BEATS: Array<[string, string]> = [
    [
      'We state a claim.',
      'A probability, a country, a threshold, a date. Written to the book before the window opens; never edited after.',
    ],
    [
      'The world answers.',
      'OONI’s measurements or the FX reference rate — sources we don’t control — settle every call on schedule, unattended.',
    ],
    [
      'The score publishes either way.',
      'Brier per kind; skill only when three independent batches exist. A withheld number states its reason. The misses stay on the page.',
    ],
  ];
  BEATS.forEach(([t, b], i) => {
    const beat = createElement('div', { className: 'lr-beat lr-reveal' });
    beat.style.setProperty('--i', String(i));
    beat.appendChild(createElement('div', { className: 'lr-beat-n', textContent: String(i + 1).padStart(2, '0') }));
    beat.appendChild(createElement('h3', { className: 'lr-beat-t', textContent: t }));
    beat.appendChild(createElement('p', { className: 'lr-beat-b', textContent: b }));
    beats.appendChild(beat);
  });
  main.appendChild(beats);

  // --- The honest bit -------------------------------------------------
  const quote = createElement('blockquote', { className: 'lr-quote lr-reveal' });
  quote.appendChild(
    createElement('p', {
      textContent:
        'Our first cohort settled on 5 September 2026: ten hits, twenty-four misses, five held for thin evidence — and the sharpest finding was about our own instrument. We published that, too.',
    }),
  );
  const qLink = createElement('a', { className: 'lr-quote-link', textContent: 'See the record →' });
  (qLink as HTMLAnchorElement).href = '/ledger';
  quote.appendChild(qLink);
  main.appendChild(quote);

  // --- The brief ------------------------------------------------------
  main.appendChild(sectionRule({ kicker: 'THE DAILY BRIEF', title: 'The record first, then the board' }));
  const briefP = createElement('p', {
    className: 'lr-brief-p lr-reveal',
    textContent:
      'One email a day. Written by a model, gated by rules that refuse ungrounded numbers — with a deterministic edition when the draft doesn’t clear the gate, and it says so.',
  });
  main.appendChild(briefP);
  main.appendChild(
    capture({ source: 'landing-register', note: 'Free. Unsubscribe is one click, and the link works.' }),
  );

  // --- Live numbers ---------------------------------------------------
  void hydrateStrip(strip);

  // --- Scroll reveals -------------------------------------------------
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          (e.target as HTMLElement).classList.add('is-in');
          observer.unobserve(e.target);
        }
      }
    },
    { threshold: 0.2 },
  );
  main.querySelectorAll('.lr-reveal').forEach((n) => observer.observe(n));
}

/** The live strip: open / settled / hit, ticked up from zero on first view. */
async function hydrateStrip(strip: HTMLElement): Promise<void> {
  const cell = (label: string): HTMLElement => {
    const c = createElement('div', { className: 'lr-strip-cell' });
    const v = createElement('span', { className: 'lr-strip-value', textContent: '—' });
    c.appendChild(v);
    c.appendChild(createElement('span', { className: 'lr-strip-label', textContent: label }));
    strip.appendChild(c);
    return v;
  };
  const openEl = cell('CALLS OPEN');
  const settledEl = cell('SETTLED');
  const hitEl = cell('HIT');

  try {
    const res = await fetch('/api/calls/ledger');
    if (!res.ok) return;
    const j = (await res.json()) as { counts?: { open?: number; resolved?: number; hits?: number } };
    const c = j.counts;
    if (!c) return;
    tick(openEl, c.open ?? 0);
    tick(settledEl, c.resolved ?? 0);
    tick(hitEl, c.hits ?? 0);
  } catch {
    // The dash stays. A stale number dressed as live is worse than a dash.
  }
}

/** Count up to `target` over --motion-slow; instant under reduced motion. */
function tick(el: HTMLElement, target: number): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced
    ? 0
    : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-slow')) || 480;
  if (duration <= 0) {
    el.textContent = String(target);
    return;
  }
  const t0 = performance.now();
  const frame = (t: number) => {
    const p = Math.min(1, (t - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = String(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
