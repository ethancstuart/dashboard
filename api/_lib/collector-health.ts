/**
 * Collector health — notices when a scheduled ingest job stops producing rows.
 *
 * WHY. `delivery-health.ts` watches the channels we PUBLISH through, and it
 * exists because beehiiv failed for 34 consecutive days with the failures
 * faithfully recorded and faithfully ignored. Nothing watched the other end.
 * Audited 2026-08-22, four of the twelve scheduled `source-*` collectors are
 * failing, as reported by this module's own derived mapping:
 *
 *   source-vdem        -> vdem_indicators      0 rows  (monthly, since 2026-04)
 *   source-copernicus  -> copernicus_damage    0 rows
 *   source-fred-yields -> sovereign_yields     0 rows
 *   source-unhcr       -> refugee_populations  945 rows, newest 68 days old
 *
 * All scheduled. All running. All silent. Two of them were cited as live data
 * sources on public pages, which is how an empty table becomes a false claim.
 *
 * A HAND-MADE VERSION OF THAT LIST WAS WRONG, which is the argument for this
 * module existing. Reading the cron names and guessing their tables put
 * `source-promed` against food_security_phases and `source-reliefweb` against
 * displacement_tracking, and called both broken. They both write to
 * `event_snapshots` and are fine. The derived mapping — read from each file's
 * own INSERT — corrected the audit that motivated it.
 *
 * IT DERIVES, IT DOES NOT ENUMERATE. There is no list of collectors here to
 * fall out of date. The set of collectors comes from the cron schedule in
 * vercel.json, and each one's target table comes from the INSERT statement in
 * its own source file. A collector added tomorrow is in scope automatically,
 * and one that writes to a table nobody declared fails by default.
 */

/** A scheduled ingest job and the table it claims to write. */
export interface CollectorSpec {
  /** Cron path basename, e.g. 'source-vdem'. */
  name: string;
  /** Cron schedule from vercel.json. */
  schedule: string;
  /** Tables the file INSERTs into, in order of appearance. */
  tables: string[];
}

/**
 * Extract the tables a collector writes to, from its source.
 *
 * Comments are stripped first so a table named in a docstring does not count
 * as a write — the same trap that would have made check-llm-spend.ts scope a
 * file by its own documentation.
 */
export function extractInsertTargets(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const out: string[] = [];
  const re = /INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const table = m[1].toLowerCase();
    if (!out.includes(table)) out.push(table);
  }
  return out;
}

/** Cron paths that are ingest collectors, derived from the path convention. */
export function collectorPaths(cronPaths: string[]): string[] {
  return cronPaths.filter((p) => /\/source-[a-z0-9-]+$/.test(p));
}

export interface CollectorStatus {
  name: string;
  table: string;
  rowCount: number;
  /** Days since the newest row, or null when the table carries no timestamp. */
  ageDays: number | null;
  /** Why this is a problem, or null when healthy. */
  problem: 'empty' | 'stale' | 'no_insert_target' | null;
}

/**
 * Decide which collectors are unhealthy.
 *
 * `maxAgeDays` is generous on purpose: these are ingest jobs on external schedules,
 * some monthly, and an alert that cries wolf gets muted — which returns us to
 * exactly the silence this is meant to break.
 */
export function assessCollectors(
  rows: Array<{ name: string; table: string | null; rowCount: number; ageDays: number | null }>,
  maxAgeDays = 45,
): CollectorStatus[] {
  return rows.map((r) => {
    if (!r.table) {
      return { name: r.name, table: '', rowCount: 0, ageDays: null, problem: 'no_insert_target' as const };
    }
    let problem: CollectorStatus['problem'] = null;
    if (r.rowCount === 0) problem = 'empty';
    else if (r.ageDays !== null && r.ageDays > maxAgeDays) problem = 'stale';
    return { name: r.name, table: r.table, rowCount: r.rowCount, ageDays: r.ageDays, problem };
  });
}

/** Only the unhealthy ones, worst first. */
export function unhealthyCollectors(statuses: CollectorStatus[]): CollectorStatus[] {
  const rank = { no_insert_target: 0, empty: 1, stale: 2 } as const;
  return statuses
    .filter((s) => s.problem !== null)
    .sort((a, b) => rank[a.problem as keyof typeof rank] - rank[b.problem as keyof typeof rank]);
}

/** Plain-text report naming what broke and for how long. */
export function formatCollectorReport(bad: CollectorStatus[]): string {
  if (bad.length === 0) return 'All scheduled collectors are producing rows.';
  const lines = bad.map((s) => {
    if (s.problem === 'no_insert_target') {
      return `  • ${s.name} — scheduled, but no INSERT target found in its source`;
    }
    if (s.problem === 'empty') {
      return `  • ${s.name} -> ${s.table} — scheduled and running, ZERO rows`;
    }
    return `  • ${s.name} -> ${s.table} — newest row is ${s.ageDays} days old (${s.rowCount} rows)`;
  });
  return [
    `${bad.length} scheduled collector${bad.length === 1 ? '' : 's'} produced nothing.`,
    '',
    ...lines,
    '',
    'An empty table cited as a data source on a public page is a false claim,',
    'which is how V-Dem and Copernicus ended up on the landing page.',
  ].join('\n');
}
