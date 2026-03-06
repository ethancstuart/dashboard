export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const cookies = req.headers.get('cookie') || '';
  const sessionCookie = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith('session='));
  const sessionId = sessionCookie?.split('=')[1];

  // Delete session from KV if available
  if (sessionId) {
    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    if (kvUrl && kvToken) {
      try {
        await fetch(`${kvUrl}/del/session:${sessionId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${kvToken}` },
        });
      } catch {
        // Best-effort cleanup
      }
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/#/',
      'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  });
}
