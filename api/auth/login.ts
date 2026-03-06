export const config = { runtime: 'edge' };

const PROVIDERS: Record<string, { authUrl: string; scope: string; clientIdEnv: string }> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    scope: 'read:user user:email',
    clientIdEnv: 'GITHUB_CLIENT_ID',
  },
};

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider') || 'google';

  const config = PROVIDERS[provider];
  if (!config) {
    return new Response(JSON.stringify({ error: 'Invalid provider' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const clientId = process.env[config.clientIdEnv];
  if (!clientId) {
    return new Response(JSON.stringify({ error: 'OAuth not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redirectUri = `${url.origin}/api/auth/callback?provider=${provider}`;

  // Generate random state for CSRF protection
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scope,
    state,
  });

  // Store state in a short-lived cookie for verification
  const authUrl = `${config.authUrl}?${params.toString()}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
