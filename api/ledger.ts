import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import {
  brierScore,
  brierSkillScore,
  baseRate,
  independentUnits,
  resolutionBatches,
  MIN_RESOLUTION_BATCHES,
  type ScoredCall,
} from './_lib/calls.js';
import { shell, esc, pct } from './_lib/ssr-shell.js';

export const config = { runtime: 'nodejs', maxDuration: 20 };

/**
 * Server-rendered /ledger.
 *
 * WHY THIS EXISTS ALONGSIDE src/pages/ledger.ts. The SPA renders the ledger
 * beautifully and a crawler sees none of it: /ledger returns index.html with the
 * generic site title and no content, because every route in this app is
 * client-rendered. The ledger is the one page the whole repositioning depends on
 * being findable — "the only geopolitical platform that publishes its own track
 * record" is worth nothing if the record is invisible to search.
 *
 * Both paths coexist the way /brief/:date already does: an in-app navigation
 * pushState's and the SPA renders, while a direct load or a crawl hits this
 * function and gets real HTML with no JavaScript required.
 *
 * THE PALETTE COMES FROM src/styles/email-tokens.ts, the same source the daily
 * brief and the dossier theme read. A server renderer that cannot use CSS custom
 * properties is exactly where a private copy of the palette gets made, and a
 * private copy is how an identity change strands the most public surface you
 * have. There are no colour literals below.
 */

interface CallRow {
  id: number;
  kind: string;
  country_code: string;
  claim: string;
  probability: number;
  base_rate: number | null;
  resolves_on: string;
  status: string;
}

const KIND_LABEL: Record<string, string> = {
  censorship_event: 'Network interference (OONI)',
  fx_devaluation: 'Currency depreciation (FX reference rates)',
  seismicity_window: 'Seismicity (USGS) — calibration harness',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('method_not_allowed');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900');

  const title = 'The Ledger — every call NexusWatch has made, scored';
  // The unfurl card. /ledger is the page the whole repositioning depends on
  // being forwardable; it previously declared a large twitter card and shipped
  // no image, which unfurls to nothing at all.
  const ogImage = 'https://nexuswatch.dev/api/og?type=ledger';
  const description =
    'Dated, falsifiable calls resolved against external sources on a date fixed in advance, with the score published whether it flatters us or not.';

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.send(
      shell('<h1>The Ledger</h1><p class="lede">Temporarily unavailable.</p>', {
        title,
        description,
        canonicalPath: '/ledger',
        ogImage,
      }),
    );
  }

  try {
    const sql = neon(dbUrl);
    const open = (await sql`
      SELECT id, kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, resolves_on::text AS resolves_on, status
      FROM calls WHERE status = 'pending'
      ORDER BY ABS(probability - COALESCE(base_rate, probability)) DESC, probability DESC
      LIMIT 40
    `) as unknown as CallRow[];

    // Display list, capped. The STATISTICS below must not be computed from
    // this — see `scoredRows`.
    const resolved = (await sql`
      SELECT id, kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, resolves_on::text AS resolves_on, status
      FROM calls WHERE status <> 'pending'
      ORDER BY resolved_at DESC LIMIT 40
    `) as unknown as CallRow[];

    // Every resolved call, for scoring. The headline was previously computed
    // from the 40 rows above while being captioned with the un-limited count —
    // and because record-calls.ts writes FX after censorship, those 40 would
    // have been almost entirely one leg presented as the whole book.
    const scoredRows = (await sql`
      SELECT kind, country_code, probability::float AS probability, base_rate::float AS base_rate,
             status, resolved_at::text AS resolved_at
      FROM calls WHERE status <> 'pending' AND kind <> 'seismicity_window'
    `) as unknown as Array<{
      kind: string;
      country_code: string;
      probability: number;
      base_rate: number | null;
      status: string;
      resolved_at: string | null;
    }>;

    const totals = (await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending' AND kind <> 'seismicity_window')::int AS open,
        COUNT(*) FILTER (WHERE status <> 'pending' AND kind <> 'seismicity_window')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'hit' AND kind <> 'seismicity_window')::int AS hits,
        MIN(resolves_on) FILTER (WHERE status = 'pending')::text AS next_resolves,
        MIN(made_on)::text AS first_call
      FROM calls
    `) as unknown as Array<{
      open: number;
      resolved: number;
      hits: number;
      next_resolves: string | null;
      first_call: string | null;
    }>;
    const t = totals[0];

    const scored: ScoredCall[] = scoredRows.map((c) => ({
      probability: c.probability,
      outcome: c.status === 'hit' ? 1 : 0,
      baseRate: c.base_rate ?? undefined,
    }));
    const asOf = new Date().toISOString().slice(0, 10);

    const parts: string[] = [];
    parts.push('<div class="rule"></div><div class="kicker">The Ledger</div>');
    parts.push('<h1>Every call we make, scored against something that isn’t us.</h1>');
    parts.push(
      '<p class="lede">Each call names an external source, a threshold and a resolution date before the outcome is known. ' +
        'The score is published whether it flatters us or not — a record that only reports its wins is not a record.</p>',
    );

    // THE CONSTRUCTION DISCLOSURE, published 2026-08-28 — before the first
    // resolution on 09-05, and deliberately so. record-calls.ts computes
    // probability = blendRates(recent, longRun) while storing base_rate =
    // longRun: the forecast and the baseline are two summaries of the SAME
    // series. Stating that after a bad number would be an excuse, and everyone
    // would know which it was. Stating it first makes it methodology.
    parts.push(
      '<div class="rule"></div><div class="kicker">Read this before the first score</div>' +
        '<h2>How we forecast, and what this first score can and cannot show</h2>' +
        '<p class="lede">Each call’s probability is that country’s own long-run rate, re-weighted toward its ' +
        'recent behaviour. The base rate we score against is that same long-run rate. So this first cohort is ' +
        'not a test of whether we understand the world — it is a narrower and more answerable question: ' +
        '<strong>does weighting recent behaviour beat the long-run average?</strong> A negative score means it ' +
        'does not, and that is a valid result we expect to publish. It is also why we withhold any skill number ' +
        'until three independent resolution batches exist: one fortnight cannot separate a forecasting method ' +
        'from the weather it happened to land in.</p>',
    );

    // The honest hero. With nothing resolved, report the open book rather than
    // borrowing a confident number from somewhere it does not belong.
    parts.push('<div class="grid">');
    if (t.resolved === 0) {
      parts.push(
        `<div class="stat"><div class="v">${t.open}</div><div class="l">calls open</div>` +
          `<div class="d">${t.next_resolves ? `first resolves ${esc(t.next_resolves)}` : ''}</div>` +
          `<div class="p">as of ${asOf} · calls table</div></div>`,
      );
      parts.push(
        '<div class="stat"><div class="v">—</div><div class="l">skill vs base rate</div>' +
          '<div class="d">nothing has resolved yet</div>' +
          '<div class="p">reported from the first resolution onward</div></div>',
      );
    } else {
      // PER-KIND, and no pooled headline. An independent review (2026-08-28)
      // refuted the single mixed "skill vs base rate" tile that used to sit
      // here: censorship and FX have different resolvers, base-rate
      // estimators and dependence structures, so a row-weighted average
      // across them reports whichever kind wrote more rows. And with one
      // resolution batch, no skill number separates forecasting from the
      // fortnight the world happened to have — so it is withheld and SAID to
      // be withheld, which is the more honest artifact anyway.
      const br = baseRate(scored);
      parts.push(
        `<div class="stat"><div class="v">${t.hits}/${t.resolved}</div><div class="l">calls that landed</div>` +
          `<div class="d">${Number.isFinite(br) ? `stated base rate ${pct(br)}` : ''}</div>` +
          `<div class="p">as of ${asOf} · calls table</div></div>`,
      );

      const batches = resolutionBatches(scoredRows.map((r) => (r.resolved_at ?? '').slice(0, 10)));
      const units = independentUnits(scoredRows.map((r) => `${r.kind}:${r.country_code}`));
      parts.push(
        `<div class="stat"><div class="v">${units}</div><div class="l">independent units</div>` +
          `<div class="d">${t.resolved} rows, but one call per country per day overlaps 13 of 14 days</div>` +
          `<div class="p">distinct country × kind · ${batches} resolution batch${batches === 1 ? '' : 'es'}</div></div>`,
      );

      if (batches < MIN_RESOLUTION_BATCHES) {
        parts.push(
          `<div class="stat"><div class="v">—</div><div class="l">skill vs base rate</div>` +
            `<div class="d">withheld until ${MIN_RESOLUTION_BATCHES} independent resolution batches</div>` +
            `<div class="p">one batch cannot separate skill from one fortnight's weather</div></div>`,
        );
      }
      parts.push('</div>');

      // Per-kind table: the honest unit of scoring.
      parts.push('<div class="rule"></div><div class="kicker">By domain</div><h2>Scored separately, on purpose</h2>');
      parts.push(
        '<p class="lede">Each domain has its own resolver, its own base-rate estimator and its own ' +
          'dependence structure. Pooling them would produce one number dominated by whichever domain ' +
          'happened to write more rows, which is not a track record.</p>',
      );
      const kinds = [...new Set(scoredRows.map((r) => r.kind))];
      for (const kind of kinds) {
        const rows = scoredRows.filter((r) => r.kind === kind);
        const ks: ScoredCall[] = rows.map((r) => ({
          probability: r.probability,
          outcome: (r.status === 'hit' ? 1 : 0) as 0 | 1,
          baseRate: r.base_rate ?? undefined,
        }));
        const kBatches = resolutionBatches(rows.map((r) => (r.resolved_at ?? '').slice(0, 10)));
        const kHits = rows.filter((r) => r.status === 'hit').length;
        const kBrier = brierScore(ks);
        const kSkill = kBatches >= MIN_RESOLUTION_BATCHES ? brierSkillScore(ks) : NaN;
        const trail = Number.isFinite(kSkill)
          ? `skill ${kSkill >= 0 ? '+' : ''}${Math.round(kSkill * 100)}%`
          : 'skill withheld';
        parts.push(
          `<div class="row pending"><span class="lead">${esc(kind === 'fx_devaluation' ? 'FX' : 'OONI')}</span>` +
            `<span class="det">${esc(KIND_LABEL[kind] ?? kind)} — ${kHits}/${rows.length} landed` +
            `${Number.isFinite(kBrier) ? `, Brier ${kBrier.toFixed(3)}` : ''}, ` +
            `${independentUnits(rows.map((r) => r.country_code))} units, ${kBatches} batch${kBatches === 1 ? '' : 'es'}` +
            `</span><span class="trail">${esc(trail)}</span></div>`,
        );
      }
      parts.push('<div class="grid">');
    }
    parts.push('</div>');

    parts.push('<div class="rule"></div><div class="kicker">What counts</div><h2>Resolved by someone else</h2>');
    parts.push(
      '<p class="lede">Nothing here is scored against a NexusWatch number. That distinction is the whole product: ' +
        'an index that grades its own forecasts can accumulate rows forever without ever being wrong. ' +
        'One domain is deliberately unglamorous: USGS seismicity windows, stated at their own climatology. ' +
        'They are a calibration harness — a domain where the right answer is computable, so a broken scoring ' +
        'pipeline cannot hide — and they are excluded from the claim counts above.</p>',
    );
    const kinds = new Map<string, number>();
    for (const c of open) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
    for (const [kind] of kinds) {
      parts.push(
        `<div class="row pending"><span class="lead">${esc(kind === 'fx_devaluation' ? 'FX' : 'OONI')}</span>` +
          `<span class="det">${esc(KIND_LABEL[kind] ?? kind)}</span><span class="trail">open</span></div>`,
      );
    }

    parts.push('<div class="rule"></div><div class="kicker">Open</div><h2>What we are currently claiming</h2>');
    parts.push(
      '<p class="lede">Ordered by how far each call sits from that country’s own base rate — the ones at the top ' +
        'are where we are actually saying something rather than restating how often it happens anyway.</p>',
    );
    for (const c of open) {
      const div = c.base_rate === null ? null : (c.probability - c.base_rate) * 100;
      const trail =
        div === null ? pct(c.probability) : `${pct(c.probability)} (${div >= 0 ? '+' : ''}${div.toFixed(0)}pts)`;
      parts.push(
        `<a class="row pending" href="/call/${c.id}"><span class="lead">${esc(c.country_code)}</span>` +
          `<span class="det">${esc(c.claim)}</span><span class="trail">${esc(trail)}</span></a>`,
      );
    }

    if (resolved.length > 0) {
      parts.push('<div class="rule"></div><div class="kicker">Resolved</div><h2>Including where we were wrong</h2>');
      const ordered = [...resolved].sort(
        (a, b) =>
          Math.abs((b.status === 'hit' ? 1 : 0) - b.probability) -
          Math.abs((a.status === 'hit' ? 1 : 0) - a.probability),
      );
      for (const c of ordered) {
        parts.push(
          `<a class="row ${c.status === 'hit' ? 'hit' : 'miss'}" href="/call/${c.id}"><span class="lead">${esc(c.country_code)}</span>` +
            `<span class="det">${esc(c.claim)} — said ${pct(c.probability)}</span>` +
            `<span class="trail">${c.status === 'hit' ? 'HIT' : 'MISS'}</span></a>`,
        );
      }
    }

    parts.push(
      `<p class="foot">The brief opens with this ledger, every morning. ` +
        `<a href="https://nexuswatch.dev/briefs">Read the latest issue</a> · ` +
        `<a href="https://nexuswatch.dev/">Subscribe</a>` +
        (t.first_call ? ` · first call recorded ${esc(t.first_call)}` : '') +
        `</p>`,
    );

    return res.send(shell(parts.join('\n'), { title, description, canonicalPath: '/ledger', ogImage }));
  } catch (err) {
    console.error('[ledger] failed:', err instanceof Error ? err.message : err);
    return res.send(
      shell('<h1>The Ledger</h1><p class="lede">The ledger query failed. Nothing is being hidden.</p>', {
        title,
        description,
        canonicalPath: '/ledger',
        ogImage,
      }),
    );
  }
}
