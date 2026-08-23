import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import {
  brierScore,
  brierSkillScore,
  baseRate,
  calibrationBins,
  murphyDecomposition,
  type ScoredCall,
} from './_lib/calls.js';
import { colors, fonts } from '../src/styles/email-tokens.js';

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
};

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function shell(body: string, title: string, description: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="https://nexuswatch.dev/ledger">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="https://nexuswatch.dev/ledger">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@NexusWatchDev">
<style>
  :root {
    --ink: ${colors.textPrimary}; --ink2: ${colors.textSecondary}; --ink3: ${colors.textTertiary};
    --page: ${colors.bgPage}; --card: ${colors.bgCard}; --rule: ${colors.border};
    --gold: ${colors.divider}; --accent: ${colors.accent};
    --up: ${colors.up}; --down: ${colors.down};
  }
  body { margin:0; background:var(--page); color:var(--ink); font-family:${fonts.sans}; }
  .wrap { max-width:940px; margin:0 auto; padding:56px 24px 96px; }
  .rule { height:2px; background:var(--gold); margin:64px 0 14px; }
  .rule:first-of-type { margin-top:0; }
  .kicker { font-family:${fonts.mono}; font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--accent); margin-bottom:8px; }
  h1,h2 { font-family:${fonts.serif}; font-weight:600; line-height:1.15; margin:0; }
  h1 { font-size:clamp(30px,4vw,46px); }
  h2 { font-size:clamp(24px,3vw,34px); }
  .lede { font-size:17px; line-height:1.62; color:var(--ink2); max-width:62ch; margin:16px 0 0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:32px; margin:32px 0; }
  .stat .v { font-family:${fonts.mono}; font-variant-numeric:tabular-nums; font-size:clamp(48px,8vw,96px); line-height:1; letter-spacing:-.02em; }
  .stat .l { font-family:${fonts.serif}; font-size:20px; margin-top:10px; }
  .stat .d { font-size:14px; color:var(--ink2); margin-top:4px; }
  .stat .p { font-family:${fonts.mono}; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink3); margin-top:12px; }
  .row { display:flex; align-items:baseline; gap:14px; padding:11px 0; border-bottom:1px solid var(--rule); }
  .row .lead { font-family:${fonts.mono}; font-variant-numeric:tabular-nums; font-size:15px; min-width:3.5em; }
  .row .det { font-size:14px; color:var(--ink2); flex:1 1 auto; }
  .row .trail { font-family:${fonts.mono}; font-variant-numeric:tabular-nums; font-size:15px; margin-left:auto; }
  .hit .trail { color:var(--up); } .miss .trail { color:var(--down); } .pending .trail { color:var(--ink3); }
  a { color:var(--accent); }
  .foot { margin-top:64px; font-size:14px; color:var(--ink2); }
</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('method_not_allowed');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900');

  const title = 'The Ledger — every call NexusWatch has made, scored';
  const description =
    'Dated, falsifiable calls resolved against external sources on a date fixed in advance, with the score published whether it flatters us or not.';

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.send(shell('<h1>The Ledger</h1><p class="lede">Temporarily unavailable.</p>', title, description));
  }

  try {
    const sql = neon(dbUrl);
    const open = (await sql`
      SELECT kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, resolves_on::text AS resolves_on, status
      FROM calls WHERE status = 'pending'
      ORDER BY ABS(probability - COALESCE(base_rate, probability)) DESC, probability DESC
      LIMIT 40
    `) as unknown as CallRow[];

    // Display list, capped. The STATISTICS below must not be computed from
    // this — see `scoredRows`.
    const resolved = (await sql`
      SELECT kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, resolves_on::text AS resolves_on, status
      FROM calls WHERE status <> 'pending'
      ORDER BY resolved_at DESC LIMIT 40
    `) as unknown as CallRow[];

    // Every resolved call, for scoring. The headline was previously computed
    // from the 40 rows above while being captioned with the un-limited count —
    // and because record-calls.ts writes FX after censorship, those 40 would
    // have been almost entirely one leg presented as the whole book.
    const scoredRows = (await sql`
      SELECT kind, probability::float AS probability, base_rate::float AS base_rate, status
      FROM calls WHERE status <> 'pending'
    `) as unknown as Array<{ kind: string; probability: number; base_rate: number | null; status: string }>;

    const totals = (await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS open,
        COUNT(*) FILTER (WHERE status <> 'pending')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'hit')::int AS hits,
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
      const skill = brierSkillScore(scored);
      const bs = brierScore(scored);
      const br = baseRate(scored);
      parts.push(
        `<div class="stat"><div class="v">${Number.isFinite(skill) ? `${skill >= 0 ? '+' : ''}${Math.round(skill * 100)}%` : '—'}</div>` +
          '<div class="l">skill vs base rate</div>' +
          `<div class="d">${Number.isFinite(skill) ? (skill >= 0 ? 'better than climatology' : 'WORSE than climatology') : 'not enough variation to score'}</div>` +
          `<div class="p">as of ${asOf} · ${t.resolved} resolved calls</div></div>`,
      );
      parts.push(
        `<div class="stat"><div class="v">${Number.isFinite(bs) ? bs.toFixed(3) : '—'}</div><div class="l">Brier score</div>` +
          '<div class="d">lower is better · 0.25 is always saying 50%</div>' +
          `<div class="p">as of ${asOf} · calls table</div></div>`,
      );
      parts.push(
        `<div class="stat"><div class="v">${t.hits}/${t.resolved}</div><div class="l">calls that landed</div>` +
          `<div class="d">${Number.isFinite(br) ? `base rate ${pct(br)}` : ''}</div>` +
          `<div class="p">as of ${asOf} · calls table</div></div>`,
      );
      const m = murphyDecomposition(scored);
      const bins = calibrationBins(scored);
      if (bins.length > 0) {
        parts.push(
          `<div class="stat"><div class="v">${m.reliability.toFixed(3)}</div><div class="l">reliability</div>` +
            `<div class="d">resolution ${m.resolution.toFixed(3)} · uncertainty ${m.uncertainty.toFixed(3)}</div>` +
            `<div class="p">Murphy decomposition · ${scored.length} calls</div></div>`,
        );
      }
    }
    parts.push('</div>');

    parts.push('<div class="rule"></div><div class="kicker">What counts</div><h2>Resolved by someone else</h2>');
    parts.push(
      '<p class="lede">Nothing here is scored against a NexusWatch number. That distinction is the whole product: ' +
        'an index that grades its own forecasts can accumulate rows forever without ever being wrong.</p>',
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
        `<div class="row pending"><span class="lead">${esc(c.country_code)}</span>` +
          `<span class="det">${esc(c.claim)}</span><span class="trail">${esc(trail)}</span></div>`,
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
          `<div class="row ${c.status === 'hit' ? 'hit' : 'miss'}"><span class="lead">${esc(c.country_code)}</span>` +
            `<span class="det">${esc(c.claim)} — said ${pct(c.probability)}</span>` +
            `<span class="trail">${c.status === 'hit' ? 'HIT' : 'MISS'}</span></div>`,
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

    return res.send(shell(parts.join('\n'), title, description));
  } catch (err) {
    console.error('[ledger] failed:', err instanceof Error ? err.message : err);
    return res.send(
      shell(
        '<h1>The Ledger</h1><p class="lede">The ledger query failed. Nothing is being hidden.</p>',
        title,
        description,
      ),
    );
  }
}
