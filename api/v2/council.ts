/**
 * The Council — 5-persona parallel analyst + synthesizer.
 *
 * POST /api/v2/council
 *   Body: { question, context?, country_code? }
 *   Accept: text/event-stream  → streams 6 channels
 *
 * Architecture:
 *   1. checkBudget — kill-switch at $9/day
 *   2. Pre-fetch a shared data appendix once (CII, top risks, verified
 *      signals, recent ACLED) so personas don't each pay for tool-use.
 *   3. Fan out 5 persona calls in parallel (non-streaming, 1 round-trip each).
 *      Emit `persona_start` immediately, `persona_done` as each completes.
 *   4. Stream the synthesizer's response token-by-token after all personas done.
 *   5. Persist run + per-persona outputs in council_runs / council_persona_outputs.
 *
 * Latency target: ~20s (10s personas in parallel + 10s synth stream).
 * Cost: ~$0.05/run (5x Sonnet) + ~$0.04 synth (Opus) ≈ $0.09 per run.
 *
 * 2026-05 tier-up Phase 2.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { fanout, singleAnthropic, type AnthropicCallSpec } from '../_lib/anthropic-fanout.js';
import { checkBudget, estimateAnthropicCost, recordSpend } from '../_lib/llm-budget.js';
import { rateLimit } from '../_lib/rateLimit.js';
import {
  PERSONAS,
  SYNTHESIZER_SYSTEM,
  personaUserMessage,
  synthesizerUserMessage,
  type PersonaId,
} from '../_lib/personas.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const PERSONA_MODEL = 'claude-sonnet-4-6';
const SYNTH_MODEL = 'claude-opus-4-7';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

interface CouncilBody {
  question?: string;
  context?: string;
  country_code?: string;
  /** When true, skip the user-facing budget gate (cron only). */
  /** Where the run came from (logging only). */
  source?: 'live-brief' | 'daily-brief' | 'audio-brief' | 'manual';
}

interface PersonaOutput {
  persona: PersonaId;
  text: string;
  ok: boolean;
  ms: number;
  spend_usd: number;
  error?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const rl = await rateLimit(req, { key: 'council', limit: 5, windowSec: 3600 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({ error: 'rate_limited', limit: rl.limit, retry_after_sec: rl.retryAfterSec });
  }

  const body = (req.body ?? {}) as CouncilBody;
  const question = (body.question ?? '').trim();
  if (!question) return res.status(400).json({ error: 'question required' });

  const source = body.source ?? 'manual';

  // Budget gate
  // The cap-bypass argument is a CONSTANT here, never a request field. Until
  // 2026-08-28 this endpoint read that flag off the unauthenticated JSON body,
  // so a single boolean from any caller skipped BOTH spend defences at once:
  // the $9/day hard kill (llm-budget.ts:74) and the DISABLE_LLM_USER_FACING
  // operator switch (llm-budget.ts:50), on a ~$0.09 five-Sonnet-plus-Opus
  // fan-out that had no rate limit either. Nothing in the repo ever set it —
  // the field existed only to be abused.
  const gate = await checkBudget({ endpoint: 'council', bypassCap: false });
  if (!gate.ok) {
    res.setHeader('Retry-After', '3600');
    return res.status(503).json(gate);
  }

  // Stream SSE
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sse = (event: string, data: unknown): void => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Stable run row so we can persist as we go
  const runStart = Date.now();
  const dbUrl = process.env.DATABASE_URL;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = dbUrl ? neon(dbUrl) : null;
  let runId: number | null = null;
  if (sql) {
    try {
      const rows = (await sql`
        INSERT INTO council_runs (question, context, trigger_source, started_at)
        VALUES (${question}, ${body.context ?? null}, ${source}, NOW())
        RETURNING id
      `) as unknown as Array<{ id: number }>;
      runId = rows[0]?.id ?? null;
    } catch (e) {
      console.error('[council] run insert failed:', e instanceof Error ? e.message : e);
    }
  }

  sse('run_started', { run_id: runId, started_at: new Date().toISOString() });

  // Build shared data appendix (in-memory; no per-persona tool use)
  const appendix = await buildDataAppendix({
    sql,
    countryCode: body.country_code,
    extraContext: body.context,
  });
  sse('appendix_ready', { chars: appendix.length });

  // Fan out personas — each notifies its own start so columns animate in.
  const personaResults = await Promise.all(
    PERSONAS.map(async (p): Promise<PersonaOutput> => {
      sse('persona_start', { persona: p.id, label: p.label, one_line: p.oneLine });
      const spec: AnthropicCallSpec = {
        label: `council:${p.id}`,
        model: 'sonnet',
        timeoutMs: 40_000,
        body: {
          model: PERSONA_MODEL,
          max_tokens: 700,
          system: [{ type: 'text', text: p.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: personaUserMessage(question, appendix) }],
        },
      };
      const [result] = await fanout([spec], apiKey);
      const text = extractText(result.data);
      sse('persona_done', {
        persona: p.id,
        ok: result.ok,
        ms: result.ms,
        text,
        error: result.error,
      });
      if (sql && runId != null) {
        try {
          await sql`
            INSERT INTO council_persona_outputs (run_id, persona, output, ms, ok, error)
            VALUES (${runId}, ${p.id}, ${text}, ${result.ms}, ${result.ok}, ${result.error ?? null})
          `;
        } catch (e) {
          console.error('[council] persona insert failed:', e instanceof Error ? e.message : e);
        }
      }
      return {
        persona: p.id,
        text,
        ok: result.ok,
        ms: result.ms,
        spend_usd: result.spend_usd,
        error: result.error,
      };
    }),
  );

  const successfulTranscripts = personaResults
    .filter((p) => p.ok && p.text.length > 0)
    .map((p) => ({ persona: p.persona, text: p.text }));

  if (successfulTranscripts.length < 2) {
    sse('error', { stage: 'council', message: 'too few personas completed; aborting synthesis' });
    sse('done', {
      run_id: runId,
      ok: false,
      total_spend_usd: personaResults.reduce((s, p) => s + p.spend_usd, 0),
      persona_oks: personaResults.map((p) => ({ persona: p.persona, ok: p.ok })),
    });
    res.end();
    return;
  }

  // Synthesizer — stream tokens
  sse('synthesizer_start', { model: SYNTH_MODEL });

  let synthBuffer = '';
  let synthSpend = 0;
  try {
    const synthRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: SYNTH_MODEL,
        max_tokens: 1500,
        system: [{ type: 'text', text: SYNTHESIZER_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: synthesizerUserMessage(question, successfulTranscripts) }],
        stream: true,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!synthRes.ok || !synthRes.body) {
      sse('error', { stage: 'synthesizer', message: `anthropic_${synthRes.status}` });
    } else {
      const reader = synthRes.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const ev = JSON.parse(dataLine.slice(6)) as {
              type: string;
              delta?: { type?: string; text?: string };
              message?: { usage?: typeof usage };
              usage?: typeof usage;
            };
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
              synthBuffer += ev.delta.text;
              sse('synthesizer_token', { text: ev.delta.text });
            } else if (ev.type === 'message_start' && ev.message?.usage) {
              usage = ev.message.usage;
            } else if (ev.type === 'message_delta' && ev.usage) {
              usage = { ...usage, ...ev.usage };
            }
          } catch {
            /* skip */
          }
        }
      }
      synthSpend = estimateAnthropicCost('opus', {
        input_tokens: usage?.input_tokens,
        output_tokens: usage?.output_tokens,
        cached_input_tokens: usage?.cache_read_input_tokens,
      });
      await recordSpend(synthSpend, 'council:synth');
    }
  } catch (e) {
    sse('error', { stage: 'synthesizer', message: e instanceof Error ? e.message : 'stream_failed' });
  }

  sse('synthesizer_done', { chars: synthBuffer.length });

  // Split synth into consensus / dissent / bottom-line for storage
  const { consensus, dissent, bottomLine } = splitSynthesis(synthBuffer);

  const totalSpend = personaResults.reduce((s, p) => s + p.spend_usd, 0) + synthSpend;

  if (sql && runId != null) {
    try {
      await sql`
        UPDATE council_runs
        SET completed_at = NOW(),
            synthesis = ${consensus},
            dissent_log = ${dissent},
            total_spend_usd = ${totalSpend},
            ok = true
        WHERE id = ${runId}
      `;
    } catch (e) {
      console.error('[council] run update failed:', e instanceof Error ? e.message : e);
    }
  }

  sse('done', {
    run_id: runId,
    ok: true,
    total_spend_usd: Number(totalSpend.toFixed(4)),
    duration_ms: Date.now() - runStart,
    persona_oks: personaResults.map((p) => ({ persona: p.persona, ok: p.ok, ms: p.ms })),
    bottom_line: bottomLine,
  });
  res.end();
}

// ---------------------------------------------------------------------------
// Data appendix builder
// ---------------------------------------------------------------------------

async function buildDataAppendix({
  sql,
  countryCode,
  extraContext,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any;
  countryCode?: string;
  extraContext?: string;
}): Promise<string> {
  const parts: string[] = [];

  if (extraContext) {
    parts.push('CALLER-PROVIDED CONTEXT:');
    parts.push(extraContext);
    parts.push('');
  }

  if (!sql) {
    parts.push('(No DB connection — relying on caller context.)');
    return parts.join('\n');
  }

  try {
    if (countryCode) {
      const rows = (await sql`
        SELECT country_code, country_name, cii_score::float AS cii_score,
               confidence,
               component_conflict::float AS conflict,
               component_disasters::float AS disasters,
               component_sentiment::float AS sentiment,
               component_infrastructure::float AS infrastructure,
               component_governance::float AS governance,
               component_market_exposure::float AS market_exposure,
               date
        FROM cii_daily_snapshots
        WHERE country_code = ${countryCode.toUpperCase()}
          AND date = (SELECT MAX(date) FROM cii_daily_snapshots)
        LIMIT 1
      `) as unknown as Array<Record<string, unknown>>;
      if (rows[0]) {
        const r = rows[0];
        parts.push(`COUNTRY FOCUS — ${r.country_name} (${r.country_code}) as of ${r.date}:`);
        parts.push(
          `  CII ${r.cii_score} (${(r.confidence as string).toUpperCase()} confidence) · conflict ${r.conflict} · disasters ${r.disasters} · sentiment ${r.sentiment} · infra ${r.infrastructure} · governance ${r.governance} · market exposure ${r.market_exposure}`,
        );
        parts.push('');
      }
    }

    const topRows = (await sql`
      SELECT country_code, country_name, cii_score::float AS s, confidence
      FROM cii_daily_snapshots
      WHERE date = (SELECT MAX(date) FROM cii_daily_snapshots)
      ORDER BY cii_score DESC
      LIMIT 12
    `) as unknown as Array<{ country_code: string; country_name: string; s: number; confidence: string }>;
    if (topRows.length > 0) {
      parts.push('TOP-12 RISK COUNTRIES (current snapshot):');
      for (const r of topRows) {
        parts.push(`  ${r.country_name} (${r.country_code}): CII ${r.s.toFixed(1)} [${r.confidence.toUpperCase()}]`);
      }
      parts.push('');
    }

    const triggers = (await sql`
      SELECT country_code, trigger_type, cii_score::float AS cii_score,
             cii_delta::float AS cii_delta, notes, triggered_at
      FROM crisis_triggers
      WHERE resolved_at IS NULL
      ORDER BY triggered_at DESC
      LIMIT 8
    `.catch(() => [] as unknown)) as unknown as Array<Record<string, unknown>>;
    if (Array.isArray(triggers) && triggers.length > 0) {
      parts.push('ACTIVE CRISIS TRIGGERS:');
      for (const t of triggers) {
        parts.push(
          `  ${t.country_code} · ${t.trigger_type} · CII ${t.cii_score} (Δ ${t.cii_delta}) · ${t.notes ?? ''}`,
        );
      }
      parts.push('');
    }

    if (countryCode) {
      const events = (await sql`
        SELECT location, event_type, fatalities, occurred_at
        FROM acled_events
        WHERE country = ${countryCode.toUpperCase()}
          AND occurred_at > NOW() - INTERVAL '30 days'
        ORDER BY occurred_at DESC
        LIMIT 12
      `.catch(() => [] as unknown)) as unknown as Array<Record<string, unknown>>;
      if (Array.isArray(events) && events.length > 0) {
        parts.push(`RECENT ACLED EVENTS in ${countryCode.toUpperCase()} (last 30 days):`);
        for (const e of events) {
          parts.push(
            `  ${e.occurred_at} · ${e.location ?? '?'} · ${e.event_type ?? '?'} · ${e.fatalities ?? 0} fatalities`,
          );
        }
        parts.push('');
      }
    }
  } catch (e) {
    parts.push(`(Data appendix partial — query error: ${e instanceof Error ? e.message : 'unknown'})`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

function extractText(data: unknown): string {
  if (!data) return '';
  const r = data as AnthropicResponse;
  if (!Array.isArray(r.content)) return '';
  return r.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

function splitSynthesis(text: string): { consensus: string; dissent: string; bottomLine: string } {
  const consensusMatch = text.match(/\[CONSENSUS\]\s*([\s\S]*?)(?=\[DISSENT\]|$)/);
  const dissentMatch = text.match(/\[DISSENT\]\s*([\s\S]*?)(?=\[BOTTOM-LINE\]|$)/);
  const bottomMatch = text.match(/\[BOTTOM-LINE\]:?\s*(.*)$/);
  return {
    consensus: (consensusMatch?.[1] ?? text).trim(),
    dissent: (dissentMatch?.[1] ?? '').trim(),
    bottomLine: (bottomMatch?.[1] ?? '').trim(),
  };
}

// Keep singleAnthropic referenced so the import stays useful if we add a
// sequential pre-flight call later.
void singleAnthropic;
