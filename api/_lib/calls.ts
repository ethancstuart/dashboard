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
export type CallKind = 'censorship_event' | 'fx_devaluation' | 'seismicity_window';

/**
 * Calibration-harness kinds: real calls, resolved externally like any other,
 * but our stated probability IS the climatology, so expected skill is ≈ 0 by
 * construction. They exist to validate the scoring machinery on a domain
 * where the right answer is computable analytically (USGS seismicity is
 * ~Poisson; Gutenberg–Richter gives the theoretical base rate). Ledger
 * surfaces label them as a harness and exclude them from headline CLAIM
 * counts — counting them as geopolitical claims would be inflation.
 */
export const CALIBRATION_KINDS: ReadonlySet<string> = new Set(['seismicity_window']);

/**
 * The ONLY statuses that carry an outcome and may be scored.
 *
 * This is an ALLOW-list on purpose, and the direction is the point. Every
 * scoring surface used to select `WHERE status <> 'pending'` and then map
 * `status === 'hit' ? 1 : 0` — under which every non-hit row scores as a MISS.
 * So `void`, a status that exists precisely because a call could NOT be
 * honestly resolved, was already being counted as a wrong forecast. Adding
 * `unresolvable` under that mapping would have silently manufactured exactly
 * the false miss it was introduced to prevent.
 *
 * As an allow-list, a NEW status is excluded from scoring by default and has
 * to prove itself in scope. As a deny-list of things to skip, a new status
 * would be scored by omission the day someone adds one — which is the failure
 * this repo has legislated against more than once.
 */
export const SCORED_STATUSES: ReadonlySet<string> = new Set(['hit', 'miss']);

/** True when a row carries a real outcome and belongs in a Brier computation. */
export function isScored(status: string): boolean {
  return SCORED_STATUSES.has(status);
}

/**
 * How much evidence the resolver must have seen before a call may be scored.
 *
 * Absence of evidence is not evidence of absence, and the previous gate did not
 * say so: it tested `measurements === 0`, which meant ONE row anywhere in a
 * fourteen-day window certified a country as observed. A call with no block
 * seen was then written as an irreversible public miss. On the live 2026-09-05
 * cohort, SD and SS each had exactly one covered day.
 *
 * Two dimensions, because either alone is defeatable. Days alone: Cuba had 15
 * of 15 days on 479 measurements against Russia's 95,531. Volume alone: a
 * single busy day would certify a fortnight nobody watched.
 *
 * BOTH DERIVED FROM THE WINDOW, so a kind with a different horizon is in scope
 * by construction rather than because somebody remembered to extend a list.
 *
 * The per-day floor is a judgement and is stated as one: below roughly fifty
 * measurements a country-day is one or two probes, and one volunteer's network
 * conditions should not decide a public verdict. It is NOT tuned to a
 * publishing count — sizing it against the cohort is reported alongside, so the
 * choice stays auditable rather than fitted.
 */
export const MIN_MEASUREMENTS_PER_REQUIRED_DAY = 50;

export interface CoverageRequirement {
  minDays: number;
  minMeasurements: number;
}

/**
 * How long a matured call waits for late evidence before it is declared
 * unresolvable.
 *
 * Marking on the resolution day itself is wrong and an independent review
 * caught it: `resolve-calls` only ever selects `status = 'pending'`, so a
 * terminal write removes the call from the retry set permanently. OONI's
 * ingest lags roughly 24 hours and `source-ooni.ts` fetches only
 * `since = yesterday`, so a run that misses leaves a hole that a later
 * backfill or a collector fix could still fill — and a call marked terminal on
 * day one can never benefit from either.
 *
 * So: below the grace period a thin call stays pending, exactly as before.
 * Past it, the evidence is not coming and the row is settled with its reason.
 * Either way it is never scored as a miss, which is the property that matters.
 */
export const UNRESOLVABLE_GRACE_DAYS = 7;

/** Whole days elapsed since a call matured. Both inputs are ISO dates (UTC). */
export function daysSinceResolution(resolvesOn: string, now: Date = new Date()): number {
  const due = Date.parse(`${resolvesOn}T00:00:00Z`);
  if (!Number.isFinite(due)) return 0;
  return Math.floor((now.getTime() - due) / 86_400_000);
}

export function coverageRequirement(horizonDays: number): CoverageRequirement {
  // Half the declared window, rounded up, floored at one day so a degenerate
  // horizon can never produce a zero requirement — which would restore the
  // exact boolean gate this replaces.
  const h = Number.isFinite(horizonDays) && horizonDays > 0 ? horizonDays : 1;
  const minDays = Math.max(1, Math.ceil(h / 2));
  return { minDays, minMeasurements: minDays * MIN_MEASUREMENTS_PER_REQUIRED_DAY };
}

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
  /**
   * `void` — our criterion was unsound; we withdrew it.
   * `unresolvable` — the resolver did not observe enough evidence to score it.
   * Neither carries an outcome; see SCORED_STATUSES.
   */
  status: 'pending' | 'hit' | 'miss' | 'void' | 'unresolvable';
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
 *
 * DO NOT CALL THIS TO PUBLISH A NUMBER. Use `publishableSkill`, which carries
 * the batch and climatology gates. This stays exported because it is a real
 * statistical primitive with real tests — `calls.test.ts` and
 * `resolution-rehearsal.test.ts` both exercise its NaN behaviour directly, and
 * hiding it would delete that coverage rather than improve it.
 *
 * An independent review argued the export itself is the hole, since a new
 * caller could reach it. The counter, recorded so the trade-off is visible
 * rather than assumed: `skill-gate.test.ts` fails on any call OR import of
 * this function outside this module, and that suite now runs in
 * `.githooks/pre-push` — which is the gate that matters here, because pushing
 * to main DEPLOYS and CI reports afterwards. A new ungated caller cannot reach
 * production without the push being refused first.
 */
export function brierSkillScore(calls: ScoredCall[]): number {
  if (calls.length === 0) return NaN;
  if (calls.some((c) => c.baseRate === undefined || !Number.isFinite(c.baseRate))) return NaN;
  const reference = calls.reduce((acc, c) => acc + ((c.baseRate as number) - c.outcome) ** 2, 0) / calls.length;
  if (reference === 0) return NaN; // reference was perfect — skill undefined
  return 1 - brierScore(calls) / reference;
}

/**
 * THE ONLY SKILL NUMBER THAT MAY BE PUBLISHED.
 *
 * `brierSkillScore` above is the raw arithmetic and carries no gate, which is
 * how the daily brief came to print a pooled cross-kind skill figure that
 * `/ledger` and `/api/calls/ledger` both correctly withheld. Two callers had
 * their own copy of the gate, and two had none — and one of the ungated ones
 * had no production caller only by luck.
 *
 * A shared HELPER would not have fixed that: a fifth caller could still reach
 * the raw function. So the gate is STRUCTURAL. `brierSkillScore` is now called
 * nowhere outside this module, `skill-gate.test.ts` fails if that stops being
 * true, and every publication path goes through here — where the gate cannot
 * be forgotten because it is not a separate step.
 *
 * Returns NaN, deliberately, when a number should not be published:
 *   - fewer than MIN_RESOLUTION_BATCHES independent resolution batches. One
 *     fortnight cannot separate a forecasting method from the weather it
 *     happened to land in.
 *   - a cohort whose every row was stated AT its base rate. Its skill is
 *     0.000 by algebra rather than by measurement, and a hard zero printed as
 *     a result reads as a finding. It is not one.
 *
 * NaN is a real answer here — "not enough resolved calls to say" — and callers
 * must render it as an absence with its reason, never as a 0.
 */
export function publishableSkill(opts: { calls: ScoredCall[]; batches: number }): number {
  const { calls, batches } = opts;
  if (calls.length === 0) return NaN;
  if (batches < MIN_RESOLUTION_BATCHES) return NaN;
  // Every row priced at its own baseline: numerator and denominator are the
  // same sum, so the result is an identity, not a measurement.
  if (calls.every((c) => c.baseRate !== undefined && c.probability === c.baseRate)) return NaN;
  return brierSkillScore(calls);
}

/** How many of a cohort's rows could contribute skill at all. */
export function informativeRows(calls: ScoredCall[]): number {
  return calls.filter((c) => c.baseRate === undefined || c.probability !== c.baseRate).length;
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

/**
 * The HONEST sample size: how many independent things were actually observed.
 *
 * WHY THIS REPLACES A rho-DISCOUNTED ROW COUNT. An independent review
 * (2026-08-28) refuted `effectiveSampleSize(n, 0.15)` as a defensible
 * correction for this book, and it was right. The recorder writes one call per
 * country per day on a 14-day horizon, so seven consecutive calls for one
 * country share 13 of 14 days and resolve against the same external source in
 * the same batch. A single assumed correlation of 0.15 turns 273 censorship
 * rows into ~6.5 "effective" observations, which is a number with a decimal
 * point and no defence: the true structure is CLUSTERED, not exchangeable.
 *
 * So count clusters instead of discounting rows. A cluster is one
 * (kind, country) unit — 273 censorship calls across 39 countries are at most
 * 39 units, and because every one of them resolves on the same date against
 * one source, the first batch is closer to ONE common draw than to 39
 * independent ones. That is why `MIN_RESOLUTION_BATCHES` exists below.
 */
export function independentUnits(clusterKeys: string[]): number {
  return new Set(clusterKeys).size;
}

/**
 * Distinct resolution dates. One batch is one common-factor draw: everything
 * in it shares a resolver, a date, and whatever the world happened to do that
 * fortnight.
 */
export function resolutionBatches(resolvedOnDates: string[]): number {
  return new Set(resolvedOnDates.filter(Boolean)).size;
}

/**
 * How many independent batches before a SKILL number means anything.
 *
 * Three is not a statistical threshold — it is an honesty threshold. With one
 * batch there is no way to separate forecasting skill from the fortnight the
 * world happened to have. Below this, the surfaces publish the raw record
 * (what was claimed, what happened) and say plainly that the skill number is
 * not yet meaningful. That sentence is a stronger differentiator than any
 * number we could put in its place.
 */
export const MIN_RESOLUTION_BATCHES = 3;

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
  // Poisson climatology — a recency blend would only add noise to a harness
  // whose entire job is to sit exactly on its base rate.
  seismicity_window: 0,
};

/**
 * Can this generator ever state a probability that DEPARTS from its own base
 * rate — that is, can it make a claim at all?
 *
 * With a recency weight of zero, `blendRates` returns `longRun` unchanged and
 * the recorder stores that same value as `base_rate`. Probability and baseline
 * are then bit-identical on every row, and `brierSkillScore` divides a sum by
 * itself: skill is exactly 0.000 for any outcome sequence. Such a generator is
 * publishing climatology and grading it against itself.
 *
 * That is true of censorship since 2026-08-23, when the weight was set to zero
 * because a walk-forward backtest measured recency at -7.1% skill there. The
 * tuning was right. Continuing to ISSUE under it was not: every such call is a
 * row that cannot inform anything and that dilutes the pooled score when the
 * three-batch gate opens.
 *
 * Stated as a property of the generator rather than a check on each call, so it
 * generalises: any future kind whose weight is zero is caught by the same rule,
 * with nothing to remember.
 */
export function canDepartFromBaseRate(kind: CallKind): boolean {
  return RECENCY_WEIGHT[kind] !== 0;
}

/**
 * Should this kind issue new calls today?
 *
 * A generator that cannot depart from its base rate issues nothing — UNLESS it
 * is a declared calibration harness, whose whole purpose is to sit exactly on
 * climatology and prove the scoring machinery is honest on a domain where the
 * right answer is computable. That is not an exception carved out for an
 * awkward case; it is the one kind for which zero skill is the intended
 * reading, and it is already declared as such in CALIBRATION_KINDS.
 *
 * So the rule reads: state a claim, or be a control. Nothing else is issued.
 */
export function shouldIssue(kind: CallKind): boolean {
  return canDepartFromBaseRate(kind) || CALIBRATION_KINDS.has(kind);
}

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
export interface LedgerSummaryRow {
  kind: string;
  probability: number;
  baseRate?: number;
  outcome: 0 | 1;
  /** YYYY-MM-DD. Distinct dates are the batch count. */
  resolvedOn: string;
}

export function formatLedgerSummary(opts: {
  resolvedToday: Call[];
  scored: LedgerSummaryRow[];
  openCount: number;
  nextResolvesOn?: string | null;
}): string {
  const { resolvedToday, scored, openCount, nextResolvesOn } = opts;
  const parts: string[] = [];

  if (resolvedToday.length > 0) {
    const hits = resolvedToday.filter((c) => c.status === 'hit').length;
    // A count of today's resolutions, not an accuracy claim. Deliberately a
    // raw fraction: "23%" invites comparison against a target nobody set, and
    // a hit rate beside a negative skill score is the spurious-excellence trap
    // — the near-certain calls resolve YES and flatter a book that added no
    // skill at all.
    parts.push(`${resolvedToday.length} resolved today, ${hits} hit`);
  }

  // PER KIND, NEVER POOLED. Censorship and FX have different resolvers,
  // different base-rate estimators and different dependence structures, so a
  // row-weighted average across them reports whichever kind wrote more rows.
  const kinds = [...new Set(scored.map((r) => r.kind))].sort();
  for (const kind of kinds) {
    const rows = scored.filter((r) => r.kind === kind);
    const calls: ScoredCall[] = rows.map((r) => ({
      probability: r.probability,
      outcome: r.outcome,
      baseRate: r.baseRate,
    }));
    const batches = resolutionBatches(rows.map((r) => r.resolvedOn));
    const skill = publishableSkill({ calls, batches });
    const label = KIND_SHORT_LABEL[kind] ?? kind;
    const bs = brierScore(calls);

    if (Number.isFinite(skill)) {
      parts.push(
        `${label} Brier ${bs.toFixed(3)} over ${calls.length}, ` +
          `${skill >= 0 ? '+' : ''}${(skill * 100).toFixed(0)}% vs base rate`,
      );
    } else if (informativeRows(calls) === 0) {
      // Stated AT the base rate on every row: skill is 0.000 by algebra. A hard
      // zero printed as a result would read as a measurement.
      parts.push(`${label} Brier ${bs.toFixed(3)} over ${calls.length}, stated at climatology — not a forecast`);
    } else {
      parts.push(
        `${label} Brier ${bs.toFixed(3)} over ${calls.length}, ` +
          `skill withheld (${batches} of ${MIN_RESOLUTION_BATCHES} batches)`,
      );
    }
  }

  if (openCount > 0) {
    parts.push(nextResolvesOn ? `${openCount} open, next resolves ${nextResolvesOn}` : `${openCount} open`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'No calls on the book yet.';
}

const KIND_SHORT_LABEL: Record<string, string> = {
  censorship_event: 'OONI',
  fx_devaluation: 'FX',
  seismicity_window: 'seismicity harness',
};

/*
 * `formatLedgerLine` was DELETED here, not gated.
 *
 * It computed a pooled `brierSkillScore` with no batch gate and printed it
 * alongside a raw hit count — the same defect as formatLedgerSummary's. It had
 * no production caller, which is luck rather than design: it was one import
 * away from publishing the number the ledger withholds.
 *
 * Gating it would have left a second path to the same claim. Deleting it means
 * there is one, and skill-gate.test.ts keeps it that way.
 */
