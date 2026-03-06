import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs' };

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Mapbox token not configured' });
  }
  return res
    .setHeader('Cache-Control', 'max-age=3600')
    .json({ token });
}
