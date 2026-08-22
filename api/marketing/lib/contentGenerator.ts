/**
 * contentGenerator.ts — Claude-backed content generation
 *
 * Wraps Anthropic Messages API. Routes to Haiku for short-form (X,
 * Bluesky, Threads, LinkedIn) and Sonnet for long-form (Substack,
 * Medium, weekly recaps).
 *
 * Always includes the assembled voice profile + few-shot context
 * from marketingVoice.buildVoiceProfile().
 *
 * Returns the raw generated content + token usage stats. Voice
 * evaluation happens AFTER generation (caller routes to /api/voice/eval).
 */

import type { Platform } from './flags.js';
import type { Topic, Pillar, PostType } from './topicSelector.js';
import type { VoiceProfile } from './marketingVoice.js';
import { recordAnthropicSpend } from '../../_lib/llm-budget.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Per-platform model selection. Haiku for short-form (cheap, fast),
// Sonnet for long-form (better narrative cohesion at length).
const MODEL_FOR_PLATFORM: Record<Platform, string> = {
  x: 'claude-haiku-4-5-20251001',
  bluesky: 'claude-haiku-4-5-20251001',
  threads: 'claude-haiku-4-5-20251001',
  linkedin: 'claude-haiku-4-5-20251001',
  substack: 'claude-sonnet-4-5-20251001',
  medium: 'claude-sonnet-4-5-20251001',
  beehiiv: 'claude-haiku-4-5-20251001',
  instagram: 'claude-haiku-4-5-20251001',
};

const MAX_TOKENS_FOR_PLATFORM: Record<Platform, number> = {
  x: 600, // single tweet or 3-tweet thread
  bluesky: 400,
  threads: 500,
  linkedin: 1200,
  substack: 4000,
  medium: 4000,
  beehiiv: 1500,
  instagram: 800, // caption for image post
};

export interface GenerationRequest {
  platform: Platform;
  topic: Topic;
  voiceProfile: VoiceProfile;
  postType: PostType;
  // Optional parent post (for content waterfall — substack → derivatives)
  parentContent?: string;
  parentPlatform?: Platform;
}

export interface GenerationResult {
  content: string;
  format: 'post' | 'thread' | 'longform' | 'short';
  pillar: Pillar;
  model: string;
  input_tokens: number;
  output_tokens: number;
  rationale: string;
}

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export function buildPostTypePrompt(postType: PostType, platform: Platform): string {
  if (postType === 'alert') {
    return `POST TYPE: Alert
Lead with a number or a place name — never with "In" or "The."
Reference the data layer with "our [layer] shows" or "our [layer] flagged" — use "our" to anchor NexusWatch as the source.
One concrete claim. Zero hedging language.
Single post only, ≤280 characters. End with nexuswatch.dev.`;
  }

  if (postType === 'data_story' && platform === 'x') {
    return `POST TYPE: Data Story — X Thread (3 tweets)
Tweet 1: hook with a specific stat or observation.
Tweet 2: what the data layer actually shows — be specific about the source.
Tweet 3: why it matters right now + nexuswatch.dev.
Separate tweets with a blank line. No "🧵" opener.`;
  }

  if (postType === 'data_story' && platform === 'linkedin') {
    return `POST TYPE: Data Story — LinkedIn
LinkedIn: write at 50/50 analyst/friend ratio.
Line 1: one-sentence hook with a tension or a number. No preamble.
Paragraph 2: context (2–3 sentences, 40% analyst).
Bullet list: 3–4 observations, each grounded in a NexusWatch layer.
Closing line: one read or next step. No "thoughts?" No "agree or disagree?"
150–400 words total.`;
  }

  if (postType === 'cta' && platform === 'x') {
    return `POST TYPE: CTA — X
Show the product working, not the product existing.
One concrete intelligence example a reader can verify for free right now.
Soft close: "it's free to start" not "sign up."
Single post ≤280 chars. Include nexuswatch.dev.`;
  }

  if (postType === 'cta' && platform === 'linkedin') {
    return `POST TYPE: CTA — LinkedIn
LinkedIn: write at 50/50 analyst/friend ratio.
"We built X because Y" logic — lead with the problem, not the product.
One concrete example of NexusWatch solving it.
Soft close with nexuswatch.dev. 100–200 words.
Avoid hype opener phrases and false humility.`;
  }

  if (postType === 'product_update' && platform === 'x') {
    return `POST TYPE: Product Update — X
One sentence: what we shipped. One sentence: why we built it.
Optional third sentence: what it unlocks for the reader.
1–2 tweets max. Include nexuswatch.dev.`;
  }

  if (postType === 'product_update' && platform === 'linkedin') {
    return `POST TYPE: Product Update — LinkedIn
LinkedIn: write at 50/50 analyst/friend ratio.
"We built X because Y" structure.
What it does in one sentence. The decision behind it in one paragraph.
What you can do with it now. nexuswatch.dev link. 150–300 words.`;
  }

  // Fallback for other platforms (beehiiv, substack, medium, etc.)
  return `POST TYPE: Data Story
Share one concrete intelligence finding. Use "our [layer]" or "we're tracking" to anchor NexusWatch as the source.
Include nexuswatch.dev.`;
}

function buildUserPrompt(req: GenerationRequest): string {
  const { platform, topic, parentContent, parentPlatform } = req;
  const lines: string[] = [];
  lines.push(`Pillar: ${topic.pillar}`);
  lines.push(`Topic key: ${topic.topic_key}`);
  if (topic.entity_keys.length > 0) {
    lines.push(`Entities involved: ${topic.entity_keys.join(', ')}`);
  }
  if (topic.source_layer) {
    lines.push(`Primary source: ${topic.source_layer}`);
  }
  if (topic.source_url) {
    lines.push(`Source URL (do not include in post unless natural): ${topic.source_url}`);
  }
  lines.push('');
  lines.push(`Hook / one-line summary you are expanding into a full post:`);
  lines.push(topic.hook);
  if (topic.metadata && Object.keys(topic.metadata).length > 0) {
    lines.push('');
    lines.push(`Additional context:`);
    lines.push(JSON.stringify(topic.metadata, null, 2));
  }
  if (parentContent && parentPlatform) {
    lines.push('');
    lines.push(
      `This is a derivative post — the source long-form (from ${parentPlatform}) is below. Adapt the SAME insight to ${platform}'s format. Do not rewrite from scratch; pull the load-bearing claim and reframe for the new platform.`,
    );
    lines.push('--- parent content ---');
    lines.push(parentContent.slice(0, 3000));
    lines.push('--- end parent ---');
  }
  lines.push('');
  lines.push(
    `Write the post now. Return only the post content — no preamble, no "Here is the post:", no JSON wrapper. Just the text exactly as it should appear on ${platform}.`,
  );
  if (platform === 'x' && shouldBeThread(topic)) {
    lines.push(
      `This topic warrants a thread. Return the thread as ${platform}-friendly format: each tweet on its own paragraph, separated by a blank line, no numbering.`,
    );
  }
  return lines.join('\n');
}

function shouldBeThread(topic: Topic): boolean {
  // Heuristic: pattern + methodology pillars + posts with multiple entities
  // tend to need a thread. Signal posts default to single tweet.
  if (topic.pillar === 'methodology') return true;
  if (topic.pillar === 'pattern' && topic.entity_keys.length > 1) return true;
  if (topic.pillar === 'context') return true;
  return false;
}

function inferFormat(platform: Platform, content: string): 'post' | 'thread' | 'longform' | 'short' {
  if (platform === 'substack' || platform === 'medium') return 'longform';
  if (platform === 'x') {
    // Detect thread by paragraph breaks
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
    return paragraphs.length > 1 ? 'thread' : 'post';
  }
  if (content.length < 200) return 'short';
  return 'post';
}

export async function generateContent(req: GenerationRequest): Promise<GenerationResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Stub mode — generate a placeholder so the flow can be exercised end-to-end.
    return {
      content: `[STUB] ${req.topic.hook} — generated without ANTHROPIC_API_KEY for ${req.platform}.`,
      format: inferFormat(req.platform, req.topic.hook),
      pillar: req.topic.pillar,
      model: 'stub',
      input_tokens: 0,
      output_tokens: 0,
      rationale: 'stub: ANTHROPIC_API_KEY not set',
    };
  }

  const model = MODEL_FOR_PLATFORM[req.platform];
  const maxTokens = MAX_TOKENS_FOR_PLATFORM[req.platform];
  const postTypePrompt = buildPostTypePrompt(req.postType, req.platform);
  const systemPrompt = `${postTypePrompt}\n\n${req.voiceProfile.systemPrompt}`;
  const userPrompt = buildUserPrompt(req);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[contentGenerator] Anthropic error:', res.status, err.slice(0, 300));
      return null;
    }
    const data = (await res.json()) as AnthropicMessageResponse;
    await recordAnthropicSpend(data.model, data.usage, 'marketing:content');
    const text = data.content
      .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
      .join('')
      .trim();
    if (!text) {
      console.error('[contentGenerator] empty response from Anthropic');
      return null;
    }
    return {
      content: text,
      format: inferFormat(req.platform, text),
      pillar: req.topic.pillar,
      model: data.model,
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
      rationale: `pillar=${req.topic.pillar}, source=${req.topic.source_layer ?? 'n/a'}, score=${req.topic.score}`,
    };
  } catch (err) {
    console.error('[contentGenerator] error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Ask the existing /api/voice/eval endpoint to score a draft. Returns
 * null if the endpoint is unreachable.
 *
 * NOTE: we call this via fetch to localhost so the eval logic stays in
 * one place (api/voice/eval.ts). Slight overhead but keeps the source
 * of truth singular.
 */
export interface VoiceEvalResult {
  passed: boolean;
  voice_score: number;
  violations: string[];
  reasoning: string;
}

export async function evaluateVoice(
  baseUrl: string,
  platform: Platform,
  content: string,
): Promise<VoiceEvalResult | null> {
  // Voice eval only knows about x/linkedin/reddit/dm. Map our platforms.
  const evalPlatform: 'x' | 'linkedin' | 'reddit' | 'dm' =
    platform === 'linkedin' || platform === 'medium' || platform === 'substack' ? 'linkedin' : 'x';
  try {
    const res = await fetch(`${baseUrl}/api/voice/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: evalPlatform, content }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return (await res.json()) as VoiceEvalResult;
  } catch {
    return null;
  }
}
