/**
 * Parallel Anthropic call fan-out with timeout + cost tracking + concurrency cap.
 *
 * The Council (api/v2/council.ts) is the primary consumer: it fans out the
 * same question to N personas, then a synthesizer reads all transcripts.
 * Each call goes through this helper so:
 *   - we Promise.allSettled (one persona timing out doesn't blank the whole brief)
 *   - we record spend via llm-budget
 *   - we cap concurrency (5) so Anthropic's per-second TPS limit is respected
 *   - each call has its own AbortSignal-based timeout
 *
 * 2026-05 tier-up Phase 0.
 */

import { estimateAnthropicCost, recordSpend } from './llm-budget.js';
// llm-budget-gate-exempt: library, not a handler — its only caller (council.ts) gates with checkBudget before fanning out.

export interface AnthropicCallSpec {
  /** Persona/label for logging + cost attribution. */
  label: string;
  /** Anthropic Messages API body. */
  body: Record<string, unknown>;
  /** Model cost tier. */
  model: 'sonnet' | 'opus' | 'haiku';
  /** Per-call timeout in ms. Default 45000. */
  timeoutMs?: number;
}

export interface AnthropicCallResult {
  label: string;
  ok: boolean;
  data?: AnthropicMessagesResponse;
  error?: string;
  ms: number;
  spend_usd: number;
}

interface AnthropicMessagesResponse {
  id?: string;
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_CONCURRENCY = 5;

async function singleCall(spec: AnthropicCallSpec, apiKey: string): Promise<AnthropicCallResult> {
  const t0 = Date.now();
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(spec.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        label: spec.label,
        ok: false,
        error: `anthropic_${res.status}: ${text.slice(0, 200)}`,
        ms: Date.now() - t0,
        spend_usd: 0,
      };
    }
    const data = (await res.json()) as AnthropicMessagesResponse;
    const usage = data.usage ?? {};
    const spend = estimateAnthropicCost(spec.model, {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cached_input_tokens: usage.cache_read_input_tokens,
    });
    await recordSpend(spend, spec.label);
    return { label: spec.label, ok: true, data, ms: Date.now() - t0, spend_usd: spend };
  } catch (e) {
    return {
      label: spec.label,
      ok: false,
      error: e instanceof Error ? e.message : 'fanout_error',
      ms: Date.now() - t0,
      spend_usd: 0,
    };
  }
}

/**
 * Run a batch of Anthropic calls in parallel with concurrency cap.
 * Always resolves (never throws); inspect result.ok per entry.
 */
export async function fanout(specs: AnthropicCallSpec[], apiKey: string): Promise<AnthropicCallResult[]> {
  const results: AnthropicCallResult[] = new Array(specs.length);
  let i = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = i++;
      if (idx >= specs.length) return;
      results[idx] = await singleCall(specs[idx], apiKey);
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, specs.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Sequential follow-up call (e.g. synthesizer reading 5 persona transcripts).
 * Same cost-tracking, no concurrency.
 */
export async function singleAnthropic(spec: AnthropicCallSpec, apiKey: string): Promise<AnthropicCallResult> {
  return singleCall(spec, apiKey);
}
