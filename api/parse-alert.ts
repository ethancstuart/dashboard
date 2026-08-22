import type { VercelRequest, VercelResponse } from '@vercel/node';
import { recordAnthropicSpend, type AnthropicUsage } from './_lib/llm-budget.js';

const CORS_ORIGIN = 'https://nexuswatch.dev';
function setCors(res: VercelResponse): VercelResponse {
  return res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
}

export const config = { runtime: 'nodejs' };

export interface ParsedAlertRule {
  layer: string;
  condition: string;
  threshold: number | null;
  location: string | null;
  radiusKm: number | null;
  comparisonLayer: string | null;
  humanReadable: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({
      available: false,
      error: 'AI alert parsing is being configured',
      hint: 'Set ANTHROPIC_API_KEY in Vercel environment variables to enable natural language alerts.',
    });
  }

  const { text } = req.body as { text: string };
  if (!text || text.length < 5) return res.status(400).json({ error: 'Alert text required (min 5 chars)' });

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
        max_tokens: 300,
        system: `You parse natural language alert rules into structured JSON for a geopolitical intelligence platform.

Available layers: earthquakes, acled (armed conflicts), fires, ships, flights, weather-alerts, internet-outages, disease-outbreaks, nuclear, military-bases, chokepoints, energy, cables, ports, satellites, launches, elections, sanctions, displacement, predictions, air-quality, gps-jamming, sentiment, gdacs.

Available conditions: magnitude_above, count_above, fatalities_above, severity_equals, near_layer, country_equals, any_new.

Respond with ONLY valid JSON matching this schema:
{
  "layer": "string (one of the available layers)",
  "condition": "string (one of the available conditions)",
  "threshold": "number or null",
  "location": "string (country or region name) or null",
  "radiusKm": "number or null (for proximity alerts)",
  "comparisonLayer": "string or null (for near_layer condition)",
  "humanReadable": "string (clear 1-sentence description of the rule)"
}`,
        messages: [
          {
            role: 'user',
            content: text,
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'AI parsing failed' });
    }

    const data = (await response.json()) as {
      content: Array<{ text: string }>;
      usage?: AnthropicUsage;
    };
    await recordAnthropicSpend('claude-haiku-4-5-20251001', data.usage, 'parse-alert');
    const rawText = data.content?.[0]?.text || '';

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(422).json({ error: 'Could not parse alert rule', raw: rawText });
    }

    const parsed = JSON.parse(jsonMatch[0]) as ParsedAlertRule;

    // Validate required fields
    if (!parsed.layer || !parsed.condition) {
      return res.status(422).json({ error: 'Incomplete alert rule', parsed });
    }

    return res.json({ rule: parsed });
  } catch (err) {
    console.error('Parse alert error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Alert parsing failed' });
  }
}
