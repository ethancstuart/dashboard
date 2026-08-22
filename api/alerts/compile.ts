import type { VercelRequest, VercelResponse } from '@vercel/node';
import { recordAnthropicSpend, type AnthropicUsage } from '../_lib/llm-budget.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

/**
 * POST /api/alerts/compile
 *
 * Natural-language alert compiler. Takes free-text like
 *
 *   "alert me when Taiwan CII rises by 5 or more in 24 hours"
 *   "tell me if any NATO country's CII crosses 60"
 *   "fire if there's a major quake (M7+) within 500km of Tehran"
 *
 * and uses Claude Haiku to emit a structured composite rule the
 * front-end alert engine (src/services/alertEngine.ts) can evaluate.
 *
 * Output shape:
 *   {
 *     composite: {
 *       operator: 'AND' | 'OR',
 *       conditions: [{ layer, condition, threshold, location?, radiusKm?, humanReadable }],
 *       label: string
 *     },
 *     confidence: 'high' | 'medium' | 'low',
 *     clarifying_questions?: string[]
 *   }
 *
 * Body:   { text: string }
 * Errors:
 *   401 unauthorized (session required — this writes to the user's rules)
 *   400 empty or malformed body
 *   502 model error
 */

const SYSTEM_PROMPT = `You are the NexusWatch alert-rule compiler. Your ONLY job is to convert natural-language alert requests into a strict JSON composite rule that the NexusWatch front-end can evaluate.

OUTPUT FORMAT (strict JSON — no prose, no markdown fences, nothing else):
{
  "composite": {
    "operator": "AND" | "OR",
    "conditions": [
      {
        "layer": string,             // one of: cii, acled, earthquakes, fires, ships, flights, news, weather, cyber, sanctions, prediction-markets
        "condition": string,         // human-readable condition like "score_above_threshold", "magnitude_above", "fatalities_above", "count_above", "sentiment_below", "near_location", "delta_above_24h"
        "threshold": number | null,  // numeric threshold; null if N/A
        "location": string | null,   // country code or named place (e.g. "Taiwan", "TW", "Hormuz")
        "radiusKm": number | null,   // proximity radius in km; null if not proximity-based
        "comparisonLayer": string | null, // if condition compares two layers
        "humanReadable": string      // short human-readable phrase, 80 chars max
      }
    ],
    "label": string                  // short label for the whole rule, 60 chars max
  },
  "confidence": "high" | "medium" | "low",
  "clarifying_questions": string[]   // empty array if the intent was clear
}

Rules:
- If the user says "AND" between conditions → operator="AND". If "OR" or unclear → default to "OR" ONLY when there are multiple independent conditions; otherwise "AND".
- Single-condition rules still use the composite structure with one element in conditions.
- If ANY part of the intent is ambiguous, include clarifying_questions describing what you need to know. Still output a best-guess rule.
- If the request cannot be parsed at all, output {"composite": null, "confidence": "low", "clarifying_questions": [<questions>]}.
- Layer values MUST come from the enumerated list above. If the user names something not in the list, pick the closest valid layer and add a clarifying question.
- Never invent layers, conditions, or thresholds.
- Keep labels tight and descriptive: "Taiwan CII +5/24h", not "Alert when the Taiwan Country Instability Index has risen by five or more points in the last twenty-four hours".`;

interface CompileRequest {
  text?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'anthropic_not_configured' });

  const body = (req.body ?? {}) as CompileRequest;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'empty_text' });
  if (text.length > 1000) return res.status(400).json({ error: 'text_too_long', cap: 1000 });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      console.error('[alerts/compile] model error:', resp.status, err.slice(0, 200));
      return res.status(502).json({ error: 'model_error', status: resp.status });
    }
    const data = (await resp.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: AnthropicUsage;
    };
    await recordAnthropicSpend('claude-haiku-4-5-20251001', data.usage, 'alerts-compile');
    const raw = data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();

    // Strip any accidental code fences or leading prose.
    const jsonText = extractJson(raw);
    if (!jsonText) {
      return res.status(422).json({ error: 'model_output_unparseable', raw });
    }

    try {
      const parsed = JSON.parse(jsonText);
      return res.json({ ok: true, compiled: parsed, raw });
    } catch {
      return res.status(422).json({ error: 'model_output_invalid_json', raw: jsonText });
    }
  } catch (err) {
    console.error('[alerts/compile] error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'compile_failed' });
  }
}

function extractJson(s: string): string | null {
  // Handle ```json ... ``` fences.
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Otherwise find the first { and the matching last }.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first < 0 || last < first) return null;
  return s.slice(first, last + 1).trim();
}
