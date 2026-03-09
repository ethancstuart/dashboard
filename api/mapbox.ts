import type { VercelRequest, VercelResponse } from '@vercel/node';

const CORS_ORIGIN = 'https://dashpulse.app';
function setCors(res: VercelResponse): VercelResponse {
  return res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
}

export const config = { runtime: 'nodejs' };

// Proxy Mapbox tile requests server-side so the token never reaches the client.
// Client requests: /api/mapbox?z=2&x=1&y=1
// Server fetches the tile from Mapbox with the secret token and pipes it back.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Mapbox token not configured' });
  }

  const z = req.query.z as string | undefined;
  const x = req.query.x as string | undefined;
  const y = req.query.y as string | undefined;

  if (!z || !x || !y) {
    // Return a flag that Mapbox is available (no token exposed)
    return res
      .setHeader('Cache-Control', 'max-age=3600')
      .json({ available: true });
  }

  // Validate tile coordinates are integers
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return res.status(400).json({ error: 'Invalid tile coordinates' });
  }

  const ALLOWED_STYLES = new Set(['dark-v11', 'navigation-night-v1', 'satellite-streets-v12']);
  const styleParam = req.query.style as string | undefined;
  const style = (styleParam && ALLOWED_STYLES.has(styleParam)) ? styleParam : 'navigation-night-v1';

  try {
    const tileUrl = `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/${z}/${x}/${y}@2x?access_token=${token}`;
    const tileRes = await fetch(tileUrl);

    if (!tileRes.ok) {
      return res.status(tileRes.status).end();
    }

    const contentType = tileRes.headers.get('content-type') || 'application/octet-stream';
    const arrayBuf = await tileRes.arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = (globalThis as any).Buffer.from(arrayBuf);

    return res
      .setHeader('Content-Type', contentType)
      .setHeader('Cache-Control', 'public, max-age=86400')
      .send(buf);
  } catch {
    return res.status(502).end();
  }
}
