/**
 * Collector health check.
 *
 * Two modes, because the two failures are different:
 *
 *   STRUCTURAL (always, and the CI gate). Every scheduled `source-*` cron must
 *   have a discoverable INSERT target in its own source. A collector that is
 *   scheduled but writes nowhere is a job burning a slot to no effect, and it
 *   fails the build.
 *
 *   DATA (only when DATABASE_URL is set — so, locally and in cron, not in CI).
 *   Reports scheduled collectors whose target table is empty or has stopped
 *   growing. This is the one that matters: audited 2026-08-22, four of twelve
 *   were failing — vdem, copernicus and fred-yields writing zero rows, unhcr
 *   68 days stale — all scheduled, all running, all silent, and two of them
 *   cited as live sources on public pages. CI cannot see this, which is why it
 *   warns rather than fails there.
 *
 * IT DERIVES. The collector set comes from vercel.json's cron list and each
 * target table from that collector's own INSERT, so a collector added tomorrow
 * is in scope with no edit here.
 *
 * Usage: npx tsx scripts/check-collectors.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractInsertTargets,
  collectorPaths,
  assessCollectors,
  unhealthyCollectors,
  formatCollectorReport,
} from '../api/_lib/collector-health.js';

const ROOT = process.cwd();

interface VercelConfig {
  crons?: Array<{ path: string; schedule: string }>;
}

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as VercelConfig;
const crons = vercel.crons ?? [];
const paths = collectorPaths(crons.map((c) => c.path));

if (paths.length === 0) {
  console.error('[check-collectors] FAILED — no source-* collectors found in vercel.json crons.');
  process.exit(1);
}

const specs = paths.map((p) => {
  const name = p.split('/').pop() as string;
  const file = join(ROOT, 'api', 'cron', `${name}.ts`);
  const tables = existsSync(file) ? extractInsertTargets(readFileSync(file, 'utf8')) : [];
  return { name, file, tables, exists: existsSync(file) };
});

console.log(`[check-collectors] ${specs.length} scheduled collector(s).`);

// ---- structural: every scheduled collector must exist and write somewhere ----
const structural = specs.filter((s) => !s.exists || s.tables.length === 0);
if (structural.length > 0) {
  console.error(`\n[check-collectors] FAILED — ${structural.length} scheduled collector(s) write nothing:\n`);
  for (const s of structural) {
    console.error(`  ${s.name} — ${s.exists ? 'no INSERT target found in its source' : 'source file missing'}`);
  }
  console.error(
    '\nA scheduled cron that writes to no table burns a slot to no effect.\n' +
      'Either give it an INSERT, or remove it from vercel.json crons.',
  );
  process.exit(1);
}

for (const s of specs) {
  console.log(`  ${s.name} -> ${s.tables.join(', ')}`);
}

// ---- data: only possible where a database is reachable ----
const dbUrl = process.env.DATABASE_URL ?? readEnvLocal('DATABASE_URL');
if (!dbUrl) {
  console.log('\n[check-collectors] structural check OK. No DATABASE_URL — skipping the data check.');
  process.exit(0);
}

const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

const rows: Array<{ name: string; table: string | null; rowCount: number; ageDays: number | null }> = [];
for (const spec of specs) {
  const table = spec.tables[0] ?? null;
  if (!table) {
    rows.push({ name: spec.name, table: null, rowCount: 0, ageDays: null });
    continue;
  }
  try {
    const count = (await sql.query(`SELECT COUNT(*)::int AS n FROM ${table}`)) as Array<{ n: number }>;
    // Find a timestamp-ish column rather than assuming one, since these tables
    // were written by different people at different times and do not agree.
    const cols = (await sql.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND data_type IN ('timestamp with time zone','timestamp without time zone','date')
       ORDER BY ordinal_position`,
      [table],
    )) as Array<{ column_name: string }>;
    let ageDays: number | null = null;
    if (cols.length > 0 && count[0].n > 0) {
      const col = cols[cols.length - 1].column_name;
      const age = (await sql.query(`SELECT EXTRACT(DAY FROM (NOW() - MAX(${col})))::int AS d FROM ${table}`)) as Array<{
        d: number | null;
      }>;
      ageDays = age[0]?.d ?? null;
    }
    rows.push({ name: spec.name, table, rowCount: count[0].n, ageDays });
  } catch {
    rows.push({ name: spec.name, table, rowCount: 0, ageDays: null });
  }
}

const bad = unhealthyCollectors(assessCollectors(rows));
console.log('');
console.log(formatCollectorReport(bad));

// Warn, do not fail: a collector's upstream can be down through no fault of
// this repo, and a build that breaks on someone else's outage gets bypassed.
process.exit(0);

function readEnvLocal(key: string): string | null {
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return null;
  const m = readFileSync(p, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}
