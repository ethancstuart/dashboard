/**
 * The Call Ledger — dated, falsifiable predictions scored against EXTERNAL
 * ground truth.
 *
 * WHY THIS EXISTS. `api/cron/record-assessments.ts:85` generates every
 * "prediction" as `0.6·score + 0.4·(score + Δ7)` — a mechanical extrapolation
 * of the CII — and then scores it against the CII. The system forecasts its own
 * output. Measured 2026-08-22, that pipeline's skill against a naive no-change
 * baseline is **−37.3%** (MAE 1.263 vs 0.920 over 10,215 scored rows): worse
 * than assuming nothing changes, on a series that mostly does not change. It is
 * a closed loop, and a closed loop cannot be a track record no matter how many
 * rows it accumulates.
 *
 * A call in this module is different in one specific way: **nothing about its
 * resolution touches NexusWatch's own numbers.** A call names an external
 * source, a threshold and a date before the fact, and something outside this
 * system decides whether it happened.
 *
 * ONE RESOLVER IS LIVE TODAY, and the reason the other is not is worth
 * recording, because its row count is misleading:
 *
 *   - `censorship_event` → `ooni_measurements`. LIVE. 39 countries, daily
 *     since 2026-04-18, 4-6 confirmed blocking events a day. Confirmed
 *     blocking is among the most reliable open leading indicators of a
 *     political crackdown, and it is a genuine per-country time series.
 *
 *   - `sanctions_designation` → `sanctions_events`. NOT USABLE YET. The table
 *     holds 115,706 rows, which looks like the richest political dataset here
 *     and is not: it is 1,021 distinct entities re-inserted ~113 times. The
 *     collector's `ON CONFLICT (source, source_entity_id, change_type,
 *     source_date)` never fires, so the same snapshot is re-added daily as
 *     `change_type = 'add'` — 115,706 of 115,706 rows are 'add', which is not
 *     what a diff produces. Worse for our purposes, `country_codes` is EMPTY on
 *     every single row, so nothing in it can resolve a country-scoped claim.
 *     Fix api/cron/source-ofac.ts first; the kind goes in then.
 *
 *   - `fx_devaluation` → `fx_rates`. LIVE. 80 currencies mapped to 80
 *     countries, daily and unbroken since 2026-04-18. A market price is the
 *     best resolver material there is: it settles itself, on a fixed date,
 *     with no threshold anyone can argue about afterwards. It is not a closed
 *     loop — a market price is emphatically not our output.
 *
 * The censorship resolver is political on purpose: the brief measures 3.1%
 * politics against 18.5% seismic, and censorship is the highest-frequency
 * political signal actually flowing. FX adds an independent second domain, so
 * the aggregate score is not one narrow signal wearing a track record's
 * clothes.
 *
 * SCORING. Brier score, plus the Murphy decomposition into reliability,
 * resolution and uncertainty, plus skill against the base rate. The base rate
 * is the honest baseline here — "how often does this happen anyway" — and a
 * forecaster that cannot beat it has demonstrated nothing. Publishing the skill
 * score when it is negative is the point of the exercise, not a failure of it.
 */

/**
 * What kind of external fact resolves this call.
 *
 * Only kinds that can actually be resolved today belong here. Declaring one we
 * cannot produce would be the same shape of error as the ledger this replaces:
 * a name implying evidence that does not exist.
 */
export type CallKind = 'censorship_event' | 'fx_devaluation';

export interface Call {
  id?: number;
  /** ISO date the call was made. */
  madeOn: string;
  kind: CallKind;
  countryCode: string;
  /** Stated probability the event occurs, 0..1. */
  probability: number;
  horizonDays: number;
  /** ISO date the call resolves. */
  resolvesOn: string;
  /** Human-readable claim, written before the outcome is known. */
  claim: string;
  /** The named external source that decides it. */
  resolver: string;
  status: 'pending' | 'hit' | 'miss';
  /** Count of qualifying external events found at resolution time. */
  evidenceCount?: number;
}

/** A resolved call: probability stated, and what actually happened. */
export interface ScoredCall {
  probability: number;
  outcome: 0 | 1;
  /**
   * That unit's OWN long-run rate at the time the call was made — the number
   * this forecast is trying to beat. Stored per call in `calls.base_rate`.
   * Required for a publishable skill score; see brierSkillScore.
   */
  baseRate?: number;
}

/** Clamp into the open interval so a stated 0 or 1 is never unfalsifiable. */
export function clampProbability(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(0.99, Math.max(0.01, p));
}

/**
 * Mean squared error of the stated probabilities. Lower is better; 0 is
 * perfect, 0.25 is what you get by always saying 50%.
 */
export function brierScore(calls: ScoredCall[]): number {
  if (calls.length === 0) return NaN;
  const sum = calls.reduce((acc, c) => acc + (c.probability - c.outcome) ** 2, 0);
  return sum / calls.length;
}

/** Share of resolved calls that actually happened — the base rate. */
export function baseRate(calls: ScoredCall[]): number {
  if (calls.length === 0) return NaN;
  return calls.reduce((acc, c) => acc + c.outcome, 0) / calls.length;
}

/**
 * Brier Skill Score against EACH UNIT'S OWN long-run rate.
 *
 * THE REFERENCE MATTERS MORE THAN THE SCORE, and getting it wrong was the
 * defect this function was rewritten to remove. It previously scored against
 * the POOLED realized frequency across every call of every kind. That is not a
 * benchmark a forecaster has to be any good to beat.
 *
 * Measured on the live book: of 39 censorship calls, 7 countries saw a
 * confirmed block in 8 of 8 fortnights and 24 saw one in 0 of 8. Only 8 carry
 * genuine uncertainty. Pooling "always" with "never" produces a reference
 * around 0.33 that is a terrible forecast for every individual country, so
 * beating it requires only knowing that China censors the internet and Chad
 * does not. That is a lookup table, not a prediction — and against the pooled
 * reference this book projected +15.2% while the honest per-country numbers
 * were -66.8% (censorship) and -23.6% (FX).
 *
 * Requires `baseRate` on every call. A call without one is not scoreable here,
 * and returning a number anyway would reintroduce exactly the flattery this
 * removes.
 *
 * Positive means we beat that unit's own climatology. Zero or negative means we
 * did not, and that number publishes exactly as it comes out.
 */
export function brierSkillScore(calls: ScoredCall[]): number {
  if (calls.length === 0) return NaN;
  if (calls.some((c) => c.baseRate === undefined || !Number.isFinite(c.baseRate))) return NaN;
  const reference = calls.reduce((acc, c) => acc + ((c.baseRate as number) - c.outcome) ** 2, 0) / calls.length;
  if (reference === 0) return NaN; // reference was perfect — skill undefined
  return 1 - brierScore(calls) / reference;
}

/**
 * The old pooled-reference skill score, kept ONLY so the difference can be
 * shown and argued about. Never publish this as "skill".
 */
export function brierSkillScoreVsPooled(calls: ScoredCall[]): number {
  if (calls.length === 0) return NaN;
  const climatology = baseRate(calls);
  const reference = calls.reduce((acc, c) => acc + (climatology - c.outcome) ** 2, 0) / calls.length;
  if (reference === 0) return NaN;
  return 1 - brierScore(calls) / reference;
}

/**
 * Effective sample size, given that overlapping calls are not independent.
 *
 * `record-calls.ts` writes a fresh 14-day call per country EVERY DAY, so two
 * consecutive calls on the same country share 13 of their 14 days and will
 * almost always resolve identically. Ninety-one calls resolving on one date
 * against one set of external data is nowhere near ninety-one observations.
 *
 * The standard correction for equicorrelated observations:
 *   n_eff = n / (1 + (n - 1) * rho)
 *
 * `rho` is the average pairwise outcome correlation. It is an input rather
 * than an estimate because with a single resolution date there is nothing to
 * estimate it from — and assuming independence is the one option that is
 * certainly wrong.
 */
export function effectiveSampleSize(n: number, rho = 0.15): number {
  if (n <= 1) return n;
  const r = Math.min(0.99, Math.max(0, rho));
  return n / (1 + (n - 1) * r);
}

export interface CalibrationBin {
  /** Lower edge of the probability bin, 0..1. */
  from: number;
  to: number;
  count: number;
  /** Mean stated probability inside the bin. */
  meanPredicted: number;
  /** Share of those that actually happened. */
  observed: number;
}

/**
 * Reliability data: for each probability band, how often did it happen?
 *
 * A well-calibrated forecaster's points sit on the diagonal — when they say
 * 70%, it happens 70% of the time. Empty bins are omitted rather than reported
 * as zero, because "we never said 90%" and "we said 90% and were always wrong"
 * are opposite facts and must not render identically.
 */
export function calibrationBins(calls: ScoredCall[], binCount = 10): CalibrationBin[] {
  const bins: { sumP: number; sumO: number; n: number }[] = Array.from({ length: binCount }, () => ({
    sumP: 0,
    sumO: 0,
    n: 0,
  }));

  for (const c of calls) {
    const idx = Math.min(binCount - 1, Math.floor(c.probability * binCount));
    bins[idx].sumP += c.probability;
    bins[idx].sumO += c.outcome;
    bins[idx].n += 1;
  }

  return bins
    .map((b, i) => ({
      from: i / binCount,
      to: (i + 1) / binCount,
      count: b.n,
      meanPredicted: b.n ? b.sumP / b.n : NaN,
      observed: b.n ? b.sumO / b.n : NaN,
    }))
    .filter((b) => b.count > 0);
}

export interface MurphyDecomposition {
  /** How far stated probabilities sit from observed frequency. Lower is better. */
  reliability: number;
  /** How much the forecasts discriminate between outcomes. Higher is better. */
  resolution: number;
  /** Inherent difficulty: base·(1−base). Not attributable to the forecaster. */
  uncertainty: number;
}

/**
 * Murphy's three-way decomposition: Brier = reliability − resolution + uncertainty.
 *
 * This is what separates "we are badly calibrated" from "this is a hard
 * problem" from "our forecasts carry no information" — three very different
 * diagnoses that a single Brier number cannot distinguish.
 */
export function murphyDecomposition(calls: ScoredCall[], binCount = 10): MurphyDecomposition {
  const n = calls.length;
  const climatology = baseRate(calls);
  const uncertainty = climatology * (1 - climatology);
  if (n === 0) return { reliability: NaN, resolution: NaN, uncertainty: NaN };

  const bins = calibrationBins(calls, binCount);
  let reliability = 0;
  let resolution = 0;
  for (const b of bins) {
    reliability += (b.count / n) * (b.meanPredicted - b.observed) ** 2;
    resolution += (b.count / n) * (b.observed - climatology) ** 2;
  }
  return { reliability, resolution, uncertainty };
}

/**
 * Did the call come true?
 *
 * Deliberately trivial and deliberately separate from the probability: a call
 * resolves on whether the external source recorded a qualifying event, never
 * on how confident we were. `threshold` is the count of events required, taken
 * from the call itself so the criterion is fixed before the window opens.
 */
export function resolveOutcome(evidenceCount: number, threshold = 1): 0 | 1 {
  return evidenceCount >= threshold ? 1 : 0;
}

/**
 * Estimate P(event) for a country from its own history.
 *
 * `windows` is the number of historical windows examined and `hits` how many
 * contained a qualifying event. Laplace smoothing keeps a country with no
 * history from being handed a confident 0 — with two pseudo-observations, an
 * unseen country starts at 50% and moves as evidence arrives, rather than
 * asserting something we have not earned.
 */
export function historicalRate(hits: number, windows: number): number {
  return clampProbability((hits + 1) / (windows + 2));
}

/**
 * The depreciation threshold for one currency, from its own history.
 *
 * NOT a multiple of volatility, which was the obvious approach and is wrong
 * here. `volatility_7d` is exactly 0.0000 for the 28 of 80 currencies that are
 * pegged or tightly managed, so a vol multiple gives them a threshold of zero —
 * "any move at all" — and the call becomes degenerate rather than uncertain.
 *
 * Instead the threshold IS the currency's own 75th-percentile 14-day
 * depreciation. That makes the base rate ~25% by construction for every
 * currency, so a call on the Turkish lira and a call on the Swiss franc are
 * comparably hard and the aggregate Brier means something. A fixed percentage
 * would have made the ledger's score mostly a measure of which currencies
 * happened to be included.
 *
 * Currencies whose p75 falls below `floorPct` get NO call: there is no honest
 * uncertainty to express about a hard peg, and filling the ledger with
 * near-certain negatives would flatter the Brier score without informing anyone.
 */
export function fxThreshold(p75DepreciationPct: number | null, floorPct = 0.25): number | null {
  if (p75DepreciationPct === null || !Number.isFinite(p75DepreciationPct)) return null;
  if (p75DepreciationPct < floorPct) return null;
  return Math.round(p75DepreciationPct * 100) / 100;
}

/** Did the currency depreciate past the threshold? Rate is units-per-USD, so UP is weaker. */
export function fxDepreciationPct(reference: number, observed: number): number {
  if (!Number.isFinite(reference) || reference === 0) return 0;
  return ((observed - reference) / reference) * 100;
}

/**
 * Recency weight per call kind — SET BY MEASUREMENT, not by taste.
 *
 * The original weight was a declared-in-advance 0.6 for everything, which was
 * honest but arbitrary. A walk-forward backtest over the full stored history
 * (disjoint 14-day outcome windows, thresholds and rates estimated from data
 * strictly before each fold; scripts/backtest-calls.ts reproduces it) swept
 * the weight and measured Brier out-of-sample:
 *
 *     w      FX (n=267)   censorship (n=93)
 *     0.0    0.1013       0.0677   <- best for censorship
 *     0.2    0.0993       0.0687
 *     0.4    0.0987 <- best for FX
 *     0.6    0.0994       0.0725   <- the old default
 *     0.8    0.1014       0.0753
 *
 * Recency carries a small real signal in FX and none at all in censorship —
 * at w=0.6 the censorship leg scored -7.1% skill against its own climatology,
 * a pure noise penalty the data-science review predicted from the variance of
 * a three-window estimator. So censorship states climatology, and FX leans
 * recent only as far as the evidence supports.
 *
 * Remeasure as history accumulates; the weight follows the backtest, never
 * the other way around.
 */
export const RECENCY_WEIGHT: Record<CallKind, number> = {
  censorship_event: 0,
  fx_devaluation: 0.4,
};

/**
 * Blend a country's recent rate with its long-run rate into a stated probability.
 *
 * This is the whole forecast, and it is deliberately small enough to argue
 * with: it claims that recent activity predicts near-term activity. If that is
 * false, the skill score against the long-run base rate comes out at or below
 * zero and we publish that — which is a genuine finding about the domain, not
 * an embarrassment. A model too complicated to be wrong in a legible way would
 * be worse here.
 */
export function blendRates(recent: number, longRun: number, recentWeight = 0.6): number {
  const w = Math.min(1, Math.max(0, recentWeight));
  return clampProbability(w * recent + (1 - w) * longRun);
}

/**
 * The standing line at the top of every brief.
 *
 * This is the habit mechanic, not a stat. A reader who saw a call made has a
 * stake in it resolving, and the resolution arrives on a schedule they do not
 * control — the same open-loop shape that makes people come back to a fixture
 * list. It also drags the differentiator out of a page nobody visits and into
 * the one surface with demonstrated daily engagement.
 *
 * Honest on day one: with nothing resolved yet it reports the open book rather
 * than inventing a record, and says so.
 */
export function formatLedgerSummary(opts: {
  resolvedToday: Call[];
  allScored: ScoredCall[];
  openCount: number;
  nextResolvesOn?: string | null;
}): string {
  const { resolvedToday, allScored, openCount, nextResolvesOn } = opts;
  const parts: string[] = [];

  if (resolvedToday.length > 0) {
    const hits = resolvedToday.filter((c) => c.status === 'hit').length;
    parts.push(`${resolvedToday.length} call${resolvedToday.length === 1 ? '' : 's'} resolved · ${hits} hit`);
  }

  if (allScored.length > 0) {
    const bs = brierScore(allScored);
    const skill = brierSkillScore(allScored);
    parts.push(`Brier ${bs.toFixed(3)} over ${allScored.length}`);
    if (!Number.isNaN(skill)) {
      parts.push(`${skill >= 0 ? '+' : ''}${(skill * 100).toFixed(0)}% vs base rate`);
    }
  }

  if (openCount > 0) {
    parts.push(nextResolvesOn ? `${openCount} open, next resolves ${nextResolvesOn}` : `${openCount} open`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'No calls on the book yet.';
}

/** A one-line summary for the brief's ledger section. */
export function formatLedgerLine(resolved: Call[], calls: ScoredCall[]): string {
  if (resolved.length === 0) return 'No calls resolved today.';
  const hits = resolved.filter((c) => c.status === 'hit').length;
  const bs = brierScore(calls);
  const skill = brierSkillScore(calls);
  const skillText = Number.isNaN(skill)
    ? 'skill n/a'
    : `${skill >= 0 ? '+' : ''}${(skill * 100).toFixed(0)}% vs base rate`;
  return `${resolved.length} call${resolved.length === 1 ? '' : 's'} resolved · ${hits} hit · Brier ${bs.toFixed(3)} · ${skillText}`;
}
