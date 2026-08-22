import type { VercelRequest, VercelResponse } from '@vercel/node';
import { recordAnthropicSpend, type AnthropicUsage } from './_lib/llm-budget.js';

const CORS_ORIGIN = 'https://nexuswatch.dev';
function setCors(res: VercelResponse): VercelResponse {
  return res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
}

export const config = { runtime: 'nodejs' };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({
      available: false,
      narration: 'Cinema narration is being configured. Explore the globe manually while AI narration is set up.',
    });
  }

  const { region, eventLabel, profileFocus, tensionIndex } = req.body as {
    region: string;
    eventLabel: string;
    profileFocus: string;
    tensionIndex: number;
  };

  if (!eventLabel) {
    return res.status(400).json({ error: 'eventLabel required' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: `You are a breaking-news intelligence anchor for a geopolitical monitoring platform focused on ${profileFocus}. Generate exactly 1-2 sentences of concise, dramatic context for the event described. Use present tense. Reference cross-correlations when provided. No speculation beyond the data. Maximum 40 words.`,
        messages: [
          {
            role: 'user',
            content: `Event: ${eventLabel}\nRegion: ${region}\nGlobal Tension Index: ${tensionIndex}/100\n\nGenerate a brief intelligence narration.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Anthropic API error' });
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage?: AnthropicUsage;
    };
    await recordAnthropicSpend('claude-haiku-4-5-20251001', data.usage, 'cinema-narrate');

    const narration = data.content?.[0]?.text || '';

    return res.setHeader('Cache-Control', 'no-store').json({
      narration,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Cinema narrate error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Narration generation failed' });
  }
}
