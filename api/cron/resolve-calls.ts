import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { resolveOutcome } from '../_lib/calls.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Resolve matured calls (daily, 09:45 UTC — after record, before the brief).
 *
 * Every call names its resolver and its threshold at creation. This job does
 * one thing: count the qualifying EXTERNAL events inside the window the call
 * declared, and write hit or miss. It never reads a NexusWatch score, never
 * consults the stated probability, and never adjusts a threshold — those are
 * the three ways a track record quietly becomes a closed loop.
 *
 * The window is [made_on, resolves_on], both fixed before the outcome existed.
 *
 * Idempotent by predicate: only `status = 'pending'` rows past `resolves_on`
 * are touched, so re-running does nothing to already-resolved calls. A resolved
 * call is never rewritten — that is the point of a ledger.
 */

interface DueCall {
  id: number;
  country_code: string;
  made_on: string;
  resolves_on: string;
  threshold: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'database_not_configured' });
  const sql = neon(dbUrl);

  try {
    const due = (await sql`
      SELECT id, country_code, made_on::text AS made_on, resolves_on::text AS resolves_on, threshold
      FROM calls
      WHERE status = 'pending' AND resolves_on <= CURRENT_DATE
      ORDER BY resolves_on ASC
      LIMIT 500
    `) as unknown as DueCall[];

    let hits = 0;
    let misses = 0;

    for (const call of due) {
      // The only question asked of the outside world: did OONI confirm a block
      // in this country inside the declared window?
      const evidence = (await sql`
        SELECT COUNT(*)::int AS n
        FROM ooni_measurements
        WHERE country_code = ${call.country_code}
          AND confirmed_blocked > 0
          AND measurement_date >= ${call.made_on}::date
          AND measurement_date <= ${call.resolves_on}::date
      `) as unknown as Array<{ n: number }>;

      const count = evidence[0]?.n ?? 0;
      const outcome = resolveOutcome(count, call.threshold);
      const status = outcome === 1 ? 'hit' : 'miss';

      await sql`
        UPDATE calls
        SET status = ${status}, evidence_count = ${count}, resolved_at = NOW()
        WHERE id = ${call.id} AND status = 'pending'
      `;

      if (outcome === 1) hits++;
      else misses++;
    }

    console.log(`[resolve-calls] resolved ${due.length} — ${hits} hit, ${misses} miss`);
    return res.status(200).json({ ok: true, resolved: due.length, hits, misses });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resolve-calls] failed:', msg);
    return res.status(500).json({ error: 'resolve_failed', message: msg });
  }
}
