import { createElement } from '../../utils/dom.ts';

export { installSurfaces, surfaceCss } from './surfaces.ts';

/**
 * The four components that carry the product.
 *
 * Deliberately four. The repo already has 33 pages and a component per page;
 * what it lacks is the handful of repeated marks that would make those pages
 * read as chapters of one document rather than as separate projects. These are
 * the marks that repeat: a measurement, a section anchor, a figure in an
 * argument, and the email capture.
 *
 * Plain functions returning HTMLElement, matching `createElement` in
 * src/utils/dom.ts. No framework — that constraint is real here and a React
 * rewrite is not on the table.
 */

// ---------------------------------------------------------------------------

export interface StatOptions {
  /** The measurement itself. Pre-formatted — this does not do numerics. */
  value: string;
  /** What it measures. */
  label: string;
  /**
   * When the number is from and what produced it. REQUIRED, and that is the
   * point: you cannot render a number on this site without saying where it came
   * from. In a product whose entire claim is a published track record, an
   * unattributed figure is the thing that costs you the reader — and the old
   * map loading screen counted up "50 countries · 13 sources" on a timer, with
   * every figure wrong, which is exactly what a required provenance slot makes
   * impossible to write.
   */
  provenance: string;
  /** hero for the one number a page is about; section inside a block; inline in prose. */
  size?: 'hero' | 'section' | 'inline';
  /** Optional short qualifier under the label, e.g. "7-day horizon". */
  detail?: string;
}

export function stat(opts: StatOptions): HTMLElement {
  const { value, label, provenance, size = 'section', detail } = opts;
  if (!provenance || !provenance.trim()) {
    throw new Error('stat(): provenance is required — a number without a source does not ship');
  }

  const root = createElement('div', { className: `nw-stat nw-stat--${size}` });
  const v = createElement('div', { className: 'nw-stat__value', textContent: value });
  const l = createElement('div', { className: 'nw-stat__label', textContent: label });
  root.append(v, l);
  if (detail) root.appendChild(createElement('div', { className: 'nw-stat__detail', textContent: detail }));
  root.appendChild(createElement('div', { className: 'nw-stat__provenance', textContent: provenance }));
  return root;
}

// ---------------------------------------------------------------------------

export interface SectionRuleOptions {
  /** Mono kicker above the title. */
  kicker: string;
  /** Serif title. */
  title: string;
  /** Optional one-sentence lede. */
  lede?: string;
}

/**
 * The repeated anchor: a gold hairline, a mono kicker, a serif title.
 *
 * Replaces the uppercase-mono `<h2>` on every reading surface. Uppercase mono
 * headers stay on the map HUD, where density is functional; on a reading
 * surface they are the loudest "built by a developer" tell in the product.
 */
export function sectionRule(opts: SectionRuleOptions): HTMLElement {
  const root = createElement('header', { className: 'nw-section' });
  root.appendChild(createElement('div', { className: 'nw-section__rule' }));
  root.appendChild(createElement('div', { className: 'nw-section__kicker', textContent: opts.kicker }));
  root.appendChild(createElement('h2', { className: 'nw-section__title', textContent: opts.title }));
  if (opts.lede) root.appendChild(createElement('p', { className: 'nw-section__lede', textContent: opts.lede }));
  return root;
}

// ---------------------------------------------------------------------------

export interface FigureOptions {
  title: string;
  /** What the reader should take from it, in plain English. */
  caption?: string;
  /** Axis or unit note. */
  axisNote?: string;
  /** Where the data came from. Required, for the same reason stat() requires it. */
  source: string;
  /** The plot itself. */
  plot: HTMLElement;
}

/**
 * A `<figure>` frame with a mandatory source line.
 *
 * This is what stops the ledger reading as a data dump: charts stop being
 * widgets and become figures in an argument. Everything numeric on the ledger
 * renders inside one.
 */
export function figure(opts: FigureOptions): HTMLElement {
  if (!opts.source || !opts.source.trim()) {
    throw new Error('figure(): source is required — an unattributed chart is a claim without a citation');
  }
  const root = createElement('figure', { className: 'nw-figure' });
  root.appendChild(createElement('div', { className: 'nw-figure__title', textContent: opts.title }));
  if (opts.caption)
    root.appendChild(createElement('p', { className: 'nw-figure__caption', textContent: opts.caption }));
  const plotWrap = createElement('div', { className: 'nw-figure__plot' });
  plotWrap.appendChild(opts.plot);
  root.appendChild(plotWrap);
  const cap = createElement('figcaption', { className: 'nw-figure__meta' });
  if (opts.axisNote)
    cap.appendChild(createElement('span', { className: 'nw-figure__axis', textContent: opts.axisNote }));
  cap.appendChild(createElement('span', { className: 'nw-figure__source', textContent: opts.source }));
  root.appendChild(cap);
  return root;
}

// ---------------------------------------------------------------------------

export interface CaptureOptions {
  /** Where the submission is attributed. */
  source: string;
  /** Button text. */
  cta?: string;
  /** Heading above the field. */
  heading?: string;
  /** Supporting line. */
  note?: string;
}

/**
 * The one email capture.
 *
 * There are currently three implementations posting to two different endpoints
 * — landing.ts, briefs.ts, and the orphaned welcome.ts — which is the
 * mechanical reason capture is broken and why the only 3 subscribers all came
 * through a fourth path. One implementation, one endpoint, one success state.
 */
export function capture(opts: CaptureOptions): HTMLElement {
  const { source, cta = 'Get tomorrow’s brief', heading, note } = opts;

  const root = createElement('div', { className: 'nw-capture' });
  if (heading) root.appendChild(createElement('div', { className: 'nw-capture__heading', textContent: heading }));
  if (note) root.appendChild(createElement('p', { className: 'nw-capture__note', textContent: note }));

  const form = createElement('form', { className: 'nw-capture__form' });
  const input = createElement('input', { className: 'nw-capture__input' });
  input.type = 'email';
  input.required = true;
  input.placeholder = 'you@example.com';
  input.setAttribute('aria-label', 'Email address');

  const button = createElement('button', { className: 'nw-capture__button', textContent: cta });
  button.type = 'submit';

  const status = createElement('div', { className: 'nw-capture__status' });
  status.setAttribute('role', 'status');

  form.append(input, button);
  root.append(form, status);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      status.textContent = 'Enter a valid email.';
      status.dataset.state = 'err';
      return;
    }
    status.textContent = 'Subscribing…';
    status.dataset.state = '';
    button.disabled = true;

    void fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    })
      .then((r) => r.json() as Promise<{ success?: boolean; error?: string }>)
      .then((data) => {
        if (data.success) {
          status.textContent = 'You’re in. First brief tomorrow.';
          status.dataset.state = 'ok';
          form.reset();
        } else {
          status.textContent = data.error || 'That didn’t work — try again.';
          status.dataset.state = 'err';
        }
      })
      .catch(() => {
        status.textContent = 'Network error. Try again.';
        status.dataset.state = 'err';
      })
      .finally(() => {
        button.disabled = false;
      });
  });

  return root;
}

// ---------------------------------------------------------------------------

export interface RowOptions {
  /** Mono, left. */
  lead: string;
  /** Ink, right. */
  trail: string;
  /** Optional middle detail. */
  detail?: string;
  /** Optional state for colouring: hit / miss / pending. */
  state?: 'hit' | 'miss' | 'pending';
  /**
   * Optional destination — the row renders as a real <a>. Used by the ledger to
   * link each call to its /call/:id page; a plain anchor deliberately bypasses
   * the SPA router so the server-rendered call document is what loads.
   */
  href?: string;
}

/** The half-component: a mono-left / ink-right line, used by every list. */
export function row(opts: RowOptions): HTMLElement {
  const root = createElement(opts.href ? 'a' : 'div', { className: 'nw-row' });
  if (opts.href) (root as HTMLAnchorElement).href = opts.href;
  if (opts.state) root.dataset.state = opts.state;
  root.appendChild(createElement('span', { className: 'nw-row__lead', textContent: opts.lead }));
  if (opts.detail) root.appendChild(createElement('span', { className: 'nw-row__detail', textContent: opts.detail }));
  root.appendChild(createElement('span', { className: 'nw-row__trail', textContent: opts.trail }));
  return root;
}
