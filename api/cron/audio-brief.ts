/**
 * Daily audio-brief cron — NexusWatch FM.
 *
 * Schedule: 10:30 UTC (30 min after daily-brief).
 *
 * 1. Pull today's daily brief from daily_briefs
 * 2. Run Council with a "podcast script" prompt to turn the brief into
 *    a 3-host 90-second script tagged [HOST_A]/[HOST_B]/[HOST_C]
 * 3. Split by host tag, call OpenAI tts-1 per segment (3 voices)
 * 4. Concatenate the mp3 frames (tts-1 emits CBR mp3 → concat is safe)
 * 5. Upload to Vercel Blob, record audio_briefs row
 *
 * Cost per brief: 5 council Sonnet + 1 Opus synth + 1 Sonnet rewrite
 *   ≈ $0.10 council + ~$0.022 TTS = $0.12/day total
 *
 * 2026-05 tier-up Phase 4.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { cronJitter, requireCron } from '../_cron-utils.js';
import { uploadBlob, blobEnabled } from '../_lib/storage.js';
import { checkBudget, estimateOpenAiTtsCost, recordSpend } from '../_lib/llm-budget.js';
import { singleAnthropic } from '../_lib/anthropic-fanout.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

const PODCAST_PROMPT = `Rewrite the geopolitical intelligence brief below as a 90-second podcast script with three hosts: [HOST_A] (lead analyst, sets the agenda), [HOST_B] (skeptical foil, asks the contrarian question), [HOST_C] (closes with the action items).

CONSTRAINTS:
- Total length: 220–260 spoken words (roughly 90 seconds at NPR-clip pace).
- Format every line as [HOST_X] <line of dialogue> on its own line. No headings, no stage directions.
- Open with [HOST_A] greeting "From NexusWatch, this is your daily geopolitical brief for {DATE}."
- Each line ≤ 25 words. Conversational, not narrated. Hosts can interrupt each other.
- Surface the bottom line in the first 25 seconds. The dissent (where the read could be wrong) goes in the middle. Close with what to watch in the next 7 days.
- No music cues, no SFX, no transitions, no "(pause)".
- Spell out numbers (CII 73 → "C-I-I of seventy-three"). Convert acronyms on first use.
- NO emojis. NO markdown.

BRIEF:
{BRIEF}`;

const HOST_VOICES: Record<string, string> = {
  HOST_A: 'onyx',
  HOST_B: 'nova',
  HOST_C: 'shimmer',
};

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  await cronJitter(15);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const dbUrl = process.env.DATABASE_URL;

  if (!anthropicKey || !openaiKey || !dbUrl) {
    return res.status(500).json({
      error: 'missing_env',
      need: { anthropic: !!anthropicKey, openai: !!openaiKey, db: !!dbUrl },
    });
  }
  if (!blobEnabled()) {
    return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not configured' });
  }

  // Budget gate (with bypass — this is a critical daily cron)
  const gate = await checkBudget({ endpoint: 'audio-brief', bypassCap: true });
  if (!gate.ok && gate.cause === 'env_disabled') {
    return res.status(503).json(gate);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = neon(dbUrl);
  const today = new Date().toISOString().slice(0, 10);

  // Skip if today already has an audio brief
  const existing = (await sql`
    SELECT id, blob_url FROM audio_briefs WHERE brief_date = ${today}::date
  `) as unknown as Array<{ id: number; blob_url: string }>;
  if (existing.length > 0) {
    return res.json({ ok: true, skipped: 'already_exists', existing: existing[0] });
  }

  // Pull the latest daily brief
  const briefs = (await sql`
    SELECT content, published_at FROM daily_briefs ORDER BY published_at DESC LIMIT 1
  `.catch(() => [] as unknown)) as unknown as Array<{ content: string; published_at: string }>;
  if (!Array.isArray(briefs) || briefs.length === 0 || !briefs[0].content) {
    return res.status(404).json({ error: 'no_daily_brief_available' });
  }
  const brief = briefs[0].content;
  const dateStr = new Date(briefs[0].published_at ?? Date.now()).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // 1. Rewrite as 3-host podcast script via Claude Sonnet
  const rewrite = await singleAnthropic(
    {
      label: 'audio-brief:rewrite',
      model: 'sonnet',
      timeoutMs: 30_000,
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: 'You are a podcast scriptwriter for NexusWatch.',
        messages: [
          {
            role: 'user',
            content: PODCAST_PROMPT.replace('{DATE}', dateStr).replace('{BRIEF}', brief),
          },
        ],
      },
    },
    anthropicKey,
  );

  if (!rewrite.ok || !rewrite.data) {
    return res.status(502).json({ error: 'rewrite_failed', detail: rewrite.error });
  }

  const script = extractText(rewrite.data);
  const segments = parseHostSegments(script);
  if (segments.length === 0) {
    return res.status(422).json({ error: 'no_host_segments', script });
  }

  // 2. TTS each segment via OpenAI tts-1
  const mp3Buffers: Buffer[] = [];
  let totalChars = 0;
  for (const seg of segments) {
    if (!seg.text.trim()) continue;
    totalChars += seg.text.length;
    const voice = HOST_VOICES[seg.host] ?? 'onyx';
    const ttsRes = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice,
        input: seg.text,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!ttsRes.ok) {
      const t = await ttsRes.text().catch(() => '');
      return res.status(502).json({ error: 'tts_failed', status: ttsRes.status, body: t.slice(0, 300) });
    }
    const ab = await ttsRes.arrayBuffer();
    mp3Buffers.push(Buffer.from(ab));
  }

  await recordSpend(estimateOpenAiTtsCost(totalChars), 'audio-brief:tts');

  // 3. Concatenate mp3 frames (CBR-safe; tts-1 is CBR)
  const combined = Buffer.concat(mp3Buffers);

  // 4. Upload to Blob
  const path = `audio/${today}.mp3`;
  const upload = await uploadBlob(path, combined, {
    contentType: 'audio/mpeg',
    cacheMaxAge: 86_400,
    stableUrl: true,
  });

  // Estimate duration: tts-1 ≈ 24kbps CBR mono → bytes / 3000 ≈ seconds
  const durationSec = Math.round(combined.length / 3000);

  // 5. Record manifest row
  try {
    await sql`
      INSERT INTO audio_briefs
        (brief_date, created_at, duration_sec, bytes, blob_url, cover_art_url, script, voices)
      VALUES
        (${today}::date, NOW(), ${durationSec}, ${combined.length}, ${upload.url},
         ${'https://nexuswatch.dev/api/og?type=site'},
         ${script}, ${JSON.stringify(Object.values(HOST_VOICES))}::jsonb)
      ON CONFLICT (brief_date) DO UPDATE
        SET created_at = NOW(),
            duration_sec = EXCLUDED.duration_sec,
            bytes = EXCLUDED.bytes,
            blob_url = EXCLUDED.blob_url,
            script = EXCLUDED.script,
            voices = EXCLUDED.voices
    `;
  } catch (e) {
    return res.status(500).json({ error: 'db_insert_failed', detail: e instanceof Error ? e.message : 'unknown' });
  }

  return res.json({
    ok: true,
    brief_date: today,
    duration_sec: durationSec,
    bytes: combined.length,
    blob_url: upload.url,
    segments: segments.length,
  });
}

interface HostSegment {
  host: string;
  text: string;
}

function parseHostSegments(script: string): HostSegment[] {
  const lines = script.split(/\r?\n/);
  const out: HostSegment[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*\[(HOST_[A-C])\]\s*(.*)$/);
    if (!m) continue;
    const host = m[1];
    const text = m[2].trim();
    if (!text) continue;
    // Merge consecutive same-host lines
    if (out.length > 0 && out[out.length - 1].host === host) {
      out[out.length - 1].text += ' ' + text;
    } else {
      out.push({ host, text });
    }
  }
  return out;
}

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
