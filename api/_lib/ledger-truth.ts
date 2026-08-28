/**
 * Ledger-truth assertion — the pure decision, extracted so it can be tested
 * without a database.
 *
 * WHAT IT ASSERTS. A call is a dated, falsifiable claim: it is made on
 * `made_on`, it resolves on `resolves_on`, and `api/cron/resolve-calls.ts`
 * writes `hit` or `miss` at 09:45 UTC on or after that date. A call that is
 * still `pending` well past its own resolution date is the ledger failing to
 * keep its central promise — the track record silently reads better than it is,
 * because the unresolved ones are the ones the resolver could not settle.
 *
 * WHY IT IS NOT CAUGHT ALREADY. resolve-calls counts `unresolvable` rows and
 * LEAVES THEM PENDING by design (a resolver that cannot reach its upstream must
 * not invent an outcome). That is the correct behaviour and it is also
 * completely silent: the run returns 200, nothing errors, and the row sits
 * pending forever. Nothing anywhere asserts that the pending set drains.
 *
 * This is the same shape as the seed-data ruling in AGENTS.md — correct when
 * written, silently wrong later, and nothing fails. Time moves; the row stays
 * put.
 *
 * THE GRACE PERIOD. resolve-calls runs once a day. A call whose `resolves_on`
 * is today has not had its run yet, and one from yesterday may be mid-flight.
 * So the assertion starts one full day after that: `resolves_on < CURRENT_DATE
 * - 1`. Anything older has had at least one complete resolution run and is
 * genuinely stuck.
 */

/** Days after `resolves_on` before a still-pending call is an alert. */
export const GRACE_DAYS = 1;

export interface PendingCall {
  id: number;
  kind: string;
  country_code: string;
  made_on: string;
  resolves_on: string;
}

export interface LedgerTruthVerdict {
  /** True when the ledger is telling the truth — nothing overdue is pending. */
  ok: boolean;
  staleCount: number;
  /** Up to `sampleLimit` of the oldest offenders, for the alert body. */
  sample: PendingCall[];
  /** Human-readable alert body. Empty when ok. */
  lines: string[];
}

/**
 * Days between an ISO date (YYYY-MM-DD) and a reference date, in whole days.
 * Both are treated as calendar dates in UTC so that a local-timezone clock
 * cannot shift the answer — the same trap AGENTS.md records for
 * `toISOString().slice(0,10)`.
 */
export function daysOverdue(resolvesOn: string, today: Date): number {
  const [y, m, d] = resolvesOn.split('-').map(Number);
  const due = Date.UTC(y, m - 1, d);
  const ref = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((ref - due) / 86_400_000);
}

/**
 * Assess a set of still-pending calls that the query already filtered to
 * "overdue". Kept separate from the SQL so the reporting can be tested without
 * a database, and so the SQL predicate is the only thing that has to match
 * `GRACE_DAYS`.
 */
export function assessLedgerTruth(stale: PendingCall[], today: Date, sampleLimit = 20): LedgerTruthVerdict {
  if (stale.length === 0) {
    return { ok: true, staleCount: 0, sample: [], lines: [] };
  }

  const sorted = [...stale].sort((a, b) => a.resolves_on.localeCompare(b.resolves_on));
  const sample = sorted.slice(0, sampleLimit);
  const oldest = daysOverdue(sorted[0].resolves_on, today);

  const lines = [
    `**${stale.length} call(s) past resolution and still \`pending\`** — oldest is ${oldest} day(s) overdue.`,
    'A pending call past its own resolution date means the ledger is not settling. ' +
      '`resolve-calls` leaves rows pending when a resolver cannot reach its upstream, ' +
      'which is correct and silent — this is the alarm for it.',
  ];
  for (const c of sample) {
    lines.push(
      `  • #${c.id} \`${c.kind}\` ${c.country_code} — made ${c.made_on}, due ${c.resolves_on} ` +
        `(${daysOverdue(c.resolves_on, today)}d overdue)`,
    );
  }
  if (stale.length > sample.length) {
    lines.push(`  … and ${stale.length - sample.length} more.`);
  }

  return { ok: false, staleCount: stale.length, sample, lines };
}
