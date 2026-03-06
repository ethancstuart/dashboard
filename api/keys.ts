export const config = { runtime: 'edge' };

function getSessionId(req: Request): string | null {
  const cookies = req.headers.get('cookie') || '';
  const sessionCookie = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith('session='));
  return sessionCookie?.split('=')[1] || null;
}

export default async function handler(req: Request) {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    return new Response(JSON.stringify({ error: 'Storage not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);

  if (req.method === 'POST') {
    const body = (await req.json()) as { keyName?: string; keyValue?: string };
    const { keyName, keyValue } = body;
    if (!keyName || !keyValue) {
      return new Response(JSON.stringify({ error: 'keyName and keyValue required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Store encrypted (base64 encode for now — real encryption would use AUTH_SECRET)
    const encoded = btoa(keyValue);
    await fetch(`${kvUrl}/set/apikey:${sessionId}:${keyName}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(encoded),
    });

    return new Response(JSON.stringify({ stored: keyName }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'GET') {
    // List stored key names (not values)
    try {
      const res = await fetch(`${kvUrl}/keys/apikey:${sessionId}:*`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      const data = (await res.json()) as { result: string[] };
      const keyNames = (data.result || []).map((k: string) => k.replace(`apikey:${sessionId}:`, ''));
      return new Response(JSON.stringify({ keys: keyNames }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify({ keys: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (req.method === 'DELETE') {
    const keyName = url.searchParams.get('name');
    if (!keyName) {
      return new Response(JSON.stringify({ error: 'Key name required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await fetch(`${kvUrl}/del/apikey:${sessionId}:${keyName}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    return new Response(JSON.stringify({ deleted: keyName }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}
