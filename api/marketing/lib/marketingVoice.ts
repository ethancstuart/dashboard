/**
 * marketingVoice.ts — voice profile assembly + evolution
 *
 * Loads the canonical voice spec (docs/voice/nexuswatch-voice.md is the
 * source of truth — embedded here as an inlined system prompt because the
 * api/ tsconfig doesn't allow reading from src/ or docs/ at runtime in
 * Vercel Functions without bundler config) and joins it with the latest
 * loved/hated/neutral examples from marketing_voice_context.
 *
 * Returns a system prompt + few-shot example block ready to drop into
 * a Claude call.
 *
 * The voice profile is REGENERATED PER CRON RUN (cheap — single SQL
 * query) so chairman edits to voice context propagate without redeploy.
 */

import type { Platform } from './flags.js';
import { getConfig, type VoiceKnobs } from './config.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NeonSql = any;

interface VoiceContextRow {
  id: number;
  platform: string;
  category: 'loved' | 'hated' | 'neutral';
  content: string;
  notes: string | null;
}

export interface VoiceProfile {
  systemPrompt: string;
  pillarBalance: Record<string, number>; // current target weights, normalized to 1.0
}

const BASE_SYSTEM_PROMPT = `You are the NexusWatch drafting engine. NexusWatch is a geopolitical intelligence platform.

VOICE — 40% analyst / 60% smart friend, blended at the paragraph level.
- Analyst: precise, sourced, anchored to data. Names the layer or feed a signal came from. Refuses to speculate past what the data shows.
- Smart friend: warm, plainspoken, generous. Short sentences. Everyday words. Like a well-read human texting a curious group chat.
- Never reads like a report with a joke stapled on. Reads like a smart friend who happens to work in intelligence.

PRONOUNS — always "we / our / us." Never "I / me / my." NexusWatch is the protagonist; never name a founder or team member. "You" is fine when addressing the reader.

EDITORIAL STANCE — procedure, not position (owner ruling 2026-08-22)
NexusWatch does not have a side. It has resolution criteria. Neutrality here is
enforced by mechanism, not tone:
- ACTOR-SWAP TEST: before writing any sentence about a state's behaviour, confirm
  you would publish the identical sentence with the actor names exchanged. If not,
  rewrite it.
- SYMMETRIC SOURCING: on any state-versus-state item, cite at least one source
  from each side's information environment plus one third party, and name them.
- NAME THE GAPS: where data is thin, say so and say where. "We have no reliable
  displacement data past March" builds more trust than hedged prose.
- Facts of law and of the record are facts, not positions. An invasion is an
  invasion, a designation is a designation. Report the noun; do not supply the
  adjective.
- Tech and space remain content verticals — encouraged.
- Domestic partisan politics stay out of scope: we have no data on them, and this
  product only says things it can resolve.

FORBIDDEN
- Partisan US politics, named US politicians (R or D), wedge issues (abortion, guns, immigration policy interpretation)
- Election results commentary (report outcomes only, after wide confirmation)
- Legal / medical / financial advice
- Personal attacks on individuals (criticize analysis, not analyst)
- Conspiracy content; unsourceable claims
- Public figures' private lives
- Speculative violence ("X will strike Y by next week")

CALIBRATION RULES
- Hedged language on every claim: "assessed", "reports indicate", "appears", "likely"
- Cite sources inline: "(via our ACLED layer)", "(GDELT)", "(USGS)"
- Name limitations explicitly when relevant: "single-source, unverified"
- Casualty counts >10 — do not invent. Quote the named source.
- First 60 minutes of a breaking event — do not draft on it.

EMOJI — only from this set, never more than one per X post, two per LinkedIn, zero on Reddit:
☕ 🌍 🗺️ 📍 🔭

CONTENT PILLARS (you'll be told which one to write to):
- signal: a thing happened, here's the layer that caught it, here's what it means
- pattern: multi-day or multi-region pattern visible across the map
- methodology: how we score CII, how we triangulate, why this matters
- product: a new layer, feature, or data source
- context: historical / geographic / structural framing for an active story

CTAs — soft, only one per piece, only when the platform allows:
- X / Bluesky / Threads: 1 in 5-8 posts, soft link to "our daily brief at nexuswatch.dev"
- LinkedIn: link in first comment, never in post body
- Substack / Medium / beehiiv: paid-tier CTA in footer only
- NEVER: "Comment YES if you agree" / "Tag a friend" / engagement bait`;

const PLATFORM_TONE: Record<Platform, string> = {
  x: `PLATFORM: X. Tweet ≤280 chars. Threads ≤3 tweets in v1 (longer threads need human review). Punchy opening — drop reader into the middle of the signal. Numbers up front. Inline attribution. At most one emoji from the brand set. One hashtag max, only if unambiguous.`,
  linkedin: `PLATFORM: LinkedIn Company Page. 150-600 words. Hook (1 line tension/number) → context paragraph → 3-5 bullets → 1 closing observation. Never lead with a personal story. No "excited to announce." No "thoughts?" Zero emoji. No links in post body — link will go in first comment.`,
  substack: `PLATFORM: Substack long-form article. 800-2000 words. Headline + 1-line dek + body. Structure: lead → 3-4 thematic sections → "What we are watching next" → "What this is not" (limitations). Cite sources and layers throughout. Paid-tier CTA in a closing footer block ONLY (never in lede).`,
  medium: `PLATFORM: Medium cross-post. Same as Substack content. Add a "Originally published in The NexusWatch Brief" line at the very top with canonical link. Headline can be slightly more SEO-tuned.`,
  threads: `PLATFORM: Threads. ≤500 chars. Casual register, conversational. More observational than analytical. One emoji max. No CTAs. Reads like a thought drop, not a release.`,
  bluesky: `PLATFORM: Bluesky. ≤300 chars. More conversational than X but still calibrated. One emoji max. Inline attribution. Soft CTA only 1 in 8 posts.`,
  beehiiv: `PLATFORM: beehiiv newsletter. (handled by separate cron in v1 — not generated by this engine)`,
  instagram: `PLATFORM: Instagram. Caption ≤2200 chars (but first 125 visible). Every post MUST have an image — generated via /api/og/social. Caption format: hook line (visible above fold) → 2-3 sentence analysis → "Full analysis at nexuswatch.dev" CTA. 3-5 hashtags at bottom (#geopolitics #osint #intelligence). No link in caption (IG doesn't make them clickable). Voice: accessible, visual-first.`,
};

/**
 * Load voice context examples for the requested platform. Returns up to
 * `limit` examples per category, prioritizing platform-specific over 'all'.
 */
async function loadVoiceContext(sql: NeonSql, platform: Platform, limit = 3): Promise<VoiceContextRow[]> {
  return (await sql`
    SELECT id, platform, category, content, notes
    FROM marketing_voice_context
    WHERE platform = ${platform} OR platform = 'all'
    ORDER BY
      CASE WHEN platform = ${platform} THEN 0 ELSE 1 END,
      created_at DESC
    LIMIT ${limit * 3}
  `) as unknown as VoiceContextRow[];
}

function renderFewShotBlock(rows: VoiceContextRow[]): string {
  if (rows.length === 0) return '';
  const loved = rows.filter((r) => r.category === 'loved').slice(0, 3);
  const hated = rows.filter((r) => r.category === 'hated').slice(0, 3);
  const parts: string[] = [];
  if (loved.length > 0) {
    parts.push('--- EXAMPLES TO EMULATE ---');
    for (const r of loved) {
      parts.push(`<example category="loved"${r.notes ? ` notes="${r.notes}"` : ''}>\n${r.content}\n</example>`);
    }
  }
  if (hated.length > 0) {
    parts.push('--- ANTI-PATTERNS — NEVER WRITE LIKE THIS ---');
    for (const r of hated) {
      parts.push(`<example category="hated"${r.notes ? ` notes="${r.notes}"` : ''}>\n${r.content}\n</example>`);
    }
  }
  return parts.join('\n\n');
}

/**
 * Render the V2 voice-knob block — four 0-100 dials injected into the
 * system prompt as explicit calibration instructions. Each knob has a
 * low/mid/high band so the model gets directive guidance rather than a
 * number to interpret.
 *
 * Called once per cron run. Chairman can tune live at /#/admin/marketing.
 */
function renderVoiceKnobBlock(knobs: VoiceKnobs): string {
  const band = (n: number) => (n <= 33 ? 'low' : n >= 67 ? 'high' : 'mid');
  const lines: string[] = ['--- VOICE CALIBRATION (live-tuned by chairman) ---'];

  // Formality — affects sentence structure + vocabulary.
  const f = band(knobs.formality);
  if (f === 'low') {
    lines.push(
      `Formality (${knobs.formality}/100 — LOW): lean casual. Contractions are fine. Short plain-English sentences. Avoid policy-speak.`,
    );
  } else if (f === 'high') {
    lines.push(
      `Formality (${knobs.formality}/100 — HIGH): tighter, more analyst register. Avoid contractions. Full sentences, precise verbs, no colloquialisms.`,
    );
  } else {
    lines.push(
      `Formality (${knobs.formality}/100 — MID): blended register. Mostly plain English with analyst-grade precision where it matters.`,
    );
  }

  // Hedging — affects how assertive claims are.
  const h = band(knobs.hedging);
  if (h === 'low') {
    lines.push(
      `Hedging (${knobs.hedging}/100 — LOW): when the data is solid, say so directly. Reserve hedges ("appears", "likely") for genuine uncertainty — do not pad.`,
    );
  } else if (h === 'high') {
    lines.push(
      `Hedging (${knobs.hedging}/100 — HIGH): hedge every analytical claim. "Reports indicate", "the pattern suggests", "we assess". Distinguish fact from interpretation at every turn.`,
    );
  } else {
    lines.push(
      `Hedging (${knobs.hedging}/100 — MID): hedge analytical claims, state data facts directly. Default v1 posture.`,
    );
  }

  // Data density — affects how much numeric/citation the draft carries.
  const d = band(knobs.dataDensity);
  if (d === 'low') {
    lines.push(
      `Data density (${knobs.dataDensity}/100 — LOW): prioritize narrative flow. Numbers and inline citations are allowed but should not be the backbone of the post.`,
    );
  } else if (d === 'high') {
    lines.push(
      `Data density (${knobs.dataDensity}/100 — HIGH): numbers-first. Every assertion should carry a figure or inline citation ("(via our ACLED layer)"). Minimize adjectives; maximize specifics.`,
    );
  } else {
    lines.push(
      `Data density (${knobs.dataDensity}/100 — MID): at least one quantitative anchor and one inline citation per post.`,
    );
  }

  // Emoji — caps allowance against the brand set.
  const e = band(knobs.emoji);
  if (e === 'low') {
    lines.push(
      `Emoji (${knobs.emoji}/100 — LOW): zero emoji across platforms, even when the platform tone would permit one.`,
    );
  } else if (e === 'high') {
    lines.push(
      `Emoji (${knobs.emoji}/100 — HIGH): use the per-platform max from the brand set (1 on X/Bluesky/Threads, 2 on LinkedIn, 0 on Substack/Medium). Never invent new emoji.`,
    );
  } else {
    lines.push(
      `Emoji (${knobs.emoji}/100 — MID): emoji optional — use sparingly, only when tonally right, always from the brand set.`,
    );
  }
  return lines.join('\n');
}

export async function buildVoiceProfile(sql: NeonSql, platform: Platform): Promise<VoiceProfile> {
  const [ctx, cfg] = await Promise.all([loadVoiceContext(sql, platform), getConfig().catch(() => null)]);
  const fewShot = renderFewShotBlock(ctx);
  const tone = PLATFORM_TONE[platform] ?? '';
  const knobBlock = cfg ? renderVoiceKnobBlock(cfg.voiceKnobs) : '';
  const systemPrompt = [BASE_SYSTEM_PROMPT, tone, knobBlock, fewShot].filter(Boolean).join('\n\n');
  return {
    systemPrompt,
    pillarBalance: cfg?.pillarMix ?? { signal: 0.4, pattern: 0.2, methodology: 0.15, product: 0.15, context: 0.1 },
  };
}

/**
 * Voice retune — runs weekly. Looks at the last 7 days of marketing_posts
 * × marketing_engagement, identifies top/bottom performers, and adds them
 * to marketing_voice_context as auto-promoted loved/neutral examples.
 *
 * Does NOT auto-mark anything as 'hated' — that requires human judgment.
 *
 * Returns a summary describing what changed.
 */
export interface VoiceRetuneSummary {
  posts_considered: number;
  loved_promoted: number;
  neutral_logged: number;
  pillar_engagement: Record<string, { posts: number; total_score: number }>;
}

export async function runVoiceRetune(sql: NeonSql): Promise<VoiceRetuneSummary> {
  // Pull last 7 days of posts with their latest engagement snapshot.
  const rows = (await sql`
    SELECT
      p.id,
      p.platform,
      p.pillar,
      p.content,
      p.posted_at,
      COALESCE(latest.impressions, 0) AS impressions,
      COALESCE(latest.likes, 0) AS likes,
      COALESCE(latest.reposts, 0) AS reposts,
      COALESCE(latest.replies, 0) AS replies,
      COALESCE(latest.intel_buyer_signal, 0) AS intel_buyer_signal
    FROM marketing_posts p
    LEFT JOIN LATERAL (
      SELECT impressions, likes, reposts, replies, intel_buyer_signal
      FROM marketing_engagement e
      WHERE e.post_id = p.id
      ORDER BY e.polled_at DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE p.posted_at > NOW() - INTERVAL '7 days'
      AND p.status = 'posted'
      AND p.shadow_mode = FALSE
  `) as unknown as Array<{
    id: number;
    platform: string;
    pillar: string | null;
    content: string;
    posted_at: string;
    impressions: number;
    likes: number;
    reposts: number;
    replies: number;
    intel_buyer_signal: number;
  }>;

  const summary: VoiceRetuneSummary = {
    posts_considered: rows.length,
    loved_promoted: 0,
    neutral_logged: 0,
    pillar_engagement: {},
  };

  if (rows.length === 0) return summary;

  // Score formula: impressions×1 + likes×2 + reposts×5 + replies×3 + intel_buyer×5
  const scored = rows.map((r) => ({
    ...r,
    score: r.impressions * 1 + r.likes * 2 + r.reposts * 5 + r.replies * 3 + r.intel_buyer_signal * 5,
  }));

  // Pillar engagement aggregate.
  for (const r of scored) {
    const p = r.pillar ?? 'unknown';
    if (!summary.pillar_engagement[p]) {
      summary.pillar_engagement[p] = { posts: 0, total_score: 0 };
    }
    summary.pillar_engagement[p].posts++;
    summary.pillar_engagement[p].total_score += r.score;
  }

  scored.sort((a, b) => b.score - a.score);
  const top5 = scored.slice(0, 5);
  const bottom5 = scored.slice(-5).filter((r) => !top5.includes(r));

  const week = new Date().toISOString().slice(0, 10);

  for (const r of top5) {
    if (r.score === 0) continue;
    await sql`
      INSERT INTO marketing_voice_context (platform, category, content, notes, created_by)
      VALUES (
        ${r.platform},
        'loved',
        ${r.content},
        ${`auto-promoted week of ${week}, score ${r.score}`},
        'voice-learn-cron'
      )
    `;
    summary.loved_promoted++;
  }

  for (const r of bottom5) {
    await sql`
      INSERT INTO marketing_voice_context (platform, category, content, notes, created_by)
      VALUES (
        ${r.platform},
        'neutral',
        ${r.content},
        ${`auto-flagged underperformer week of ${week}, score ${r.score}`},
        'voice-learn-cron'
      )
    `;
    summary.neutral_logged++;
  }

  return summary;
}
