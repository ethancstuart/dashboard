import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './docs.js';

const V1 = dirname(fileURLToPath(import.meta.url));

function payload(): Record<string, any> {
  let body: any;
  const res: any = {
    setHeader() {},
    json(b: unknown) {
      body = b;
      return this;
    },
  };
  handler({} as never, res);
  return body;
}

/**
 * THE PUBLIC API DOCS MUST NOT DESCRIBE THINGS THAT DO NOT EXIST.
 *
 * Until 2026-08-30 this endpoint published four claims, none of them true:
 * a $99/month tier, a $249/month tier, a per-tier rate limit on all twelve
 * endpoints, and Bearer-token authentication. Stripe was in test mode, the
 * api_keys table was empty, no v1 handler called rateLimit() or read an
 * Authorization header, and 15 requests in a few seconds returned 15x200.
 *
 * Rule 6: when a claim can only be met by inventing something, the honest
 * output is the gap. These assertions keep it that way.
 *
 * THE RATE-LIMIT CHECK IS DERIVED, not a list. It reads the endpoints out of
 * the published payload and looks for enforcement in the handler each one
 * names, so a NEW endpoint that advertises a limit it does not enforce fails
 * by default rather than passing because nobody added it here.
 */
describe('the published API docs describe only what exists', () => {
  it('advertises no price', () => {
    // Serialised, so a price nested anywhere in the payload is caught.
    const json = JSON.stringify(payload());
    expect(json).not.toMatch(/\$\s?\d/);
    expect(json).not.toMatch(/\d+\s*\/\s*month/i);
  });

  it('advertises no purchasable tier while none can be purchased', () => {
    const p = payload();
    expect(p.tiers).toBeNull();
  });

  it('does not claim an authentication scheme no handler implements', () => {
    const json = JSON.stringify(payload());
    expect(json).not.toMatch(/Bearer/i);
    expect(payload().access?.authentication).toBe('none');
  });

  it('only advertises a rate limit for an endpoint that enforces one', () => {
    const p = payload();
    const offenders: string[] = [];

    for (const [route, spec] of Object.entries<any>(p.endpoints ?? {})) {
      const claim = spec?.rateLimit;
      if (!claim) continue;

      // 'GET /api/v1/cii' -> api/v1/cii.ts
      const name = route.split(/\s+/).pop()?.replace('/api/v1/', '');
      const file = join(V1, `${name}.ts`);
      if (!existsSync(file)) {
        offenders.push(`${route} — advertises "${claim}" and its handler could not be found`);
        continue;
      }
      // Strip comments: this file documents the very claims it forbids, and a
      // guard that reads its own prose as code is a guard that fires on itself.
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      if (!/\brateLimit\s*\(/.test(src)) {
        offenders.push(`${route} — advertises "${claim}" but ${name}.ts never calls rateLimit()`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('still documents the endpoints — this is not an empty file passing vacuously', () => {
    // Every assertion above is satisfied by a payload with no endpoints at
    // all. Without this, deleting the docs would turn the suite green.
    expect(Object.keys(payload().endpoints ?? {}).length).toBeGreaterThan(5);
  });
});
