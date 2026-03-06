export const config = { runtime: 'edge' };

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

  // Get user's Anthropic API key from KV
  let apiKey: string | null = null;
  try {
    const keyRes = await fetch(`${kvUrl}/get/apikey:${userId}:anthropic`, {
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
    return new Response(JSON.stringify({ error: 'No Anthropic API key configured. Add one in settings.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: check message count
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
    // Increment
    await fetch(`${kvUrl}/incr/${rateLimitKey}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    // Set TTL if new
    if (!rlData.result) {
      await fetch(`${kvUrl}/expire/${rateLimitKey}/3600`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
    }
  } catch {
    // Rate limit check failed, allow through
  }

  // Proxy to Anthropic API
  const body = (await req.json()) as { messages: { role: string; content: string }[]; context?: string };
  const systemMessage = body.context
    ? `You are a helpful AI assistant integrated into a real-time intelligence dashboard. Here is the current dashboard context:\n${body.context}\n\nUse this context to provide relevant, data-aware responses.`
    : 'You are a helpful AI assistant integrated into a real-time intelligence dashboard called DashPulse';

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemMessage,
        messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!anthropicRes.ok) {
      await anthropicRes.text();
      return new Response(JSON.stringify({ error: `Anthropic API error: ${anthropicRes.status}` }), {
        status: anthropicRes.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await anthropicRes.json();
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to reach Anthropic API' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
