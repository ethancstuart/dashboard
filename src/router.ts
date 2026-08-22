type RouteHandler = (params?: Record<string, string>) => void | Promise<void>;

/**
 * Path-first SPA router.
 *
 * WHY PATH-FIRST. This router used to take every clean URL and convert it into
 * a hash on first paint:
 *
 *     window.history.replaceState(null, '', '/#' + path)
 *
 * `vercel.json` already rewrites ~30 clean paths to index.html, and
 * `src/utils/seo.ts` already writes a correct per-route canonical — but that one
 * line meant every route in the app resolved to a fragment, and a fragment is
 * not an indexable address. Paired with the static homepage canonical that used
 * to sit in index.html, every page on the site looked to a crawler like the same
 * page. That is why nexuswatch.dev did not appear in search for its own name.
 *
 * WHY THE HASH STILL WORKS. ~194 in-app links and a handful of
 * `location.hash = …` assignments still speak hash. Rather than rewrite all of
 * them — 194 chances to break navigation — an inbound hash is BRIDGED to a clean
 * path. No link had to change, and the address bar only ever ends up clean.
 *
 * QUERY STRINGS. `resolve()` used to match the raw fragment against the route
 * table, so `#/intel?cinema=1` matched nothing and fell through to the 404
 * handler — the landing page's "Try Cinema" CTA and every `?country=` deep link
 * rendered a 404. The query is now stripped before matching and preserved in the
 * URL, so `readRouteParams()` below can still read it.
 */
export class Router {
  private routes = new Map<string, RouteHandler>();
  private paramRoutes: { pattern: RegExp; keys: string[]; handler: RouteHandler }[] = [];
  private fallback: RouteHandler | null = null;
  private currentPath = '';

  on(path: string, handler: RouteHandler): Router {
    // Check for parameterized route
    if (path.includes(':')) {
      const keys: string[] = [];
      const pattern = path.replace(/:(\w+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      });
      this.paramRoutes.push({ pattern: new RegExp(`^${pattern}$`), keys, handler });
    } else {
      this.routes.set(path, handler);
    }
    return this;
  }

  otherwise(handler: RouteHandler): Router {
    this.fallback = handler;
    return this;
  }

  /** Navigate to a clean path, pushing a real history entry. */
  navigate(path: string): void {
    const target = path.startsWith('/') ? path : `/${path}`;
    if (target === window.location.pathname + window.location.search) return;
    window.history.pushState(null, '', target);
    this.resolve();
  }

  start(): void {
    this.normalizeHash();

    // Legacy in-app links assign `location.hash`. Bridge each one onto a clean
    // path so the URL a user copies — or a crawler follows — is never a fragment.
    window.addEventListener('hashchange', () => {
      this.normalizeHash();
      this.resolve();
    });

    // Back/forward now move through real history entries.
    window.addEventListener('popstate', () => this.resolve());

    this.resolve();
  }

  /**
   * Rewrite `/#/intel?country=UA` to `/intel?country=UA` in place.
   *
   * `replaceState` fires neither `hashchange` nor `popstate`, so this cannot
   * re-enter the listener that calls it.
   */
  private normalizeHash(): void {
    const hash = window.location.hash;
    if (!hash.startsWith('#/')) return;
    window.history.replaceState(null, '', hash.slice(1));
  }

  /** The route key to match on: no query, no trailing slash. */
  private locationPath(): string {
    // A hash can be present for the instant between a legacy link firing and
    // normalizeHash running. Prefer it so we never resolve the stale path.
    const raw = window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : window.location.pathname;
    const path = raw.split('?')[0].replace(/\/+$/, '');
    return path === '' ? '/' : path;
  }

  private resolve(): void {
    const path = this.locationPath();
    if (path === this.currentPath) return;
    this.currentPath = path;

    // Exact match first
    const handler = this.routes.get(path);
    if (handler) {
      void handler();
      return;
    }

    // Parameterized routes
    for (const route of this.paramRoutes) {
      const match = path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => {
          params[key] = match[i + 1];
        });
        void route.handler(params);
        return;
      }
    }

    if (this.fallback) {
      void this.fallback();
    }
  }
}

/**
 * Read route query parameters regardless of which URL shape they arrived in.
 *
 * During the hash→path migration a parameter may live in `?a=1` (a clean URL,
 * and what every URL becomes once `normalizeHash` has run) or in `#/x?a=1` (a
 * legacy link, for the instant before it is bridged). A caller that reads only
 * one silently loses deep links, so everything reads through here.
 */
export function readRouteParams(): URLSearchParams {
  const fromSearch = window.location.search.slice(1);
  const fromHash = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(fromSearch || fromHash);
}
