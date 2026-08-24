import { createElement } from '../utils/dom.ts';
import { installSurfaces, stat, sectionRule, figure, capture, row } from '../ui/kit/index.ts';
import { setPageSeo } from '../utils/seo.ts';

/**
 * The Ledger — /ledger, and the front door for the only claim nobody else in
 * this category makes.
 *
 * WHAT IT REPLACES. /accuracy renders `assessments`, whose "predictions" are
 * 0.6*cii + 0.4*(cii + delta7) scored against the cii. It heroes an "accuracy
 * rate" of ~74%, which a stranger reads as a track record. Measured against a
 * naive no-change baseline that pipeline's skill is -37.3%: worse than assuming
 * nothing changes, on a series that mostly does not change. It is a closed loop,
 * and publishing it as a record was the largest untrue claim on the site.
 *
 * Every number here comes from a call resolved against something OUTSIDE
 * NexusWatch — OONI blocking measurements, daily FX reference rates — with the
 * threshold and the resolution date fixed before the outcome existed.
 *
 * THE PAGE IS NEARLY EMPTY UNTIL 2026-09-05, and it says so rather than
 * dressing an open book up as a history. That is the correct state for a ledger
 * three days old, and it is a better first impression than a confident number
 * that cannot survive one question.
 */

interface LedgerCall {
  id: number;
  kind: string;
  country_code: string;
  claim: string;
  probability: number;
  base_rate: number | null;
  made_on: string;
  resolves_on: string;
  status: string;
  evidence_count: number | null;
}

interface CalibrationBin {
  from: number;
  to: number;
  count: number;
  meanPredicted: number;
  observed: number;
}

interface LedgerData {
  generated_at: string;
  counts: {
    open: number;
    resolved: number;
    hits: number;
    next_resolves_on: string | null;
    first_call_on: string | null;
  };
  scoring: {
    brier: number | null;
    base_rate: number | null;
    skill_vs_base_rate: number | null;
    murphy: { reliability: number; resolution: number; uncertainty: number } | null;
    calibration: CalibrationBin[];
  };
  by_kind: Record<string, { open: number; resolved: number; hits: number; brier: number | null }>;
  open: LedgerCall[];
  resolved: LedgerCall[];
}

const KIND_LABEL: Record<string, string> = {
  censorship_event: 'Network interference',
  fx_devaluation: 'Currency depreciation',
  seismicity_window: 'Seismicity — calibration harness',
};

const KIND_RESOLVER: Record<string, string> = {
  censorship_event: 'OONI',
  fx_devaluation: 'FX reference rates',
  seismicity_window: 'USGS',
};

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** A reliability diagram: stated probability against observed frequency. */
function reliabilityPlot(bins: CalibrationBin[]): HTMLElement {
  const W = 340;
  const H = 340;
  const pad = 34;
  const x = (p: number) => pad + p * (W - pad * 2);
  const y = (p: number) => H - pad - p * (H - pad * 2);
  const ns = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('style', 'max-width:340px');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Reliability diagram: stated probability against observed frequency');

  const frame = document.createElementNS(ns, 'rect');
  frame.setAttribute('x', String(pad));
  frame.setAttribute('y', String(pad));
  frame.setAttribute('width', String(W - pad * 2));
  frame.setAttribute('height', String(H - pad * 2));
  frame.setAttribute('fill', 'none');
  frame.setAttribute('stroke', 'var(--color-border)');
  svg.appendChild(frame);

  // The diagonal is the argument: a calibrated forecaster's points sit on it.
  const diag = document.createElementNS(ns, 'line');
  diag.setAttribute('x1', String(x(0)));
  diag.setAttribute('y1', String(y(0)));
  diag.setAttribute('x2', String(x(1)));
  diag.setAttribute('y2', String(y(1)));
  diag.setAttribute('stroke', 'var(--color-divider)');
  diag.setAttribute('stroke-width', '1.5');
  svg.appendChild(diag);

  const maxN = Math.max(1, ...bins.map((b) => b.count));
  for (const b of bins) {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', String(x(b.meanPredicted)));
    dot.setAttribute('cy', String(y(b.observed)));
    dot.setAttribute('r', String(3 + 7 * Math.sqrt(b.count / maxN)));
    dot.setAttribute('fill', 'var(--color-accent)');
    dot.setAttribute('fill-opacity', '0.75');
    const t = document.createElementNS(ns, 'title');
    t.textContent = `stated ${pct(b.meanPredicted)}, happened ${pct(b.observed)} of ${b.count}`;
    dot.appendChild(t);
    svg.appendChild(dot);
  }

  for (const [v, label] of [
    [0, '0%'],
    [0.5, '50%'],
    [1, '100%'],
  ] as const) {
    const tx = document.createElementNS(ns, 'text');
    tx.setAttribute('x', String(x(v)));
    tx.setAttribute('y', String(H - pad + 16));
    tx.setAttribute('text-anchor', 'middle');
    tx.setAttribute('font-size', '10');
    tx.setAttribute('fill', 'var(--color-text-tertiary)');
    tx.textContent = label;
    svg.appendChild(tx);

    const ty = document.createElementNS(ns, 'text');
    ty.setAttribute('x', String(pad - 8));
    ty.setAttribute('y', String(y(v) + 3));
    ty.setAttribute('text-anchor', 'end');
    ty.setAttribute('font-size', '10');
    ty.setAttribute('fill', 'var(--color-text-tertiary)');
    ty.textContent = label;
    svg.appendChild(ty);
  }

  const wrap = createElement('div');
  wrap.appendChild(svg as unknown as HTMLElement);
  return wrap;
}

export async function renderLedgerPage(root: HTMLElement): Promise<void> {
  installSurfaces();
  setPageSeo({
    title: 'The Ledger — every call NexusWatch has made, scored',
    description:
      'Dated, falsifiable calls resolved against external sources, with the score published whether it flatters us or not.',
    canonicalPath: '/ledger',
  });

  root.textContent = '';
  const page = createElement('div', { className: 'surface-dossier nw-ledger' });
  const main = createElement('main', { className: 'nw-reading' });
  page.appendChild(main);
  root.appendChild(page);

  main.appendChild(
    sectionRule({
      kicker: 'THE LEDGER',
      title: 'Every call we make, scored against something that isn’t us.',
      lede:
        'Each call names an external source, a threshold and a resolution date before the outcome is known. ' +
        'The score is published whether it flatters us or not — a record that only reports its wins is not a record.',
    }),
  );

  const loading = createElement('p', { textContent: 'Loading the book…' });
  main.appendChild(loading);

  let data: LedgerData;
  try {
    const res = await fetch('/api/calls/ledger');
    if (!res.ok) throw new Error(String(res.status));
    data = (await res.json()) as LedgerData;
  } catch {
    loading.textContent = 'The ledger is unavailable right now. Nothing is being hidden — the query failed.';
    return;
  }
  loading.remove();

  const asOf = data.generated_at.slice(0, 10);
  const { counts, scoring } = data;

  // ---- The state of the book -------------------------------------------
  const grid = createElement('div', { className: 'nw-statgrid' });

  if (counts.resolved === 0) {
    // Honest hero for a ledger with nothing scored yet. The alternative — a
    // confident-looking number from somewhere else — is exactly the thing this
    // page exists to stop doing.
    grid.appendChild(
      stat({
        value: String(counts.open),
        label: 'calls open',
        detail: counts.next_resolves_on ? `first resolves ${counts.next_resolves_on}` : undefined,
        provenance: `as of ${asOf} · calls table`,
        size: 'hero',
      }),
    );
    grid.appendChild(
      stat({
        value: '—',
        label: 'skill vs base rate',
        detail: 'nothing has resolved yet',
        provenance: 'reported from the first resolution onward',
      }),
    );
  } else {
    const skill = scoring.skill_vs_base_rate;
    grid.appendChild(
      stat({
        value: skill === null ? '—' : `${skill >= 0 ? '+' : ''}${Math.round(skill * 100)}%`,
        label: 'skill vs base rate',
        detail:
          skill === null
            ? 'not enough variation to score'
            : skill >= 0
              ? 'better than climatology'
              : 'WORSE than climatology',
        provenance: `as of ${asOf} · ${counts.resolved} resolved calls`,
        size: 'hero',
      }),
    );
    grid.appendChild(
      stat({
        value: scoring.brier === null ? '—' : scoring.brier.toFixed(3),
        label: 'Brier score',
        detail: 'lower is better · 0.25 is always saying 50%',
        provenance: `as of ${asOf} · calls table`,
      }),
    );
    grid.appendChild(
      stat({
        value: `${counts.hits}/${counts.resolved}`,
        label: 'calls that landed',
        detail: scoring.base_rate === null ? undefined : `base rate ${pct(scoring.base_rate)}`,
        provenance: `as of ${asOf} · calls table`,
      }),
    );
  }
  main.appendChild(grid);

  // ---- What is being measured ------------------------------------------
  main.appendChild(
    sectionRule({
      kicker: 'WHAT COUNTS',
      title: 'Resolved by someone else',
      lede:
        'Nothing here is scored against a NexusWatch number. That distinction is the whole product: an index that ' +
        'grades its own forecasts can accumulate rows forever without ever being wrong.',
    }),
  );

  for (const [kind, k] of Object.entries(data.by_kind)) {
    main.appendChild(
      row({
        lead: KIND_RESOLVER[kind] ?? kind,
        detail: `${KIND_LABEL[kind] ?? kind} — ${k.open} open, ${k.resolved} resolved`,
        trail: k.brier === null ? 'not yet scored' : `Brier ${k.brier.toFixed(3)}`,
        state: k.resolved === 0 ? 'pending' : undefined,
      }),
    );
  }

  // ---- Calibration ------------------------------------------------------
  if (scoring.calibration.length > 0) {
    const m = scoring.murphy;
    main.appendChild(
      figure({
        title: 'CALIBRATION',
        caption:
          'When we say 70%, does it happen 70% of the time? Points on the diagonal are calibrated; ' +
          'dot size is how many calls sit in that band.' +
          (m
            ? ` Reliability ${m.reliability.toFixed(3)}, resolution ${m.resolution.toFixed(3)}, uncertainty ${m.uncertainty.toFixed(3)}.`
            : ''),
        axisNote: 'x: stated probability · y: observed frequency',
        source: `calls table, as of ${asOf}`,
        plot: reliabilityPlot(scoring.calibration),
      }),
    );
  }

  // ---- The open book ----------------------------------------------------
  main.appendChild(
    sectionRule({
      kicker: 'OPEN',
      title: 'What we are currently claiming',
      lede:
        'Ordered by how far each call sits from that country’s own base rate — the ones at the top are where ' +
        'we are actually saying something rather than restating how often it happens anyway.',
    }),
  );

  for (const c of data.open.slice(0, 25)) {
    const divergence = c.base_rate === null ? null : (c.probability - c.base_rate) * 100;
    main.appendChild(
      row({
        lead: c.country_code,
        detail: c.claim,
        trail:
          divergence === null
            ? pct(c.probability)
            : `${pct(c.probability)} (${divergence >= 0 ? '+' : ''}${divergence.toFixed(0)}pts)`,
        state: 'pending',
        href: `/call/${c.id}`,
      }),
    );
  }

  // ---- Where we were wrong ---------------------------------------------
  const misses = data.resolved.filter((c) => c.status === 'miss');
  if (data.resolved.length > 0) {
    main.appendChild(
      sectionRule({
        kicker: 'RESOLVED',
        title: misses.length > 0 ? 'Including where we were wrong' : 'Resolved calls',
        lede:
          'Confident misses first. A miss with a diagnosis is expertise; a miss hidden is the reason nobody ' +
          'trusts a risk score.',
      }),
    );
    const ordered = [...data.resolved].sort((a, b) => {
      const aErr = (a.status === 'hit' ? 1 : 0) - a.probability;
      const bErr = (b.status === 'hit' ? 1 : 0) - b.probability;
      return Math.abs(bErr) - Math.abs(aErr);
    });
    for (const c of ordered.slice(0, 25)) {
      main.appendChild(
        row({
          lead: c.country_code,
          detail: `${c.claim} — said ${pct(c.probability)}`,
          trail: c.status === 'hit' ? 'HIT' : 'MISS',
          state: c.status === 'hit' ? 'hit' : 'miss',
          href: `/call/${c.id}`,
        }),
      );
    }
  }

  // ---- Capture ----------------------------------------------------------
  main.appendChild(
    sectionRule({
      kicker: 'THE BRIEF',
      title: 'Every morning, starting with what resolved',
      lede: 'The brief opens with this ledger. One dated call, and what happened to the last one.',
    }),
  );
  main.appendChild(capture({ source: 'ledger', heading: undefined, note: undefined }));
}
