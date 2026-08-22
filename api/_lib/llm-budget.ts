/**
 * Daily LLM spend tracker with hard kill-switch.
 *
 * Plan-locked cap: $10/day. We trip the kill-switch at $9 to leave 10%
 * headroom for in-flight requests still being billed. Cron-side callers
 * pass `bypassCap: true` because the daily-brief is mission-critical.
 *
 * Schema (scripts/migrations/2026-05-tier-up.sql):
 *   llm_spend_daily(day DATE PK, spend_usd NUMERIC, calls INT, last_updated TIMESTAMPTZ)
 *
 * Anyone making an Anthropic / OpenAI call should:
 *   const gate = await checkBudget('council');
 *   if (!gate.ok) return res.status(503).setHeader('Retry-After', '3600').json(gate);
 *   ... do the call ...
 *   await recordSpend(estimatedUsd);
 *
 * 2026-05 tier-up Phase 0.
 */

import { neon } from '@neondatabase/serverless';

const HARD_KILL_USD = 9.0;
const SOFT_WARN_USD = 7.0;

export interface BudgetGate {
  ok: boolean;
  spend_today: number;
  cap: number;
  cause?: 'killed' | 'env_disabled';
  message?: string;
}

export interface CheckBudgetOpts {
  /** Endpoint label for logging (e.g. 'council', 'voice', 'audio-brief'). */
  endpoint: string;
  /** Cron-side: skip the per-call rate gate. Still records spend. */
  bypassCap?: boolean;
}

function getSql(): ReturnType<typeof neon> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

export async function checkBudget(opts: CheckBudgetOpts | string): Promise<BudgetGate> {
  const { endpoint, bypassCap } = typeof opts === 'string' ? { endpoint: opts, bypassCap: false } : opts;

  // Emergency env kill (deploy a Vercel env var to instantly disable).
  if (process.env.DISABLE_LLM_USER_FACING === 'true' && !bypassCap) {
    return {
      ok: false,
      spend_today: -1,
      cap: HARD_KILL_USD,
      cause: 'env_disabled',
      message: 'LLM endpoints temporarily disabled by operator.',
    };
  }

  const sql = getSql();
  if (!sql) {
    // No DB — fail open (local dev). Production must have DATABASE_URL.
    return { ok: true, spend_today: 0, cap: HARD_KILL_USD };
  }

  try {
    const rows = (await sql`
      SELECT COALESCE(spend_usd, 0)::float AS spend
      FROM llm_spend_daily
      WHERE day = (CURRENT_DATE AT TIME ZONE 'UTC')::date
    `) as unknown as Array<{ spend: number }>;
    const spend = rows[0]?.spend ?? 0;

    if (spend >= HARD_KILL_USD && !bypassCap) {
      return {
        ok: false,
        spend_today: spend,
        cap: HARD_KILL_USD,
        cause: 'killed',
        message: `Daily LLM budget exceeded ($${spend.toFixed(2)} of $${HARD_KILL_USD.toFixed(2)} cap). Try again tomorrow.`,
      };
    }

    if (spend >= SOFT_WARN_USD) {
      console.warn(`[llm-budget] ${endpoint}: spend $${spend.toFixed(2)} approaching cap`);
    }

    return { ok: true, spend_today: spend, cap: HARD_KILL_USD };
  } catch (e) {
    console.error('[llm-budget] check failed:', e instanceof Error ? e.message : e);
    // Fail open on DB error — better to risk overspend than to take the product down.
    return { ok: true, spend_today: -1, cap: HARD_KILL_USD };
  }
}

export async function recordSpend(usd: number, endpoint?: string): Promise<void> {
  if (usd <= 0) return;
  const sql = getSql();
  if (!sql) return;

  try {
    await sql`
      INSERT INTO llm_spend_daily (day, spend_usd, calls, last_updated)
      VALUES ((CURRENT_DATE AT TIME ZONE 'UTC')::date, ${usd}, 1, NOW())
      ON CONFLICT (day) DO UPDATE
        SET spend_usd  = llm_spend_daily.spend_usd + EXCLUDED.spend_usd,
            calls       = llm_spend_daily.calls + 1,
            last_updated = NOW()
    `;
  } catch (e) {
    console.error(`[llm-budget] record failed (${endpoint ?? 'unknown'}):`, e instanceof Error ? e.message : e);
  }
}

/**
 * Estimate USD spend for an Anthropic call. Conservative rounding.
 * Pricing as of 2026-05 (claude-sonnet-4.7 / claude-opus-4.7):
 *   sonnet: $3 / 1M input, $15 / 1M output, $0.30 / 1M cached input
 *   opus:   $15 / 1M input, $75 / 1M output, $1.50 / 1M cached input
 */
export function estimateAnthropicCost(
  model: 'sonnet' | 'opus' | 'haiku',
  usage: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number },
): number {
  const rates = {
    sonnet: { in: 3, out: 15, cached: 0.3 },
    opus: { in: 15, out: 75, cached: 1.5 },
    haiku: { in: 0.8, out: 4, cached: 0.08 },
  }[model];
  const inT = (usage.input_tokens ?? 0) / 1_000_000;
  const outT = (usage.output_tokens ?? 0) / 1_000_000;
  const cachedT = (usage.cached_input_tokens ?? 0) / 1_000_000;
  return inT * rates.in + outT * rates.out + cachedT * rates.cached;
}

/**
 * Map a full Anthropic model id to a pricing family.
 *
 * Call sites hold ids like `claude-sonnet-4-5-20250929`, not the bare
 * family, so every one of them would otherwise hand-write this mapping.
 *
 * An UNRECOGNISED model is priced as `opus` — the most expensive family —
 * on purpose. This feeds a kill-switch, and the two ways to be wrong are
 * not symmetrical: over-estimating trips the cap early and someone
 * investigates, while under-estimating lets real spend through invisibly,
 * which is the failure this whole module exists to prevent. A new model id
 * should cost us a false alarm, never a blind spot.
 */
export function anthropicFamily(model: string): 'sonnet' | 'opus' | 'haiku' {
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  return 'opus';
}

/** The `usage` block Anthropic returns on a successful /v1/messages call. */
export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cached_input_tokens?: number;
}

/**
 * Record the spend of one Anthropic call from its response `usage` block.
 *
 * This exists so that recording is a ONE-LINE change at a call site. The
 * convention in this file's header — check, call, record — was documented
 * from the start and followed by 2 of 12 call sites; a convention that
 * costs five lines to honour is a convention that gets skipped. Pair it
 * with scripts/check-llm-spend.ts, which fails CI when a new call site
 * does not record.
 *
 * Safe to await unconditionally: recordSpend swallows its own errors and
 * no-ops when DATABASE_URL is unset.
 */
export async function recordAnthropicSpend(
  model: string,
  usage: AnthropicUsage | undefined,
  endpoint: string,
): Promise<void> {
  if (!usage) return;
  const cost = estimateAnthropicCost(anthropicFamily(model), {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cached_input_tokens: usage.cache_read_input_tokens ?? usage.cached_input_tokens,
  });
  await recordSpend(cost, endpoint);
}

/**
 * Estimate USD spend for OpenAI tts-1: $15 / 1M chars.
 */
export function estimateOpenAiTtsCost(chars: number): number {
  return (chars / 1_000_000) * 15;
}
