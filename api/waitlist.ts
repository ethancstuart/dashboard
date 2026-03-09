import { corsHeaders } from './_cors.ts';

export const config = { runtime: 'edge' };

// Simple in-memory rate limiter (per-instance, resets on cold start)
const recentSubmits = new Map<string, number>();

export default async function handler(req: Request) {
  if (req.method === 'GET') {
    // Return waitlist count (placeholder until KV is set up)
    return new Response(JSON.stringify({ count: 0 }), {
      headers: corsHeaders(),
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders(),
    });
  }

  try {
    const body = await req.json();
    const { name, email } = body as { name?: string; email?: string };

    if (!name || !email) {
      return new Response(JSON.stringify({ error: 'Name and email are required' }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    if (name.length > 100 || email.length > 254) {
      return new Response(JSON.stringify({ error: 'Input too long' }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    // Rate limit: 1 submit per email per 5 minutes
    const now = Date.now();
    const lastSubmit = recentSubmits.get(email);
    if (lastSubmit && now - lastSubmit < 300000) {
      return new Response(JSON.stringify({ error: 'Please wait before submitting again' }), {
        status: 429,
        headers: corsHeaders(),
      });
    }
    recentSubmits.set(email, now);

    // Try to store in Vercel KV if available
    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;

    if (kvUrl && kvToken) {
      try {
        await fetch(`${kvUrl}/set/waitlist:${encodeURIComponent(email)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name, email, joinedAt: new Date().toISOString() }),
        });
      } catch {
        // KV storage failed — still acknowledge the signup
      }
    }

    return new Response(
      JSON.stringify({ message: "You're on the list! We'll be in touch." }),
      { headers: corsHeaders() },
    );
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: corsHeaders(),
    });
  }
}
