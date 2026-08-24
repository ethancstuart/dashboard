import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { parseUcdpCsv, extractCandidateUrls, type UcdpEvent } from '../_lib/ucdp.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

/**
 * UCDP GED candidate ingestion — monthly.
 *
 * UCDP publishes curated conflict events as monthly "candidate" CSVs (~1
 * month lag) and an annual curated release. This cron discovers the candidate
 * CSV links on the UCDP downloads page — the version string in the filename
 * changes every month, so the URL is DERIVED from the page, never hardcoded
 * (rule 5) — and upserts recent events into ucdp_events.
 *
 * compute-cii derives the conflict structural baseline from this table as
 * max(fragility floor, trailing-12-month-deaths curve). The annual release
 * (which supersedes candidate rows) is ingested by scripts/ingest-ucdp.ts —
 * see the runbook note in that file.
 *
 * Schedule: monthly. UCDP updates around the start of each month.
 */

const DOWNLOADS_URL = 'https://ucdp.uu.se/downloads/';

export async function upsertUcdpEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  events: UcdpEvent[],
  sourceVersion: string,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < events.length; i += 2000) {
    const c = events.slice(i, i + 2000);
    await sql`
      INSERT INTO ucdp_events (event_id, date_start, year, country_name, gw_code, iso2, lat, lon, deaths_best, type_of_violence, source_version)
      SELECT * FROM UNNEST(
        ${c.map((e) => e.eventId)}::bigint[], ${c.map((e) => e.dateStart)}::date[],
        ${c.map((e) => e.year)}::int[], ${c.map((e) => e.countryName)}::text[],
        ${c.map((e) => e.gwCode)}::int[], ${c.map((e) => e.iso2)}::text[],
        ${c.map((e) => e.lat)}::real[], ${c.map((e) => e.lon)}::real[],
        ${c.map((e) => e.deathsBest)}::int[], ${c.map((e) => e.typeOfViolence)}::int[],
        ${c.map(() => sourceVersion)}::text[]
      )
      ON CONFLICT (event_id) DO UPDATE SET
        date_start = EXCLUDED.date_start, year = EXCLUDED.year,
        country_name = EXCLUDED.country_name, gw_code = EXCLUDED.gw_code,
        iso2 = EXCLUDED.iso2, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
        deaths_best = EXCLUDED.deaths_best, type_of_violence = EXCLUDED.type_of_violence,
        source_version = EXCLUDED.source_version, ingested_at = NOW()
    `;
    written += c.length;
  }
  return written;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'database_not_configured' });
  const sql = neon(dbUrl);

  try {
    const page = await fetch(DOWNLOADS_URL, { signal: AbortSignal.timeout(30000) });
    if (!page.ok) return res.status(500).json({ error: `downloads_page_${page.status}` });
    const urls = extractCandidateUrls(await page.text());
    if (urls.length === 0) {
      // The page changed shape and the derivation found nothing — that is a
      // failure to surface, not a quiet "no new data".
      return res.status(500).json({ error: 'no_candidate_urls_found' });
    }

    const minYear = new Date().getUTCFullYear() - 1;
    const results: Array<{ url: string; parsed: number; kept: number; upserted: number }> = [];
    for (const url of urls) {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) {
        results.push({ url, parsed: -r.status, kept: 0, upserted: 0 });
        continue;
      }
      const { events } = parseUcdpCsv(await r.text());
      const kept = events.filter((e) => e.year >= minYear && e.dateStart.length === 10);
      const version = `candidate ${url.split('/').pop()?.replace('.csv', '') ?? 'unknown'}`;
      const upserted = await upsertUcdpEvents(sql, kept, version);
      results.push({ url, parsed: events.length, kept: kept.length, upserted });
    }

    const failed = results.filter((r) => r.parsed < 0);
    return res.status(failed.length === results.length ? 500 : 200).json({ results });
  } catch (err) {
    console.error('[source-ucdp] failed:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'ucdp_ingest_failed' });
  }
}
