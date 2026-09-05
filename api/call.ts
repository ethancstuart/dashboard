import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { shell, esc, pct } from './_lib/ssr-shell.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

/**
 * Server-rendered /call/:id — one page per call, the citeable unit.
 *
 * WHY THIS EXISTS. A journalist, a researcher, or anyone checking our work
 * cannot cite "row 47 of a 130-row table". The unit of accountability is one
 * call: what we claimed, at what probability, against which external resolver,
 * with the criterion frozen on the day it was made — and then what happened.
 * This page is that unit, at a stable URL, in real HTML a crawler can read.
 *
 * Everything shown is what the calls row already froze at creation. Nothing is
 * recomputed at render time, because a criterion recomputed at read time is a
 * criterion that can drift — the same reason the resolver reads stored
 * threshold_pct/reference_value instead of re-deriving them.
 */

interface CallRow {
  id: number;
  made_on: string;
  kind: string;
  country_code: string;
  claim: string;
  probability: number;
  horizon_days: number;
  resolves_on: string;
  resolver: string;
  threshold: number;
  threshold_pct: number | null;
  reference_value: number | null;
  base_rate: number | null;
  status: string;
  evidence_count: number | null;
  resolved_at: string | null;
  void_reason: string | null;
}

interface HistoryRow {
  id: number;
  made_on: string;
  probability: number;
  status: string;
  resolves_on: string;
}

const KIND_LABEL: Record<string, string> = {
  censorship_event: 'Network interference (OONI)',
  fx_devaluation: 'Currency depreciation (FX reference rates)',
};

/** What the resolver will do / did — stated from the frozen fields only. */
function criterion(c: CallRow): string {
  if (c.kind === 'fx_devaluation' && c.threshold_pct !== null && c.reference_value !== null) {
    return (
      `Hit if the currency's peak rate against USD inside the window exceeds the issue-day reference ` +
      `(${c.reference_value}) by at least ${c.threshold_pct}%. Peak, not endpoint: a devaluation that ` +
      `retraces still happened.`
    );
  }
  return (
    `Hit if ${esc(c.resolver)} records at least ${c.threshold} qualifying ` +
    `event${c.threshold === 1 ? '' : 's'} inside the window.`
  );
}

function statusBlock(c: CallRow): string {
  if (c.status === 'pending') {
    return (
      `<div class="stat"><div class="v">OPEN</div><div class="l">not yet resolved</div>` +
      `<div class="d">resolves ${esc(c.resolves_on)}</div>` +
      `<div class="p">resolver: ${esc(c.resolver)}</div></div>`
    );
  }
  if (c.status === 'void') {
    return (
      `<div class="stat"><div class="v">VOID</div><div class="l">withdrawn before resolution</div>` +
      `<div class="d">${esc(c.void_reason ?? 'no reason recorded')}</div>` +
      `<div class="p">voids stay on the page — a deleted call is a moved goalpost</div></div>`
    );
  }
  const hit = c.status === 'hit';
  return (
    `<div class="stat"><div class="v" style="color:var(--${hit ? 'up' : 'down'})">${hit ? 'HIT' : 'MISS'}</div>` +
    `<div class="l">resolved ${c.resolved_at ? esc(c.resolved_at.slice(0, 10)) : esc(c.resolves_on)}</div>` +
    `<div class="d">${c.evidence_count !== null ? `${c.evidence_count} qualifying event${c.evidence_count === 1 ? '' : 's'} recorded` : 'resolved on the stored criterion'}</div>` +
    `<div class="p">resolver: ${esc(c.resolver)}</div></div>`
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('method_not_allowed');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const idRaw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = Number.parseInt(idRaw ?? '', 10);
  if (!Number.isInteger(id) || id <= 0 || String(id) !== idRaw) {
    return res.status(404).send(
      shell('<h1>No such call</h1><p class="lede">Call ids are integers from <a href="/ledger">the ledger</a>.</p>', {
        title: 'No such call — NexusWatch',
        description: 'This call id does not exist.',
        canonicalPath: '/ledger',
      }),
    );
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).send('database_not_configured');

  try {
    const sql = neon(dbUrl);
    const rows = (await sql`
      SELECT id, made_on::text AS made_on, kind, country_code, claim,
             probability::float AS probability, horizon_days, resolves_on::text AS resolves_on,
             resolver, threshold, threshold_pct::float AS threshold_pct,
             reference_value::float AS reference_value, base_rate::float AS base_rate,
             status, evidence_count, resolved_at::text AS resolved_at, void_reason
      FROM calls WHERE id = ${id}
    `) as unknown as CallRow[];

    if (rows.length === 0) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(404).send(
        shell(
          '<h1>No such call</h1><p class="lede">Nothing was ever recorded under this id. The full book is on <a href="/ledger">the ledger</a>.</p>',
          {
            title: 'No such call — NexusWatch',
            description: 'This call id does not exist.',
            canonicalPath: '/ledger',
          },
        ),
      );
    }
    const c = rows[0];

    // An open call can resolve any day; a resolved one is immutable.
    res.setHeader(
      'Cache-Control',
      c.status === 'pending' ? 'public, max-age=300, s-maxage=900' : 'public, max-age=3600, s-maxage=86400',
    );

    const history = (await sql`
      SELECT id, made_on::text AS made_on, probability::float AS probability,
             status, resolves_on::text AS resolves_on
      FROM calls
      WHERE country_code = ${c.country_code} AND kind = ${c.kind} AND id <> ${id}
      ORDER BY made_on DESC LIMIT 20
    `) as unknown as HistoryRow[];

    const kindLabel = KIND_LABEL[c.kind] ?? c.kind;
    const divergence = c.base_rate === null ? null : Math.round((c.probability - c.base_rate) * 100);

    const parts: string[] = [];
    parts.push(
      `<div class="rule"></div><div class="kicker">Call #${c.id} · ${esc(c.country_code)} · ${esc(kindLabel)}</div>`,
    );
    parts.push(`<h1>${esc(c.claim)}</h1>`);
    parts.push(
      `<p class="lede">Made ${esc(c.made_on)}, resolving ${esc(c.resolves_on)} — a ${c.horizon_days}-day window, ` +
        `fixed before the outcome was known. Every field on this page was frozen when the call was made.</p>`,
    );

    parts.push('<div class="grid">');
    parts.push(
      `<div class="stat"><div class="v">${pct(c.probability)}</div><div class="l">what we said</div>` +
        `<div class="d">stated on ${esc(c.made_on)}, before the window opened</div>` +
        `<div class="p">calls table · probability</div></div>`,
    );
    if (c.base_rate !== null) {
      parts.push(
        `<div class="stat"><div class="v">${pct(c.base_rate)}</div><div class="l">how often it happens anyway</div>` +
          `<div class="d">${esc(c.country_code)}'s own base rate at issue` +
          `${divergence !== null ? ` — we sit ${divergence >= 0 ? '+' : ''}${divergence}pts from it` : ''}</div>` +
          `<div class="p">calls table · base_rate</div></div>`,
      );
    }
    parts.push(statusBlock(c));
    parts.push('</div>');

    parts.push('<div class="rule"></div><div class="kicker">The criterion</div><h2>Frozen at issue</h2>');
    parts.push(`<p class="lede">${criterion(c)}</p>`);
    parts.push(
      `<p class="lede">The resolver is external — ${esc(c.resolver)} — and the daily snapshot of this call in ` +
        `<a href="https://github.com/ethancstuart/nexus-watch/tree/main/ledger-snapshots">ledger-snapshots/</a> ` +
        `carries GitHub's timestamps. Diff any two dated files to verify nothing above moved after ${esc(c.made_on)}.</p>`,
    );

    if (history.length > 0) {
      parts.push(
        `<div class="rule"></div><div class="kicker">History</div><h2>Every ${esc(c.country_code)} ${esc(kindLabel.split(' ')[0].toLowerCase())} call</h2>`,
      );
      for (const h of history) {
        const state = h.status === 'hit' ? 'hit' : h.status === 'miss' ? 'miss' : 'pending';
        const trail =
          h.status === 'pending'
            ? `${pct(h.probability)} · resolves ${esc(h.resolves_on)}`
            : h.status === 'void'
              ? 'VOID'
              : `said ${pct(h.probability)} · ${h.status.toUpperCase()}`;
        parts.push(
          `<a class="row ${state}" href="/call/${h.id}"><span class="lead">${esc(h.made_on)}</span>` +
            `<span class="det">call #${h.id}</span><span class="trail">${trail}</span></a>`,
        );
      }
    }

    parts.push(
      `<p class="foot"><a href="/ledger">← The full ledger</a> · ` +
        `<a href="/api/calls/ledger">the same data as JSON</a></p>`,
    );

    const title = `${c.country_code}: ${c.claim} — Call #${c.id} · NexusWatch`;
    const description =
      `NexusWatch said ${pct(c.probability)} on ${c.made_on}, resolving ${c.resolves_on} against ${c.resolver}. ` +
      (c.status === 'pending'
        ? 'Still open.'
        : c.status === 'void'
          ? 'Voided before resolution.'
          : `Result: ${c.status.toUpperCase()}.`);

    // The unfurl card. /call/:id is the citeable unit — the thing a journalist
    // pastes into a post — and it previously declared a large twitter card
    // with no image, which unfurls to nothing. The card renders the claim, the
    // stated probability and the resolution date off this same row.
    const ogImage = `https://nexuswatch.dev/api/og?type=call&id=${c.id}`;

    return res
      .status(200)
      .send(shell(parts.join('\n'), { title, description, canonicalPath: `/call/${c.id}`, ogImage }));
  } catch (err) {
    console.error('[call] failed:', err instanceof Error ? err.message : err);
    return res.status(500).send('call_unavailable');
  }
}
