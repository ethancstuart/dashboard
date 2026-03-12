export const config = { runtime: 'edge' };

const CORS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://dashpulse.app' };

function getSessionId(req: Request): string | null {
  const cookies = req.headers.get('cookie') || '';
  const sessionCookie = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('__Host-session='));
  return sessionCookie?.split('=')[1] || null;
}

async function getUser(sessionId: string, kvUrl: string, kvToken: string): Promise<{ id: string; tier: string; name?: string } | null> {
  try {
    const res = await fetch(`${kvUrl}/get/session:${sessionId}`, { headers: { Authorization: `Bearer ${kvToken}` } });
    const data = (await res.json()) as { result: string | null };
    if (!data.result) return null;
    let user = JSON.parse(data.result);
    if (typeof user === 'string') user = JSON.parse(user);
    return user?.id ? { id: user.id, tier: user.tier || 'free', name: user.name } : null;
  } catch { return null; }
}

export default async function handler(req: Request) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    return new Response(JSON.stringify({ error: 'Storage not configured' }), { status: 503, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  // GET: public, no auth required
  if (req.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code || !/^[A-Z0-9]{8}$/.test(code)) {
      return new Response(JSON.stringify({ error: 'Invalid share code' }), { status: 400, headers: CORS_HEADERS });
    }
    try {
      const res = await fetch(`${kvUrl}/get/share:${code}`, { headers: { Authorization: `Bearer ${kvToken}` } });
      const data = (await res.json()) as { result: string | null };
      if (!data.result) {
        return new Response(JSON.stringify({ error: 'Share not found or expired' }), { status: 404, headers: CORS_HEADERS });
      }
      const parsed = JSON.parse(data.result);
      return new Response(JSON.stringify(parsed), { headers: CORS_HEADERS });
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to retrieve share' }), { status: 500, headers: CORS_HEADERS });
    }
  }

  // POST and DELETE require auth
  const sessionId = getSessionId(req);
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: CORS_HEADERS });
  }
  const user = await getUser(sessionId, kvUrl, kvToken);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: CORS_HEADERS });
  }

  if (req.method === 'POST') {
    // Rate limit: 5 shares/hour
    const rlKey = `ratelimit:share:${user.id}`;
    try {
      const rlRes = await fetch(`${kvUrl}/get/${rlKey}`, { headers: { Authorization: `Bearer ${kvToken}` } });
      const rlData = (await rlRes.json()) as { result: string | null };
      const count = parseInt(rlData.result || '0', 10);
      if (count >= 5) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded (5 shares/hour)' }), { status: 429, headers: CORS_HEADERS });
      }
      await fetch(`${kvUrl}/incr/${rlKey}`, { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
      if (!rlData.result) {
        await fetch(`${kvUrl}/expire/${rlKey}/3600`, { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
      }
    } catch { /* allow through */ }

    // Free tier: max 1 active share
    if (user.tier !== 'premium') {
      try {
        const countRes = await fetch(`${kvUrl}/keys/share-owner:${user.id}:*`, { headers: { Authorization: `Bearer ${kvToken}` } });
        const countData = (await countRes.json()) as { result: string[] };
        if ((countData.result || []).length >= 1) {
          return new Response(JSON.stringify({ error: 'Free tier limited to 1 active share. Delete existing share or upgrade.' }), { status: 403, headers: CORS_HEADERS });
        }
      } catch { /* allow through */ }
    }

    const body = (await req.json()) as { data: Record<string, unknown> };
    if (!body.data || typeof body.data !== 'object') {
      return new Response(JSON.stringify({ error: 'Config data required' }), { status: 400, headers: CORS_HEADERS });
    }

    const code = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const ttl = user.tier === 'premium' ? 30 * 24 * 3600 : 7 * 24 * 3600;
    const expiresAt = Date.now() + ttl * 1000;

    const shareData = JSON.stringify({
      data: body.data,
      createdBy: user.name || user.id,
      createdAt: Date.now(),
      expiresAt,
    });

    await fetch(`${kvUrl}/set/share:${code}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(shareData),
    });
    await fetch(`${kvUrl}/expire/share:${code}/${ttl}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    // Track ownership
    await fetch(`${kvUrl}/set/share-owner:${user.id}:${code}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify('"1"'),
    });
    await fetch(`${kvUrl}/expire/share-owner:${user.id}:${code}/${ttl}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    return new Response(JSON.stringify({ code, expiresAt }), { headers: CORS_HEADERS });
  }

  if (req.method === 'DELETE') {
    const code = url.searchParams.get('code');
    if (!code) {
      return new Response(JSON.stringify({ error: 'Share code required' }), { status: 400, headers: CORS_HEADERS });
    }

    // Verify ownership
    try {
      const ownerRes = await fetch(`${kvUrl}/get/share-owner:${user.id}:${code}`, { headers: { Authorization: `Bearer ${kvToken}` } });
      const ownerData = (await ownerRes.json()) as { result: string | null };
      if (!ownerData.result) {
        return new Response(JSON.stringify({ error: 'Not authorized to delete this share' }), { status: 403, headers: CORS_HEADERS });
      }
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to verify ownership' }), { status: 500, headers: CORS_HEADERS });
    }

    await fetch(`${kvUrl}/del/share:${code}`, { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
    await fetch(`${kvUrl}/del/share-owner:${user.id}:${code}`, { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });

    return new Response(JSON.stringify({ deleted: code }), { headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
}
