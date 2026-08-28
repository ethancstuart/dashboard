import { describe, it, expect } from 'vitest';
import { escalate, countByStatus, overallHealthOf, type Health } from './status-health.js';

const r = (status: Health) => ({ status });

describe('escalate', () => {
  it('is ok only when nothing is down or degraded', () => {
    expect(escalate({ downCount: 0, degradedCount: 0 })).toBe('ok');
  });

  it('ANY single down endpoint escalates to at least degraded', () => {
    // This is the regression. The old rule required THREE.
    expect(escalate({ downCount: 1, degradedCount: 0 })).toBe('degraded');
  });

  it('two or more down endpoints escalate to down', () => {
    expect(escalate({ downCount: 2, degradedCount: 0 })).toBe('down');
    expect(escalate({ downCount: 3, degradedCount: 0 })).toBe('down');
    expect(escalate({ downCount: 9, degradedCount: 0 })).toBe('down');
  });

  it('any degraded endpoint escalates to degraded', () => {
    expect(escalate({ downCount: 0, degradedCount: 1 })).toBe('degraded');
    expect(escalate({ downCount: 0, degradedCount: 2 })).toBe('degraded');
  });

  it('down dominates degraded', () => {
    expect(escalate({ downCount: 2, degradedCount: 5 })).toBe('down');
    expect(escalate({ downCount: 1, degradedCount: 5 })).toBe('degraded');
  });

  it('never returns ok when anything at all is unhealthy', () => {
    // Exhaustive over a realistic fleet size — the property, not a sample.
    for (let down = 0; down <= 9; down++) {
      for (let degraded = 0; degraded + down <= 9; degraded++) {
        const verdict = escalate({ downCount: down, degradedCount: degraded });
        if (down + degraded > 0) expect(verdict).not.toBe('ok');
        else expect(verdict).toBe('ok');
      }
    }
  });
});

describe('the production payload that reported ok through a live outage', () => {
  // Verbatim statuses from https://nexuswatch.dev/api/status at
  // 2026-08-28T15:22:47.662Z, which reported overallHealth "ok".
  const readings = [
    r('down'), // /api/cii            (core)
    r('ok'), // /api/briefs
    r('ok'), // /api/news-feed
    r('ok'), // /api/webcam-catalog
    r('ok'), // /api/aurora
    r('ok'), // /api/energy
    r('ok'), // /api/trade-flows
    r('ok'), // /api/reliefweb
    r('down'), // /api/briefs-sample  (derived)
  ];

  it('counts the two down endpoints', () => {
    expect(countByStatus(readings)).toEqual({ downCount: 2, degradedCount: 0 });
  });

  it('now reports down, not ok', () => {
    expect(overallHealthOf(readings)).toBe('down');
  });
});
