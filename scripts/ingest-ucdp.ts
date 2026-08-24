/**
 * UCDP GED ingest — idempotent, re-runnable, chunked.
 *
 * Usage:
 *   npx tsx scripts/ingest-ucdp.ts <csv-file> <source_version> [minYear]
 *
 * Reads a GED or candidate CSV (annual releases: unzip first), keeps rows
 * with year >= minYear (default 2024), upserts by event_id — so re-running
 * is safe, and running the curated annual AFTER candidates replaces
 * candidate rows with curated ones for the same events.
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { parseUcdpCsv } from '../api/_lib/ucdp.js';
import { upsertUcdpEvents } from '../api/cron/source-ucdp.js';

const [file, sourceVersion, minYearArg] = process.argv.slice(2);
if (!file || !sourceVersion) {
  console.error('usage: npx tsx scripts/ingest-ucdp.ts <csv-file> <source_version> [minYear]');
  process.exit(1);
}
const minYear = Number.parseInt(minYearArg ?? '2024', 10);

const m = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m);
if (!m) throw new Error('no DATABASE_URL');
const sql = neon(m[1].replace(/^["']|["']$/g, ''));

console.log(`[ingest-ucdp] parsing ${file} ...`);
const { events, unmappedGwCodes } = parseUcdpCsv(readFileSync(file, 'utf8'));
const kept = events.filter((e) => e.year >= minYear && e.dateStart.length === 10);
console.log(`[ingest-ucdp] ${events.length} events parsed, ${kept.length} with year >= ${minYear}`);
if (unmappedGwCodes.size > 0) {
  console.log(`[ingest-ucdp] unmapped GW codes (kept with iso2=NULL): ${JSON.stringify([...unmappedGwCodes])}`);
}

const written = await upsertUcdpEvents(sql, kept, sourceVersion);
console.log(`[ingest-ucdp] upserted ${written} rows as '${sourceVersion}'`);
