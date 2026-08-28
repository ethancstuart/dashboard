import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

/**
 * Dark Vessel Detection Cron — runs every 15 minutes.
 *
 * Detects vessels that:
 * 1. Were broadcasting AIS regularly (seen in last snapshot)
 * 2. Are NOT in the current snapshot (went dark)
 * 3. Last known position was near a sensitive area
 *
 * Stores gap events in vessel_gaps table for map rendering and alerts.
 */

// Sensitive areas: chokepoints, sanctioned waters, conflict zones
const SENSITIVE_AREAS: { name: string; lat: number; lon: number; radiusKm: number }[] = [
  { name: 'Strait of Hormuz', lat: 26.56, lon: 56.25, radiusKm: 150 },
  { name: 'Bab el-Mandeb', lat: 12.58, lon: 43.33, radiusKm: 100 },
  { name: 'Suez Canal', lat: 30.46, lon: 32.34, radiusKm: 80 },
  { name: 'Malacca Strait', lat: 2.5, lon: 101.8, radiusKm: 120 },
  { name: 'Taiwan Strait', lat: 24.0, lon: 119.0, radiusKm: 100 },
  { name: 'South China Sea', lat: 15.0, lon: 114.0, radiusKm: 300 },
  { name: 'Persian Gulf', lat: 27.0, lon: 51.0, radiusKm: 200 },
  { name: 'Red Sea', lat: 20.0, lon: 38.0, radiusKm: 200 },
  { name: 'Black Sea', lat: 43.5, lon: 34.0, radiusKm: 250 },
  { name: 'Sea of Japan', lat: 40.0, lon: 135.0, radiusKm: 200 },
  { name: 'Panama Canal', lat: 9.08, lon: -79.68, radiusKm: 50 },
  { name: 'North Korean Waters', lat: 39.0, lon: 127.5, radiusKm: 150 },
  { name: 'Iranian Waters', lat: 27.0, lon: 55.0, radiusKm: 200 },
  { name: 'Libyan Coast', lat: 32.5, lon: 15.0, radiusKm: 150 },
  { name: 'Venezuelan Waters', lat: 11.0, lon: -66.0, radiusKm: 150 },
];

// Only track cargo/tanker types (not recreational/fishing)
const TRACKED_TYPES = new Set(['cargo', 'tanker', 'military']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  try {
    const sql = neon(dbUrl);

    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS vessel_positions (
        mmsi TEXT PRIMARY KEY,
        name TEXT,
        vessel_type TEXT,
        lat DOUBLE PRECISION,
        lon DOUBLE PRECISION,
        speed DOUBLE PRECISION,
        last_seen TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS vessel_gaps (
        id SERIAL PRIMARY KEY,
        mmsi TEXT NOT NULL,
        vessel_name TEXT,
        vessel_type TEXT,
        last_lat DOUBLE PRECISION,
        last_lon DOUBLE PRECISION,
        gap_start TIMESTAMP NOT NULL,
        gap_end TIMESTAMP,
        duration_minutes INTEGER,
        near_sensitive BOOLEAN DEFAULT FALSE,
        sensitive_area TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Fetch current vessel positions from the ships API snapshot
    // Use the most recent event_snapshots if available, or fetch live
    let currentVessels: Array<{ mmsi: string; name: string; type: string; lat: number; lon: number; speed: number }> =
      [];

    try {
      // Try to get from internal API
      const shipRes = await fetch(`https://${process.env.VERCEL_URL || 'nexuswatch.dev'}/api/ships`, {
        signal: AbortSignal.timeout(10000),
      });
      if (shipRes.ok) {
        const shipData = (await shipRes.json()) as {
          vessels: Array<{ mmsi: string; name: string; type: string; lat: number; lon: number; speed: number }>;
        };
        currentVessels = shipData.vessels || [];
      }
    } catch {
      // Ships API unavailable — skip this cycle
      return res.json({ skipped: true, reason: 'Ships API unavailable' });
    }

    if (currentVessels.length === 0) {
      return res.json({ skipped: true, reason: 'No vessel data available' });
    }

    // Get previously known positions
    const previousPositions = await sql`
      SELECT mmsi, name, vessel_type, lat, lon, last_seen
      FROM vessel_positions
      WHERE last_seen > NOW() - INTERVAL '2 hours'
    `;

    const prevMap = new Map(
      (previousPositions as Array<Record<string, unknown>>).map((p) => [
        p.mmsi as string,
        {
          name: p.name as string,
          type: p.vessel_type as string,
          lat: p.lat as number,
          lon: p.lon as number,
          lastSeen: new Date(p.last_seen as string),
        },
      ]),
    );

    // Update current positions
    const currentMmsiSet = new Set<string>();
    for (const v of currentVessels) {
      if (!TRACKED_TYPES.has(v.type)) continue;
      currentMmsiSet.add(v.mmsi);
      await sql`
        INSERT INTO vessel_positions (mmsi, name, vessel_type, lat, lon, speed, last_seen)
        VALUES (${v.mmsi}, ${v.name}, ${v.type}, ${v.lat}, ${v.lon}, ${v.speed}, NOW())
        ON CONFLICT (mmsi) DO UPDATE SET
          name = ${v.name}, vessel_type = ${v.type},
          lat = ${v.lat}, lon = ${v.lon}, speed = ${v.speed}, last_seen = NOW()
      `;
    }

    // Detect dark vessels: were in previous snapshot, not in current, near sensitive area
    let darkCount = 0;
    for (const [mmsi, prev] of prevMap) {
      if (currentMmsiSet.has(mmsi)) continue; // Still broadcasting
      if (!TRACKED_TYPES.has(prev.type)) continue;

      // Check if last known position is near a sensitive area
      let nearestSensitive: string | null = null;
      for (const area of SENSITIVE_AREAS) {
        const dist = haversineKm(prev.lat, prev.lon, area.lat, area.lon);
        if (dist < area.radiusKm) {
          nearestSensitive = area.name;
          break;
        }
      }

      if (!nearestSensitive) continue; // Not near sensitive area — not interesting

      // Calculate gap duration
      const gapMinutes = Math.round((Date.now() - prev.lastSeen.getTime()) / 60000);
      if (gapMinutes < 30) continue; // Must be dark for at least 30 minutes

      // Check if we already logged this gap
      const existing = await sql`
        SELECT id FROM vessel_gaps
        WHERE mmsi = ${mmsi} AND gap_end IS NULL
        LIMIT 1
      `;

      if (existing.length === 0) {
        // New dark vessel event
        await sql`
          INSERT INTO vessel_gaps (mmsi, vessel_name, vessel_type, last_lat, last_lon, gap_start, duration_minutes, near_sensitive, sensitive_area)
          VALUES (${mmsi}, ${prev.name}, ${prev.type}, ${prev.lat}, ${prev.lon}, ${prev.lastSeen.toISOString()}, ${gapMinutes}, TRUE, ${nearestSensitive})
        `;
        darkCount++;
      } else {
        // Update duration
        await sql`
          UPDATE vessel_gaps
          SET duration_minutes = ${gapMinutes}
          WHERE mmsi = ${mmsi} AND gap_end IS NULL
        `;
      }
    }

    // Close gaps for vessels that reappeared
    for (const mmsi of currentMmsiSet) {
      await sql`
        UPDATE vessel_gaps
        SET gap_end = NOW(), duration_minutes = EXTRACT(EPOCH FROM (NOW() - gap_start)) / 60
        WHERE mmsi = ${mmsi} AND gap_end IS NULL
      `;
    }

    // Prune old data
    await sql`DELETE FROM vessel_positions WHERE last_seen < NOW() - INTERVAL '24 hours'`;
    await sql`DELETE FROM vessel_gaps WHERE created_at < NOW() - INTERVAL '30 days'`;

    return res.json({
      processed: currentVessels.length,
      previousTracked: prevMap.size,
      newDarkVessels: darkCount,
      activeGaps: (await sql`SELECT COUNT(*) as cnt FROM vessel_gaps WHERE gap_end IS NULL`)[0]?.cnt || 0,
    });
  } catch (err) {
    console.error('Dark vessel cron error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Dark vessel detection failed' });
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
