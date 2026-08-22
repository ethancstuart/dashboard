/**
 * Time scrubber — writes to the global `timeCursor`.
 *
 * Range picker (24h / 7d / 30d / 1y) sets the slider's extent. Default
 * pos = right edge = "live" (now). Dragging left scrubs into the past;
 * the globe re-renders day/night terminator + marker positions through
 * the timeCursor subscription.
 *
 * 2026-05 tier-up Phase 5.
 */

import { timeCursor } from '../state/timeCursor.ts';
import { readRouteParams } from '../router.ts';

export type ScrubRange = '24h' | '7d' | '30d' | '1y';

const RANGE_MS: Record<ScrubRange, number> = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
  '1y': 365 * 24 * 3600 * 1000,
};

export interface TimeScrubberOptions {
  initialRange?: ScrubRange;
  /** URL sync writes ?t=ISO&range=R to window.location. */
  syncUrl?: boolean;
}

export class TimeScrubber {
  private root: HTMLElement;
  private opts: TimeScrubberOptions;
  private slider!: HTMLInputElement;
  private rangeBtns!: HTMLButtonElement[];
  private label!: HTMLElement;
  private rangeBadge!: HTMLElement;
  private liveBtn!: HTMLButtonElement;
  private currentRange: ScrubRange;

  constructor(root: HTMLElement, opts: TimeScrubberOptions = {}) {
    this.root = root;
    this.opts = opts;
    this.currentRange = opts.initialRange ?? '7d';
    this.scaffold();
    this.wire();
    this.applyFromUrl();
  }

  private scaffold(): void {
    this.root.classList.add('nw-scrub');
    this.root.innerHTML = `
      <div class="nw-scrub-top">
        <span class="nw-scrub-eyebrow">Time scrubber</span>
        <span class="nw-scrub-range-badge" data-range-badge>${this.currentRange}</span>
        <span class="nw-scrub-label" data-label>LIVE</span>
        <button class="nw-scrub-live" data-live aria-pressed="true">● Live</button>
      </div>
      <div class="nw-scrub-row">
        ${(['24h', '7d', '30d', '1y'] as ScrubRange[])
          .map(
            (r) =>
              `<button class="nw-scrub-range" data-range="${r}" aria-pressed="${
                r === this.currentRange ? 'true' : 'false'
              }">${r}</button>`,
          )
          .join('')}
        <input class="nw-scrub-slider" type="range" min="0" max="1000" value="1000" data-slider aria-label="Time position" />
      </div>
    `;
    this.slider = this.root.querySelector('[data-slider]') as HTMLInputElement;
    this.label = this.root.querySelector('[data-label]') as HTMLElement;
    this.rangeBadge = this.root.querySelector('[data-range-badge]') as HTMLElement;
    this.liveBtn = this.root.querySelector('[data-live]') as HTMLButtonElement;
    this.rangeBtns = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-range]'));
  }

  private wire(): void {
    this.slider.addEventListener('input', () => this.applySlider());
    this.slider.addEventListener('change', () => this.applySlider());
    for (const btn of this.rangeBtns) {
      btn.addEventListener('click', () => {
        this.currentRange = btn.dataset.range as ScrubRange;
        for (const b of this.rangeBtns) b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        this.rangeBadge.textContent = this.currentRange;
        this.applySlider();
      });
    }
    this.liveBtn.addEventListener('click', () => {
      this.slider.value = '1000';
      timeCursor.reset();
      this.label.textContent = 'LIVE';
      this.liveBtn.setAttribute('aria-pressed', 'true');
      if (this.opts.syncUrl) this.clearUrl();
    });
  }

  private applySlider(): void {
    const v = Number(this.slider.value);
    const max = Number(this.slider.max);
    const ageMs = ((max - v) / max) * RANGE_MS[this.currentRange];
    const date = new Date(Date.now() - ageMs);
    timeCursor.set(date, { live: ageMs === 0 });
    this.label.textContent =
      ageMs === 0
        ? 'LIVE'
        : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    this.liveBtn.setAttribute('aria-pressed', ageMs === 0 ? 'true' : 'false');
    if (this.opts.syncUrl) this.writeUrl(date);
  }

  // Paths, not fragments — the router is path-first (see src/router.ts).
  // The old `hash.split('?')[0]` base is '' on a clean URL, which made
  // clearUrl() a no-op: replaceState('') resolves to the current URL.
  private writeUrl(date: Date): void {
    const params = readRouteParams();
    params.set('t', date.toISOString());
    params.set('range', this.currentRange);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }

  private clearUrl(): void {
    window.history.replaceState(null, '', window.location.pathname);
  }

  private applyFromUrl(): void {
    const params = readRouteParams();
    if (!params.has('t') && !params.has('range')) return;
    const r = params.get('range') as ScrubRange | null;
    if (r && RANGE_MS[r] != null) {
      this.currentRange = r;
      for (const b of this.rangeBtns) b.setAttribute('aria-pressed', b.dataset.range === r ? 'true' : 'false');
      this.rangeBadge.textContent = r;
    }
    const t = params.get('t');
    if (t) {
      const date = new Date(t);
      if (!Number.isNaN(date.getTime())) {
        const ageMs = Date.now() - date.getTime();
        const frac = Math.max(0, Math.min(1, 1 - ageMs / RANGE_MS[this.currentRange]));
        this.slider.value = String(Math.round(frac * 1000));
        timeCursor.set(date, { live: ageMs < 60_000 });
        this.label.textContent = date.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
        this.liveBtn.setAttribute('aria-pressed', 'false');
      }
    }
  }
}
