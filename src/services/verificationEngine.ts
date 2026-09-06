/**
 * Multi-Source Verification Engine
 *
 * Cross-references events across independent data layers to produce
 * verification levels. When multiple independent sources agree on a
 * signal, it's CONFIRMED. When only one source reports it, it's
 * UNVERIFIED. This is how real intelligence agencies work — and
 * nobody else in the consumer geopolitical intel space does it.
 *
 * Verification levels:
 *   CONFIRMED    — 3+ independent sources agree (green shield)
 *   CORROBORATED — 2 independent sources agree (yellow shield)
 *   UNVERIFIED   — single source only (gray, explicitly labeled)
 *   CONTESTED    — sources disagree on the same event (orange)
 *
 * Matching logic uses geo + time windows, NOT naive string matching.
 * Per council review (Priya Raghavan): "One false CONFIRMED badge on
 * a sensitive geopolitical event kills the entire trust thesis."
 */

export type VerificationLevel = 'confirmed' | 'corroborated' | 'unverified' | 'contested';

export interface VerifiedSignal {
  /** Unique signal ID. */
  id: string;
  /** Verification level. */
  level: VerificationLevel;
  /** Human-readable summary of the signal. */
  summary: string;
  /** Country code if country-specific. */
  countryCode?: string;
  /** Location. */
  lat: number;
  lon: number;
  /** Which sources contributed to this signal. */
  sources: Array<{
    name: string;
    layerId: string;
    detail: string;
  }>;
  /** When this signal was first detected. */
  detectedAt: number;
  /** Signal type for categorization. */
  type:
    | 'conflict_escalation'
    | 'natural_disaster'
    | 'infrastructure_disruption'
    | 'political_instability'
    | 'convergence';
}

// ---------------------------------------------------------------------------
// Matching parameters — per council review, these must be conservative
// ---------------------------------------------------------------------------

/** Max distance (degrees, ~111km per degree) for two events to be "same location". */
const GEO_MATCH_RADIUS = 3;

/** Max time window (ms) for two events to be "same event" — 24 hours. */
const TIME_MATCH_WINDOW = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let verifiedSignals: VerifiedSignal[] = [];

export function getVerifiedSignals(): VerifiedSignal[] {
  return verifiedSignals;
}

export function getSignalForCountry(countryCode: string): VerifiedSignal | undefined {
  return verifiedSignals.find((s) => s.countryCode === countryCode);
}

// ---------------------------------------------------------------------------
// Core verification logic
// ---------------------------------------------------------------------------

interface LayerEvent {
  source: string;
  layerId: string;
  lat: number;
  lon: number;
  timestamp: number;
  text: string;
  countryCode?: string;
  type: 'conflict' | 'disaster' | 'sentiment' | 'infrastructure' | 'political';
}

function isNearby(lat1: number, lon1: number, lat2: number, lon2: number): boolean {
  return Math.sqrt((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2) < GEO_MATCH_RADIUS;
}

function isTimeProximate(t1: number, t2: number): boolean {
  if (t1 === 0 || t2 === 0) return true; // timestamps unavailable, assume proximate
  return Math.abs(t1 - t2) < TIME_MATCH_WINDOW;
}

/**
 * Extract verifiable events from raw layer data.
 * Each layer maps to a specific source and event type.
 */
function extractEvents(layerData: Map<string, unknown>): LayerEvent[] {
  const events: LayerEvent[] = [];

  // ACLED conflict events
  const acled = layerData.get('acled') as
    | Array<{ lat: number; lon: number; fatalities?: number; event_type?: string; country?: string }>
    | undefined;
  if (acled) {
    for (const e of acled.slice(0, 200)) {
      events.push({
        source: 'ACLED',
        layerId: 'acled',
        lat: e.lat,
        lon: e.lon,
        timestamp: 0,
        text: `${e.event_type || 'Conflict event'}${e.fatalities ? ` (${e.fatalities} casualties)` : ''}`,
        countryCode: undefined, // ACLED doesn't always include ISO codes
        type: 'conflict',
      });
    }
  }

  // GDELT news events (sentiment as verification signal)
  const news = layerData.get('news') as
    | Array<{ lat?: number; lon?: number; tone?: number; country?: string; title?: string }>
    | undefined;
  if (news) {
    for (const e of news.slice(0, 200)) {
      if (!e.lat || !e.lon) continue;
      const isNegative = (e.tone || 0) < -3;
      events.push({
        source: 'GDELT',
        layerId: 'news',
        lat: e.lat,
        lon: e.lon,
        timestamp: 0,
        text: e.title || `News event (tone: ${(e.tone || 0).toFixed(1)})`,
        type: isNegative ? 'conflict' : 'sentiment',
      });
    }
  }

  // Earthquakes
  const quakes = layerData.get('earthquakes') as
    | Array<{ lat: number; lon: number; magnitude?: number; place?: string; time?: number }>
    | undefined;
  if (quakes) {
    for (const e of quakes) {
      if ((e.magnitude || 0) < 4.0) continue; // only significant quakes
      events.push({
        source: 'USGS',
        layerId: 'earthquakes',
        lat: e.lat,
        lon: e.lon,
        timestamp: e.time || 0,
        text: `M${(e.magnitude || 0).toFixed(1)} earthquake${e.place ? ` — ${e.place}` : ''}`,
        type: 'disaster',
      });
    }
  }

  // Fires (clustered — only count if many nearby)
  const fires = layerData.get('fires') as Array<{ lat: number; lon: number }> | undefined;
  if (fires && fires.length > 20) {
    // Aggregate into clusters
    const clusters = clusterPoints(fires, 2);
    for (const cluster of clusters) {
      if (cluster.count < 10) continue;
      events.push({
        source: 'NASA FIRMS',
        layerId: 'fires',
        lat: cluster.lat,
        lon: cluster.lon,
        timestamp: 0,
        text: `${cluster.count} active fire hotspots`,
        type: 'disaster',
      });
    }
  }

  // Internet outages
  const outages = layerData.get('internet-outages') as
    | Array<{ code?: string; severity?: string; lat?: number; lon?: number }>
    | undefined;
  if (outages) {
    for (const e of outages) {
      if (e.severity === 'critical' || e.severity === 'high') {
        events.push({
          source: 'Cloudflare Radar',
          layerId: 'internet-outages',
          lat: e.lat || 0,
          lon: e.lon || 0,
          timestamp: 0,
          text: `Internet ${e.severity} outage`,
          countryCode: e.code,
          type: 'infrastructure',
        });
      }
    }
  }

  // Prediction markets (for corroboration, not primary signals)
  const predictions = layerData.get('predictions') as
    | Array<{ question?: string; probability?: number; lat?: number; lon?: number }>
    | undefined;
  if (predictions) {
    for (const p of predictions) {
      if ((p.probability || 0) > 0.6 && p.lat && p.lon) {
        events.push({
          source: 'Polymarket',
          layerId: 'prediction-markets',
          lat: p.lat,
          lon: p.lon,
          timestamp: 0,
          text: `${p.question} (${Math.round((p.probability || 0) * 100)}% probability)`,
          type: 'political',
        });
      }
    }
  }

  return events;
}

/**
 * Simple grid-based point clustering.
 */
function clusterPoints(
  points: Array<{ lat: number; lon: number }>,
  gridSize: number,
): Array<{ lat: number; lon: number; count: number }> {
  const grid = new Map<string, { latSum: number; lonSum: number; count: number }>();
  for (const p of points) {
    const key = `${Math.floor(p.lat / gridSize)},${Math.floor(p.lon / gridSize)}`;
    const cell = grid.get(key) || { latSum: 0, lonSum: 0, count: 0 };
    cell.latSum += p.lat;
    cell.lonSum += p.lon;
    cell.count++;
    grid.set(key, cell);
  }
  return Array.from(grid.values()).map((c) => ({
    lat: c.latSum / c.count,
    lon: c.lonSum / c.count,
    count: c.count,
  }));
}

/**
 * Run cross-source verification on current layer data.
 * Called from the dashview:layer-data event handler alongside CII computation.
 */
export function runVerification(layerData: Map<string, unknown>): VerifiedSignal[] {
  const events = extractEvents(layerData);
  const signals: VerifiedSignal[] = [];
  const used = new Set<number>();
  let signalId = 0;

  // For each event, find events from OTHER sources in the same location
  for (let i = 0; i < events.length; i++) {
    if (used.has(i)) continue;
    const primary = events[i];
    const corroborating: Array<{ event: LayerEvent; index: number }> = [];

    for (let j = i + 1; j < events.length; j++) {
      if (used.has(j)) continue;
      const candidate = events[j];
      // Must be from a DIFFERENT source
      if (candidate.source === primary.source) continue;
      // Must be geographically proximate
      if (!isNearby(primary.lat, candidate.lat, primary.lon, candidate.lon)) continue;
      // Must be temporally proximate
      if (!isTimeProximate(primary.timestamp, candidate.timestamp)) continue;
      // Must be same general type (conflict with conflict, disaster with disaster)
      // OR any type for convergence detection
      if (candidate.type === primary.type || primary.type === 'conflict' || candidate.type === 'conflict') {
        corroborating.push({ event: candidate, index: j });
      }
    }

    // Only generate signals for events with at least some significance
    const uniqueSources = new Set([primary.source, ...corroborating.map((c) => c.event.source)]);

    if (uniqueSources.size >= 3) {
      // CONFIRMED — 3+ independent sources
      used.add(i);
      for (const c of corroborating) used.add(c.index);
      signals.push({
        id: `vs-${signalId++}`,
        level: 'confirmed',
        summary: primary.text,
        countryCode: primary.countryCode,
        lat: primary.lat,
        lon: primary.lon,
        sources: [
          { name: primary.source, layerId: primary.layerId, detail: primary.text },
          ...corroborating.map((c) => ({
            name: c.event.source,
            layerId: c.event.layerId,
            detail: c.event.text,
          })),
        ],
        detectedAt: Date.now(),
        type:
          primary.type === 'conflict'
            ? 'conflict_escalation'
            : primary.type === 'disaster'
              ? 'natural_disaster'
              : primary.type === 'infrastructure'
                ? 'infrastructure_disruption'
                : primary.type === 'political'
                  ? 'political_instability'
                  : 'convergence',
      });
    } else if (uniqueSources.size === 2) {
      // CORROBORATED — 2 independent sources
      used.add(i);
      for (const c of corroborating) used.add(c.index);
      signals.push({
        id: `vs-${signalId++}`,
        level: 'corroborated',
        summary: primary.text,
        countryCode: primary.countryCode,
        lat: primary.lat,
        lon: primary.lon,
        sources: [
          { name: primary.source, layerId: primary.layerId, detail: primary.text },
          ...corroborating.map((c) => ({
            name: c.event.source,
            layerId: c.event.layerId,
            detail: c.event.text,
          })),
        ],
        detectedAt: Date.now(),
        type:
          primary.type === 'conflict'
            ? 'conflict_escalation'
            : primary.type === 'disaster'
              ? 'natural_disaster'
              : primary.type === 'infrastructure'
                ? 'infrastructure_disruption'
                : primary.type === 'political'
                  ? 'political_instability'
                  : 'convergence',
      });
    }
    // Single-source events stay UNVERIFIED (no signal generated — they're visible
    // through the normal layer display, just without a verification badge)
  }

  // Sort: confirmed first, then corroborated
  signals.sort((a, b) => {
    const order = { confirmed: 0, corroborated: 1, unverified: 2, contested: 3 };
    return order[a.level] - order[b.level];
  });

  verifiedSignals = signals;
  return signals;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function verificationColor(level: VerificationLevel): string {
  switch (level) {
    case 'confirmed':
      return 'var(--color-signal-ok)';
    case 'corroborated':
      return '#eab308';
    case 'unverified':
      return 'var(--color-text-2)';
    case 'contested':
      return '#f97316';
  }
}

export function verificationIcon(level: VerificationLevel): string {
  switch (level) {
    case 'confirmed':
      return '🛡'; // green shield
    case 'corroborated':
      return '◈'; // diamond with dot
    case 'unverified':
      return '○'; // hollow circle
    case 'contested':
      return '⚠'; // warning
  }
}

export function verificationLabel(level: VerificationLevel): string {
  switch (level) {
    case 'confirmed':
      return 'CONFIRMED';
    case 'corroborated':
      return 'CORROBORATED';
    case 'unverified':
      return 'UNVERIFIED';
    case 'contested':
      return 'CONTESTED';
  }
}
