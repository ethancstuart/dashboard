import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs', maxDuration: 30 };

/**
 * NexusWatch MCP Server — Streamable HTTP endpoint
 *
 * Implements the MCP JSON-RPC protocol directly (no SDK dependency) so the
 * main project's module resolution stays clean. Proxies tool calls to the
 * existing v2 API endpoints.
 *
 * Connect from Claude Code:
 *   claude mcp add --transport http nexus-watch https://nexuswatch.dev/api/mcp \
 *     --header "X-API-Key: nwk_xxx"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// Internal API caller
// ---------------------------------------------------------------------------

// Always use the production domain — VERCEL_URL points to the deployment-specific
// URL which may have deployment protection enabled.
const BASE = 'https://nexuswatch.dev';

async function callApi(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
    apiKey?: string;
  } = {},
) {
  const url = new URL(path, BASE);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v != null && v !== '') url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers['X-API-Key'] = opts.apiKey;
  if (opts.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url.toString(), {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: ToolDef[] = [
  {
    name: 'get_country_risk',
    description:
      'Get the Country Instability Index (CII) score for one or all countries. Returns a 0-100 composite score with 6 components (conflict, disasters, sentiment, infrastructure, governance, market_exposure), confidence level, and provenance metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        country_code: {
          type: 'string',
          description: "ISO 3166-1 alpha-2 code (e.g. 'UA', 'TW', 'IR'). Omit for all countries.",
          minLength: 2,
          maxLength: 2,
        },
      },
    },
  },
  {
    name: 'get_alerts',
    description:
      'Get active geopolitical alerts: countries above a CII threshold, 7-day biggest movers, and active crisis triggers.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', description: 'CII threshold (0-100). Default 60.', default: 60 },
        min_delta: { type: 'number', description: 'Min 7-day CII change for movers. Default 15.', default: 15 },
      },
    },
  },
  {
    name: 'run_scenario',
    description:
      'Run a geopolitical what-if scenario. Presets: hormuz-closure, taiwan-blockade, suez-disruption, russia-nato, nk-nuclear, istanbul-earthquake, tehran-earthquake. Omit scenario_id to list all.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario_id: {
          type: 'string',
          description: "Scenario ID (e.g. 'hormuz-closure'). Omit to list all.",
        },
      },
    },
  },
  {
    name: 'get_portfolio_exposure',
    description:
      'Analyze a stock/ETF portfolio geopolitical exposure. Maps holdings to countries, cross-references CII, identifies chokepoint dependencies. Supports 50+ symbols.',
    inputSchema: {
      type: 'object',
      properties: {
        holdings: {
          type: 'array',
          description: 'Array of {symbol, weight} objects',
          items: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: "Ticker (e.g. 'TSM', 'XOM')" },
              weight: { type: 'number', description: 'Weight as %' },
            },
            required: ['symbol', 'weight'],
          },
        },
      },
      required: ['holdings'],
    },
  },
  {
    name: 'get_risk_factors',
    description:
      'Systematic risk factors: per-country z-scores, 7d/30d momentum, realized volatility. For quant strategies.',
    inputSchema: {
      type: 'object',
      properties: {
        lookback_days: { type: 'number', description: 'Rolling window (7-180). Default 30.', default: 30 },
        country_codes: { type: 'string', description: "Comma-separated ISO-2 codes (e.g. 'UA,RU,TW'). Omit for all." },
      },
    },
  },
  {
    name: 'get_audit_trail',
    description:
      'Full CII computation audit trail for a country: every score change with rule version, input lineage, component breakdown, confidence.',
    inputSchema: {
      type: 'object',
      properties: {
        country_code: { type: 'string', description: "ISO-2 code (e.g. 'UA')", minLength: 2, maxLength: 2 },
        days: { type: 'number', description: 'Lookback days (1-365). Default 30.', default: 30 },
      },
      required: ['country_code'],
    },
  },
  {
    name: 'get_active_crises',
    description: 'All currently active (unresolved) crisis triggers: CII spikes, M7+ earthquakes, verified signals.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_call_ledger',
    description:
      'The public call ledger: every dated, falsifiable call NexusWatch has open or resolved, each settled ' +
      'against a named EXTERNAL source (OONI censorship measurements, FX reference rates) on a date fixed in ' +
      "advance. Includes Brier score, skill vs each unit's own base rate, calibration bins, and effective " +
      'sample size. Skill is reported even when negative; with nothing resolved yet, scores are null rather ' +
      'than invented.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(name: string, args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  switch (name) {
    case 'get_country_risk': {
      const params: Record<string, string> = {};
      if (args.country_code) params.code = String(args.country_code).toUpperCase();
      return callApi('/api/v2/cii', { params, apiKey });
    }
    case 'get_alerts':
      return callApi('/api/v2/alerts', {
        params: {
          threshold: String(args.threshold ?? 60),
          min_delta: String(args.min_delta ?? 15),
        },
        apiKey,
      });
    case 'run_scenario': {
      const params: Record<string, string> = {};
      if (args.scenario_id) params.id = String(args.scenario_id);
      return callApi('/api/v2/scenario', { params, apiKey });
    }
    case 'get_portfolio_exposure':
      return callApi('/api/v2/exposure', {
        method: 'POST',
        body: { holdings: args.holdings },
        apiKey,
      });
    case 'get_risk_factors': {
      const params: Record<string, string> = { lookback_days: String(args.lookback_days ?? 30) };
      if (args.country_codes) params.codes = String(args.country_codes);
      return callApi('/api/v2/factors', { params, apiKey });
    }
    case 'get_audit_trail':
      return callApi('/api/v2/audit', {
        params: {
          country: String(args.country_code).toUpperCase(),
          days: String(args.days ?? 30),
        },
      });
    case 'get_active_crises':
      return callApi('/api/crisis/active');
    case 'get_call_ledger':
      return callApi('/api/calls/ledger');
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC response helpers
// ---------------------------------------------------------------------------

function rpcOk(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

// ---------------------------------------------------------------------------
// MCP protocol handler
// ---------------------------------------------------------------------------

function handleInitialize(req: JsonRpcRequest) {
  return rpcOk(req.id, {
    protocolVersion: '2024-11-05',
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
      name: 'nexuswatch',
      version: '1.0.0',
    },
  });
}

function handleToolsList(req: JsonRpcRequest) {
  return rpcOk(req.id, { tools: TOOLS });
}

async function handleToolsCall(req: JsonRpcRequest, apiKey: string) {
  const params = req.params as { name: string; arguments?: Record<string, unknown> };
  const name = params?.name;
  const args = params?.arguments ?? {};

  if (!name) return rpcError(req.id, -32602, 'Missing tool name');

  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return rpcError(req.id, -32602, `Unknown tool: ${name}`);

  try {
    const result = await executeTool(name, args, apiKey);
    return rpcOk(req.id, {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return rpcOk(req.id, {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Vercel Function handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET → info page
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      name: 'nexuswatch',
      version: '1.0.0',
      protocol: 'MCP (Model Context Protocol)',
      description:
        'Geopolitical intelligence for AI agents — 9 tools covering country risk, scenarios, portfolio exposure, alerts, and prediction accuracy.',
      tools: TOOLS.map((t) => t.name),
      connect: 'claude mcp add --transport http nexus-watch https://nexuswatch.dev/api/mcp',
      auth_required: false,
      rate_limit: '100 calls/hour per IP (shared public pool)',
      docs: 'https://nexuswatch.dev/#/mcp',
    });
  }

  // DELETE → session termination (no-op, we're stateless)
  if (req.method === 'DELETE') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Public MCP server — no auth required for callers. Anyone can connect.
  // The server uses the public key internally to authenticate against /api/v2/*.
  // Callers may optionally pass a full API_V2_KEYS key for higher rate limits.
  const callerKey =
    (req.headers['x-api-key'] as string) || (req.headers['authorization'] as string)?.replace('Bearer ', '') || '';

  const fullKeys = (process.env.API_V2_KEYS || '').split(',').filter(Boolean);
  const publicKey = process.env.NW_MCP_PUBLIC_KEY || '';

  // Upstream calls use the caller's full key if valid, otherwise fall back
  // to the server's public key so the connection works with no header set.
  const apiKey = fullKeys.includes(callerKey) ? callerKey : publicKey;

  // Parse JSON-RPC
  const body = req.body as JsonRpcRequest | JsonRpcRequest[];
  const messages = Array.isArray(body) ? body : [body];
  const results: unknown[] = [];

  for (const msg of messages) {
    if (!msg.jsonrpc || msg.jsonrpc !== '2.0') {
      results.push(rpcError(msg.id, -32600, 'Invalid JSON-RPC'));
      continue;
    }

    switch (msg.method) {
      case 'initialize':
        results.push(handleInitialize(msg));
        break;
      case 'notifications/initialized':
        // Client acknowledgment — no response needed
        break;
      case 'tools/list':
        results.push(handleToolsList(msg));
        break;
      case 'tools/call':
        results.push(await handleToolsCall(msg, apiKey));
        break;
      case 'ping':
        results.push(rpcOk(msg.id, {}));
        break;
      default:
        results.push(rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
    }
  }

  // Filter out undefined (notifications) and return
  const filtered = results.filter(Boolean);
  if (filtered.length === 0) {
    return res.status(202).end();
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(filtered.length === 1 ? filtered[0] : filtered);
}
