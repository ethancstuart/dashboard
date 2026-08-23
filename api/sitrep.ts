import { recordAnthropicSpend, type AnthropicUsage } from './_lib/llm-budget.js';
import { checkBudget } from './_lib/llm-budget.js';
export const config = { runtime: 'edge' };

const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://nexuswatch.dev' };

interface SitrepBody {
  region?: string;
  query?: string;
  mode?: 'sitrep' | 'query';
  data: {
    context?: string;
    earthquakes?: { magnitude: number; place: string; time: number }[];
    fires?: { count: number; regions: string[] };
    news?: { title: string; source: string; tone: number }[];
    weather?: { city: string; description: string }[];
    predictions?: { question: string; probability: number }[];
    personalContext?: {
      tensionIndex: number;
      tensionTrend: string;
      watchlistTopics: string;
      watchlistMatches: string;
    };
  };
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
  }

  // Budget gate. Edge runtime, but llm-budget's neon driver is fetch-based and
  // edge-compatible; fails open on DB error by design.
  const gate = await checkBudget({ endpoint: 'sitrep', bypassCap: false });
  if (!gate.ok) {
    return new Response(JSON.stringify(gate), {
      status: 503,
      headers: { ...CORS_HEADERS, 'Retry-After': '3600' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        available: false,
        error: 'AI analyst is being configured',
        hint: 'The AI intelligence analyst will be available shortly. In the meantime, explore the 45+ data layers on the map.',
      }),
      { status: 200, headers: CORS_HEADERS },
    );
  }

  const body = (await req.json()) as SitrepBody;
  const region = body.region || 'Global';
  const data = body.data || {};
  const isQueryMode = body.mode === 'query' && body.query;

  // Input validation — guard against prompt injection and oversized payloads.
  if (body.query !== undefined) {
    if (typeof body.query !== 'string') {
      return new Response(JSON.stringify({ error: 'query must be a string' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    if (body.query.length > 500) {
      return new Response(JSON.stringify({ error: 'query too long (max 500 chars)' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    if (/```|ignore (all |previous |the |your )/i.test(body.query)) {
      return new Response(JSON.stringify({ error: 'invalid query format' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
  }

  // Query mode — answer a specific question using platform data
  if (isQueryMode) {
    const querySystemPrompt = `You are the NexusWatch AI command center — an intelligent analyst that answers questions about global geopolitical conditions using real-time platform data.

RULES:
- Answer the specific question asked. Be direct and concise.
- Use the provided data context. Don't fabricate events.
- If the data doesn't contain what's needed, say so honestly.
- Use the NexusWatch "we" voice: "We're tracking 243 earthquakes..." not "There are 243..."
- Keep responses under 200 words.
- Format: plain text, no markdown headers. Use bullet points (•) for lists.
- When relevant, suggest which NexusWatch layers or features to enable for more detail.`;

    const queryUserPrompt = `Question: ${body.query}\n\nCurrent NexusWatch platform data:\n${data.context || 'No data context available.'}`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: querySystemPrompt,
          messages: [{ role: 'user', content: queryUserPrompt }],
        }),
      });

      if (!res.ok) {
        return new Response(JSON.stringify({ error: `AI error: ${res.status}` }), {
          status: 502,
          headers: CORS_HEADERS,
        });
      }

      const result = (await res.json()) as {
        content?: { type: string; text: string }[];
        usage?: AnthropicUsage;
      };
      await recordAnthropicSpend('claude-haiku-4-5-20251001', result.usage, 'sitrep');
      const text = (result.content || [])
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('');

      return new Response(JSON.stringify({ sitrep: text, query: body.query, generatedAt: new Date().toISOString() }), {
        headers: { ...CORS_HEADERS, 'Cache-Control': 'no-cache' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Query failed';
      return new Response(JSON.stringify({ error: message }), { status: 502, headers: CORS_HEADERS });
    }
  }

  // Build context from layer data
  const sections: string[] = [];

  if (data.earthquakes?.length) {
    sections.push(
      `SEISMIC ACTIVITY:\n${data.earthquakes
        .slice(0, 10)
        .map((e) => `- M${e.magnitude} — ${e.place} (${new Date(e.time).toISOString()})`)
        .join('\n')}`,
    );
  }

  if (data.fires?.count) {
    sections.push(
      `WILDFIRE ACTIVITY:\n- ${data.fires.count} active hotspots\n- Regions: ${data.fires.regions.join(', ')}`,
    );
  }

  if (data.news?.length) {
    sections.push(
      `NEWS FEED (${data.news.length} articles):\n${data.news
        .slice(0, 8)
        .map((n) => `- [${n.source}] ${n.title} (tone: ${n.tone > 0 ? '+' : ''}${n.tone.toFixed(1)})`)
        .join('\n')}`,
    );
  }

  if (data.weather?.length) {
    sections.push(`WEATHER ALERTS:\n${data.weather.map((w) => `- ${w.city}: ${w.description}`).join('\n')}`);
  }

  if (data.predictions?.length) {
    sections.push(
      `PREDICTION MARKETS:\n${data.predictions.map((p) => `- ${p.question}: ${p.probability}%`).join('\n')}`,
    );
  }

  if (data.personalContext) {
    const pc = data.personalContext;
    sections.push(`GLOBAL TENSION INDEX: ${pc.tensionIndex}/100 (trend: ${pc.tensionTrend})`);
    if (pc.watchlistTopics) {
      sections.push(`USER WATCHLIST TOPICS: ${pc.watchlistTopics}`);
    }
    if (pc.watchlistMatches) {
      sections.push(`WATCHLIST MATCHES:\n${pc.watchlistMatches}`);
    }
  }

  const dataContext = sections.length > 0 ? sections.join('\n\n') : 'No current data available.';
  const isPersonal = !!data.personalContext;

  const systemPrompt = isPersonal
    ? `You are a personal intelligence briefing analyst for NexusWatch. Generate a PERSONALIZED morning brief focused on the user's watchlist topics. Prioritize events matching their interests. Include the Global Tension Index context. Write 2-3 focused paragraphs. End with a one-sentence outlook for the day ahead.`
    : `You are a concise geopolitical intelligence analyst for NexusWatch. Generate a situation report based on the provided real-time data.

Rules:
- Write 2-3 focused paragraphs
- Lead with the most significant developments
- Note any correlations between data points (e.g., seismic activity + fire hotspots in same region)
- End with a single-sentence risk assessment
- Use precise, professional intelligence language
- Do NOT speculate beyond the data
- Format: plain text, no markdown headers`;

  const userPrompt = `Generate a situation report for: ${region}\n\nCurrent intelligence data:\n\n${dataContext}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `AI error: ${res.status}` }), { status: 502, headers: CORS_HEADERS });
    }

    const result = (await res.json()) as {
      content?: { type: string; text: string }[];
      usage?: AnthropicUsage;
    };
    await recordAnthropicSpend('claude-haiku-4-5-20251001', result.usage, 'sitrep:narrate');
    const text = (result.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');

    return new Response(JSON.stringify({ sitrep: text, region, generatedAt: new Date().toISOString() }), {
      headers: { ...CORS_HEADERS, 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sitrep generation failed';
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: CORS_HEADERS });
  }
}
