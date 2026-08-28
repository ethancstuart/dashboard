/**
 * Nightly Parquet export — powers the public Data Lab.
 *
 * Reads from Neon, writes 4 parquet files to /tmp via parquetjs-lite,
 * uploads each to Vercel Blob, records the URL in `data_exports`.
 * The /api/data/manifest endpoint reads from `data_exports` so the
 * browser can hand the URLs to DuckDB-WASM.
 *
 * Schedule: 03:00 UTC daily (set in vercel.json).
 * Budget: ≤300s. cii_daily_snapshots is the largest (~94K rows, ~14MB raw).
 *
 * 2026-05 tier-up Phase 1.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cronJitter, requireCron } from '../_cron-utils.js';
import { uploadBlob, blobEnabled } from '../_lib/storage.js';

// parquetjs-lite has no types — declare the minimal shape we use.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const parquet: any = require('parquetjs-lite');

export const config = { runtime: 'nodejs', maxDuration: 300 };

interface ExportSpec {
  name: string;
  schema: Record<string, { type: string; optional?: boolean }>;
  query: string;
}

const EXPORTS: ExportSpec[] = [
  {
    name: 'cii_daily_snapshots',
    schema: {
      country_code: { type: 'UTF8' },
      country_name: { type: 'UTF8', optional: true },
      date: { type: 'UTF8' },
      cii_score: { type: 'DOUBLE' },
      confidence: { type: 'UTF8', optional: true },
      component_conflict: { type: 'DOUBLE', optional: true },
      component_disasters: { type: 'DOUBLE', optional: true },
      component_sentiment: { type: 'DOUBLE', optional: true },
      component_infrastructure: { type: 'DOUBLE', optional: true },
      component_governance: { type: 'DOUBLE', optional: true },
      component_market_exposure: { type: 'DOUBLE', optional: true },
      source_count: { type: 'INT32', optional: true },
      data_point_count: { type: 'INT32', optional: true },
    },
    query: `
      SELECT
        country_code,
        country_name,
        date::text AS date,
        cii_score::float AS cii_score,
        confidence,
        component_conflict::float AS component_conflict,
        component_disasters::float AS component_disasters,
        component_sentiment::float AS component_sentiment,
        component_infrastructure::float AS component_infrastructure,
        component_governance::float AS component_governance,
        component_market_exposure::float AS component_market_exposure,
        source_count,
        data_point_count
      FROM cii_daily_snapshots
      ORDER BY date DESC, country_code
    `,
  },
  {
    name: 'acled_events_90d',
    schema: {
      id: { type: 'UTF8' },
      country: { type: 'UTF8' },
      location: { type: 'UTF8', optional: true },
      event_type: { type: 'UTF8', optional: true },
      fatalities: { type: 'INT32', optional: true },
      source_url: { type: 'UTF8', optional: true },
      occurred_at: { type: 'UTF8' },
    },
    query: `
      SELECT id, country, location, event_type, fatalities, source_url,
             occurred_at::text AS occurred_at
      FROM acled_events
      WHERE occurred_at > NOW() - INTERVAL '90 days'
      ORDER BY occurred_at DESC
    `,
  },
  {
    name: 'crisis_triggers',
    schema: {
      id: { type: 'INT32' },
      playbook_key: { type: 'UTF8', optional: true },
      country_code: { type: 'UTF8', optional: true },
      trigger_type: { type: 'UTF8', optional: true },
      cii_score: { type: 'DOUBLE', optional: true },
      cii_delta: { type: 'DOUBLE', optional: true },
      magnitude: { type: 'DOUBLE', optional: true },
      notes: { type: 'UTF8', optional: true },
      triggered_at: { type: 'UTF8' },
      resolved_at: { type: 'UTF8', optional: true },
    },
    query: `
      SELECT id, playbook_key, country_code, trigger_type,
             cii_score::float AS cii_score,
             cii_delta::float AS cii_delta,
             magnitude::float AS magnitude,
             notes,
             triggered_at::text AS triggered_at,
             resolved_at::text AS resolved_at
      FROM crisis_triggers
      ORDER BY triggered_at DESC
      LIMIT 5000
    `,
  },
  {
    name: 'verified_signals',
    schema: {
      id: { type: 'INT32' },
      country_code: { type: 'UTF8', optional: true },
      kind: { type: 'UTF8', optional: true },
      source_count: { type: 'INT32', optional: true },
      verification: { type: 'UTF8', optional: true },
      summary: { type: 'UTF8', optional: true },
      first_seen: { type: 'UTF8', optional: true },
    },
    query: `
      SELECT id, country_code, kind, source_count, verification,
             summary, first_seen::text AS first_seen
      FROM verified_signals
      ORDER BY first_seen DESC NULLS LAST
      LIMIT 5000
    `,
  },
  {
    name: 'forecasts_90d',
    schema: {
      id: { type: 'INT32' },
      country_code: { type: 'UTF8' },
      made_on: { type: 'UTF8' },
      horizon_days: { type: 'INT32' },
      model: { type: 'UTF8' },
      p10: { type: 'DOUBLE', optional: true },
      p25: { type: 'DOUBLE', optional: true },
      p50: { type: 'DOUBLE', optional: true },
      p75: { type: 'DOUBLE', optional: true },
      p90: { type: 'DOUBLE', optional: true },
      cii_now: { type: 'DOUBLE', optional: true },
      actual: { type: 'DOUBLE', optional: true },
      abs_error: { type: 'DOUBLE', optional: true },
    },
    query: `
      SELECT id, country_code, made_on::text AS made_on, horizon_days, model,
             p10::float AS p10, p25::float AS p25, p50::float AS p50,
             p75::float AS p75, p90::float AS p90,
             cii_now::float AS cii_now,
             actual::float AS actual, abs_error::float AS abs_error
      FROM forecasts
      WHERE made_on > NOW() - INTERVAL '90 days'
      ORDER BY made_on DESC, country_code, model
    `,
  },
];

async function exportOne(
  spec: ExportSpec,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
): Promise<{ ok: boolean; rows: number; bytes?: number; url?: string; error?: string }> {
  try {
    const rows = (await sql.query(spec.query)) as unknown as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, rows: 0, error: 'no rows' };
    }

    const schema = new parquet.ParquetSchema(spec.schema);
    const tmpPath = join(tmpdir(), `${spec.name}.parquet`);
    const writer = await parquet.ParquetWriter.openFile(schema, tmpPath);
    for (const r of rows) {
      // parquetjs-lite drops undefined values for optional fields; null still fails.
      // Map nulls → undefined for optional columns.
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (v == null) continue;
        cleaned[k] = v;
      }
      await writer.appendRow(cleaned);
    }
    await writer.close();

    const buf = await fs.readFile(tmpPath);
    const upload = await uploadBlob(`exports/${spec.name}.parquet`, buf, {
      contentType: 'application/vnd.apache.parquet',
      cacheMaxAge: 86_400,
      stableUrl: true,
    });
    await fs.unlink(tmpPath).catch(() => undefined);

    return { ok: true, rows: rows.length, bytes: buf.length, url: upload.url };
  } catch (e) {
    return { ok: false, rows: 0, error: e instanceof Error ? e.message : 'export_failed' };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  await cronJitter(20);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  if (!blobEnabled()) {
    return res.status(503).json({
      error: 'BLOB_READ_WRITE_TOKEN not configured',
      note: 'Provision Vercel Blob in the dashboard then redeploy.',
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = neon(dbUrl);
  const summary: Record<string, unknown>[] = [];

  for (const spec of EXPORTS) {
    const result = await exportOne(spec, sql);
    summary.push({ name: spec.name, ...result });
    if (result.ok && result.url) {
      try {
        await sql`
          INSERT INTO data_exports (name, blob_url, bytes, rows, exported_at, schema_json)
          VALUES (${spec.name}, ${result.url}, ${result.bytes ?? 0}, ${result.rows}, NOW(), ${JSON.stringify(spec.schema)}::jsonb)
          ON CONFLICT (name) DO UPDATE
            SET blob_url = EXCLUDED.blob_url,
                bytes = EXCLUDED.bytes,
                rows = EXCLUDED.rows,
                exported_at = NOW(),
                schema_json = EXCLUDED.schema_json
        `;
      } catch (e) {
        console.error('[export-parquet] manifest write failed:', e instanceof Error ? e.message : e);
      }
    }
  }

  return res.json({ ok: true, exports: summary });
}
