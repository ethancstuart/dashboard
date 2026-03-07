export const config = { runtime: 'edge' };

type ChatProvider = 'anthropic' | 'openai' | 'google' | 'xai';

interface ChatBody {
  messages: { role: string; content: string }[];
  context?: string;
  provider?: ChatProvider;
}

function getSessionId(req: Request): string | null {
  const cookies = req.headers.get('cookie') || '';
  const sessionCookie = cookies
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('__Host-session=') || c.startsWith('session='));
  return sessionCookie?.split('=')[1] || null;
}

async function decryptKey(ciphertext: string, secret: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('dashview-api-keys'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

function buildSystemMessage(context?: string): string {
  const base = 'You are a helpful AI assistant integrated into a real-time intelligence dashboard called DashView.';
  if (context) {
    return `${base} Here is the current dashboard context:\n${context}\n\nUse this context to provide relevant, data-aware responses.`;
  }
  return base;
}

async function callAnthropic(apiKey: string, messages: { role: string; content: string }[], system: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    await res.text();
    throw new Error(`Anthropic API error: ${res.status}`);
  }
  const data = await res.json();
  // Extract text from Anthropic response format
  const text = (data.content || [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('');
  return { response: text || 'No response' };
}

async function callOpenAI(apiKey: string, messages: { role: string; content: string }[], system: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  if (!res.ok) {
    await res.text();
    throw new Error(`OpenAI API error: ${res.status}`);
  }
  const data = await res.json();
  return { response: data.choices?.[0]?.message?.content || 'No response' };
}

async function callGoogle(apiKey: string, messages: { role: string; content: string }[], system: string) {
  const geminiMessages = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: geminiMessages,
      }),
    },
  );
  if (!res.ok) {
    await res.text();
    throw new Error(`Google AI API error: ${res.status}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return { response: text || 'No response' };
}

async function callXAI(apiKey: string, messages: { role: string; content: string }[], system: string) {
  // xAI uses OpenAI-compatible API
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-3-mini',
      max_tokens: 1024,
      messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  if (!res.ok) {
    await res.text();
    throw new Error(`xAI API error: ${res.status}`);
  }
  const data = await res.json();
  return { response: data.choices?.[0]?.message?.content || 'No response' };
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionId = getSessionId(req);
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const authSecret = process.env.AUTH_SECRET;

  if (!kvUrl || !kvToken || !authSecret) {
    return new Response(JSON.stringify({ error: 'Storage not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify session exists and user is premium
  let userId: string;
  try {
    const sessionRes = await fetch(`${kvUrl}/get/session:${sessionId}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const sessionData = (await sessionRes.json()) as { result: string | null };
    if (!sessionData.result) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const user = JSON.parse(sessionData.result);
    if (user.tier !== 'premium') {
      return new Response(JSON.stringify({ error: 'Premium tier required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    userId = user.id;
  } catch {
    return new Response(JSON.stringify({ error: 'Session check failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = (await req.json()) as ChatBody;
  const provider: ChatProvider = body.provider || 'anthropic';
  const validProviders: ChatProvider[] = ['anthropic', 'openai', 'google', 'xai'];
  if (!validProviders.includes(provider)) {
    return new Response(JSON.stringify({ error: `Invalid provider: ${provider}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get user's API key for the selected provider
  let apiKey: string | null = null;
  try {
    const keyRes = await fetch(`${kvUrl}/get/apikey:${userId}:${provider}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const keyData = (await keyRes.json()) as { result: string | null };
    if (keyData.result) {
      apiKey = await decryptKey(keyData.result, authSecret);
    }
  } catch {
    // Key fetch failed
  }

  if (!apiKey) {
    const providerNames: Record<ChatProvider, string> = {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google AI',
      xai: 'xAI (Grok)',
    };
    return new Response(
      JSON.stringify({ error: `No ${providerNames[provider]} API key configured. Add one in the chat panel.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Rate limit
  const rateLimitKey = `ratelimit:chat:${sessionId}`;
  try {
    const rlRes = await fetch(`${kvUrl}/get/${rateLimitKey}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const rlData = (await rlRes.json()) as { result: string | null };
    const count = parseInt(rlData.result || '0', 10);
    if (count >= 50) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded (50 messages/hour)' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    await fetch(`${kvUrl}/incr/${rateLimitKey}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    if (!rlData.result) {
      await fetch(`${kvUrl}/expire/${rateLimitKey}/3600`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
    }
  } catch {
    // Rate limit check failed, allow through
  }

  const system = buildSystemMessage(body.context);

  try {
    const callers: Record<ChatProvider, typeof callAnthropic> = {
      anthropic: callAnthropic,
      openai: callOpenAI,
      google: callGoogle,
      xai: callXAI,
    };
    const result = await callers[provider](apiKey, body.messages, system);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reach AI provider';
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
