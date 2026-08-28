import { describe, it, expect } from 'vitest';
import { assessLedgerTruth, daysOverdue, GRACE_DAYS, type PendingCall } from './ledger-truth.js';

const call = (id: number, resolves_on: string, extra: Partial<PendingCall> = {}): PendingCall => ({
  id,
  kind: 'fx_devaluation',
  country_code: 'TR',
  made_on: '2026-07-01',
  resolves_on,
  ...extra,
});

describe('daysOverdue', () => {
  const today = new Date('2026-08-28T10:15:00Z');

  it('is 0 on the resolution date itself', () => {
    expect(daysOverdue('2026-08-28', today)).toBe(0);
  });

  it('counts whole days past the resolution date', () => {
    expect(daysOverdue('2026-08-27', today)).toBe(1);
    expect(daysOverdue('2026-08-21', today)).toBe(7);
    expect(daysOverdue('2026-07-29', today)).toBe(30);
  });

  it('is negative for a call not yet due', () => {
    expect(daysOverdue('2026-08-30', today)).toBe(-2);
  });

  it('does not shift with the time of day — any hour gives the same answer', () => {
    // The trap AGENTS.md records: a date test written at one hour that agrees
    // only with that hour. Sweep the clock.
    for (let h = 0; h < 24; h++) {
      const at = new Date(Date.UTC(2026, 7, 28, h, 30, 0));
      expect(daysOverdue('2026-08-21', at)).toBe(7);
    }
  });

  it('is correct across a month boundary and a leap day', () => {
    expect(daysOverdue('2026-02-28', new Date('2026-03-01T00:00:00Z'))).toBe(1);
    expect(daysOverdue('2024-02-28', new Date('2024-03-01T00:00:00Z'))).toBe(2); // 2024 is a leap year
  });
});

describe('assessLedgerTruth', () => {
  const today = new Date('2026-08-28T10:15:00Z');

  it('an empty pending set is a truthful ledger', () => {
    const v = assessLedgerTruth([], today);
    expect(v.ok).toBe(true);
    expect(v.staleCount).toBe(0);
    expect(v.lines).toEqual([]);
  });

  it('a single overdue pending call raises the alert', () => {
    const v = assessLedgerTruth([call(1005, '2026-08-20')], today);
    expect(v.ok).toBe(false);
    expect(v.staleCount).toBe(1);
    expect(v.lines.join('\n')).toContain('#1005');
    expect(v.lines.join('\n')).toContain('8 day(s) overdue');
  });

  it('reports the OLDEST offender first', () => {
    const v = assessLedgerTruth([call(2, '2026-08-25'), call(1, '2026-07-01'), call(3, '2026-08-10')], today);
    expect(v.sample.map((c) => c.id)).toEqual([1, 3, 2]);
    expect(v.lines[0]).toContain('58 day(s) overdue');
  });

  it('truncates the sample but never the count', () => {
    const many = Array.from({ length: 50 }, (_, i) => call(i + 1, '2026-08-01'));
    const v = assessLedgerTruth(many, today, 20);
    expect(v.staleCount).toBe(50);
    expect(v.sample).toHaveLength(20);
    expect(v.lines.join('\n')).toContain('and 30 more');
  });

  it('does not mutate the caller array', () => {
    const rows = [call(2, '2026-08-25'), call(1, '2026-07-01')];
    assessLedgerTruth(rows, today);
    expect(rows.map((c) => c.id)).toEqual([2, 1]);
  });

  it('GRACE_DAYS is one day, matching the SQL predicate', () => {
    // The handler interpolates GRACE_DAYS into `resolves_on < CURRENT_DATE - $1`.
    // If this constant changes, the SQL changes with it — that is the point of
    // sharing it rather than writing `1` in two places.
    expect(GRACE_DAYS).toBe(1);
  });
});
