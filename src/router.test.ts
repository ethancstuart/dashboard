import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Router, readRouteParams } from './router.ts';

/** Point the test document at a URL, the way a real navigation would. */
function goto(url: string): void {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  goto('/');
});

describe('Router — path resolution', () => {
  it('resolves an exact path route', () => {
    const hit = vi.fn();
    goto('/intel');
    new Router().on('/intel', hit).start();
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('resolves the root', () => {
    const hit = vi.fn();
    goto('/');
    new Router().on('/', hit).start();
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('resolves a parameterized route and passes params', () => {
    const hit = vi.fn();
    goto('/brief/2026-08-22');
    new Router().on('/brief/:date', hit).start();
    expect(hit).toHaveBeenCalledWith({ date: '2026-08-22' });
  });

  it('falls back for an unknown path', () => {
    const notFound = vi.fn();
    goto('/nope');
    new Router().on('/intel', vi.fn()).otherwise(notFound).start();
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('ignores a trailing slash', () => {
    const hit = vi.fn();
    goto('/briefs/');
    new Router().on('/briefs', hit).start();
    expect(hit).toHaveBeenCalledTimes(1);
  });
});

describe('Router — routes carrying a query string', () => {
  // NOTE ON WHAT THESE PROVE. The production 404 came from resolve() matching
  // `location.hash.slice(1)`, which INCLUDES the query — so '#/intel?cinema=1'
  // matched no route and fell through to show404 (the landing page's "Try
  // Cinema" CTA, and every ?country= deep link). The regression test for that
  // is 'resolves a legacy hash URL carrying a query' in the block below, and it
  // was confirmed to fail when hash normalization is disabled.
  //
  // The cases here exercise the PATH branch, where the query lives in
  // location.search and never appears in location.pathname. They are worth
  // keeping as a statement of intent, but they do not by themselves prove the
  // query-stripping in locationPath(): planting that removal leaves them green.
  it('matches the route when a query string is present', () => {
    const intel = vi.fn();
    const notFound = vi.fn();
    goto('/intel?cinema=1');
    new Router().on('/intel', intel).otherwise(notFound).start();
    expect(intel).toHaveBeenCalledTimes(1);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('matches a parameterized route carrying a query', () => {
    const hit = vi.fn();
    goto('/brief/2026-08-22?utm_source=x');
    new Router().on('/brief/:date', hit).start();
    expect(hit).toHaveBeenCalledWith({ date: '2026-08-22' });
  });

  it('preserves the query in the URL after resolving', () => {
    goto('/intel?country=UA');
    new Router().on('/intel', vi.fn()).start();
    expect(window.location.search).toBe('?country=UA');
  });
});

describe('Router — legacy hash URLs', () => {
  it('normalizes /#/intel to /intel', () => {
    const hit = vi.fn();
    goto('/#/intel');
    new Router().on('/intel', hit).start();
    expect(window.location.pathname).toBe('/intel');
    expect(window.location.hash).toBe('');
    expect(hit).toHaveBeenCalledTimes(1);
  });

  // THE REGRESSION TEST for the production 404. Before path routing, resolve()
  // matched 'location.hash.slice(1)' — i.e. '/intel?country=UA' including the
  // query — against a route table registered as '/intel', matched nothing, and
  // rendered show404. Confirmed to fail when hash normalization is disabled.
  it('resolves a legacy hash URL carrying a query, instead of 404ing', () => {
    const intel = vi.fn();
    const notFound = vi.fn();
    goto('/#/intel?country=UA');
    new Router().on('/intel', intel).otherwise(notFound).start();
    expect(intel).toHaveBeenCalledTimes(1);
    expect(notFound).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/intel');
    expect(window.location.search).toBe('?country=UA');
    expect(window.location.hash).toBe('');
  });

  it('leaves a non-route hash alone', () => {
    goto('/about#section');
    const hit = vi.fn();
    new Router().on('/about', hit).start();
    expect(window.location.pathname).toBe('/about');
    expect(hit).toHaveBeenCalledTimes(1);
  });
});

describe('Router — navigate', () => {
  it('pushes a clean path and resolves it', () => {
    const intel = vi.fn();
    goto('/');
    const r = new Router().on('/', vi.fn()).on('/intel', intel);
    r.start();
    r.navigate('/intel');
    expect(window.location.pathname).toBe('/intel');
    expect(window.location.hash).toBe('');
    expect(intel).toHaveBeenCalledTimes(1);
  });

  it('does not push a duplicate entry for the current path', () => {
    goto('/intel');
    const r = new Router().on('/intel', vi.fn());
    r.start();
    const spy = vi.spyOn(window.history, 'pushState');
    r.navigate('/intel');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('readRouteParams', () => {
  it('reads a clean query string', () => {
    goto('/intel?country=UA&t=1');
    const p = readRouteParams();
    expect(p.get('country')).toBe('UA');
    expect(p.get('t')).toBe('1');
  });

  it('falls back to a legacy hash query', () => {
    goto('/#/intel?country=FR');
    const p = readRouteParams();
    expect(p.get('country')).toBe('FR');
  });

  it('returns empty when there are no params', () => {
    goto('/intel');
    expect([...readRouteParams().keys()]).toEqual([]);
  });
});
