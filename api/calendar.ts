export const config = { runtime: 'edge' };

const CORS_HEADERS = { 'Content-Type': 'application/json' };

function getSessionId(req: Request): string | null {
  const cookies = req.headers.get('cookie') || '';
  const sessionCookie = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('__Host-session=') || c.startsWith('session='));
  return sessionCookie?.split('=')[1] || null;
}

async function getUser(sessionId: string, kvUrl: string, kvToken: string): Promise<{ id: string; tier: string } | null> {
  try {
    const res = await fetch(`${kvUrl}/get/session:${sessionId}`, { headers: { Authorization: `Bearer ${kvToken}` } });
    const data = (await res.json()) as { result: string | null };
    if (!data.result) return null;
    let user = JSON.parse(data.result);
    if (typeof user === 'string') user = JSON.parse(user);
    return user?.id ? { id: user.id, tier: user.tier || 'free' } : null;
  } catch { return null; }
}

async function decrypt(ciphertext: string, secret: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('dashview-api-keys'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

export default async function handler(req: Request) {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: CORS_HEADERS });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const authSecret = process.env.AUTH_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!kvUrl || !kvToken || !authSecret || !clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'Not configured' }), { status: 503, headers: CORS_HEADERS });
  }

  const user = await getUser(sessionId, kvUrl, kvToken);
  if (!user || user.tier !== 'premium') {
    return new Response(JSON.stringify({ error: 'Premium required' }), { status: 403, headers: CORS_HEADERS });
  }

  // Check for cached response (5-minute cache)
  const cacheKey = `calendar-cache:${user.id}`;
  try {
    const cacheRes = await fetch(`${kvUrl}/get/${cacheKey}`, { headers: { Authorization: `Bearer ${kvToken}` } });
    const cacheData = (await cacheRes.json()) as { result: string | null };
    if (cacheData.result) {
      return new Response(cacheData.result, { headers: CORS_HEADERS });
    }
  } catch { /* cache miss */ }

  // Get refresh token
  const kvKey = `apikey:${user.id}:google-calendar`;
  let refreshToken: string;
  try {
    const res = await fetch(`${kvUrl}/get/${kvKey}`, { headers: { Authorization: `Bearer ${kvToken}` } });
    const data = (await res.json()) as { result: string | null };
    if (!data.result) {
      return new Response(JSON.stringify({ error: 'Calendar not connected' }), { status: 404, headers: CORS_HEADERS });
    }
    const stored = JSON.parse(data.result);
    refreshToken = await decrypt(stored, authSecret);
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to retrieve credentials' }), { status: 500, headers: CORS_HEADERS });
  }

  // Exchange refresh token for access token
  let accessToken: string;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tokens = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokens.access_token) {
      return new Response(JSON.stringify({ error: 'Failed to refresh access token' }), { status: 401, headers: CORS_HEADERS });
    }
    accessToken = tokens.access_token;
  } catch {
    return new Response(JSON.stringify({ error: 'Token refresh failed' }), { status: 500, headers: CORS_HEADERS });
  }

  // Fetch calendar events
  try {
    const now = new Date();
    const timeMax = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });

    const eventsRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const eventsData = (await eventsRes.json()) as { items?: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string; colorId?: string }> };

    const COLOR_MAP: Record<string, string> = {
      '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
      '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161',
      '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
    };

    const events = (eventsData.items || []).map(item => ({
      id: item.id,
      title: item.summary || 'Untitled',
      start: item.start?.dateTime || item.start?.date || '',
      end: item.end?.dateTime || item.end?.date || '',
      allDay: !item.start?.dateTime,
      location: item.location || undefined,
      calendarColor: item.colorId ? COLOR_MAP[item.colorId] || '#3b82f6' : '#3b82f6',
    }));

    const result = JSON.stringify({ events, fetchedAt: Date.now() });

    // Cache for 5 minutes
    try {
      await fetch(`${kvUrl}/set/${cacheKey}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
      await fetch(`${kvUrl}/expire/${cacheKey}/300`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
    } catch { /* cache write failure is non-critical */ }

    return new Response(result, { headers: CORS_HEADERS });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to fetch events' }), { status: 500, headers: CORS_HEADERS });
  }
}
