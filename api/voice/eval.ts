/**
 * NexusWatch Voice Eval — /api/voice/eval
 *
 * POST endpoint that scores a social draft against the NexusWatch voice
 * model v1 (see docs/voice/nexuswatch-voice.md).
 *
 * Runs a two-stage check:
 *
 *   1. Deterministic regex/heuristic rules — forbidden topics, pronoun
 *      correctness, character limits, brand emoji set, corporate slop, etc.
 *      These are fast, offline, and 100% reliable. Deterministic failures
 *      short-circuit the response — we do not spend a Claude call on a
 *      draft that already fails a hard rule.
 *
 *   2. Optional semantic check — if ANTHROPIC_API_KEY is set and the draft
 *      passed the deterministic stage, we ask Claude Haiku to score voice
 *      adherence 0-100 against the spec rubric. This catches the drifts
 *      that regex can't (too-analyst, too-smart-friend, stan-account tone,
 *      missing data anchors, etc.).
 *
 * Response shape:
 *   {
 *     passed: boolean,           // overall pass/fail
 *     voice_score: number,       // 0-100, from semantic check (or 0 if skipped)
 *     violations: string[],      // deterministic violations, one per failed check
 *     reasoning: string          // either the semantic reasoning or a short
 *                                //  note on why the semantic check was skipped
 *   }
 *
 * NOTE: the deterministic check logic is duplicated from
 * src/voice/deterministic.ts because the api/ TypeScript project cannot
 * import from src/. Both copies must stay in sync. Tests live in
 * src/voice/eval.test.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { recordAnthropicSpend, type AnthropicUsage } from '../_lib/llm-budget.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

// ---------- Types ----------

type Platform = 'x' | 'linkedin' | 'reddit' | 'dm';

interface VoiceDraft {
  platform: Platform;
  content: string;
  context?: string;
}

interface EvalResponse {
  passed: boolean;
  voice_score: number;
  violations: string[];
  reasoning: string;
}

// ---------- Deterministic checker (duplicated from src/voice/deterministic.ts) ----------

const LENGTH_LIMITS: Record<Platform, { maxChars: number; minChars: number }> = {
  x: { maxChars: 280, minChars: 1 },
  linkedin: { maxChars: 4000, minChars: 80 },
  reddit: { maxChars: 10000, minChars: 80 },
  dm: { maxChars: 1500, minChars: 1 },
};

const BRAND_EMOJI_SET = ['☕', '🌍', '🗺️', '📍', '🔭'] as const;

const EMOJI_LIMITS: Record<Platform, number> = {
  x: 1,
  linkedin: 2,
  reddit: 0,
  dm: 1,
};

const FORBIDDEN_PHRASES: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bethan( stuart)?\b/i,
    reason: 'names the founder by name (brand is the protagonist, not the founder)',
  },
  {
    pattern: /\b(our|my) founder\b/i,
    reason: 'references a founder (brand is the protagonist, not the founder)',
  },
  {
    pattern: /\bi['\u2019 ]?m\s+(the\s+)?(founder|ceo|cto|creator|builder)\b/i,
    reason: 'identifies a named role behind the brand (use "we" voice)',
  },
  { pattern: /\bexcited to announce\b/i, reason: 'uses the LinkedIn cliché "excited to announce"' },
  { pattern: /\bhumbled (to|by)\b/i, reason: 'uses the LinkedIn cliché "humbled"' },
  { pattern: /\bngl\b/i, reason: 'uses chat filler "ngl"' },
  { pattern: /\blol\b/i, reason: 'uses chat filler "lol"' },
  { pattern: /\bwake up\b/i, reason: 'uses conspiracy-adjacent phrasing "wake up"' },
  {
    pattern: /\bmainstream media (is|are) controlled\b/i,
    reason: 'conspiracy framing about mainstream media',
  },
  {
    pattern: /\b(you should|we recommend) (buy|sell|short|long) \w+/i,
    reason: 'financial advice (not allowed)',
  },
  {
    pattern: /\b(you should|we recommend) (take|use) \w+ (medication|vaccine|drug)/i,
    reason: 'medical advice (not allowed)',
  },
  {
    pattern: /\b(will strike|will attack|will invade|will hit) .* (by|within|before) (next|the next)/i,
    reason: 'speculative violence framing (not allowed without a named source)',
  },
  {
    pattern:
      /\b(biden|trump|harris|desantis|aoc|mcconnell|pelosi) (is|was) (wrong|right|completely|asleep|a disaster)\b/i,
    reason: 'partisan US politics about a named US politician',
  },
  { pattern: /\bunpopular opinion\b/i, reason: 'uses engagement-bait phrase "unpopular opinion"' },
  { pattern: /\bpromo code\b/i, reason: 'contains a promo code (marketing pitch, not on-brand)' },
  {
    pattern: /\b(follow us|dm me if you want to learn more)\b/i,
    reason: 'contains a growth-hacker CTA',
  },
  { pattern: /\b\d+%\s*off\b/i, reason: 'contains a discount offer (marketing pitch, not on-brand)' },
  {
    pattern: /\b(94|95|96|97|98|99|100)%\s+(accuracy|accurate) .* (predict|forecast|event|strike|attack)/i,
    reason: 'overclaims predictive capability',
  },
  { pattern: /\bleverag(e|ing) synergies\b/i, reason: 'corporate buzzword slop ("leverage synergies")' },
  { pattern: /\bbest[- ]in[- ]class\b/i, reason: 'corporate buzzword ("best-in-class")' },
  { pattern: /\bmission[- ]critical\b/i, reason: 'corporate buzzword ("mission-critical")' },
  { pattern: /\bactionable insights?\b/i, reason: 'corporate buzzword ("actionable insights")' },
  { pattern: /\btrusted partner\b/i, reason: 'corporate buzzword ("trusted partner")' },
];

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const FIRST_PERSON_SINGULAR = /\b(i|i['\u2019]?m|i['\u2019]?ve|i['\u2019]?ll|i['\u2019]?d|me|my|mine|myself)\b/i;
const FIRST_PERSON_PLURAL = /\b(we|we['\u2019]?re|we['\u2019]?ve|we['\u2019]?ll|our|ours|us|ourselves)\b/i;
const PRONOUN_MIN_LENGTH = 60;

function runDeterministicChecks(draft: VoiceDraft): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  const content = draft.content ?? '';
  const charCount = [...content].length;

  const limits = LENGTH_LIMITS[draft.platform];
  if (!limits) {
    violations.push(`unknown platform: ${String(draft.platform)}`);
  } else {
    if (charCount > limits.maxChars) {
      violations.push(`exceeds ${draft.platform} max length: ${charCount}/${limits.maxChars} chars`);
    }
    if (charCount < limits.minChars) {
      violations.push(`below ${draft.platform} min length: ${charCount}/${limits.minChars} chars`);
    }
  }

  const emojiMatches = content.match(EMOJI_REGEX) || [];
  const emojiLimit = EMOJI_LIMITS[draft.platform] ?? 0;
  if (emojiMatches.length > emojiLimit) {
    violations.push(`exceeds ${draft.platform} emoji limit: ${emojiMatches.length}/${emojiLimit}`);
  }
  // Strip U+FE0F variation selector before comparing — models sometimes omit it.
  const stripVS = (e: string) => e.replace(/\uFE0F/g, '');
  const normalizedBrandSet = (BRAND_EMOJI_SET as readonly string[]).map(stripVS);
  const nonBrandEmoji = emojiMatches.filter((e) => !normalizedBrandSet.includes(stripVS(e)));
  if (nonBrandEmoji.length > 0) {
    const unique = [...new Set(nonBrandEmoji)].join('');
    violations.push(`contains emoji outside the brand set (${unique}); allowed: ${BRAND_EMOJI_SET.join('')}`);
  }

  if (FIRST_PERSON_SINGULAR.test(content)) {
    violations.push('uses first-person singular ("I", "me", "my"); must use "we" voice');
  }
  if (charCount >= PRONOUN_MIN_LENGTH && !FIRST_PERSON_PLURAL.test(content)) {
    violations.push('missing "we/our/us" pronoun (must speak as the brand)');
  }

  for (const { pattern, reason } of FORBIDDEN_PHRASES) {
    if (pattern.test(content)) {
      violations.push(reason);
    }
  }

  return { passed: violations.length === 0, violations };
}

// ---------- Semantic check (Claude Haiku) ----------

const SEMANTIC_SYSTEM_PROMPT = `You are the NexusWatch voice reviewer. You score social drafts against the NexusWatch voice model v1.

The voice is 40% analyst / 60% smart friend. The brand speaks as "we," never first-person singular, never naming the founder. Approved topics: geopolitics, intelligence, energy, shipping, conflict, disasters, the NexusWatch product, tech and space. Forbidden: partisan US politics, legal/medical/financial advice, personal attacks, conspiracy content, public figures' private lives, speculative violence, election result commentary.

Score on a 0-100 scale where:
- 90-100: drafts that belong in the few-shot good corpus. In-voice, data-anchored, appropriate register for the platform.
- 70-89: acceptable but drift in one direction (slightly too analyst or slightly too smart-friend, or missing a data anchor).
- 50-69: noticeable voice failure. Something concrete has to change before this can ship.
- 0-49: hard voice failure (stan-account tone, LinkedIn cliché pattern, corporate slop, unanchored opinion, off-topic).

Return ONLY a JSON object with exactly this shape (no prose, no markdown):
{"voice_score": <number 0-100>, "reasoning": "<one sentence explaining the score>"}`;

interface ClaudeResponse {
  content?: { type: string; text: string }[];
  usage?: AnthropicUsage;
}

async function callSemanticCheck(
  draft: VoiceDraft,
  apiKey: string,
): Promise<{ voice_score: number; reasoning: string }> {
  const userPrompt = `Platform: ${draft.platform}
${draft.context ? `Context: ${draft.context}\n` : ''}Draft:
"""
${draft.content}
"""

Score this draft against the NexusWatch voice model v1. Return the JSON object only.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SEMANTIC_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.status}`);
  }

  const body = (await res.json()) as ClaudeResponse;
  await recordAnthropicSpend('claude-haiku-4-5-20251001', body.usage, 'voice-eval');
  const text = (body.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // The model sometimes wraps JSON in a code block — strip it if so.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(cleaned) as { voice_score: number; reasoning: string };

  if (typeof parsed.voice_score !== 'number' || typeof parsed.reasoning !== 'string') {
    throw new Error('semantic check returned malformed JSON');
  }
  return parsed;
}

// ---------- Handler ----------

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://nexuswatch.dev',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res: VercelResponse, status: number, body: unknown): void {
  res.status(status);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }
  res.send(JSON.stringify(body));
}

function isValidPlatform(p: unknown): p is Platform {
  return p === 'x' || p === 'linkedin' || p === 'reddit' || p === 'dm';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.status(200);
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.setHeader(k, v);
    }
    res.send('');
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Partial<VoiceDraft>;
  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Invalid body' });
    return;
  }
  if (!isValidPlatform(body.platform)) {
    sendJson(res, 400, { error: 'Invalid or missing platform (must be x, linkedin, reddit, or dm)' });
    return;
  }
  if (typeof body.content !== 'string' || body.content.length === 0) {
    sendJson(res, 400, { error: 'Missing content' });
    return;
  }

  const draft: VoiceDraft = {
    platform: body.platform,
    content: body.content,
    context: typeof body.context === 'string' ? body.context : undefined,
  };

  const det = runDeterministicChecks(draft);

  // If deterministic failed, short-circuit — don't spend a Claude call.
  if (!det.passed) {
    const response: EvalResponse = {
      passed: false,
      voice_score: 0,
      violations: det.violations,
      reasoning: `Deterministic check failed with ${det.violations.length} violation(s); semantic check skipped.`,
    };
    sendJson(res, 200, response);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const response: EvalResponse = {
      passed: true,
      voice_score: 0,
      violations: [],
      reasoning: 'Passed deterministic checks. Semantic check skipped (ANTHROPIC_API_KEY not set).',
    };
    sendJson(res, 200, response);
    return;
  }

  try {
    const semantic = await callSemanticCheck(draft, apiKey);
    const response: EvalResponse = {
      passed: semantic.voice_score >= 70,
      voice_score: semantic.voice_score,
      violations: [],
      reasoning: semantic.reasoning,
    };
    sendJson(res, 200, response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'semantic check failed';
    const response: EvalResponse = {
      passed: true,
      voice_score: 0,
      violations: [],
      reasoning: `Passed deterministic checks. Semantic check errored: ${message}`,
    };
    sendJson(res, 200, response);
  }
}
