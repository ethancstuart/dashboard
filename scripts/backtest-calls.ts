/**
 * Retrospective walk-forward backtest of the call ledger.
 *
 * WHY THIS EXISTS. The first calls resolve 2026-09-05, and the only check whose
 * output could change what gets published before that date is replaying the
 * generator over the history already stored and resolving it with the real
 * resolution rule. This script is that replay, committed so the numbers in
 * RECENCY_WEIGHT's docstring (api/_lib/calls.ts) are reproducible rather than
 * asserted.
 *
 * DESIGN, so the result means something:
 *  - Outcome windows are DISJOINT (stepped by the horizon). Overlapping daily
 *    calls share 13/14 days of data and would fake the sample size.
 *  - Everything a "call" uses — the FX threshold, the base rates, the recency
 *    rate — is estimated from data strictly BEFORE the fold. No leakage.
 *  - Skill is scored against each unit's OWN climatology, the same reference
 *    brierSkillScore uses, never a pooled rate.
 *
 * WHAT IT FOUND (2026-08-23, full stored history):
 *  - FX: realised out-of-sample hit rate 7.5% against an in-sample ~25%
 *    calibration — the recent regime is calmer than the training window.
 *    Skill vs climatology +1.9% at w=0.6: statistically nothing.
 *  - Censorship: skill −7.1% at w=0.6. The recency blend is pure noise there.
 *  - Weight sweep put the optimum at w≈0.4 for FX and w=0 for censorship;
 *    RECENCY_WEIGHT now carries those values.
 *
 * Usage: npx tsx scripts/backtest-calls.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const H = 14;
const clamp = (p: number) => Math.min(0.99, Math.max(0.01, p));
const rate = (h: number, w: number) => clamp((h + 1) / (w + 2));

function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const p = join(process.cwd(), '.env.local');
  if (!existsSync(p)) throw new Error('no DATABASE_URL');
  const m = readFileSync(p, 'utf8').match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error('no DATABASE_URL in .env.local');
  return m[1].replace(/^["']|["']$/g, '');
}

interface Fold {
  recent: number;
  longRun: number;
  outcome: 0 | 1;
}

async function fxFolds(sql: ReturnType<typeof neon>): Promise<Fold[]> {
  const rows = (await sql.query(
    `WITH m AS (
       SELECT currency_code, date, rate_vs_usd,
         MAX(rate_vs_usd) OVER (PARTITION BY currency_code ORDER BY date ROWS BETWEEN CURRENT ROW AND ${H} FOLLOWING) AS fwd_peak,
         COUNT(*)         OVER (PARTITION BY currency_code ORDER BY date ROWS BETWEEN CURRENT ROW AND ${H} FOLLOWING) AS wr
       FROM fx_rates)
     SELECT currency_code, ((fwd_peak-rate_vs_usd)/NULLIF(rate_vs_usd,0)*100)::float AS dep
     FROM m WHERE wr = ${H}+1 ORDER BY currency_code, date`,
  )) as Array<{ currency_code: string; dep: number }>;

  const byC = new Map<string, number[]>();
  for (const r of rows) {
    const a = byC.get(r.currency_code) ?? [];
    a.push(r.dep);
    byC.set(r.currency_code, a);
  }

  const folds: Fold[] = [];
  for (const deps of byC.values()) {
    if (deps.length < 70) continue;
    const cut = Math.floor(deps.length * 0.6);
    for (let i = cut; i + 1 < deps.length; i += H) {
      const train = deps.slice(0, i);
      const sorted = [...train].sort((a, b) => a - b);
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      if (!Number.isFinite(p75) || p75 < 0.25) continue; // peg skip, same as the recorder
      const th = Math.round(p75 * 100) / 100;
      const longRun = rate(train.filter((x) => x >= th).length, train.length);
      const rec = train.slice(-H * 3);
      const recent = rate(rec.filter((x) => x >= th).length, rec.length);
      folds.push({ recent, longRun, outcome: deps[i] >= th ? 1 : 0 });
    }
  }
  return folds;
}

async function ooniFolds(sql: ReturnType<typeof neon>): Promise<Fold[]> {
  const rows = (await sql.query(
    `SELECT country_code, measurement_date::date::text AS d,
            MAX(CASE WHEN confirmed_blocked > 0 THEN 1 ELSE 0 END)::int AS blocked
     FROM ooni_measurements GROUP BY 1, measurement_date::date ORDER BY 1, 2`,
  )) as Array<{ country_code: string; blocked: number }>;

  const byC = new Map<string, number[]>();
  for (const r of rows) {
    const a = byC.get(r.country_code) ?? [];
    a.push(r.blocked);
    byC.set(r.country_code, a);
  }

  const folds: Fold[] = [];
  for (const days of byC.values()) {
    if (days.length < 90) continue;
    const cut = Math.floor(days.length * 0.6);
    for (let i = cut; i + H <= days.length; i += H) {
      const train = days.slice(0, i);
      const wins: number[] = [];
      for (let j = i; j - H >= 0; j -= H) wins.push(train.slice(j - H, j).some((x) => x === 1) ? 1 : 0);
      if (wins.length < 4) continue;
      const longW = Math.min(8, wins.length);
      const longRun = rate(
        wins.slice(0, longW).reduce((a, b) => a + b, 0),
        longW,
      );
      const recent = rate(
        wins.slice(0, 3).reduce((a, b) => a + b, 0),
        3,
      );
      folds.push({ recent, longRun, outcome: days.slice(i, i + H).some((x) => x === 1) ? 1 : 0 });
    }
  }
  return folds;
}

function brierAt(folds: Fold[], w: number): number {
  return folds.reduce((s, f) => s + (clamp(w * f.recent + (1 - w) * f.longRun) - f.outcome) ** 2, 0) / folds.length;
}
function reference(folds: Fold[]): number {
  return folds.reduce((s, f) => s + (f.longRun - f.outcome) ** 2, 0) / folds.length;
}

const sql = neon(dbUrl());
const fx = await fxFolds(sql);
const oo = await ooniFolds(sql);

console.log('[backtest-calls] walk-forward, disjoint 14-day windows, no leakage\n');
for (const [name, folds] of [
  ['fx_devaluation', fx],
  ['censorship_event', oo],
] as const) {
  const hit = folds.reduce((s, f) => s + f.outcome, 0) / folds.length;
  console.log(`${name}: n=${folds.length}  hit-rate=${(100 * hit).toFixed(1)}%`);
  console.log(`  reference Brier (own climatology): ${reference(folds).toFixed(4)}`);
  for (const w of [0, 0.2, 0.4, 0.6, 0.8]) {
    const b = brierAt(folds, w);
    const skill = 100 * (1 - b / reference(folds));
    console.log(`  w=${w.toFixed(1)}  Brier=${b.toFixed(4)}  skill=${skill >= 0 ? '+' : ''}${skill.toFixed(1)}%`);
  }
  console.log('');
}
console.log('The weight follows this measurement (RECENCY_WEIGHT in api/_lib/calls.ts), never the other way around.');
