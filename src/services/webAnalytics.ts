/**
 * Vercel Web Analytics — aggregate traffic for nexuswatch.dev.
 *
 * NOT to be confused with `src/services/analytics.ts`, which is the
 * local-only, per-browser event log shown in Settings. That one can never
 * answer "how many people visited the site", because it never leaves the
 * device. This one can.
 *
 * TWO THINGS THAT MAKE THIS NON-TRIVIAL HERE:
 *
 * 1. `inject()` on a non-framework app has NO route support — Vercel's own
 *    docs say so. It fires exactly one pageview, on load. This app is a
 *    hash router (`#/intel`, `#/country/US`), and a hash change is not a
 *    history navigation, so without the listener below every session would
 *    collapse to a single pageview and per-route traffic would be a flat
 *    line at zero. We report route changes ourselves.
 *
 * 2. Routes are reported as PATTERNS, not concrete paths — `/country/[code]`
 *    rather than `/country/US` — so the dashboard groups them. The pattern
 *    is DERIVED from the shape of each segment, not matched against a list
 *    of known routes: a route added tomorrow is normalised correctly without
 *    anyone remembering to update this file.
 *
 * CSP: production and preview load `/_vercel/insights/script.js` from our
 * own origin, so the existing `script-src 'self'` covers it and vercel.json
 * needs no change. Only `isDevelopment()` loads from va.vercel-scripts.com,
 * where no CSP header is served. Verified against the package source, not
 * assumed.
 */
import { inject, pageview } from '@vercel/analytics';

/** Query params that must never reach the analytics beacon. */
const REDACTED_PARAMS = ['token', 'key', 'secret', 'email', 'session'];

/**
 * Segment shapes that are values rather than route structure.
 * Order matters only for readability — the first match wins.
 */
const PARAM_SHAPES: ReadonlyArray<{ re: RegExp; name: string }> = [
  { re: /^\d{4}-\d{2}-\d{2}$/, name: 'date' },
  { re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, name: 'id' },
  { re: /^\d+$/, name: 'id' },
  { re: /^[A-Z]{2,3}$/, name: 'code' },
  { re: /^[0-9a-f]{16,}$/i, name: 'id' },
];

/**
 * Turn a concrete hash path into a route pattern.
 * `/country/US` → `/country/[code]`, `/briefs/2026-08-22` → `/briefs/[date]`.
 */
export function computeHashRoute(path: string): string {
  const segments = path.split('/');
  return segments
    .map((seg) => {
      if (!seg) return seg;
      const shape = PARAM_SHAPES.find((s) => s.re.test(seg));
      return shape ? `[${shape.name}]` : seg;
    })
    .join('/');
}

/** The current hash, normalised to a leading-slash path with no query. */
export function currentHashPath(hash: string): string {
  const raw = (hash || '#/').replace(/^#/, '');
  const path = raw.split('?')[0] || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const p of REDACTED_PARAMS) url.searchParams.delete(p);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

let lastReported: string | null = null;

/** Report a pageview if — and only if — the route actually changed. */
function reportCurrent(): void {
  const path = currentHashPath(window.location.hash);
  if (path === lastReported) return;
  lastReported = path;
  pageview({ route: computeHashRoute(path), path });
}

/**
 * Install Vercel Web Analytics. Safe to call once, from the entry point.
 *
 * NOTE: this ships the client half only. Nothing is recorded until Web
 * Analytics is enabled for the project in the Vercel dashboard — until then
 * the script 404s and the beacons go nowhere, silently.
 */
export function initWebAnalytics(): void {
  inject({
    beforeSend: (event) => ({ ...event, url: redactUrl(event.url) }),
  });

  reportCurrent();
  window.addEventListener('hashchange', reportCurrent);
}

/** Test seam — resets the dedupe so specs are order-independent. */
export function _resetWebAnalyticsForTests(): void {
  lastReported = null;
}
