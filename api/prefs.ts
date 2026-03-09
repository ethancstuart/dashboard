export const config = { runtime: 'edge' };

const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://dashpulse.app' };
const PREFS_TTL_SECONDS = 180 * 24 * 3600; // 180 days
const MAX_PAYLOAD_BYTES = 50_000; // 50 KB

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

async function checkRateLimit(
  kvUrl: string,
  kvToken: string,
  userId: string,
  action: 'read' | 'write',
): Promise<boolean> {
  const limit = action === 'read' ? 60 : 30;
  const rlKey = `ratelimit:prefs-${action}:${userId}`;
  try {
    const res = await fetch(`${kvUrl}/get/${rlKey}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = (await res.json()) as { result: string | null };
    const count = parseInt(data.result || '0', 10);
    if (count >= limit) return false;
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
    return true;
  }
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/<[^>]*>/g, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/\\u00[0-9a-f]{2}/gi, '')
      .replace(/&#x?[0-9a-f]+;?/gi, '');
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      cleaned[k] = sanitizeValue(v);
    }
    return cleaned;
  }
  return value;
}

function validatePrefsData(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  for (const key of Object.keys(data as Record<string, unknown>)) {
    if (!key.startsWith('dashview')) return false;
  }
  return true;
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
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
  if (!kvUrl || !kvToken) {
    return new Response(JSON.stringify({ error: 'Storage not configured' }), {
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
  if (user.tier === 'guest') {
    return new Response(JSON.stringify({ error: 'Sign in to sync preferences' }), {
      status: 403,
      headers: CORS_HEADERS,
    });
  }

  const prefsKey = `prefs:${user.id}`;

  // GET — pull preferences
  if (req.method === 'GET') {
    const allowed = await checkRateLimit(kvUrl, kvToken, user.id, 'read');
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: CORS_HEADERS,
      });
    }

    try {
      const res = await fetch(`${kvUrl}/get/${prefsKey}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      const kv = (await res.json()) as { result: string | null };
      if (!kv.result) {
        return new Response(JSON.stringify({ data: null }), { headers: CORS_HEADERS });
      }
      let parsed = JSON.parse(kv.result);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return new Response(JSON.stringify(parsed), { headers: CORS_HEADERS });
    } catch {
      return new Response(JSON.stringify({ data: null }), { headers: CORS_HEADERS });
    }
  }

  // PUT or POST — push preferences
  if (req.method === 'PUT' || req.method === 'POST') {
    const allowed = await checkRateLimit(kvUrl, kvToken, user.id, 'write');
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: CORS_HEADERS,
      });
    }

    let body: { data?: unknown; updatedAt?: number; baseUpdatedAt?: number };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    if (!validatePrefsData(body.data)) {
      return new Response(JSON.stringify({ error: 'Invalid preferences data' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Check payload size
    const serialized = JSON.stringify(body.data);
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      return new Response(JSON.stringify({ error: 'Preferences too large (max 50 KB)' }), {
        status: 413,
        headers: CORS_HEADERS,
      });
    }

    // Sanitize all values
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.data as Record<string, unknown>)) {
      sanitized[k] = sanitizeValue(v);
    }

    // Conflict detection: check if server data changed since client's last pull
    if (body.baseUpdatedAt) {
      try {
        const res = await fetch(`${kvUrl}/get/${prefsKey}`, {
          headers: { Authorization: `Bearer ${kvToken}` },
        });
        const kv = (await res.json()) as { result: string | null };
        if (kv.result) {
          let existing = JSON.parse(kv.result);
          if (typeof existing === 'string') existing = JSON.parse(existing);
          if (existing.updatedAt && existing.updatedAt !== body.baseUpdatedAt) {
            return new Response(
              JSON.stringify({ conflict: true, server: existing }),
              { status: 409, headers: CORS_HEADERS },
            );
          }
        }
      } catch {
        // Proceed with write if conflict check fails
      }
    }

    const now = Date.now();
    const prefsBlob = { version: 1, updatedAt: now, data: sanitized };

    await fetch(`${kvUrl}/set/${prefsKey}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(prefsBlob)),
    });
    await fetch(`${kvUrl}/expire/${prefsKey}/${PREFS_TTL_SECONDS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    return new Response(JSON.stringify({ updatedAt: now }), { headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: CORS_HEADERS,
  });
}
