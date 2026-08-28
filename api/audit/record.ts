import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'nodejs' };

/**
 * Internal audit recording endpoint — SERVER-SIDE ONLY.
 * POST /api/audit/record   (requires CRON_SECRET)
 * Body: { type: 'lineage' | 'audit' | 'ai-audit', record: {...} }
 *
 * WHY IT IS LOCKED. Until 2026-08-28 this was an unauthenticated POST with
 * `Access-Control-Allow-Origin: *` that inserted caller-supplied rows into
 * data_lineage, audit_log and ai_analyst_audit — the three tables
 * /api/v2/audit and /api/v2/lineage publish keylessly AS the provenance
 * product. All three were empty, so anything an attacker wrote would have
 * been the only rows the transparency API ever served: on a platform whose
 * pitch is an auditable public record, a writable audit log is the whole
 * claim undone. The docstring also asserted "Rate-limited by origin", which
 * was never true of this file. No caller exists in the repo.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Fail closed: an unset secret must refuse, never wave everything through.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: 'cron_secret_not_configured' });
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== cronSecret) return res.status(401).json({ error: 'unauthorized' });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'db_not_configured' });

  const body = req.body as {
    type: 'lineage' | 'audit' | 'ai-audit';
    record: Record<string, unknown>;
  };

  if (!body?.type || !body?.record) {
    return res.status(400).json({ error: 'type and record required' });
  }

  try {
    const sql = neon(dbUrl);
    const r = body.record;

    if (body.type === 'lineage') {
      await sql`
        INSERT INTO data_lineage
          (id, layer_id, source, source_url, response_status, fetch_start_ms, fetch_end_ms,
           latency_ms, response_size_bytes, records_returned, records_accepted,
           quality_filters, diff, source_type, error)
        VALUES
          (${r.id}, ${r.layerId}, ${r.source}, ${r.sourceUrl}, ${r.responseStatus},
           ${r.fetchStartMs}, ${r.fetchEndMs}, ${r.latencyMs}, ${r.responseSizeBytes},
           ${r.recordsReturned}, ${r.recordsAccepted},
           ${JSON.stringify(r.qualityFilters ?? [])}, ${JSON.stringify(r.diff ?? null)},
           ${r.sourceType ?? 'primary'}, ${r.error ?? null})
        ON CONFLICT (id) DO NOTHING
      `;
    } else if (body.type === 'audit') {
      await sql`
        INSERT INTO audit_log
          (id, country_code, computed_at_ms, rule_version, input_lineage_ids, score,
           previous_score, components, confidence, applied_rules, gaps)
        VALUES
          (${r.id}, ${r.countryCode}, ${r.computedAtMs}, ${r.ruleVersion},
           ${r.inputLineageIds as string[]}, ${r.score}, ${r.previousScore ?? null},
           ${JSON.stringify(r.components)}, ${r.confidence},
           ${r.appliedRules as string[]}, ${r.gaps as string[]})
        ON CONFLICT (id) DO NOTHING
      `;
    } else if (body.type === 'ai-audit') {
      await sql`
        INSERT INTO ai_analyst_audit
          (id, query, computed_at_ms, tools_used, claims, overall_confidence, rule_version)
        VALUES
          (${r.id}, ${r.query}, ${r.computedAtMs}, ${r.toolsUsed as string[]},
           ${JSON.stringify(r.claims)}, ${r.overallConfidence}, ${r.ruleVersion ?? null})
        ON CONFLICT (id) DO NOTHING
      `;
    } else {
      return res.status(400).json({ error: 'unknown type' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[audit/record]', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'insert_failed' });
  }
}
