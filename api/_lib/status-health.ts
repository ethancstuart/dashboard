/**
 * Status escalation — the pure decision, extracted so it can be tested.
 *
 * WHY THIS IS ITS OWN FILE. On 2026-08-28 /api/status reported
 * `overallHealth: "ok"` while TWO core endpoints were reporting `down`:
 *
 *   { path: "/api/cii",           status: "down", httpCode: 0, latencyMs: 5004 }
 *   { path: "/api/briefs-sample", status: "down", httpCode: 0, latencyMs: 5001 }
 *   → overallHealth: "ok"
 *
 * The old rule was `downCount >= 3 ? 'down' : down + degraded >= 3 ? 'degraded'
 * : 'ok'`, so a status page whose whole job is to say when something is broken
 * stayed green through two simultaneous outages. A monitor that cannot report
 * the outage it is watching is worse than no monitor, because it is believed.
 *
 * THE RULE NOW:
 *   - two or more endpoints down  → 'down'
 *   - any endpoint down           → at least 'degraded'
 *   - any endpoint degraded       → 'degraded'
 *   - otherwise                   → 'ok'
 *
 * Note the second clause is the one that was missing: a single down endpoint
 * can never again read as 'ok'.
 */

export type Health = 'ok' | 'degraded' | 'down';

export interface HealthCounts {
  downCount: number;
  degradedCount: number;
}

/**
 * Escalate a set of per-endpoint readings into one overall verdict.
 *
 * Deliberately total: any non-negative pair of counts maps to a verdict, so
 * there is no input for which this silently falls through to 'ok'.
 */
export function escalate({ downCount, degradedCount }: HealthCounts): Health {
  if (downCount >= 2) return 'down';
  if (downCount >= 1) return 'degraded';
  if (degradedCount >= 1) return 'degraded';
  return 'ok';
}

/** Count readings by status, so the caller cannot miscount one and not the other. */
export function countByStatus(readings: Array<{ status: Health }>): HealthCounts {
  return {
    downCount: readings.filter((r) => r.status === 'down').length,
    degradedCount: readings.filter((r) => r.status === 'degraded').length,
  };
}

/** The verdict for a set of readings — the only path callers should use. */
export function overallHealthOf(readings: Array<{ status: Health }>): Health {
  return escalate(countByStatus(readings));
}
