export const config = { runtime: 'edge' };

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

async function encrypt(plaintext: string, secret: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('dashview-api-keys'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return new Response(null, { status: 302, headers: { Location: '/#/app?calendar=error' } });
  }

  // Verify CSRF state
  const cookies = req.headers.get('cookie') || '';
  const stateCookie = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('calendar_state='));
  const savedState = stateCookie?.split('=')[1];
  if (!savedState || savedState !== state) {
    return new Response(null, { status: 302, headers: { Location: '/#/app?calendar=error' } });
  }

  const sessionId = getSessionId(req);
  if (!sessionId) {
    return new Response(null, { status: 302, headers: { Location: '/#/app?calendar=error' } });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const authSecret = process.env.AUTH_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!kvUrl || !kvToken || !authSecret || !clientId || !clientSecret) {
    return new Response(null, { status: 302, headers: { Location: '/#/app?calendar=error' } });
  }

  const user = await getUser(sessionId, kvUrl, kvToken);
  if (!user || user.tier !== 'premium') {
    return new Response(null, { status: 302, headers: { Location: '/#/app?calendar=error' } });
  }

  // Exchange code for tokens
  const redirectUri = `${url.origin}/api/auth/calendar-callback`;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string; error?: string };
    if (!tokens.refresh_token) {
      return new Response(null, { status: 302, headers: { Location: '/#/app?calendar=error' } });
    }

    // Store encrypted refresh token in KV
    const encryptedToken = await encrypt(tokens.refresh_token, authSecret);
    const kvKey = `apikey:${user.id}:google-calendar`;
    await fetch(`${kvUrl}/set/${kvKey}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(encryptedToken),
    });
    await fetch(`${kvUrl}/expire/${kvKey}/${90 * 24 * 3600}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/#/app?calendar=connected',
        'Set-Cookie': 'calendar_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
      },
    });
  } catch {
    return new Response(null, { status: 302, headers: { Location: '/#/app?calendar=error' } });
  }
}
