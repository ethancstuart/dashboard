import type { VercelRequest, VercelResponse } from '@vercel/node';
import { raiseAlert, clearStaleAlerts } from '../_lib/alert.js';
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'nodejs', maxDuration: 30 };

/**
 * Cron health monitor.
 *
 * Pings the production /api/status endpoint and posts a Discord alert
 * if any monitored endpoint is degraded or down. Runs every 30 minutes
 * via vercel.json `crons`.
 *
 * Also surfaces a "cron lag" warning: any cron whose last successful
 * run is more than 2x its expected interval (tracked via
 * dashview-cron-stats KV record). For now we infer health from /api/status.
 *
 * Silently no-ops if DISCORD_APPROVAL_WEBHOOK_URL is not set.
 *
 * 2026-05-02 G2.
 */

interface StatusEndpoint {
  path: string;
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number;
  httpCode: number;
  lastError?: string;
}

interface StatusPayload {
  generatedAt: string;
  overallHealth: 'ok' | 'degraded' | 'down';
  endpoints: StatusEndpoint[];
}

async function postDiscord(webhook: string, content: string, embeds: unknown[]): Promise<boolean> {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds, username: 'NexusWatch Health' }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Captured before ANY alert is raised, including the ledger check below.
  // Every active condition refreshes its last_seen after this instant, so a row
  // older than it was genuinely not observed on this run — which is what lets
  // clearStaleAlerts derive staleness from stored state instead of trusting a
  // caller to pass a complete active set.
  const runStartedAt = new Date();
  // Vercel cron auth
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const webhook = process.env.DISCORD_APPROVAL_WEBHOOK_URL;
  const enabled = process.env.DISCORD_APPROVAL_ENABLED !== 'false';

  // Pull current status snapshot
  const host = req.headers.host || 'nexuswatch.dev';
  let status: StatusPayload;
  try {
    const r = await fetch(`https://${host}/api/status`, { signal: AbortSignal.timeout(15000) });
    status = (await r.json()) as StatusPayload;
  } catch (err) {
    console.error('[cron-health] failed to fetch status', err);
    return res.status(502).json({ error: 'status fetch failed', message: String(err) });
  }

  // LEDGER TRUTH — the assertion that matters most before 2026-09-05.
  // resolve-calls runs unattended at 09:45 UTC. If it silently fails, calls sit
  // past their resolution date and the product's entire pre-commitment claim
  // quietly stops being true, with nothing on any surface saying so. Absence of
  // resolution is exactly the failure that looks like nothing happening.
  //
  // Note the deliberate 1-day grace: a call whose window closes today is
  // resolved by the 09:45 run, so only rows older than that are overdue.
  // Calls left pending for want of resolver COVERAGE are expected and are
  // reported separately rather than paged on — that disposition is published
  // on /methodology.
  let ledgerIssue: { overdue: number; oldest: string | null } | null = null;
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const sql = neon(dbUrl);
      const rows = (await sql`
        SELECT COUNT(*)::int AS overdue, MIN(resolves_on)::text AS oldest
        FROM calls
        WHERE status = 'pending' AND resolves_on < CURRENT_DATE - 1
      `) as unknown as Array<{ overdue: number; oldest: string | null }>;
      if ((rows[0]?.overdue ?? 0) === 0) {
        // No call is overdue: stand down any ledger condition we raised.
        await clearStaleAlerts('ledger:', [], runStartedAt);
      }
      if ((rows[0]?.overdue ?? 0) > 0) {
        ledgerIssue = rows[0];
        await raiseAlert({
          // Keyed on the COUNT, not the message: the body names the oldest due
          // date, which changes daily and would defeat deduplication.
          key: `ledger:overdue:${rows[0].overdue}`,
          title: `${rows[0].overdue} call(s) overdue for resolution`,
          body:
            `${rows[0].overdue} call(s) are still pending past their resolution date; the oldest was due ` +
            `${rows[0].oldest}. resolve-calls runs 09:45 UTC daily. Either it is failing, or the resolver ` +
            `has no coverage for those countries — check /api/cron/resolve-calls output for the ` +
            `"unresolvable" and "errored" counts.`,
          severity: 'critical',
        });
      }
    } catch (err) {
      console.error('[cron-health] ledger truth check failed:', err instanceof Error ? err.message : err);
    }
  }

  const downEndpoints = status.endpoints.filter((e) => e.status === 'down');
  const degradedEndpoints = status.endpoints.filter((e) => e.status === 'degraded');
  const issuesCount = downEndpoints.length + degradedEndpoints.length;

  if (issuesCount === 0) {
    // EVERYTHING RECOVERED — say so. Without this, silence after an alert is
    // ambiguous between "fixed" and "the monitor itself died", and the
    // operator has to infer recovery from an absence. On 2026-08-28 the
    // /api/cii alerts simply stopped when the perf fix deployed and nothing
    // announced it.
    const cleared = await clearStaleAlerts('endpoints:', [], runStartedAt);
    return res.status(200).json({
      ok: true,
      allHealthy: true,
      ledgerIssue,
      clearedAlerts: cleared,
      generatedAt: status.generatedAt,
    });
  }

  // ALERT ON WHATEVER CHANNEL EXISTS. This used to return `alertingDisabled`
  // and stop, because DISCORD_APPROVAL_WEBHOOK_URL has never been set in
  // production — so the health monitor detected issues and told nobody, for
  // months. raiseAlert() prefers Discord when configured and otherwise emails
  // ADMIN_EMAILS through Resend, both of which ARE configured today.
  if (!webhook || !enabled) {
    const summary = [
      ...downEndpoints.map(
        (e) => `DOWN  ${e.path} — HTTP ${e.httpCode}${e.lastError ? ` — ${e.lastError.slice(0, 100)}` : ''}`,
      ),
      ...degradedEndpoints.map((e) => `SLOW  ${e.path} — ${e.latencyMs}ms`),
    ].join('\n');
    // Keyed on WHICH endpoints are affected, not on the message. Latencies
    // change every run ("3934ms"), so keying on the body would have deduped
    // nothing and sent the flood anyway.
    const affected = [...downEndpoints, ...degradedEndpoints].map((e) => e.path).sort();
    const key = `endpoints:${affected.join(',')}`;
    const alert = await raiseAlert({
      key,
      title: `${issuesCount} endpoint issue(s) on nexuswatch.dev`,
      body: `${summary}\n\nChecked ${status.endpoints.length} endpoints at ${status.generatedAt}.`,
      severity: downEndpoints.length > 0 ? 'critical' : 'warning',
    });
    // Any endpoint condition that is no longer present gets an all-clear.
    await clearStaleAlerts('endpoints:', [key], runStartedAt);
    return res.status(200).json({
      ok: true,
      issuesDetected: issuesCount,
      alert,
      issues: [...downEndpoints, ...degradedEndpoints],
    });
  }

  const lines: string[] = [];
  if (downEndpoints.length > 0) {
    lines.push(`🔴 **${downEndpoints.length} endpoint(s) DOWN**`);
    downEndpoints.forEach((e) => {
      lines.push(`  • \`${e.path}\` — HTTP ${e.httpCode}${e.lastError ? ` — ${e.lastError.slice(0, 80)}` : ''}`);
    });
  }
  if (degradedEndpoints.length > 0) {
    lines.push(`🟡 **${degradedEndpoints.length} endpoint(s) DEGRADED**`);
    degradedEndpoints.forEach((e) => {
      lines.push(`  • \`${e.path}\` — ${e.latencyMs}ms`);
    });
  }

  const colour = downEndpoints.length > 0 ? 0xdc2626 : 0xeab308;
  const ok = await postDiscord(webhook, '', [
    {
      title: `NexusWatch Health Alert — ${status.overallHealth.toUpperCase()}`,
      description: lines.join('\n'),
      color: colour,
      timestamp: status.generatedAt,
      footer: { text: 'nexuswatch.dev/api/status' },
    },
  ]);

  return res.status(200).json({
    ok: true,
    alertSent: ok,
    issuesDetected: issuesCount,
    overallHealth: status.overallHealth,
  });
}
