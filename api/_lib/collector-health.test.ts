import { describe, it, expect } from 'vitest';
import {
  extractInsertTargets,
  collectorPaths,
  assessCollectors,
  unhealthyCollectors,
  formatCollectorReport,
} from './collector-health.js';

describe('extractInsertTargets', () => {
  it('finds the table a collector writes to', () => {
    expect(extractInsertTargets('await sql`INSERT INTO vdem_indicators (a) VALUES (1)`')).toEqual(['vdem_indicators']);
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(extractInsertTargets('insert   into\n  Sanctions_Events (x)')).toEqual(['sanctions_events']);
  });

  it('finds several distinct tables without duplicating', () => {
    const src = 'INSERT INTO a (x) ... INSERT INTO b (y) ... INSERT INTO a (z)';
    expect(extractInsertTargets(src)).toEqual(['a', 'b']);
  });

  it('IGNORES a table named only in a comment', () => {
    // The trap: a file that documents "INSERT INTO foo" in its header would
    // otherwise be credited with writing to foo.
    expect(extractInsertTargets('// INSERT INTO ghost_table\nconst x = 1;')).toEqual([]);
    expect(extractInsertTargets('/* INSERT INTO ghost_table */\nconst x = 1;')).toEqual([]);
  });

  it('still finds a real insert in a file that also mentions one in a comment', () => {
    const src = '/* writes INSERT INTO documented_table */\nawait sql`INSERT INTO real_table (a)`';
    expect(extractInsertTargets(src)).toEqual(['real_table']);
  });

  it('returns empty for a collector that inserts nothing', () => {
    expect(extractInsertTargets('export default async function handler() { return; }')).toEqual([]);
  });
});

describe('collectorPaths — derived from the cron list, not a maintained list', () => {
  it('selects source-* crons and nothing else', () => {
    const paths = [
      '/api/cron/source-vdem',
      '/api/cron/source-fred-yields',
      '/api/cron/daily-brief',
      '/api/cron/record-calls',
      '/api/cron/marketing-x',
    ];
    expect(collectorPaths(paths)).toEqual(['/api/cron/source-vdem', '/api/cron/source-fred-yields']);
  });

  it('picks up a collector added later with no code change here', () => {
    expect(collectorPaths(['/api/cron/source-brand-new-feed'])).toEqual(['/api/cron/source-brand-new-feed']);
  });
});

describe('assessCollectors', () => {
  it('flags a scheduled collector with zero rows', () => {
    const [s] = assessCollectors([{ name: 'source-vdem', table: 'vdem_indicators', rowCount: 0, ageDays: null }]);
    expect(s.problem).toBe('empty');
  });

  it('flags a collector whose newest row is older than the threshold', () => {
    const [s] = assessCollectors([{ name: 'source-x', table: 't', rowCount: 100, ageDays: 90 }]);
    expect(s.problem).toBe('stale');
  });

  it('does not flag a monthly collector that ran recently enough', () => {
    const [s] = assessCollectors([{ name: 'source-x', table: 't', rowCount: 100, ageDays: 31 }]);
    expect(s.problem).toBeNull();
  });

  it('flags a scheduled collector that writes to nothing at all', () => {
    const [s] = assessCollectors([{ name: 'source-ghost', table: null, rowCount: 0, ageDays: null }]);
    expect(s.problem).toBe('no_insert_target');
  });

  it('does not flag a healthy collector with no timestamp column', () => {
    const [s] = assessCollectors([{ name: 'source-x', table: 't', rowCount: 5, ageDays: null }]);
    expect(s.problem).toBeNull();
  });
});

describe('unhealthyCollectors', () => {
  it('returns nothing when everything is producing', () => {
    const ok = assessCollectors([{ name: 'a', table: 't', rowCount: 10, ageDays: 1 }]);
    expect(unhealthyCollectors(ok)).toEqual([]);
  });

  it('ranks a missing insert target above an empty table above a stale one', () => {
    const statuses = assessCollectors([
      { name: 'stale', table: 't', rowCount: 5, ageDays: 99 },
      { name: 'empty', table: 't', rowCount: 0, ageDays: null },
      { name: 'ghost', table: null, rowCount: 0, ageDays: null },
    ]);
    expect(unhealthyCollectors(statuses).map((s) => s.name)).toEqual(['ghost', 'empty', 'stale']);
  });
});

describe('formatCollectorReport', () => {
  it('says so plainly when everything is healthy', () => {
    expect(formatCollectorReport([])).toBe('All scheduled collectors are producing rows.');
  });

  it('names the collector, its table and the failure', () => {
    const bad = unhealthyCollectors(
      assessCollectors([{ name: 'source-vdem', table: 'vdem_indicators', rowCount: 0, ageDays: null }]),
    );
    const report = formatCollectorReport(bad);
    expect(report).toContain('source-vdem');
    expect(report).toContain('vdem_indicators');
    expect(report).toContain('ZERO rows');
  });
});
