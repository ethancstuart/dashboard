export const config = { runtime: 'edge' };

const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://dashpulse.app' };

interface ShellBody {
  query: string;
  context?: string;
}

function getSessionId(req: Request): string | null {
  const cookies = req.headers.get('cookie') || '';
  const sessionCookie = cookies
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('__Host-session='));
  return sessionCookie?.split('=')[1] || null;
}

export default async function handler(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'AI not configured' }), {
      status: 503,
      headers: CORS_HEADERS,
    });
  }

  const sessionId = getSessionId(req);
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  // Check quota for GET requests
  if (req.method === 'GET') {
    const url = new URL(req.url);
    if (url.searchParams.get('check') === 'quota') {
      if (!kvUrl || !kvToken) {
        return new Response(JSON.stringify({ remaining: 5 }), { headers: CORS_HEADERS });
      }
      try {
        const key = `ratelimit:aishell:${sessionId}`;
        const res = await fetch(`${kvUrl}/get/${key}`, {
          headers: { Authorization: `Bearer ${kvToken}` },
        });
        const data = (await res.json()) as { result: string | null };
        const used = parseInt(data.result || '0', 10);

        // Check user tier for limit
        const sessionRes = await fetch(`${kvUrl}/get/session:${sessionId}`, {
          headers: { Authorization: `Bearer ${kvToken}` },
        });
        const sessionData = (await sessionRes.json()) as { result: string | null };
        const user = sessionData.result ? JSON.parse(sessionData.result) : null;
        const limit = user?.tier === 'premium' ? 25 : 5;

        return new Response(JSON.stringify({ remaining: Math.max(0, limit - used) }), {
          headers: CORS_HEADERS,
        });
      } catch {
        return new Response(JSON.stringify({ remaining: 5 }), { headers: CORS_HEADERS });
      }
    }
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  // Rate limit: 5/day free, 25/day premium
  if (kvUrl && kvToken) {
    const rateLimitKey = `ratelimit:aishell:${sessionId}`;
    try {
      const rlRes = await fetch(`${kvUrl}/get/${rateLimitKey}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      const rlData = (await rlRes.json()) as { result: string | null };
      const count = parseInt(rlData.result || '0', 10);

      // Check tier
      const sessionRes = await fetch(`${kvUrl}/get/session:${sessionId}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      const sessionData = (await sessionRes.json()) as { result: string | null };
      const user = sessionData.result ? JSON.parse(sessionData.result) : null;
      const limit = user?.tier === 'premium' ? 25 : 5;

      if (count >= limit) {
        return new Response(
          JSON.stringify({ error: `Daily AI limit reached (${limit}/day). Add your own API key for unlimited.` }),
          { status: 429, headers: CORS_HEADERS },
        );
      }

      await fetch(`${kvUrl}/incr/${rateLimitKey}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      if (!rlData.result) {
        // Set TTL to end of day (86400s)
        await fetch(`${kvUrl}/expire/${rateLimitKey}/86400`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${kvToken}` },
        });
      }
    } catch {
      // Rate limit check failed, allow through
    }
  }

  const body = (await req.json()) as ShellBody;
  const query = (body.query || '').slice(0, 500);
  const context = (body.context || '').slice(0, 3000);

  const systemPrompt = `You are the AI assistant for DashPulse, a personal intelligence terminal. You help users manage their dashboard spaces and widgets.

You MUST respond with a valid JSON object with these fields:
- "action": one of "navigate_space", "add_widget", "remove_widget", "create_space", "answer", "highlight"
- "params": object with action-specific parameters (optional)
- "message": a short, friendly confirmation message

Action params:
- navigate_space: { "spaceId": "string" }
- add_widget: { "panelId": "string", "size": "compact"|"medium"|"large" }
- remove_widget: { "panelId": "string" }
- create_space: { "name": "string", "icon": "emoji", "widgets": [{"panelId": "string", "size": "string"}] }
- highlight: { "panelId": "string" }
- answer: (no params, just message)

Dashboard context:
${context}

Respond ONLY with the JSON object, no markdown or explanation.`;

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
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: 'user', content: query }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: `AI error: ${res.status}`, detail: errText }), {
        status: 502,
        headers: CORS_HEADERS,
      });
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(text);
      return new Response(JSON.stringify(parsed), { headers: CORS_HEADERS });
    } catch {
      // If not valid JSON, return as answer
      return new Response(JSON.stringify({ action: 'answer', message: text }), {
        headers: CORS_HEADERS,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: CORS_HEADERS,
    });
  }
}
