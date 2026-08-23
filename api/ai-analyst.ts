import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { recordAnthropicSpend, type AnthropicUsage } from './_lib/llm-budget.js';
import { checkBudget } from './_lib/llm-budget.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * AI Analyst — Tool-using intelligence analyst endpoint.
 *
 * POST /api/ai-analyst
 * Body: { query: string, context?: string }
 *
 * Supports two response modes:
 *   - Default (application/json): buffers the full response and returns
 *     { text, toolsUsed }. Backward-compatible with existing clients.
 *   - Streaming (Accept: text/event-stream OR ?stream=1): emits SSE
 *     events as the model works —
 *       event: tool_use   data: { name: 'get_country_cii', input: {...} }
 *       event: tool_result data: { tool: '...', ok: true }
 *       event: token      data: { text: '...' }
 *       event: done       data: { toolsUsed: [...] }
 *     Lets the client show "Checking CII for Sudan…" within ~500 ms
 *     instead of waiting 15 s for the full two-call round trip.
 *
 * Anthropic prompt caching (cache_control: ephemeral) is applied to both
 * the system prompt and the tool definitions so the second call (follow-
 * up after tool execution) benefits from ~90% input-token discount.
 */

const SYSTEM_PROMPT = `You are the NexusWatch Intelligence Analyst — a tool-using AI analyst embedded in a geopolitical intelligence platform monitoring 86 countries across 35+ data layers.

CORE MANDATE: Every claim you make must be traceable to a data source. You are not a chatbot. You are an analyst who shows their work.

CITATION RULES (MANDATORY):
- Every factual claim must name its source: "Per ACLED data...", "USGS reports...", "GDELT sentiment analysis shows..."
- Tag EVERY SENTENCE with a confidence marker at the end:
  [H] — HIGH confidence: 3+ sources agree, data fresh (< 1 hour)
  [M] — MEDIUM confidence: 2 sources or partially stale data
  [L] — LOW confidence: single source, stale data, or analytical inference
  [A] — ASSESSMENT (analytical, not factual): your interpretation
- Example of proper tagging:
  "Sudan's CII is 87 [H]. Conflict intensity increased 23% week-over-week per ACLED [H]. The RSF-SAF dynamic resembles the 2023 Khartoum collapse pattern [A]. Reports of famine in Darfur are widespread but exact casualty numbers remain uncertain [M]."
- Distinguish facts from assessments: "CONFIRMED: X happened (ACLED + GDELT)" vs "ASSESSED: Y is likely (based on historical pattern)"
- When data is thin, say so: "Limited ACLED coverage in this region — conflict score relies on baseline estimates [L]"

VOICE: 40% analyst / 60% smart friend. Authoritative but accessible. Use "we" as the brand pronoun.

STRUCTURE: Lead with the bottom line, then evidence, then gaps. End with a confidence summary.

FORBIDDEN:
- Never fabricate data or events
- Never say "according to reports" without naming the report
- Never present single-source intelligence as confirmed
- Never hide uncertainty — disclose it prominently

You have access to tools that query live NexusWatch data. Use them to ground your responses in real, timestamped data.`;

interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const TOOLS: Tool[] = [
  {
    name: 'get_country_cii',
    description:
      'Get the Country Instability Index score for a specific country. Returns the 0-100 CII score, 6-component breakdown (conflict, disasters, sentiment, infrastructure, governance, marketExposure), confidence level, contributing data sources, and data gaps.',
    input_schema: {
      type: 'object',
      properties: {
        country_code: {
          type: 'string',
          description: 'ISO 3166-1 alpha-2 country code (e.g., "UA" for Ukraine, "SD" for Sudan)',
        },
      },
      required: ['country_code'],
    },
  },
  {
    name: 'get_top_risk_countries',
    description:
      'Get the top N countries by CII score. Returns country name, code, score, tier, confidence, trend, and top signals for each.',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of top countries to return (default 10)' },
      },
    },
  },
  {
    name: 'get_verified_signals',
    description:
      'Get all currently active verified signals — events confirmed by 2+ independent sources. Each signal includes verification level (CONFIRMED/CORROBORATED), contributing sources, and location.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_layer_status',
    description:
      'Get the freshness and health status of all data layers. Shows which sources are live, recent, stale, or offline, with last fetch timestamps and data point counts.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_platform_health',
    description:
      'Get the aggregate platform data confidence score and breakdown. Shows what percentage of layers are fresh and what percentage of countries have high-confidence scores.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_events',
    description:
      'Search for specific events across all layers by country or region. Returns matching events with source attribution.',
    input_schema: {
      type: 'object',
      properties: {
        country_code: { type: 'string', description: 'ISO country code to filter by' },
        event_type: {
          type: 'string',
          enum: ['conflict', 'earthquake', 'fire', 'weather', 'cyber', 'all'],
          description: 'Type of events to search for',
        },
      },
    },
  },
];

/**
 * Build the Anthropic payload with prompt caching applied.
 * cache_control: ephemeral on the system prompt + last tool gets ~90%
 * input-token discount on the follow-up call (TOOLS + SYSTEM identical
 * across both calls).
 */
function buildRequestBody(messages: unknown[], opts: { stream: boolean }): Record<string, unknown> {
  const toolsWithCache = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t,
  );
  return {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: toolsWithCache,
    messages,
    stream: opts.stream,
  };
}

function wantsStream(req: VercelRequest): boolean {
  if (typeof req.query.stream === 'string' && ['1', 'true'].includes(req.query.stream)) return true;
  const accept = String(req.headers.accept ?? '');
  return accept.includes('text/event-stream');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Budget gate — the $9/day kill switch only works if every public spender
  // checks it. Until now it gated 3 of 12 call sites; this endpoint could keep
  // spending past any limit.
  const gate = await checkBudget({ endpoint: 'ai-analyst', bypassCap: false });
  if (!gate.ok) {
    res.setHeader('Retry-After', '3600');
    return res.status(503).json(gate);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({
      available: false,
      response:
        'The AI intelligence analyst is being configured. Use the map layers, CII scores, and data tools while AI analysis is being set up.',
      sources: [],
    });
  }

  const { query, context } = req.body as { query?: string; context?: string };
  if (!query) return res.status(400).json({ error: 'query required' });

  const userMessage = context ? `${query}\n\nPlatform context:\n${context}` : query;
  const streaming = wantsStream(req);

  if (streaming) return handleStreaming(req, res, apiKey, userMessage, context);
  return handleBuffered(res, apiKey, userMessage, context);
}

// ---------------------------------------------------------------------------
// Buffered (JSON) mode — backward-compatible
// ---------------------------------------------------------------------------

async function handleBuffered(
  res: VercelResponse,
  apiKey: string,
  userMessage: string,
  context?: string,
): Promise<VercelResponse | void> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(buildRequestBody([{ role: 'user', content: userMessage }], { stream: false })),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error(`AI analyst API error: ${response.status} — ${errBody.slice(0, 200)}`);
      return res.status(502).json({ error: 'AI analyst unavailable' });
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown>; id?: string }>;
      stop_reason: string;
      usage?: AnthropicUsage;
    };
    await recordAnthropicSpend('claude-haiku-4-5-20251001', data.usage, 'ai-analyst');

    if (data.stop_reason === 'tool_use') {
      const dbUrl = process.env.DATABASE_URL;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sql: any = dbUrl ? neon(dbUrl) : null;
      const toolResults = [];
      for (const block of data.content) {
        if (block.type === 'tool_use' && block.name && block.id) {
          const result = await executeToolCall(sql, block.name, block.input || {}, context);
          toolResults.push({
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      const followUp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(
          buildRequestBody(
            [
              { role: 'user', content: userMessage },
              { role: 'assistant', content: data.content },
              { role: 'user', content: toolResults },
            ],
            { stream: false },
          ),
        ),
        signal: AbortSignal.timeout(30000),
      });

      if (!followUp.ok) {
        return res.status(502).json({ error: 'AI analyst follow-up failed' });
      }

      const followUpData = (await followUp.json()) as {
        content: Array<{ type: string; text?: string }>;
        usage?: AnthropicUsage;
      };
      await recordAnthropicSpend('claude-haiku-4-5-20251001', followUpData.usage, 'ai-analyst:tool-followup');

      const text = followUpData.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');

      return res.json({
        text,
        toolsUsed: data.content.filter((b) => b.type === 'tool_use').map((b) => b.name),
      });
    }

    const text = data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return res.json({ text, toolsUsed: [] });
  } catch (err) {
    console.error('AI analyst error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'AI analyst failed' });
  }
}

// ---------------------------------------------------------------------------
// Streaming (SSE) mode — incremental tool-use + token events
// ---------------------------------------------------------------------------

async function handleStreaming(
  _req: VercelRequest,
  res: VercelResponse,
  apiKey: string,
  userMessage: string,
  context?: string,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sseSend = (event: string, data: unknown): void => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // ---- First call: let model decide what tools to use ----
    const firstRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(buildRequestBody([{ role: 'user', content: userMessage }], { stream: false })),
      signal: AbortSignal.timeout(30000),
    });
    if (!firstRes.ok) {
      sseSend('error', { message: `anthropic_${firstRes.status}` });
      res.end();
      return;
    }
    const firstData = (await firstRes.json()) as {
      content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown>; id?: string }>;
      stop_reason: string;
      usage?: AnthropicUsage;
    };
    await recordAnthropicSpend('claude-haiku-4-5-20251001', firstData.usage, 'ai-analyst:stream-first');

    // No tool use — just emit the text and done.
    if (firstData.stop_reason !== 'tool_use') {
      const text = firstData.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      // Emit in token-sized chunks so clients can render incrementally even
      // though the buffered first call doesn't actually stream.
      for (const chunk of chunkString(text, 40)) sseSend('token', { text: chunk });
      sseSend('done', { toolsUsed: [] });
      res.end();
      return;
    }

    // ---- Run tools, emit per-tool events ----
    const dbUrl = process.env.DATABASE_URL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql: any = dbUrl ? neon(dbUrl) : null;
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    const toolsUsed: string[] = [];
    for (const block of firstData.content) {
      if (block.type === 'tool_use' && block.name && block.id) {
        sseSend('tool_use', { name: block.name, input: block.input ?? {} });
        const result = await executeToolCall(sql, block.name, block.input || {}, context);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
        toolsUsed.push(block.name);
        sseSend('tool_result', { name: block.name, ok: !(result as { error?: unknown }).error });
      }
    }

    // ---- Second call: streaming follow-up with tool results ----
    const followRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(
        buildRequestBody(
          [
            { role: 'user', content: userMessage },
            { role: 'assistant', content: firstData.content },
            { role: 'user', content: toolResults },
          ],
          { stream: true },
        ),
      ),
      signal: AbortSignal.timeout(45000),
    });

    if (!followRes.ok || !followRes.body) {
      sseSend('error', { message: `anthropic_followup_${followRes.status}` });
      res.end();
      return;
    }

    // Relay the Anthropic SSE stream directly, transforming its
    // content_block_delta events into our own `token` events.
    const reader = followRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // A streamed response has no JSON body to read usage from: Anthropic
    // reports input_tokens on `message_start` and output_tokens on
    // `message_delta`. Accumulate as the frames go past and record once the
    // stream closes — otherwise the most expensive path in this file (a
    // tool-using, streamed answer) would be the one that spends silently.
    const streamUsage: AnthropicUsage = {};
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Anthropic SSE frames are separated by \n\n.
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const json = dataLine.slice(6);
        try {
          const ev = JSON.parse(json) as {
            type: string;
            delta?: { type?: string; text?: string };
            message?: { usage?: AnthropicUsage };
            usage?: AnthropicUsage;
          };
          if (ev.type === 'message_start' && ev.message?.usage) {
            streamUsage.input_tokens = ev.message.usage.input_tokens;
            streamUsage.cache_read_input_tokens = ev.message.usage.cache_read_input_tokens;
          } else if (ev.type === 'message_delta' && ev.usage) {
            streamUsage.output_tokens = ev.usage.output_tokens;
          }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            sseSend('token', { text: ev.delta.text });
          }
        } catch {
          // Skip unparseable frames (e.g. keepalives).
        }
      }
    }

    await recordAnthropicSpend('claude-haiku-4-5-20251001', streamUsage, 'ai-analyst:stream-followup');
    sseSend('done', { toolsUsed });
    res.end();
  } catch (err) {
    try {
      sseSend('error', { message: err instanceof Error ? err.message : 'stream_failed' });
    } catch {
      /* response may already be closed */
    }
    res.end();
  }
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

/**
 * Execute a tool call. Queries Neon when available; falls back to parsing
 * the client-provided context string for offline/dev runs.
 *
 * Always returns a plain object the model can serialize. Never throws —
 * errors are returned as `{ error: string }` so the model can hedge.
 */
async function executeToolCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  name: string,
  input: Record<string, unknown>,
  context?: string,
): Promise<Record<string, unknown>> {
  const ctx = context || '';

  try {
    switch (name) {
      case 'get_country_cii': {
        const code = String(input.country_code || '').toUpperCase();
        if (!code) return { error: 'country_code required' };
        if (sql) {
          const rows = (await sql`
            SELECT country_code, country_name, cii_score::float AS score,
                   confidence, component_conflict, component_disasters,
                   component_sentiment, component_infrastructure,
                   component_governance, component_market_exposure,
                   source_count, data_point_count, date
            FROM cii_daily_snapshots
            WHERE country_code = ${code}
              AND date = (SELECT MAX(date) FROM cii_daily_snapshots)
            LIMIT 1
          `) as unknown as Array<Record<string, unknown>>;
          if (rows.length > 0) {
            const r = rows[0];
            return {
              country: r.country_name,
              code: r.country_code,
              cii_score: r.score,
              confidence: r.confidence,
              components: {
                conflict: r.component_conflict,
                disasters: r.component_disasters,
                sentiment: r.component_sentiment,
                infrastructure: r.component_infrastructure,
                governance: r.component_governance,
                market_exposure: r.component_market_exposure,
              },
              source_count: r.source_count,
              data_point_count: r.data_point_count,
              snapshot_date: r.date,
              source: 'cii_daily_snapshots',
            };
          }
          return { error: `No CII snapshot for ${code}`, code };
        }
        const regex = new RegExp(`([^\\n]+?)\\(${code}\\)[:\\s]+CII\\s+(\\d+)`, 'i');
        const match = ctx.match(regex);
        return match
          ? { country: match[1].trim(), code, cii_score: parseInt(match[2], 10), source: 'context' }
          : { error: `No data for ${code}`, code };
      }

      case 'get_top_risk_countries': {
        const count = Math.min(50, Math.max(1, Number(input.count) || 10));
        if (sql) {
          const rows = (await sql`
            SELECT country_code, country_name, cii_score::float AS score, confidence
            FROM cii_daily_snapshots
            WHERE date = (SELECT MAX(date) FROM cii_daily_snapshots)
            ORDER BY cii_score DESC
            LIMIT ${count}
          `) as unknown as Array<{ country_code: string; country_name: string; score: number; confidence: string }>;
          return {
            countries: rows.map((r) => ({
              country: r.country_name,
              code: r.country_code,
              cii_score: r.score,
              confidence: r.confidence,
            })),
            count: rows.length,
            source: 'cii_daily_snapshots (6-component CII)',
          };
        }
        const lines = ctx
          .split('\n')
          .filter((l) => /CII\s+\d+/.test(l))
          .slice(0, count);
        return { countries: lines.map((l) => l.trim()), source: 'context', count: lines.length };
      }

      case 'get_verified_signals': {
        if (sql) {
          const rows = (await sql`
            SELECT playbook_key, country_code, trigger_type, cii_score::float AS cii_score,
                   cii_delta::float AS cii_delta, magnitude::float AS magnitude,
                   notes, triggered_at
            FROM crisis_triggers
            WHERE resolved_at IS NULL
            ORDER BY triggered_at DESC
            LIMIT 20
          `.catch(() => [] as unknown)) as unknown as Array<Record<string, unknown>>;
          return {
            signals: Array.isArray(rows) ? rows : [],
            source: 'crisis_triggers (server-side detection cron)',
            note: 'Each signal represents a CII spike ≥15pt/24h, M7+ quake, or verified cross-source event.',
          };
        }
        return {
          signals: ctx.split('\n').filter((l) => /VERIFIED|CONFIRMED|CORROBORATED/.test(l)),
          source: 'context',
        };
      }

      case 'get_layer_status': {
        if (sql) {
          const rows = (await sql`
            SELECT layer_id, timestamp, feature_count
            FROM event_snapshots
            WHERE timestamp > NOW() - INTERVAL '24 hours'
            ORDER BY timestamp DESC
            LIMIT 100
          `.catch(() => [] as unknown)) as unknown as Array<{
            layer_id: string;
            timestamp: string;
            feature_count: number;
          }>;
          if (Array.isArray(rows) && rows.length > 0) {
            const byLayer = new Map<string, { last_fetch: string; feature_count: number; freshness: string }>();
            for (const r of rows) {
              if (byLayer.has(r.layer_id)) continue;
              const ageMin = (Date.now() - Date.parse(r.timestamp)) / 60000;
              const freshness = ageMin < 60 ? 'live' : ageMin < 360 ? 'recent' : ageMin < 1440 ? 'stale' : 'offline';
              byLayer.set(r.layer_id, { last_fetch: r.timestamp, feature_count: r.feature_count, freshness });
            }
            return {
              layers: Object.fromEntries(byLayer),
              source: 'event_snapshots',
            };
          }
        }
        return {
          layers: ctx.split('\n').filter((l) => /live|recent|stale|offline/i.test(l)),
          source: 'context',
        };
      }

      case 'get_platform_health': {
        if (sql) {
          const snap = (await sql`
            SELECT COUNT(*) FILTER (WHERE confidence = 'high')::int   AS high_conf,
                   COUNT(*) FILTER (WHERE confidence = 'medium')::int AS med_conf,
                   COUNT(*) FILTER (WHERE confidence = 'low')::int    AS low_conf,
                   COUNT(*)::int AS total,
                   MAX(date)  AS snapshot_date
            FROM cii_daily_snapshots
            WHERE date = (SELECT MAX(date) FROM cii_daily_snapshots)
          `) as unknown as Array<{
            high_conf: number;
            med_conf: number;
            low_conf: number;
            total: number;
            snapshot_date: string;
          }>;
          const s = snap[0];
          if (s && s.total > 0) {
            const pctHigh = Math.round((s.high_conf / s.total) * 100);
            return {
              data_confidence_pct: pctHigh,
              high_confidence_countries: s.high_conf,
              medium_confidence_countries: s.med_conf,
              low_confidence_countries: s.low_conf,
              total_countries: s.total,
              snapshot_date: s.snapshot_date,
              source: 'cii_daily_snapshots',
            };
          }
        }
        return {
          health: ctx.split('\n').find((l) => /DATA CONFIDENCE/i.test(l)) || 'unavailable',
          source: 'context',
        };
      }

      case 'search_events': {
        const code = String(input.country_code || '').toUpperCase();
        const type = String(input.event_type || 'all');
        if (sql && (type === 'all' || type === 'conflict')) {
          const rows = (await sql`
            SELECT country, location, event_type, fatalities, occurred_at, source_url
            FROM acled_events
            WHERE occurred_at > NOW() - INTERVAL '14 days'
              AND (${code || null}::text IS NULL OR country = ${code || null}::text)
            ORDER BY occurred_at DESC
            LIMIT 20
          `.catch(() => [] as unknown)) as unknown as Array<Record<string, unknown>>;
          if (Array.isArray(rows) && rows.length > 0) {
            return { events: rows, source: 'acled_events', query: { country_code: code, event_type: type } };
          }
        }
        const lines = ctx.split('\n').filter((l) => {
          if (code && !l.toUpperCase().includes(code)) return false;
          if (type !== 'all' && !l.toLowerCase().includes(type)) return false;
          return true;
        });
        return { events: lines.slice(0, 20), query: { country_code: code, event_type: type }, source: 'context' };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'tool_execution_failed' };
  }
}
