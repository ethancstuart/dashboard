import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { requireCron } from '../_cron-utils.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

/**
 * X Alert Cron — runs every 30 minutes.
 * Checks thresholds against live data, posts alert tweets via Buffer.
 *
 * Thresholds:
 * - CII change ≥5 points in 24h for any country
 * - CII crosses 70 (critical threshold)
 * - M6.0+ earthquake anywhere
 * - M5.0+ earthquake within 200km of critical infrastructure
 * - Oil price moves ≥5% in a day
 * - 3+ countries cross CII 50 in the same 24-hour window
 * - Critical correlation detected
 *
 * Rate limits: max 3 alerts/day, minimum 2hr between posts.
 */

const CRITICAL_INFRA: { name: string; lat: number; lon: number }[] = [
  { name: 'Zaporizhzhia NPP', lat: 47.51, lon: 34.58 },
  { name: 'Bushehr NPP', lat: 28.83, lon: 50.89 },
  { name: 'Fukushima Daiichi', lat: 37.42, lon: 141.03 },
  { name: 'Strait of Hormuz', lat: 26.56, lon: 56.25 },
  { name: 'Bab el-Mandeb', lat: 12.58, lon: 43.33 },
  { name: 'Suez Canal', lat: 30.46, lon: 32.34 },
  { name: 'Taiwan Strait', lat: 24.0, lon: 119.0 },
  { name: 'Ras Tanura Terminal', lat: 26.64, lon: 50.15 },
];

const MAX_ALERTS_PER_DAY = 3;
const MIN_HOURS_BETWEEN = 2;

interface AlertPayload {
  type: string;
  headline: string;
  detail: string;
  priority: number; // lower = more urgent
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const dbUrl = process.env.DATABASE_URL;
  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  if (!bufferToken) return res.json({ skipped: true, reason: 'Buffer not configured' });

  try {
    const sql = neon(dbUrl);

    // Ensure alert log table exists
    await sql`
      CREATE TABLE IF NOT EXISTS x_alert_log (
        id SERIAL PRIMARY KEY,
        alert_type TEXT NOT NULL,
        alert_key TEXT NOT NULL UNIQUE,
        tweet_text TEXT,
        posted_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Check rate limits
    const todayAlerts = await sql`
      SELECT COUNT(*) as cnt FROM x_alert_log
      WHERE posted_at > NOW() - INTERVAL '24 hours'
    `;
    const alertCount = Number(todayAlerts[0]?.cnt || 0);
    if (alertCount >= MAX_ALERTS_PER_DAY) {
      return res.json({ skipped: true, reason: `Daily limit reached (${alertCount}/${MAX_ALERTS_PER_DAY})` });
    }

    const lastAlert = await sql`
      SELECT posted_at FROM x_alert_log
      ORDER BY posted_at DESC LIMIT 1
    `;
    if (lastAlert.length > 0) {
      const hoursSince = (Date.now() - new Date(lastAlert[0].posted_at as string).getTime()) / 3600000;
      if (hoursSince < MIN_HOURS_BETWEEN) {
        return res.json({
          skipped: true,
          reason: `Too soon (${hoursSince.toFixed(1)}h since last, need ${MIN_HOURS_BETWEEN}h)`,
        });
      }
    }

    // === Check all thresholds in parallel ===
    const alerts: AlertPayload[] = [];

    const [ciiResult, prevCiiResult, quakeResult, marketResult] = await Promise.allSettled([
      // Current CII
      sql`
        SELECT DISTINCT ON (country_code) country_code, country_name, score
        FROM country_cii_history ORDER BY country_code, timestamp DESC
      `,
      // CII from ~24h ago
      sql`
        SELECT DISTINCT ON (country_code) country_code, country_name, score
        FROM country_cii_history
        WHERE timestamp < NOW() - INTERVAL '20 hours'
        ORDER BY country_code, timestamp DESC
      `,
      // Recent earthquakes
      fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', {
        signal: AbortSignal.timeout(8000),
      }).then((r) => (r.ok ? r.json() : null)),
      // Market data
      (async () => {
        const apiKey = process.env.TWELVEDATA_API_KEY;
        if (!apiKey) return null;
        const r = await fetch(`https://api.twelvedata.com/quote?symbol=USO&apikey=${apiKey}`, {
          signal: AbortSignal.timeout(8000),
        });
        return r.ok ? r.json() : null;
      })(),
    ]);

    // --- CII Threshold Checks ---
    if (ciiResult.status === 'fulfilled' && prevCiiResult.status === 'fulfilled') {
      const current = ciiResult.value as Array<Record<string, unknown>>;
      const previous = prevCiiResult.value as Array<Record<string, unknown>>;
      const prevMap = new Map(previous.map((r) => [r.country_code as string, r.score as number]));

      // CII crosses 70 (critical)
      for (const row of current) {
        const score = row.score as number;
        const prevScore = prevMap.get(row.country_code as string);
        const name = row.country_name as string;

        if (score >= 70 && prevScore !== undefined && prevScore < 70) {
          alerts.push({
            type: 'cii-critical',
            headline: `${name} crosses critical CII threshold`,
            detail: `CII: ${prevScore} → ${score}/100. Elevated instability across multiple domains.`,
            priority: 0,
          });
        }

        // CII change ≥5 in 24h
        if (prevScore !== undefined && Math.abs(score - prevScore) >= 5) {
          const direction = score > prevScore ? '↑' : '↓';
          const change = Math.abs(score - prevScore).toFixed(0);
          alerts.push({
            type: 'cii-swing',
            headline: `${name} CII ${direction}${change} in 24h`,
            detail: `CII: ${prevScore} → ${score}/100.`,
            priority: 1,
          });
        }
      }

      // 3+ countries cross CII 50 in same 24h window
      const newAbove50 = current.filter((r) => {
        const score = r.score as number;
        const prev = prevMap.get(r.country_code as string);
        return score >= 50 && prev !== undefined && prev < 50;
      });
      if (newAbove50.length >= 3) {
        alerts.push({
          type: 'cii-multi',
          headline: `${newAbove50.length} countries crossed CII 50 in 24h`,
          detail: newAbove50.map((r) => `${r.country_name} (${r.score})`).join(', '),
          priority: 0,
        });
      }
    }

    // --- Earthquake Checks ---
    if (quakeResult.status === 'fulfilled' && quakeResult.value) {
      const qData = quakeResult.value as {
        features: Array<{
          properties: { mag: number; place: string };
          geometry: { coordinates: [number, number, number] };
        }>;
      };

      for (const f of qData.features || []) {
        const mag = f.properties.mag;
        const [lon, lat] = f.geometry.coordinates;

        // M6.0+ anywhere
        if (mag >= 6.0) {
          alerts.push({
            type: 'earthquake-major',
            headline: `M${mag.toFixed(1)} earthquake — ${f.properties.place}`,
            detail: `Major seismic event. Monitoring for infrastructure impact and aftershocks.`,
            priority: 0,
          });
        }

        // M5.0+ near critical infrastructure
        if (mag >= 5.0) {
          for (const infra of CRITICAL_INFRA) {
            const dist = haversineKm(lat, lon, infra.lat, infra.lon);
            if (dist < 200) {
              alerts.push({
                type: 'earthquake-infra',
                headline: `M${mag.toFixed(1)} earthquake ${Math.round(dist)}km from ${infra.name}`,
                detail: `${f.properties.place}. Critical infrastructure proximity alert.`,
                priority: 0,
              });
            }
          }
        }
      }
    }

    // --- Oil Price Check ---
    if (marketResult.status === 'fulfilled' && marketResult.value) {
      const mData = marketResult.value as { USO?: { percent_change?: string } };
      const oilChange = parseFloat(mData.USO?.percent_change || '0');
      if (Math.abs(oilChange) >= 5) {
        const direction = oilChange > 0 ? 'surges' : 'crashes';
        alerts.push({
          type: 'oil-move',
          headline: `Oil ${direction} ${Math.abs(oilChange).toFixed(1)}%`,
          detail: `USO ${oilChange > 0 ? '+' : ''}${oilChange.toFixed(1)}%. Monitor energy chokepoints and OPEC response.`,
          priority: 1,
        });
      }
    }

    if (alerts.length === 0) {
      return res.json({ alerts: 0, message: 'No thresholds breached' });
    }

    // Sort by priority (most urgent first)
    alerts.sort((a, b) => a.priority - b.priority);

    // Take the most urgent alert that hasn't been posted yet
    const postedKeys = await sql`
      SELECT alert_key FROM x_alert_log
      WHERE posted_at > NOW() - INTERVAL '24 hours'
    `;
    const postedSet = new Set(postedKeys.map((r) => r.alert_key as string));

    const alertToPost = alerts.find((a) => {
      const key = `${a.type}:${a.headline}`;
      return !postedSet.has(key);
    });

    if (!alertToPost) {
      return res.json({ alerts: alerts.length, posted: 0, reason: 'All alerts already posted' });
    }

    // Format tweet
    const tweetText = [
      `🚨 NexusWatch Alert\n`,
      `${alertToPost.headline}\n`,
      `${alertToPost.detail}\n`,
      `Track live → nexuswatch.dev`,
      `\nSubscribe → brief.nexuswatch.dev`,
    ]
      .join('\n')
      .slice(0, 280);

    // Post via Buffer GraphQL — hardcoded NexusWatchDev channel ID
    const bufferChannelId = '69d95485031bfa423cee6b71';
    const postRes = await fetch('https://api.buffer.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bufferToken}`,
      },
      body: JSON.stringify({
        query: `mutation CreatePost($text: String!, $channelId: ChannelId!) {
          createPost(input: {
            text: $text,
            channelId: $channelId,
            schedulingType: automatic,
            mode: addToQueue,
            attachment: false
          }) {
            ... on PostActionSuccess { post { id } }
            ... on MutationError { message }
          }
        }`,
        variables: {
          text: tweetText,
          channelId: bufferChannelId,
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    const postData = (await postRes.json()) as Record<string, unknown>;

    // Log the alert
    const alertKey = `${alertToPost.type}:${alertToPost.headline}`;
    await sql`
      INSERT INTO x_alert_log (alert_type, alert_key, tweet_text)
      VALUES (${alertToPost.type}, ${alertKey}, ${tweetText})
      ON CONFLICT (alert_key) DO NOTHING
    `;

    return res.json({
      alerts: alerts.length,
      posted: 1,
      alert: alertToPost.headline,
      buffer: postData,
    });
  } catch (err) {
    console.error('Alert cron error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Alert check failed' });
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
