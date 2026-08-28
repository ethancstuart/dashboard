import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { cronJitter, requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

// Direct upstream URLs — NOT self-referencing
const SNAPSHOT_SOURCES = [
  {
    id: 'earthquakes',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    extract: (data: Record<string, unknown>) => {
      const features = (data.features || []) as Array<{
        properties: { mag: number; place: string };
        geometry: { coordinates: number[] };
      }>;
      return features.slice(0, 200).map((f) => ({
        mag: f.properties.mag,
        place: f.properties.place,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      }));
    },
  },
  {
    id: 'disease-outbreaks',
    url: 'https://www.who.int/api/news/diseaseoutbreaknews?$top=20&$orderby=PublicationDate%20desc',
    extract: (data: Record<string, unknown>) => {
      const items = (data.value || []) as Array<{ Title: string; PublicationDate: string }>;
      return items.map((i) => ({ title: i.Title, date: i.PublicationDate }));
    },
  },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  await cronJitter(25);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  const sql = neon(dbUrl);
  let snapshots = 0;

  try {
    const results = await Promise.allSettled(
      SNAPSHOT_SOURCES.map(async (source) => {
        try {
          const response = await fetch(source.url, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) return null;
          const json = (await response.json()) as Record<string, unknown>;
          const data = source.extract(json);
          const count = data.length;
          if (count === 0) return null;

          await sql`
            INSERT INTO event_snapshots (layer_id, data, feature_count)
            VALUES (${source.id}, ${JSON.stringify(data)}, ${count})
          `;
          return { layer: source.id, count };
        } catch {
          return null;
        }
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) snapshots++;
    }

    // Prune snapshots older than 90 days
    await sql`DELETE FROM event_snapshots WHERE timestamp < NOW() - INTERVAL '90 days'`;

    return res.json({ success: true, snapshots, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Snapshot cron error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Snapshot failed' });
  }
}
