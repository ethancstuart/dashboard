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
    name: 'get_call_ledger',
    description:
      'The public call ledger: every dated, falsifiable call NexusWatch has open or resolved, each settled ' +
      'against a named EXTERNAL source (OONI censorship measurements, FX reference rates) on a date fixed in ' +
      "advance. Includes Brier score, skill vs each unit's own base rate, calibration bins, and effective " +
      'sample size. Skill is reported even when negative; with nothing resolved yet, scores are null rather ' +
      'than invented. This is the product.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_country_risk',
    description:
      'The Country Instability Index for one or all countries: a slow STRUCTURAL level (0-100; conflict, ' +
      'governance, market exposure baselines) plus a separate live daily deviation. Two numbers, never one ' +
      'sum. Includes component breakdown and a data-quality grade.',
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
    name: 'get_brief',
    description:
      'The daily intelligence brief from the archive: the model-written (or deterministic-fallback) edition ' +
      'with its standing ledger line. Defaults to the latest; pass a date for history.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD. Omit for the latest brief.' },
      },
    },
  },
];

/**
 * Tools RETIRED with the 2026-09 narrowing (map, scenarios, portfolio and
 * crisis subsystems deleted; docs/copy/2026-09-XX-the-instrument.md tells the
 * story). NOT listed to new clients — but an existing install that calls one
 * gets a structured explanation instead of "Unknown tool", because breaking
 * silently is how a public integration dies twice.
 */
const RETIRED_TOOLS: Record<string, string> = {
  get_alerts: 'CII-threshold alerting was retired with the platform narrowing (2026-09).',
  run_scenario: 'What-if scenarios were retired with the platform narrowing (2026-09).',
  get_portfolio_exposure: 'Portfolio exposure analysis was retired with the platform narrowing (2026-09).',
  get_risk_factors: 'Systematic risk factors were retired with the platform narrowing (2026-09).',
  get_audit_trail: 'The per-country CII audit trail was retired with the platform narrowing (2026-09).',
  get_active_crises: 'Crisis triggers were retired with the platform narrowing (2026-09).',
};

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name in RETIRED_TOOLS) {
    return {
      retired: true,
      message:
        RETIRED_TOOLS[name] +
        ' NexusWatch is now a public register of dated, externally-resolved forecasts. ' +
        'Available tools: get_call_ledger, get_country_risk, get_brief. ' +
        'Background: https://nexuswatch.dev/methodology',
    };
  }
  switch (name) {
    case 'get_call_ledger':
      return callApi('/api/calls/ledger');
    case 'get_country_risk': {
      const params: Record<string, string> = {};
      if (args.country_code) params.country = String(args.country_code).toUpperCase();
      return callApi('/api/v1/cii', { params });
    }
    case 'get_brief': {
      const params: Record<string, string> = {};
      if (args.date && /^\d{4}-\d{2}-\d{2}$/.test(String(args.date))) params.date = String(args.date);
      return callApi('/api/v1/brief', { params });
    }
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

async function handleToolsCall(req: JsonRpcRequest) {
  const params = req.params as { name: string; arguments?: Record<string, unknown> };
  const name = params?.name;
  const args = params?.arguments ?? {};

  if (!name) return rpcError(req.id, -32602, 'Missing tool name');

  // Retired tools must REACH executeTool to get their structured retirement
  // message — this validation gate was rejecting them as unknown before the
  // branch built for them could run, which was caught only by CALLING a
  // retired tool against the deployed endpoint after merge (the deployed-
  // model rule: the slim looked complete in every local read of the code).
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool && !(name in RETIRED_TOOLS)) return rpcError(req.id, -32602, `Unknown tool: ${name}`);

  try {
    const result = await executeTool(name, args);
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

  // Public MCP server — no auth, no keys. Every surviving backend
  // (/api/calls/ledger, /api/v1/cii, /api/v1/brief) is public JSON; the v2
  // key plumbing left with the v2 endpoints (2026-09 narrowing).

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
        results.push(await handleToolsCall(msg));
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
