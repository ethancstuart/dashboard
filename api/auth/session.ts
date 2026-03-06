export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const cookies = req.headers.get('cookie') || '';
  const sessionCookie = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith('__Host-session=') || c.startsWith('session='));
  const sessionId = sessionCookie?.split('=')[1];

  if (!sessionId) {
    return new Response(JSON.stringify({ user: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return new Response(JSON.stringify({ user: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch(`${kvUrl}/get/session:${sessionId}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const data = (await res.json()) as { result: string | null };

    if (!data.result) {
      return new Response(JSON.stringify({ user: null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let user = JSON.parse(data.result);
    // Handle legacy double-stringified sessions
    if (typeof user === 'string') user = JSON.parse(user);

    // Re-derive admin status (self-healing for existing sessions)
    const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    if (user && (ADMIN_IDS.includes(user.id) || ADMIN_EMAILS.includes(user.email))) {
      user.isAdmin = true;
      user.tier = 'premium';
    }

    return new Response(JSON.stringify({ user }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch {
    return new Response(JSON.stringify({ user: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
