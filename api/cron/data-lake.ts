import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { cronJitter, requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Gold Layer Data Lake Cron — runs every 5 minutes.
 *
 * Pulls data from ALL upstream sources into Postgres for:
 * 1. Reliability — upstream API failures don't break the platform
 * 2. Performance — web app reads from our DB, not upstream
 * 3. History — we keep timestamped snapshots for timeline/replay
 * 4. Unblocking — GDELT/ACLED blocked from Vercel? Data still flows via cache.
 *
 * Tables: data_lake (layer_id, data JSONB, feature_count, fetched_at)
 */

interface DataSource {
  id: string;
  fetch: () => Promise<unknown[] | null>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  await cronJitter(15);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  const sql = neon(dbUrl);

  // Ensure table exists
  await sql`
    CREATE TABLE IF NOT EXISTS data_lake (
      id SERIAL PRIMARY KEY,
      layer_id TEXT NOT NULL,
      data JSONB NOT NULL,
      feature_count INTEGER DEFAULT 0,
      fetched_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_data_lake_layer ON data_lake (layer_id, fetched_at DESC)`;

  const sources: DataSource[] = [
    {
      id: 'earthquakes',
      fetch: async () => {
        const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', {
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) return null;
        const d = (await r.json()) as { features: Array<Record<string, unknown>> };
        return (d.features || []).slice(0, 500).map((f: Record<string, unknown>) => {
          const props = f.properties as Record<string, unknown>;
          const geom = f.geometry as { coordinates: number[] };
          return {
            mag: props.mag,
            place: props.place,
            time: props.time,
            lat: geom.coordinates[1],
            lon: geom.coordinates[0],
            depth: geom.coordinates[2],
          };
        });
      },
    },
    {
      id: 'fires',
      fetch: async () => {
        const key = process.env.NASA_FIRMS_KEY;
        const url = key
          ? `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/world/1`
          : 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv';
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return null;
        const text = await r.text();
        const lines = text.trim().split('\n');
        if (lines.length < 2) return null;
        const headers = lines[0].split(',');
        const latIdx = headers.indexOf('latitude');
        const lonIdx = headers.indexOf('longitude');
        const brIdx = headers.indexOf('brightness');
        const frpIdx = headers.indexOf('frp');
        return lines
          .slice(1, 1000)
          .map((line) => {
            const cols = line.split(',');
            return {
              lat: parseFloat(cols[latIdx]),
              lon: parseFloat(cols[lonIdx]),
              brightness: parseFloat(cols[brIdx]) || 0,
              frp: parseFloat(cols[frpIdx]) || 0,
            };
          })
          .filter((f) => !isNaN(f.lat) && !isNaN(f.lon));
      },
    },
    {
      id: 'disease-outbreaks',
      fetch: async () => {
        const r = await fetch(
          'https://www.who.int/api/news/diseaseoutbreaknews?$top=20&$orderby=PublicationDate%20desc',
          { signal: AbortSignal.timeout(10000) },
        );
        if (!r.ok) return null;
        const d = (await r.json()) as { value: Array<{ Title: string; PublicationDate: string }> };
        return (d.value || []).map((i) => ({ title: i.Title, date: i.PublicationDate }));
      },
    },
    {
      id: 'gdelt-news',
      fetch: async () => {
        try {
          const r = await fetch(
            'https://api.gdeltproject.org/api/v2/doc/doc?query=conflict%20OR%20crisis%20OR%20sanctions%20OR%20military&mode=artlist&maxrecords=20&timespan=1440min&format=json&sort=DateDesc',
            { signal: AbortSignal.timeout(10000) },
          );
          if (!r.ok) return null;
          const text = await r.text();
          if (text.startsWith('Please limit')) return null;
          const d = JSON.parse(text) as { articles?: Array<{ title: string; url: string; domain: string }> };
          return (d.articles || []).slice(0, 20).map((a) => ({
            title: a.title,
            url: a.url,
            source: a.domain,
          }));
        } catch {
          return null; // GDELT may be blocked — that's OK, we cache what we have
        }
      },
    },
    {
      id: 'launches',
      fetch: async () => {
        const r = await fetch('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10&mode=list', {
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) return null;
        const d = (await r.json()) as { results: Array<Record<string, unknown>> };
        return (d.results || []).map((l) => ({
          name: l.name,
          net: l.net,
          status: (l.status as Record<string, unknown>)?.name,
          provider: (l.launch_service_provider as Record<string, unknown>)?.name,
          pad: (l.pad as Record<string, unknown>)?.name,
          padLat: (l.pad as Record<string, unknown>)?.latitude,
          padLon: (l.pad as Record<string, unknown>)?.longitude,
        }));
      },
    },
    {
      id: 'gdacs-disasters',
      fetch: async () => {
        const r = await fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/ALL', {
          signal: AbortSignal.timeout(10000),
          headers: { Accept: 'application/json' },
        });
        if (!r.ok) return null;
        const d = (await r.json()) as { features?: Array<Record<string, unknown>> };
        return (d.features || []).slice(0, 50).map((f) => {
          const props = f.properties as Record<string, unknown>;
          const geom = f.geometry as { coordinates: number[] };
          return {
            type: props.eventtype,
            name: props.eventname || props.name,
            severity: props.alertlevel,
            lat: geom?.coordinates?.[1],
            lon: geom?.coordinates?.[0],
            date: props.fromdate,
          };
        });
      },
    },
    // === NEWS RSS FEEDS ===
    {
      id: 'news-global',
      fetch: async () => {
        const feeds = [
          { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World' },
          { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera' },
          { url: 'https://rss.dw.com/xml/rss-en-all', source: 'DW' },
          { url: 'https://www.bellingcat.com/feed/', source: 'Bellingcat' },
          { url: 'https://www.crisisgroup.org/rss.xml', source: 'Crisis Group' },
          { url: 'https://feeds.npr.org/1004/rss.xml', source: 'NPR World' },
          { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NYT World' },
          { url: 'https://feeds.washingtonpost.com/rss/world', source: 'Washington Post' },
        ];
        const allItems: Array<{ title: string; source: string; link: string; pubDate: string }> = [];
        const results = await Promise.allSettled(
          feeds.map(async (feed) => {
            const r = await fetch(feed.url, {
              signal: AbortSignal.timeout(6000),
              headers: { 'User-Agent': 'NexusWatch/1.0 Data Lake' },
            });
            if (!r.ok) return [];
            const xml = await r.text();
            return parseRssToItems(xml, feed.source);
          }),
        );
        for (const r of results) {
          if (r.status === 'fulfilled') allItems.push(...r.value);
        }
        // Deduplicate by title similarity
        const seen = new Set<string>();
        return allItems
          .filter((item) => {
            const key = item.title.toLowerCase().slice(0, 40);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 50);
      },
    },
    // === PUBLIC CCTV / WEBCAM FEEDS ===
    {
      id: 'live-cameras',
      fetch: async () => {
        // Curated list of public webcams at strategic locations
        // These are embed-safe public feeds — no authentication required
        return [
          // Ports & Chokepoints
          {
            name: 'Port of Rotterdam',
            type: 'port',
            lat: 51.95,
            lon: 4.13,
            url: 'https://www.portofrotterdam.com/en/port-forward/webcams',
            region: 'Europe',
          },
          {
            name: 'Suez Canal (Port Said)',
            type: 'port',
            lat: 31.26,
            lon: 32.31,
            url: 'https://www.suezcanal.gov.eg',
            region: 'Middle East',
          },
          {
            name: 'Panama Canal (Miraflores)',
            type: 'port',
            lat: 9.02,
            lon: -79.59,
            url: 'https://www.pancanal.com/eng/photo/camera-702.html',
            region: 'Americas',
          },
          {
            name: 'Port of Singapore',
            type: 'port',
            lat: 1.26,
            lon: 103.84,
            url: 'https://www.mpa.gov.sg',
            region: 'Asia',
          },
          {
            name: 'Port of Shanghai',
            type: 'port',
            lat: 31.35,
            lon: 121.6,
            url: 'https://www.portshanghai.com.cn',
            region: 'Asia',
          },
          // Capital Cities
          {
            name: 'Washington DC (Capitol)',
            type: 'city',
            lat: 38.89,
            lon: -77.01,
            url: 'https://www.earthcam.com/usa/dc/',
            region: 'Americas',
          },
          {
            name: 'London (Parliament)',
            type: 'city',
            lat: 51.5,
            lon: -0.12,
            url: 'https://www.earthcam.com/world/england/london/',
            region: 'Europe',
          },
          {
            name: 'Tokyo (Shibuya)',
            type: 'city',
            lat: 35.66,
            lon: 139.7,
            url: 'https://www.earthcam.com/world/japan/tokyo/',
            region: 'Asia',
          },
          {
            name: 'Moscow (Red Square)',
            type: 'city',
            lat: 55.75,
            lon: 37.62,
            url: 'https://www.earthcam.com/world/russia/moscow/',
            region: 'Europe',
          },
          {
            name: 'Dubai (Burj Khalifa)',
            type: 'city',
            lat: 25.2,
            lon: 55.27,
            url: 'https://www.earthcam.com/world/uae/dubai/',
            region: 'Middle East',
          },
          {
            name: 'New York (Times Square)',
            type: 'city',
            lat: 40.76,
            lon: -73.99,
            url: 'https://www.earthcam.com/usa/newyork/timessquare/',
            region: 'Americas',
          },
          {
            name: 'Jerusalem (Western Wall)',
            type: 'city',
            lat: 31.78,
            lon: 35.23,
            url: 'https://www.aish.com/w/ww/',
            region: 'Middle East',
          },
          // Conflict-adjacent
          {
            name: 'Kyiv (Maidan)',
            type: 'city',
            lat: 50.45,
            lon: 30.52,
            url: 'https://www.youtube.com/results?search_query=kyiv+live+cam',
            region: 'Europe',
          },
          {
            name: 'Istanbul (Bosphorus)',
            type: 'chokepoint',
            lat: 41.05,
            lon: 29.03,
            url: 'https://www.earthcam.com/world/turkey/istanbul/',
            region: 'Europe',
          },
          // Weather / Environment
          {
            name: 'ISS Live Earth View',
            type: 'space',
            lat: 0,
            lon: 0,
            url: 'https://eol.jsc.nasa.gov/ESRS/HDEV/',
            region: 'Space',
          },
          {
            name: 'Cape Canaveral (Launch Pad)',
            type: 'space',
            lat: 28.57,
            lon: -80.65,
            url: 'https://www.kennedyspacecenter.com/launches-and-events/events-calendar/see-a-rocket-launch',
            region: 'Americas',
          },
        ];
      },
    },
  ];

  // Fetch all in parallel
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      try {
        const data = await source.fetch();
        if (!data || data.length === 0) return { id: source.id, count: 0, status: 'empty' };

        // Upsert: keep latest + maintain history
        await sql`
        INSERT INTO data_lake (layer_id, data, feature_count)
        VALUES (${source.id}, ${JSON.stringify(data)}, ${data.length})
      `;

        return { id: source.id, count: data.length, status: 'ok' };
      } catch (err) {
        return { id: source.id, count: 0, status: `error: ${err instanceof Error ? err.message : 'unknown'}` };
      }
    }),
  );

  // Prune old data (keep 7 days)
  await sql`DELETE FROM data_lake WHERE fetched_at < NOW() - INTERVAL '7 days'`;

  const summary = results.map((r) => (r.status === 'fulfilled' ? r.value : { id: '?', count: 0, status: 'rejected' }));

  return res.json({
    fetched: summary.filter((s) => s.status === 'ok').length,
    total: sources.length,
    sources: summary,
  });
}

// Simple RSS XML parser — extracts title, link, pubDate from <item> elements
function parseRssToItems(
  xml: string,
  source: string,
): Array<{ title: string; source: string; link: string; pubDate: string }> {
  const items: Array<{ title: string; source: string; link: string; pubDate: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
    const item = match[1];
    const title = extractTag(item, 'title');
    const link = extractTag(item, 'link');
    const pubDate = extractTag(item, 'pubDate');
    if (title && title.length > 10) {
      items.push({ title, source, link, pubDate });
    }
  }
  return items;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = regex.exec(xml);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}
