export const config = { runtime: 'edge' };

const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://dashpulse.app' };

const ALLOWED_KEY_NAMES = ['anthropic', 'openai', 'google', 'xai', 'google-calendar'];
const KEY_TTL_SECONDS = 90 * 24 * 3600; // 90 days

function getSessionId(req: Request): string | null {
  const cookies = req.headers.get('cookie') || '';
  const sessionCookie = cookies
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('__Host-session=') || c.startsWith('session='));
  return sessionCookie?.split('=')[1] || null;
}

async function getUser(
  sessionId: string,
  kvUrl: string,
  kvToken: string,
): Promise<{ id: string; tier: string } | null> {
  try {
    const res = await fetch(`${kvUrl}/get/session:${sessionId}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = (await res.json()) as { result: string | null };
    if (!data.result) return null;
    let user = JSON.parse(data.result);
    if (typeof user === 'string') user = JSON.parse(user);
    return user?.id ? { id: user.id, tier: user.tier || 'free' } : null;
  } catch {
    return null;
  }
}

// --- AES-GCM encryption using AUTH_SECRET ---

async function deriveKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('dashview-api-keys'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(plaintext: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  // Concatenate iv + ciphertext, encode as base64
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

// --- Audit logging ---

async function auditLog(
  kvUrl: string,
  kvToken: string,
  userId: string,
  action: string,
  keyName: string,
): Promise<void> {
  const entry = JSON.stringify({ userId, action, keyName, ts: new Date().toISOString() });
  const logKey = `audit:keys:${userId}:${Date.now()}`;
  try {
    await fetch(`${kvUrl}/set/${logKey}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    // Expire audit logs after 90 days
    await fetch(`${kvUrl}/expire/${logKey}/${KEY_TTL_SECONDS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
  } catch {
    // Best-effort logging
  }
}

// --- Rate limiting ---

async function checkRateLimit(kvUrl: string, kvToken: string, userId: string): Promise<boolean> {
  const rlKey = `ratelimit:keys:${userId}`;
  try {
    const res = await fetch(`${kvUrl}/get/${rlKey}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = (await res.json()) as { result: string | null };
    const count = parseInt(data.result || '0', 10);
    if (count >= 20) return false; // 20 key operations per hour
    await fetch(`${kvUrl}/incr/${rlKey}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    if (!data.result) {
      await fetch(`${kvUrl}/expire/${rlKey}/3600`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
    }
    return true;
  } catch {
    return true; // Allow through on rate limit check failure
  }
}

// --- Validation ---

function validateKeyName(name: string): boolean {
  return ALLOWED_KEY_NAMES.includes(name);
}

function validateKeyValue(name: string, value: string): string | null {
  if (value.length < 10 || value.length > 500) return 'Key must be 10-500 characters';
  if (name === 'anthropic' && !value.startsWith('sk-ant-')) return 'Invalid Anthropic key format';
  if (name === 'openai' && !value.startsWith('sk-')) return 'Invalid OpenAI key format';
  return null;
}

// --- Handler ---

export default async function handler(req: Request) {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const authSecret = process.env.AUTH_SECRET;
  if (!kvUrl || !kvToken) {
    return new Response(JSON.stringify({ error: 'Storage not configured' }), {
      status: 503,
      headers: CORS_HEADERS,
    });
  }
  if (!authSecret) {
    return new Response(JSON.stringify({ error: 'Encryption not configured' }), {
      status: 503,
      headers: CORS_HEADERS,
    });
  }

  const user = await getUser(sessionId, kvUrl, kvToken);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }
  if (user.tier !== 'premium') {
    return new Response(JSON.stringify({ error: 'Premium tier required' }), {
      status: 403,
      headers: CORS_HEADERS,
    });
  }

  // Rate limit all key operations
  const allowed = await checkRateLimit(kvUrl, kvToken, user.id);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded (20 key operations/hour)' }), {
      status: 429,
      headers: CORS_HEADERS,
    });
  }

  const url = new URL(req.url);

  if (req.method === 'POST') {
    const body = (await req.json()) as { keyName?: string; keyValue?: string };
    const { keyName, keyValue } = body;
    if (!keyName || !keyValue) {
      return new Response(JSON.stringify({ error: 'keyName and keyValue required' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    if (!validateKeyName(keyName)) {
      return new Response(JSON.stringify({ error: `Invalid key name. Allowed: ${ALLOWED_KEY_NAMES.join(', ')}` }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const validationError = validateKeyValue(keyName, keyValue);
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const encrypted = await encrypt(keyValue, authSecret);
    const kvKey = `apikey:${user.id}:${keyName}`;
    await fetch(`${kvUrl}/set/${kvKey}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(encrypted),
    });
    // Set TTL — keys expire after 90 days, user must re-enter
    await fetch(`${kvUrl}/expire/${kvKey}/${KEY_TTL_SECONDS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    await auditLog(kvUrl, kvToken, user.id, 'store', keyName);

    return new Response(JSON.stringify({ stored: keyName }), {
      headers: CORS_HEADERS,
    });
  }

  if (req.method === 'GET') {
    try {
      const res = await fetch(`${kvUrl}/keys/apikey:${user.id}:*`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      const data = (await res.json()) as { result: string[] };
      const keyNames = (data.result || []).map((k: string) => k.replace(`apikey:${user.id}:`, ''));
      await auditLog(kvUrl, kvToken, user.id, 'list', '*');
      return new Response(JSON.stringify({ keys: keyNames }), {
        headers: CORS_HEADERS,
      });
    } catch {
      return new Response(JSON.stringify({ keys: [] }), {
        headers: CORS_HEADERS,
      });
    }
  }

  if (req.method === 'DELETE') {
    const keyName = url.searchParams.get('name');
    if (!keyName || !validateKeyName(keyName)) {
      return new Response(JSON.stringify({ error: 'Valid key name required' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    await fetch(`${kvUrl}/del/apikey:${user.id}:${keyName}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    await auditLog(kvUrl, kvToken, user.id, 'delete', keyName);

    return new Response(JSON.stringify({ deleted: keyName }), {
      headers: CORS_HEADERS,
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: CORS_HEADERS,
  });
}
