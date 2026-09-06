import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvCached } from './_lib/kvCache.js';

export const config = { runtime: 'nodejs', maxDuration: 25 };

/**
 * Live status endpoint — pings each user-facing API and reports a
 * health snapshot. Powers the /#/status page.
 *
 * GET /api/status
 *   → { generatedAt, overallHealth, endpoints: [{ path, status, latencyMs, lastError? }, ...] }
 *
 * Cached 60s in KV so we don't hammer downstream services on every page
 * load. Each ping has its own 5s timeout — slow endpoints don't block
 * the dashboard.
 *
 * 2026-05-02 G1.
 */

interface EndpointHealth {
  path: string;
  category: 'core' | 'data' | 'derived';
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number;
  httpCode: number;
  lastError?: string;
}

interface StatusPayload {
  generatedAt: string;
  overallHealth: 'ok' | 'degraded' | 'down';
  endpoints: EndpointHealth[];
}

// The probe list matches the NARROWED product (2026-09-05): the register,
// the brief, and the CII that feeds it. It had been probing six map-layer
// endpoints — including /api/reliefweb, which was deleted a day earlier, so
// the status page was manufacturing a permanent failure for a surface the
// product no longer had. A probe list is a claim about what matters; it has
// to shrink when the product does.
const ENDPOINTS: Array<{ path: string; category: 'core' | 'data' | 'derived' }> = [
  { path: '/api/cii', category: 'core' },
  { path: '/api/briefs', category: 'core' },
  { path: '/api/calls/ledger', category: 'core' },
  { path: '/api/briefs-sample', category: 'derived' },
];

async function pingEndpoint(host: string, ep: (typeof ENDPOINTS)[number]): Promise<EndpointHealth> {
  const start = Date.now();
  try {
    const res = await fetch(`https://${host}${ep.path}`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'NexusWatch-StatusCheck/1.0' },
    });
    const latencyMs = Date.now() - start;
    let status: EndpointHealth['status'] = 'ok';
    if (!res.ok) status = res.status >= 500 ? 'down' : 'degraded';
    else if (latencyMs > 3000) status = 'degraded';
    return { path: ep.path, category: ep.category, status, latencyMs, httpCode: res.status };
  } catch (err) {
    return {
      path: ep.path,
      category: ep.category,
      status: 'down',
      latencyMs: Date.now() - start,
      httpCode: 0,
      lastError: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', 'https://nexuswatch.dev');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const host = req.headers.host || 'nexuswatch.dev';

  const payload = await kvCached<StatusPayload>('nw:status:v1', 60, async () => {
    const results = await Promise.all(ENDPOINTS.map((ep) => pingEndpoint(host, ep)));
    const downCount = results.filter((r) => r.status === 'down').length;
    const degradedCount = results.filter((r) => r.status === 'degraded').length;
    const overallHealth: StatusPayload['overallHealth'] =
      downCount >= 3 ? 'down' : downCount + degradedCount >= 3 ? 'degraded' : 'ok';
    return {
      generatedAt: new Date().toISOString(),
      overallHealth,
      endpoints: results,
    };
  });

  return res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60').json(payload);
}
