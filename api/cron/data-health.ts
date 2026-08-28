import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { DATA_SOURCES, pickSource, type LayerConfig, type LayerSource } from '../../src/config/data-sources.js';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Data Health cron — Track D.1 (Data Accuracy Autonomy).
 *
 * Runs every 15 minutes. For each of the 30 Intel Map layers:
 *   1. Probes the currently active source (primary or fallback).
 *   2. Computes a 0-100 health score from reachability, freshness, record
 *      count, and latency.
 *   3. Appends a row to `data_health` and upserts `data_health_current`.
 *   4. Runs a simple circuit breaker: after 5 consecutive failures the
 *      breaker opens and cycles through the layer's fallback list; 3
 *      consecutive successes close it again and revert to primary.
 *
 * Designed to complete in well under 60s: probes run via Promise.allSettled
 * with bounded concurrency and a per-probe AbortSignal timeout. Test helpers
 * and the pure scoring/breaker logic are exported for unit coverage.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';
export type HealthStatus = 'green' | 'amber' | 'red' | 'degraded';

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  recordCount: number | null;
  freshnessSeconds: number | null;
  error: string | null;
}

export interface CurrentRow {
  layer: string;
  status: HealthStatus;
  score: number;
  lastSuccess: string | null;
  lastFailure: string | null;
  consecutiveFailures: number;
  circuitState: CircuitState;
  activeSource: string | null;
}

// Concurrency cap to avoid thundering herds on shared upstreams (GDELT, etc).
const MAX_CONCURRENT_PROBES = 10;
const BREAKER_TRIP_THRESHOLD = 5;
const BREAKER_CLOSE_THRESHOLD = 3;
// A probe is "latency_ok" if it completes faster than this.
const LATENCY_OK_MS = 2500;

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Composite score 0-100. Weighted average:
 *   - api_reachable         × 0.4
 *   - freshness_ok          × 0.3
 *   - record_count_nonzero  × 0.2
 *   - latency_ok            × 0.1
 *
 * `freshnessWindowSeconds` is the per-layer "too stale" threshold. When the
 * probe can't parse a record count or freshness (e.g. HTML landing page), we
 * treat those inputs as neutral passes provided the probe itself succeeded —
 * otherwise static/landing-page probes would always score red.
 */
export function computeScore(probe: ProbeResult, freshnessWindowSeconds: number): number {
  const reachable = probe.ok ? 1 : 0;
  const freshOk =
    probe.freshnessSeconds == null ? (probe.ok ? 1 : 0) : probe.freshnessSeconds <= freshnessWindowSeconds ? 1 : 0;
  const countOk = probe.recordCount == null ? (probe.ok ? 1 : 0) : probe.recordCount > 0 ? 1 : 0;
  const latencyOk = probe.ok && probe.latencyMs <= LATENCY_OK_MS ? 1 : 0;
  const raw = reachable * 0.4 + freshOk * 0.3 + countOk * 0.2 + latencyOk * 0.1;
  return Math.round(raw * 100);
}

/**
 * Maps a numeric score to a human-readable status band.
 * >= 85 green, 60-84 amber, < 60 red.
 */
export function statusFromScore(score: number): HealthStatus {
  if (score >= 85) return 'green';
  if (score >= 60) return 'amber';
  return 'red';
}

/**
 * Transitions circuit breaker state after a probe result.
 *
 *   closed    → +1 failure if probe fails; open after BREAKER_TRIP_THRESHOLD
 *             → resets consecutiveFailures on success
 *   open      → stays open on failure, increments counter (drives fallback cycling)
 *             → on success, moves to half_open and resets counter
 *   half_open → on failure, returns to open and resets counter to threshold
 *             → on success, increments a success counter; after
 *               BREAKER_CLOSE_THRESHOLD successes, moves back to closed
 *
 * Pure function: takes the previous state + the probe result, returns the
 * next state. The DB layer is responsible for persistence.
 */
export interface BreakerInput {
  circuitState: CircuitState;
  consecutiveFailures: number;
  halfOpenSuccesses?: number;
}

export interface BreakerOutput {
  circuitState: CircuitState;
  consecutiveFailures: number;
  halfOpenSuccesses: number;
}

export function advanceBreaker(prev: BreakerInput, probeOk: boolean): BreakerOutput {
  const prevHalfOpen = prev.halfOpenSuccesses ?? 0;
  if (probeOk) {
    if (prev.circuitState === 'closed') {
      return { circuitState: 'closed', consecutiveFailures: 0, halfOpenSuccesses: 0 };
    }
    if (prev.circuitState === 'open') {
      return { circuitState: 'half_open', consecutiveFailures: 0, halfOpenSuccesses: 1 };
    }
    // half_open
    const nextSuccesses = prevHalfOpen + 1;
    if (nextSuccesses >= BREAKER_CLOSE_THRESHOLD) {
      return { circuitState: 'closed', consecutiveFailures: 0, halfOpenSuccesses: 0 };
    }
    return { circuitState: 'half_open', consecutiveFailures: 0, halfOpenSuccesses: nextSuccesses };
  }
  // Failure path
  const nextFailures = prev.consecutiveFailures + 1;
  if (prev.circuitState === 'closed') {
    if (nextFailures >= BREAKER_TRIP_THRESHOLD) {
      return { circuitState: 'open', consecutiveFailures: nextFailures, halfOpenSuccesses: 0 };
    }
    return { circuitState: 'closed', consecutiveFailures: nextFailures, halfOpenSuccesses: 0 };
  }
  if (prev.circuitState === 'half_open') {
    return { circuitState: 'open', consecutiveFailures: BREAKER_TRIP_THRESHOLD, halfOpenSuccesses: 0 };
  }
  // open stays open, counter advances for fallback cycling.
  return { circuitState: 'open', consecutiveFailures: nextFailures, halfOpenSuccesses: 0 };
}

/**
 * Expands a layer config's probe URL into an absolute URL when running inside
 * a Vercel function. Relative `/api/*` paths are rewritten against VERCEL_URL.
 */
export function resolveProbeUrl(probeUrl: string, base: string | undefined): string {
  if (/^https?:\/\//i.test(probeUrl)) return probeUrl;
  const origin = base ? (base.startsWith('http') ? base : `https://${base}`) : 'https://nexuswatch.dev';
  return `${origin.replace(/\/$/, '')}${probeUrl}`;
}

/**
 * Attempts to infer record count and freshness from a response body. Fails
 * soft — returns nulls on any parse error so the scoring function can treat
 * them as neutral inputs.
 */
export function inferFromBody(body: unknown): { recordCount: number | null; freshnessSeconds: number | null } {
  if (body == null) return { recordCount: null, freshnessSeconds: null };
  try {
    if (Array.isArray(body)) {
      return { recordCount: body.length, freshnessSeconds: extractFreshness(body[0]) };
    }
    if (typeof body === 'object') {
      const obj = body as Record<string, unknown>;
      for (const key of ['items', 'results', 'features', 'events', 'vessels', 'articles', 'data']) {
        const v = obj[key];
        if (Array.isArray(v)) {
          return { recordCount: v.length, freshnessSeconds: extractFreshness(v[0]) };
        }
      }
      return { recordCount: null, freshnessSeconds: extractFreshness(obj) };
    }
  } catch {
    // Ignore — fall through to null.
  }
  return { recordCount: null, freshnessSeconds: null };
}

function extractFreshness(candidate: unknown): number | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const obj = candidate as Record<string, unknown>;
  for (const key of ['updated', 'updated_at', 'timestamp', 'time', 'date', 'published', 'last_seen']) {
    const v = obj[key];
    if (typeof v === 'string' || typeof v === 'number') {
      const ts = new Date(v).getTime();
      if (!Number.isNaN(ts)) {
        return Math.max(0, Math.round((Date.now() - ts) / 1000));
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Probe runner — network-facing, stubbed in tests via injected fetch.
// ---------------------------------------------------------------------------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function probeSource(
  source: LayerSource,
  fetchImpl: FetchLike = fetch,
  base?: string,
): Promise<ProbeResult> {
  const url = resolveProbeUrl(source.probeUrl, base);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), source.probeTimeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, method: 'GET' });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        recordCount: null,
        freshnessSeconds: null,
        error: `HTTP ${res.status}`,
      };
    }
    let body: unknown = null;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    }
    const { recordCount, freshnessSeconds } = inferFromBody(body);
    return { ok: true, latencyMs, recordCount, freshnessSeconds, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      recordCount: null,
      freshnessSeconds: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the given async tasks with a concurrency cap. Preserves ordering so
 * the cron can zip results back to the DATA_SOURCES array.
 */
export async function runBounded<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]!();
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

interface StoredBreakerState {
  circuit_state: CircuitState;
  consecutive_failures: number;
  half_open_successes: number;
  last_success: string | null;
  last_failure: string | null;
  active_source: string | null;
}

// Loose shape for the Neon tagged-template SQL client. We avoid
// ReturnType<typeof neon> because its declared array-mode generics cause
// friction when the function is passed between helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NeonSql = any;

async function loadCurrentState(sql: NeonSql): Promise<Map<string, StoredBreakerState>> {
  // Reads half_open_successes alongside the rest of the breaker state so
  // recovery from the half_open → closed transition survives cron ticks.
  // Prior to the 2026-04-11 fix this column wasn't selected OR persisted,
  // so half-open recovery took ~45 minutes (3 cron runs) instead of ~15.
  const rows = (await sql`
    SELECT layer, circuit_state, consecutive_failures, half_open_successes,
           last_success, last_failure, active_source
    FROM data_health_current
  `) as Array<Record<string, unknown>>;
  const map = new Map<string, StoredBreakerState>();
  for (const row of rows) {
    map.set(row.layer as string, {
      circuit_state: (row.circuit_state as CircuitState) ?? 'closed',
      consecutive_failures: (row.consecutive_failures as number) ?? 0,
      half_open_successes: (row.half_open_successes as number) ?? 0,
      last_success: (row.last_success as string | null) ?? null,
      last_failure: (row.last_failure as string | null) ?? null,
      active_source: (row.active_source as string | null) ?? null,
    });
  }
  return map;
}

async function ensureSchema(sql: NeonSql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS data_health (
      id SERIAL PRIMARY KEY,
      layer TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      last_success TIMESTAMPTZ,
      last_failure TIMESTAMPTZ,
      error TEXT,
      fallback_used TEXT,
      latency_ms INTEGER,
      record_count INTEGER,
      freshness_seconds INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_data_health_layer_created ON data_health (layer, created_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS data_health_current (
      layer TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      last_success TIMESTAMPTZ,
      last_failure TIMESTAMPTZ,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      half_open_successes INTEGER NOT NULL DEFAULT 0,
      circuit_state TEXT NOT NULL DEFAULT 'closed',
      active_source TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Also ensure the column exists on pre-existing tables that were created
  // before the 2026-04-11 half_open_successes fix. ADD COLUMN IF NOT EXISTS
  // is a no-op on fresh tables created above.
  await sql`
    ALTER TABLE data_health_current
    ADD COLUMN IF NOT EXISTS half_open_successes INTEGER NOT NULL DEFAULT 0
  `;

  // Track D.2 — self-heal action audit log. Idempotent creation so
  // the cron self-bootstraps the schema on first run. See
  // docs/migrations/2026-04-11-data-health-actions.sql for the
  // canonical definition and column docs.
  await sql`
    CREATE TABLE IF NOT EXISTS data_health_actions (
      id SERIAL PRIMARY KEY,
      layer TEXT NOT NULL,
      action_type TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      action_details JSONB,
      outcome TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      before_status TEXT,
      after_status TEXT,
      latency_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_data_health_actions_layer_created
    ON data_health_actions (layer, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_data_health_actions_unattributed
    ON data_health_actions (after_status, created_at DESC)
    WHERE after_status IS NULL
  `;
}

// ---------------------------------------------------------------------------
// Track D.2 — active self-heal actions
// ---------------------------------------------------------------------------

// How many consecutive failures before we start attempting heals. 3 is
// conservative enough that transient upstream blips don't trigger a
// storm of unnecessary actions, but fast enough to kick in before the
// circuit breaker opens at 5.
const HEAL_FAILURE_THRESHOLD = 3;

/**
 * Attempt a proxy cache-bust on a layer that's currently red.
 *
 * For layers whose probeUrl starts with `/api/` (i.e., our own
 * serverless proxies), this forces a refetch with a cache-bust
 * query param, bypassing any edge cache on the proxy route. For
 * layers that probe external URLs directly, this is a no-op — there's
 * nothing we can do server-side to flush a third-party cache.
 *
 * Returns the outcome shape the caller records in data_health_actions.
 * Never throws; captures errors into the returned object so the cron's
 * main loop isn't disrupted by a single layer's heal failing.
 */
async function attemptProxyCacheBust(
  layer: LayerConfig,
  activeSource: string | null,
  base: string | undefined,
): Promise<{
  outcome: 'succeeded' | 'failed';
  error: string | null;
  latencyMs: number;
  actionDetails: Record<string, unknown>;
}> {
  const startedAt = Date.now();

  // Pick the source that matches the active_source name — default to
  // the primary if we can't find a match. Bail early for external URLs.
  const source =
    layer.primary.name === activeSource
      ? layer.primary
      : (layer.fallbacks.find((f) => f.name === activeSource) ?? layer.primary);

  if (!source.probeUrl.startsWith('/api/')) {
    return {
      outcome: 'succeeded',
      error: null,
      latencyMs: Date.now() - startedAt,
      actionDetails: {
        action: 'proxy_cache_bust',
        skipped: 'external_probe_url',
        probe_url: source.probeUrl,
      },
    };
  }

  const cacheBustToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const probeBase = base ? (base.startsWith('http') ? base : `https://${base}`) : '';
  const separator = source.probeUrl.includes('?') ? '&' : '?';
  const healUrl = `${probeBase}${source.probeUrl}${separator}cache-bust=${encodeURIComponent(cacheBustToken)}`;

  try {
    const res = await fetch(healUrl, {
      signal: AbortSignal.timeout(source.probeTimeoutMs),
      headers: { 'Cache-Control': 'no-cache, no-store' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        outcome: 'failed',
        error: `HTTP ${res.status}: ${body.slice(0, 400)}`,
        latencyMs: Date.now() - startedAt,
        actionDetails: {
          action: 'proxy_cache_bust',
          probe_url: source.probeUrl,
          cache_bust_token: cacheBustToken,
          http_status: res.status,
        },
      };
    }
    return {
      outcome: 'succeeded',
      error: null,
      latencyMs: Date.now() - startedAt,
      actionDetails: {
        action: 'proxy_cache_bust',
        probe_url: source.probeUrl,
        cache_bust_token: cacheBustToken,
      },
    };
  } catch (err) {
    return {
      outcome: 'failed',
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      latencyMs: Date.now() - startedAt,
      actionDetails: {
        action: 'proxy_cache_bust',
        probe_url: source.probeUrl,
        cache_bust_token: cacheBustToken,
      },
    };
  }
}

/**
 * Decide whether a layer needs heal + kick off the action. Runs
 * INSIDE the cron's main loop, right after the probe row is persisted.
 *
 * Heal criteria:
 *   - current status is 'red' (status='amber' recovers on its own)
 *   - consecutive_failures >= HEAL_FAILURE_THRESHOLD
 *   - no successful heal within the last hour for this layer (avoids
 *     action storms on persistent outages)
 *
 * The heal itself is best-effort: we don't wait for the layer to
 * recover on THIS cron run — the next run (15 min later) will
 * evaluate and populate after_status via attributeHealOutcomes.
 */
async function maybeHealLayer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  row: ProbedRow,
  layer: LayerConfig,
  base: string | undefined,
): Promise<void> {
  if (row.status !== 'red' || row.consecutiveFailures < HEAL_FAILURE_THRESHOLD) return;

  // Rate-limit: one heal attempt per layer per hour. Prevents the
  // cron from spamming action rows on a persistently-down upstream.
  try {
    const recent = (await sql`
      SELECT id FROM data_health_actions
      WHERE layer = ${row.layer}
        AND action_type = 'proxy_cache_bust'
        AND created_at > NOW() - INTERVAL '1 hour'
      LIMIT 1
    `) as unknown as Array<{ id: number }>;
    if (recent.length > 0) return;
  } catch (err) {
    console.error('[data-health] heal rate-limit check failed (continuing):', err instanceof Error ? err.message : err);
  }

  const result = await attemptProxyCacheBust(layer, row.activeSource, base);

  try {
    await sql`
      INSERT INTO data_health_actions (
        layer, action_type, triggered_by, action_details,
        outcome, error, before_status, latency_ms
      ) VALUES (
        ${row.layer}, 'proxy_cache_bust', 'red_threshold', ${JSON.stringify(result.actionDetails)},
        ${result.outcome}, ${result.error}, ${row.status}, ${result.latencyMs}
      )
    `;
  } catch (err) {
    console.error('[data-health] heal audit insert failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

/**
 * Attribution pass — walks unattributed heal rows (after_status IS NULL)
 * older than 1 minute and populates their after_status from the current
 * layer state. Runs once per cron tick AFTER all probes have been
 * persisted, so the "after" reflects the result of the most recent probe.
 *
 * Kept intentionally simple: one UPDATE per unattributed row. At scale
 * this could become a single correlated UPDATE, but heal actions are
 * rare enough that per-row is fine and easier to reason about.
 */
async function attributeHealOutcomes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  current: Map<string, StoredBreakerState>,
): Promise<void> {
  try {
    const unattributed = (await sql`
      SELECT id, layer
      FROM data_health_actions
      WHERE after_status IS NULL
        AND created_at < NOW() - INTERVAL '1 minute'
        AND created_at > NOW() - INTERVAL '2 hours'
      LIMIT 50
    `) as unknown as Array<{ id: number; layer: string }>;

    for (const action of unattributed) {
      // Find the current post-cron state for this layer. We look it up
      // from the latest data_health row rather than the `current` map
      // because the map holds pre-probe state. The CREATE TABLE IF NOT
      // EXISTS in ensureSchema guarantees the table exists.
      const latest = (await sql`
        SELECT status
        FROM data_health
        WHERE layer = ${action.layer}
        ORDER BY created_at DESC
        LIMIT 1
      `) as unknown as Array<{ status: string }>;
      const afterStatus = latest[0]?.status ?? current.get(action.layer)?.circuit_state ?? 'unknown';
      await sql`
        UPDATE data_health_actions
        SET after_status = ${afterStatus}
        WHERE id = ${action.id}
      `;
    }
  } catch (err) {
    console.error('[data-health] heal attribution pass failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  try {
    const sql = neon(dbUrl);
    await ensureSchema(sql);
    const current = await loadCurrentState(sql);
    const base = process.env.VERCEL_URL;

    const tasks = DATA_SOURCES.map((layer) => async () => probeLayer(layer, current.get(layer.id), base));
    const probed = await runBounded(tasks, MAX_CONCURRENT_PROBES);

    // Build a layer id → config map so maybeHealLayer can look up the
    // probe URL for the red layers it needs to heal.
    const layerConfigById = new Map(DATA_SOURCES.map((l) => [l.id, l]));

    // Persist results.
    const summary = {
      probed: probed.length,
      green: 0,
      amber: 0,
      red: 0,
      open_circuits: [] as string[],
      heals_attempted: 0,
    };
    for (const row of probed) {
      if (row.status === 'green') summary.green++;
      else if (row.status === 'amber') summary.amber++;
      else summary.red++;
      if (row.circuitState === 'open') summary.open_circuits.push(row.layer);

      await sql`
        INSERT INTO data_health (
          layer, status, score, last_success, last_failure, error,
          fallback_used, latency_ms, record_count, freshness_seconds
        ) VALUES (
          ${row.layer}, ${row.status}, ${row.score}, ${row.lastSuccess}, ${row.lastFailure}, ${row.error},
          ${row.fallbackUsed}, ${row.latencyMs}, ${row.recordCount}, ${row.freshnessSeconds}
        )
      `;
      await sql`
        INSERT INTO data_health_current (
          layer, status, score, last_success, last_failure, consecutive_failures,
          half_open_successes, circuit_state, active_source, updated_at
        ) VALUES (
          ${row.layer}, ${row.status}, ${row.score}, ${row.lastSuccess}, ${row.lastFailure},
          ${row.consecutiveFailures}, ${row.halfOpenSuccesses}, ${row.circuitState},
          ${row.activeSource}, NOW()
        )
        ON CONFLICT (layer) DO UPDATE SET
          status = EXCLUDED.status,
          score = EXCLUDED.score,
          last_success = EXCLUDED.last_success,
          last_failure = EXCLUDED.last_failure,
          consecutive_failures = EXCLUDED.consecutive_failures,
          half_open_successes = EXCLUDED.half_open_successes,
          circuit_state = EXCLUDED.circuit_state,
          active_source = EXCLUDED.active_source,
          updated_at = NOW()
      `;

      // Track D.2 — attempt a heal action if this layer meets the
      // criteria. maybeHealLayer runs its own status/threshold check
      // internally AND self-rate-limits (one attempt per layer per
      // hour). Counted in summary only when criteria are met here so
      // the cron response reflects actual attempts, not skipped ones.
      const layerConfig = layerConfigById.get(row.layer);
      if (layerConfig && row.status === 'red' && row.consecutiveFailures >= HEAL_FAILURE_THRESHOLD) {
        summary.heals_attempted++;
        await maybeHealLayer(sql, row, layerConfig, base);
      }
    }

    // Attribution pass — populate after_status for any heal rows
    // from the previous cron run. Runs after all probes so the
    // "after" reflects the latest status. Non-fatal.
    await attributeHealOutcomes(sql, current);

    // Prune >30d of history to keep table bounded.
    await sql`DELETE FROM data_health WHERE created_at < NOW() - INTERVAL '30 days'`;
    // Also prune >30d of heal action rows so the audit table doesn't
    // grow unbounded. 30 days is enough to run the D.3 action-type
    // effectiveness analysis that will decide which heal types we
    // keep and which we drop.
    await sql`DELETE FROM data_health_actions WHERE created_at < NOW() - INTERVAL '30 days'`;

    return res.json(summary);
  } catch (err) {
    console.error('data-health cron error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'data-health cron failed' });
  }
}

// ---------------------------------------------------------------------------
// Per-layer probe result (internal shape)
// ---------------------------------------------------------------------------

interface ProbedRow {
  layer: string;
  status: HealthStatus;
  score: number;
  lastSuccess: string | null;
  lastFailure: string | null;
  error: string | null;
  fallbackUsed: string | null;
  latencyMs: number | null;
  recordCount: number | null;
  freshnessSeconds: number | null;
  consecutiveFailures: number;
  halfOpenSuccesses: number;
  circuitState: CircuitState;
  activeSource: string | null;
}

async function probeLayer(
  layer: LayerConfig,
  prev: StoredBreakerState | undefined,
  base: string | undefined,
): Promise<ProbedRow> {
  const prevState: StoredBreakerState = prev ?? {
    circuit_state: 'closed',
    consecutive_failures: 0,
    half_open_successes: 0,
    last_success: null,
    last_failure: null,
    active_source: layer.primary.name,
  };

  const source = pickSource(layer, prevState.circuit_state, prevState.consecutive_failures);

  // No fallback available while open — record the outage without probing.
  if (!source) {
    const next = advanceBreaker(
      {
        circuitState: prevState.circuit_state,
        consecutiveFailures: prevState.consecutive_failures,
        halfOpenSuccesses: prevState.half_open_successes,
      },
      false,
    );
    return {
      layer: layer.id,
      status: 'red',
      score: 0,
      lastSuccess: prevState.last_success,
      lastFailure: new Date().toISOString(),
      error: 'no fallback available',
      fallbackUsed: null,
      latencyMs: null,
      recordCount: null,
      freshnessSeconds: null,
      consecutiveFailures: next.consecutiveFailures,
      halfOpenSuccesses: next.halfOpenSuccesses,
      circuitState: next.circuitState,
      activeSource: null,
    };
  }

  const probe = await probeSource(source, fetch, base);
  const score = computeScore(probe, source.freshnessWindowSeconds);
  const status = statusFromScore(score);
  const next = advanceBreaker(
    {
      circuitState: prevState.circuit_state,
      consecutiveFailures: prevState.consecutive_failures,
      halfOpenSuccesses: prevState.half_open_successes,
    },
    probe.ok,
  );
  const now = new Date().toISOString();

  return {
    layer: layer.id,
    status,
    score,
    lastSuccess: probe.ok ? now : prevState.last_success,
    lastFailure: probe.ok ? prevState.last_failure : now,
    error: probe.error,
    fallbackUsed: source.name === layer.primary.name ? null : source.name,
    latencyMs: probe.latencyMs,
    recordCount: probe.recordCount,
    freshnessSeconds: probe.freshnessSeconds,
    consecutiveFailures: next.consecutiveFailures,
    halfOpenSuccesses: next.halfOpenSuccesses,
    circuitState: next.circuitState,
    activeSource: source.name,
  };
}
