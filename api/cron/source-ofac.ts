import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { parseOfacCsv, parseUnXml, fingerprint, diffSnapshot, type SanctionsEntity } from '../_lib/sanctions.js';

export const config = { runtime: 'nodejs', maxDuration: 120 };

/**
 * OFAC SDN + UN Consolidated sanctions ingestion — rebuilt 2026-08-23.
 *
 * What the first version actually did, per the audit that prompted this
 * rewrite: 116,717 rows for 1,021 entities (the whole UN list re-inserted on
 * every snapshot change, because the "diff" marked everything 'add'), zero
 * OFAC rows ever (the endpoint had been retired — 404 — since before the
 * first run, and the error was reported but nothing alerted), all dates NULL
 * (defeating the dedup constraint, because NULL never equals NULL), and all
 * country attributions empty (the fields were in the feeds; the parser
 * ignored them).
 *
 * How it works now:
 *  - OFAC: SDN.CSV from sanctionslistservice.ofac.treas.gov (5.6 MB; the
 *    28 MB XML is unnecessary). Program → country attribution where the
 *    regime is unambiguous; transnational programs attribute to nothing.
 *  - UN: consolidated XML (302 → Azure blob; fetch follows it). UN_LIST_TYPE
 *    → country, LISTED_ON → the entity's real designation date.
 *  - A REAL diff: each fetch is compared against sanctions_current (the
 *    stored previous snapshot); only adds / updates / removes become events,
 *    with a non-NULL source_date so the dedup constraint actually bites.
 *  - Bootstrap: when sanctions_current is empty for a source, the snapshot is
 *    seeded WITHOUT emitting events — 19k "added today" rows on day one would
 *    be false, and the brief reads this table as political signal.
 *
 * The brief consumes deltas ("OFAC added 3 entities under IRAN programs");
 * this is deliberately NOT a call domain — designation days are ~5/year,
 * far too sparse to calibrate.
 */

const OFAC_CSV_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV';
const UN_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';

interface LegResult {
  bootstrap: boolean;
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'database_not_configured' });
  const sql = neon(dbUrl);

  const result: { ofac?: LegResult; un?: LegResult; errors: string[] } = { errors: [] };

  async function seedSnapshot(source: string, feed: SanctionsEntity[]): Promise<void> {
    // Chunked UNNEST inserts: 20k single-row round trips would blow the
    // function timeout. Array fields travel as delimited strings ('|' for
    // programs, which can never contain it) and are split server-side.
    for (let i = 0; i < feed.length; i += 2000) {
      const chunk = feed.slice(i, i + 2000);
      await sql`
        INSERT INTO sanctions_current
          (source, source_entity_id, entity_name, entity_type, country_codes, programs, fingerprint)
        SELECT ${source}, t.id, t.name, t.type,
               COALESCE(string_to_array(NULLIF(t.cc, ''), ','), '{}'),
               COALESCE(string_to_array(NULLIF(t.pg, ''), '|'), '{}'),
               t.fp
        FROM UNNEST(
          ${chunk.map((e) => e.id)}::text[],
          ${chunk.map((e) => e.name)}::text[],
          ${chunk.map((e) => e.type)}::text[],
          ${chunk.map((e) => e.countries.join(','))}::text[],
          ${chunk.map((e) => e.programs.join('|'))}::text[],
          ${chunk.map((e) => fingerprint(e))}::text[]
        ) AS t(id, name, type, cc, pg, fp)
        ON CONFLICT (source, source_entity_id) DO NOTHING
      `;
    }
  }

  async function runLeg(source: 'ofac' | 'un', fetchAndParse: () => Promise<SanctionsEntity[]>): Promise<void> {
    const feed = await fetchAndParse();
    // A tiny feed is a broken fetch, not a mass delisting. Refuse to diff:
    // treating it as truth would emit thousands of false 'remove' events.
    if (feed.length < 100) throw new Error(`${source}_feed_implausibly_small:${feed.length}`);

    const prevRows = (await sql`
      SELECT source_entity_id, entity_name, fingerprint
      FROM sanctions_current WHERE source = ${source}
    `) as unknown as Array<{ source_entity_id: string; entity_name: string; fingerprint: string }>;

    const today = new Date().toISOString().slice(0, 10);

    if (prevRows.length === 0) {
      await seedSnapshot(source, feed);
      result[source] = { bootstrap: true, added: 0, updated: 0, removed: 0, total: feed.length };
      return;
    }

    const previous = new Map(
      prevRows.map((r) => [r.source_entity_id, { name: r.entity_name, fingerprint: r.fingerprint }]),
    );
    const diff = diffSnapshot(feed, previous);

    for (const e of diff.added) {
      await sql`
        INSERT INTO sanctions_events
          (source, source_entity_id, entity_name, entity_type, country_codes, change_type, programs, remarks, source_date)
        VALUES (${source}, ${e.id}, ${e.name}, ${e.type}, ${e.countries}, 'add', ${e.programs}, null, ${e.listedOn ?? today})
        ON CONFLICT (source, source_entity_id, change_type, source_date) DO NOTHING
      `;
    }
    for (const e of diff.updated) {
      await sql`
        INSERT INTO sanctions_events
          (source, source_entity_id, entity_name, entity_type, country_codes, change_type, programs, remarks, source_date)
        VALUES (${source}, ${e.id}, ${e.name}, ${e.type}, ${e.countries}, 'update', ${e.programs}, null, ${today})
        ON CONFLICT (source, source_entity_id, change_type, source_date) DO NOTHING
      `;
    }
    for (const r of diff.removed) {
      await sql`
        INSERT INTO sanctions_events (source, source_entity_id, entity_name, change_type, source_date)
        VALUES (${source}, ${r.id}, ${r.name}, 'remove', ${today})
        ON CONFLICT (source, source_entity_id, change_type, source_date) DO NOTHING
      `;
    }

    // Refresh the snapshot: upsert changed/new entities, delete the delisted.
    for (const e of [...diff.added, ...diff.updated]) {
      await sql`
        INSERT INTO sanctions_current
          (source, source_entity_id, entity_name, entity_type, country_codes, programs, fingerprint, last_seen)
        VALUES (${source}, ${e.id}, ${e.name}, ${e.type}, ${e.countries}, ${e.programs}, ${fingerprint(e)}, CURRENT_DATE)
        ON CONFLICT (source, source_entity_id) DO UPDATE SET
          entity_name = EXCLUDED.entity_name, entity_type = EXCLUDED.entity_type,
          country_codes = EXCLUDED.country_codes, programs = EXCLUDED.programs,
          fingerprint = EXCLUDED.fingerprint, last_seen = CURRENT_DATE
      `;
    }
    if (diff.removed.length > 0) {
      await sql`
        DELETE FROM sanctions_current
        WHERE source = ${source} AND source_entity_id = ANY(${diff.removed.map((r) => r.id)})
      `;
    }
    await sql`UPDATE sanctions_current SET last_seen = CURRENT_DATE WHERE source = ${source}`;

    result[source] = {
      bootstrap: false,
      added: diff.added.length,
      updated: diff.updated.length,
      removed: diff.removed.length,
      total: feed.length,
    };
  }

  try {
    await runLeg('ofac', async () => {
      const r = await fetch(OFAC_CSV_URL, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`ofac_${r.status}`);
      return parseOfacCsv(await r.text());
    });
  } catch (err) {
    result.errors.push(`ofac: ${err instanceof Error ? err.message : err}`);
  }

  try {
    await runLeg('un', async () => {
      const r = await fetch(UN_URL, { signal: AbortSignal.timeout(90000), redirect: 'follow' });
      if (!r.ok) throw new Error(`un_${r.status}`);
      return parseUnXml(await r.text());
    });
  } catch (err) {
    result.errors.push(`un: ${err instanceof Error ? err.message : err}`);
  }

  // A leg failure is a real failure now. The old collector returned 200 with
  // an errors array through 35+ days of OFAC 404s and nothing ever surfaced.
  const status = result.errors.length > 0 ? 500 : 200;
  return res.status(status).json(result);
}
