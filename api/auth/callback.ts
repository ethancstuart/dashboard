export const config = { runtime: 'edge' };

interface TokenResponse {
  access_token: string;
  token_type: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  email: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

async function exchangeGoogle(code: string, redirectUri: string): Promise<{ id: string; email: string; name: string; avatar: string }> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(tokenData)}`);
  }
  const tokens = tokenData as TokenResponse;

  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    throw new Error(`Google userinfo failed: ${userRes.status}`);
  }
  const user = (await userRes.json()) as GoogleUserInfo;
  return { id: `google:${user.sub}`, email: user.email, name: user.name, avatar: user.picture };
}

async function exchangeGithub(code: string, _redirectUri: string): Promise<{ id: string; email: string; name: string; avatar: string }> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
      code,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`GitHub token exchange failed: ${JSON.stringify(tokenData)}`);
  }
  const tokens = tokenData as TokenResponse;

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
  });
  const user = (await userRes.json()) as GitHubUser;

  let email = user.email || '';
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    });
    const emails = (await emailsRes.json()) as GitHubEmail[];
    const primary = emails.find((e) => e.primary && e.verified);
    email = primary?.email || emails[0]?.email || '';
  }

  return { id: `github:${user.id}`, email, name: user.name || user.login, avatar: user.avatar_url };
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider') || '';
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';

  if (!code || !provider) {
    return new Response(null, { status: 302, headers: { Location: '/#/' } });
  }

  // Verify CSRF state
  const cookies = req.headers.get('cookie') || '';
  const stateCookie = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith('oauth_state='));
  const savedState = stateCookie?.split('=')[1];
  if (!savedState || savedState !== state) {
    return new Response(null, { status: 302, headers: { Location: '/#/?error=invalid_state' } });
  }

  const redirectUri = `${url.origin}/api/auth/callback?provider=${provider}`;

  try {
    let userInfo: { id: string; email: string; name: string; avatar: string };
    if (provider === 'google') {
      userInfo = await exchangeGoogle(code, redirectUri);
    } else if (provider === 'github') {
      userInfo = await exchangeGithub(code, redirectUri);
    } else {
      return new Response(null, { status: 302, headers: { Location: '/#/?error=invalid_provider' } });
    }

    // Create session
    const sessionId = crypto.randomUUID();

    const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    const isOwner = ADMIN_IDS.includes(userInfo.id) || ADMIN_EMAILS.includes(userInfo.email);

    const user = {
      id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      avatar: userInfo.avatar,
      provider,
      tier: isOwner ? 'premium' : 'free',
      isAdmin: isOwner || undefined,
      createdAt: new Date().toISOString(),
    };

    // Store session in KV if available
    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    if (kvUrl && kvToken) {
      await fetch(`${kvUrl}/set/session:${sessionId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
      // Set TTL to 7 days
      await fetch(`${kvUrl}/expire/session:${sessionId}/604800`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
    }

    // Set session cookie and redirect to dashboard
    const headers = new Headers();
    headers.set('Location', '/#/app');
    headers.append('Set-Cookie', `__Host-session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`);
    // Clear legacy cookie if present
    headers.append('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    headers.append('Set-Cookie', 'oauth_state=; Path=/; Max-Age=0');
    return new Response(null, { status: 302, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('OAuth callback error:', message, err);
    // Use fixed error code — never forward raw error messages to the client
    return new Response(null, { status: 302, headers: { Location: '/#/?error=auth_failed' } });
  }
}
