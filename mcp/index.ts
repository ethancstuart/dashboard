#!/usr/bin/env node
/**
 * NexusWatch MCP Server — geopolitical intelligence for AI agents.
 *
 * Exposes NexusWatch's v2 API as MCP tools so Claude, GPT, and any
 * MCP-compatible agent can query country instability scores, run
 * geopolitical scenarios, check portfolio exposure, and more.
 *
 * Usage (stdio):
 *   NEXUSWATCH_API_KEY=nwk_xxx npx ts-node mcp/index.ts
 *
 * Or via Claude Code:
 *   claude mcp add nexus-watch -e NEXUSWATCH_API_KEY=nwk_xxx -- npx ts-node mcp/index.ts
 *
 * Remote HTTP access (no install):
 *   claude mcp add --transport http nexus-watch https://nexuswatch.dev/api/mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.NEXUSWATCH_BASE_URL || 'https://nexuswatch.dev';
const API_KEY = process.env.NEXUSWATCH_API_KEY || '';

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(path, BASE_URL);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = { 'X-API-Key': API_KEY };
  if (opts.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url.toString(), {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NexusWatch API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function text(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'nexuswatch',
  version: '1.0.0',
});

// ---- Tool 1: get_country_risk ----
server.tool(
  'get_country_risk',
  'Get the Country Instability Index (CII) score for one or all countries. Returns a 0-100 composite score with 6 components (conflict, disasters, sentiment, infrastructure, governance, market_exposure), confidence level, and data provenance metadata. Use this to assess geopolitical risk for any country.',
  {
    country_code: z
      .string()
      .length(2)
      .optional()
      .describe("ISO 3166-1 alpha-2 country code (e.g. 'UA', 'TW', 'IR'). Omit for all countries."),
  },
  async ({ country_code }) => {
    const params: Record<string, string> = {};
    if (country_code) params.code = country_code.toUpperCase();
    const data = await api('/api/v2/cii', { params });
    return text(data);
  },
);

// ---- Tool 2: get_alerts ----
server.tool(
  'get_alerts',
  "Get active geopolitical alerts: countries above a CII threshold, 7-day biggest movers (rising/falling instability), and active crisis triggers (CII spikes, major earthquakes, verified signals). This is the 'what demands attention right now' tool.",
  {
    threshold: z
      .number()
      .int()
      .min(0)
      .max(100)
      .default(60)
      .describe('CII score threshold — countries at or above this are flagged. Default 60.'),
    min_delta: z
      .number()
      .int()
      .min(0)
      .max(100)
      .default(15)
      .describe('Minimum 7-day CII change to include in movers list. Default 15.'),
  },
  async ({ threshold, min_delta }) => {
    const data = await api('/api/v2/alerts', {
      params: {
        threshold: String(threshold),
        min_delta: String(min_delta),
      },
    });
    return text(data);
  },
);

// ---- Tool 3: run_scenario ----
server.tool(
  'run_scenario',
  'Run a geopolitical what-if scenario simulation. Models the cascading impact on country instability scores if a major event occurs. Available presets: hormuz-closure (Iran closes Strait of Hormuz), taiwan-blockade (China naval blockade), suez-disruption (Suez Canal blocked), russia-nato (direct military confrontation), nk-nuclear (North Korea nuclear test), istanbul-earthquake (M7+ quake), tehran-earthquake (M7+ quake). Returns per-country CII deltas, cascade chains, and summary statistics.',
  {
    scenario_id: z
      .string()
      .optional()
      .describe(
        "Preset scenario ID: 'hormuz-closure', 'taiwan-blockade', 'suez-disruption', 'russia-nato', 'nk-nuclear', 'istanbul-earthquake', 'tehran-earthquake'. Omit to list all available scenarios.",
      ),
  },
  async ({ scenario_id }) => {
    const params: Record<string, string> = {};
    if (scenario_id) params.id = scenario_id;
    const data = await api('/api/v2/scenario', { params });
    return text(data);
  },
);

// ---- Tool 4: get_portfolio_exposure ----
server.tool(
  'get_portfolio_exposure',
  "Analyze a stock/ETF portfolio's exposure to geopolitical risk. Takes a list of holdings with weights, maps them to countries, cross-references CII scores, and identifies chokepoint dependencies (Hormuz, Malacca, Suez, etc.). Returns overall risk score, per-country exposure breakdown, elevated-risk countries, and chokepoint vulnerability. Supports 50+ symbols including TSMC, ASML, XOM, AAPL, VWO, EEM, GLD, etc.",
  {
    holdings: z
      .array(
        z.object({
          symbol: z.string().describe("Ticker symbol (e.g. 'TSM', 'XOM', 'AAPL', 'VWO')"),
          weight: z.number().min(0).max(100).describe('Portfolio weight as percentage (e.g. 20 for 20%)'),
        }),
      )
      .min(1)
      .max(50)
      .describe('Array of portfolio holdings with symbol and weight'),
  },
  async ({ holdings }) => {
    const data = await api('/api/v2/exposure', {
      method: 'POST',
      body: { holdings },
    });
    return text(data);
  },
);

// ---- Tool 5: get_risk_factors ----
server.tool(
  'get_risk_factors',
  'Get systematic risk factors for quantitative analysis. Returns per-country z-scores, 7-day and 30-day momentum, and 30-day realized volatility of CII scores. Designed for quant strategies that need geopolitical risk as a tradeable signal.',
  {
    lookback_days: z
      .number()
      .int()
      .min(7)
      .max(180)
      .default(30)
      .describe('Rolling window for momentum/vol calculations. Default 30.'),
    country_codes: z
      .string()
      .optional()
      .describe("Comma-separated ISO-2 codes to filter (e.g. 'UA,RU,TW'). Omit for all."),
  },
  async ({ lookback_days, country_codes }) => {
    const params: Record<string, string> = {
      lookback_days: String(lookback_days),
    };
    if (country_codes) params.codes = country_codes;
    const data = await api('/api/v2/factors', { params });
    return text(data);
  },
);

// ---- Tool 6: get_audit_trail ----
server.tool(
  'get_audit_trail',
  "Get the full CII computation audit trail for a country — every score change with the rule version, input data lineage IDs, component breakdown, confidence level, applied rules, and data gaps. Use this to verify WHY a country's score changed and what data drove it. This is the trust/provenance layer.",
  {
    country_code: z.string().length(2).describe("ISO 3166-1 alpha-2 country code (e.g. 'UA', 'IR')"),
    days: z.number().int().min(1).max(365).default(30).describe('Lookback window in days. Default 30.'),
  },
  async ({ country_code, days }) => {
    const data = await api('/api/v2/audit', {
      params: {
        country: country_code.toUpperCase(),
        days: String(days),
      },
    });
    return text(data);
  },
);

// ---- Tool 7: get_active_crises ----
server.tool(
  'get_active_crises',
  'Get all currently active (unresolved) crisis triggers. These are auto-detected events: CII spikes exceeding threshold, M7+ earthquakes, verified intelligence signals. Each trigger maps to a crisis playbook. Returns trigger type, affected country, CII score/delta, and timestamp.',
  {},
  async () => {
    const data = await api('/api/crisis/active');
    return text(data);
  },
);

// ---- Tool 8: get_call_ledger ----
// Replaces two tools that asserted falsehoods to LLM clients:
// get_sanctions_attribution filtered on country_codes, which is empty on every
// row of sanctions_events, so it returned "no sanctions activity" for every
// country on earth while its methodology string claimed a three-way join. And
// validate_predictions served the closed-loop pipeline — predictions of our own
// index scored against our own index, measured at -37.3% skill vs no-change —
// described as "the public accountability layer". The ledger below is the real
// accountability layer: calls settled against external sources only.
server.tool(
  'get_call_ledger',
  "The public call ledger: every dated, falsifiable call NexusWatch has open or resolved, each settled against a named EXTERNAL source (OONI censorship measurements, FX reference rates) on a date fixed in advance. Includes Brier score, skill vs each unit's own base rate, calibration bins, and effective sample size. Skill is reported even when negative; with nothing resolved yet, scores are null rather than invented.",
  {},
  async () => {
    const data = await api('/api/calls/ledger');
    return text(data);
  },
);

// ---------------------------------------------------------------------------
// Resources — passive context for agents
// ---------------------------------------------------------------------------

server.resource(
  'methodology',
  'nexuswatch://methodology',
  {
    description:
      'Country Instability Index methodology: 6-component scoring (Conflict 20%, Disasters 15%, Sentiment 15%, Infrastructure 15%, Governance 15%, Market Exposure 20%), 86 nations in 3 tiers, rule version 2.1.0. Evidence chain and confidence scoring baked in.',
    mimeType: 'text/plain',
  },
  async () => ({
    contents: [
      {
        uri: 'nexuswatch://methodology',
        mimeType: 'text/plain',
        text: `NexusWatch Country Instability Index (CII) v2.1.0

Composite 0-100 score from six weighted components:
- Conflict (20%): ACLED events, frontline proximity, military activity
- Disasters (15%): USGS earthquakes, NASA FIRMS fires, GDACS, NOAA storms
- Sentiment (15%): GDELT tone, news event volume, social signals
- Infrastructure (15%): Chokepoint status, energy disruptions, internet outages, cable/pipeline proximity
- Governance (15%): V-Dem democracy indicators, sanctions pressure, regime type
- Market Exposure (20%): Trade route dependency, commodity flow concentration, FDI vulnerability

Coverage: 86 nations across 3 tiers:
- Core (Tier 1): 30 highest-impact countries — full 6-component scoring, 15-min refresh
- Extended (Tier 2): 36 countries — 5-component scoring (governance may use baseline), 30-min refresh
- Monitor (Tier 3): 20 countries — 3-component scoring, daily refresh

Confidence levels:
- High: 4+ active data sources contributing, all components have fresh data
- Medium: 2-3 sources, some components using cached/baseline data
- Low: <2 sources or stale data; score may lag reality

Data sources: ACLED, USGS, NASA FIRMS, GDACS, NOAA NHC, GDELT, OpenSky, AIS/MarineTraffic,
Polymarket, OFAC SDN, V-Dem, Copernicus EMS, Cloudflare Radar, and 10+ additional feeds.

All scores include full audit trails via the get_audit_trail tool.`,
      },
    ],
  }),
);

server.resource(
  'scenarios',
  'nexuswatch://scenarios',
  {
    description: 'List of available geopolitical scenario simulations with descriptions and trigger conditions.',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [
      {
        uri: 'nexuswatch://scenarios',
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            scenarios: [
              {
                id: 'hormuz-closure',
                name: 'Strait of Hormuz Closure',
                triggers: ['Iran military action', 'mine deployment', 'IRGC naval blockade'],
                primary_impact: 'JP, KR, IN, CN, DE, FR',
              },
              {
                id: 'taiwan-blockade',
                name: 'China Naval Blockade of Taiwan',
                triggers: ['PLA Navy deployment', 'air defense zone expansion', 'trade embargo'],
                primary_impact: 'TW, JP, KR, US, DE',
              },
              {
                id: 'suez-disruption',
                name: 'Suez Canal Disruption',
                triggers: ['vessel grounding', 'Houthi attacks', 'Egyptian political crisis'],
                primary_impact: 'DE, FR, IT, ES, GB, EG',
              },
              {
                id: 'russia-nato',
                name: 'Russia-NATO Escalation',
                triggers: ['direct military confrontation', 'Article 5 invocation', 'nuclear threat'],
                primary_impact: 'PL, RO, DE, FR, GB',
              },
              {
                id: 'nk-nuclear',
                name: 'North Korea Nuclear Test',
                triggers: ['underground detonation', 'ICBM launch', 'test announcement'],
                primary_impact: 'KR, JP, US, CN',
              },
              {
                id: 'istanbul-earthquake',
                name: 'Istanbul M7+ Earthquake',
                triggers: ['seismic event M7.0+', 'North Anatolian Fault rupture'],
                primary_impact: 'TR, DE, FR, GB',
              },
              {
                id: 'tehran-earthquake',
                name: 'Tehran M7+ Earthquake',
                triggers: ['seismic event M7.0+'],
                primary_impact: 'IR, IQ, AF, PK',
              },
            ],
          },
          null,
          2,
        ),
      },
    ],
  }),
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('NexusWatch MCP server running on stdio');
  console.error(`Base URL: ${BASE_URL}`);
  console.error(`API Key: ${API_KEY ? 'set' : 'NOT SET — tools requiring auth will fail'}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
