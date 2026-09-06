/**
 * Intelligence Confidence Scoring & Evidence Chain System
 *
 * Every CII score decomposes to its contributing data points. Click 72 →
 * see the 14 ACLED events, 2 USGS quakes, and 23 GDELT articles that
 * computed it. Plus explicit disclosure of data gaps.
 *
 * This is the core differentiator: NexusWatch is the only platform
 * where every number has a receipt.
 *
 * Confidence levels:
 *   HIGH   — 3+ sources contributing, all live/recent, 10+ data points
 *   MEDIUM — 2+ sources OR some stale data, 3+ data points
 *   LOW    — single source OR stale/offline, <3 data points
 *
 * Components using static data only (marketExposure) are always MEDIUM
 * with an explicit "static baseline" tag in their gaps disclosure.
 */

import { getProvenance, computeFreshness, type Freshness } from './dataProvenance.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type CIIComponentName =
  | 'conflict'
  | 'disasters'
  | 'sentiment'
  | 'infrastructure'
  | 'governance'
  | 'marketExposure';

/** A single data point that contributed to a CII component score. */
export interface EvidenceDataPoint {
  text: string; // "M5.2 earthquake near Kyiv"
  lat: number;
  lon: number;
  timestamp: number; // epoch ms, 0 if unavailable
  source: string; // "USGS", "ACLED", etc.
}

/** Source-level attribution for a CII component. */
export interface EvidenceSource {
  name: string; // "ACLED", "USGS", "GDELT", etc.
  layerId: string; // matches SOURCE_REGISTRY key
  dataPointCount: number; // events from this source that matched
  freshness: Freshness; // from dataProvenance
  lastFetched: number; // epoch ms
}

/** Full evidence chain for a single CII component. */
export interface CIIEvidence {
  component: CIIComponentName;
  score: number; // the component score (0-20 or 0-15)
  maxScore: number; // weight ceiling (20 or 15)
  confidence: ConfidenceLevel;
  sourceCount: number;
  sources: EvidenceSource[];
  dataPoints: EvidenceDataPoint[];
  /** Explicit data gaps — what we DON'T have. */
  gaps: string[];
  /** Whether this component uses a static baseline (e.g., marketExposure). */
  usesBaseline: boolean;
}

/** Aggregated evidence for an entire country's CII score. */
export interface CIIEvidenceChain {
  countryCode: string;
  overallConfidence: ConfidenceLevel;
  components: CIIEvidence[];
  /** Total unique sources across all components. */
  totalSourceCount: number;
  /** Total data points across all components. */
  totalDataPoints: number;
  /** Summary gaps (deduplicated from all components). */
  summaryGaps: string[];
}

// ---------------------------------------------------------------------------
// Evidence Builder
// ---------------------------------------------------------------------------

/**
 * Builder pattern for collecting evidence during CII computation.
 * Created per-country, collects data points and sources as each
 * component is computed, then produces the final evidence chain.
 */
export class EvidenceBuilder {
  private components: Map<
    CIIComponentName,
    {
      score: number;
      maxScore: number;
      sources: EvidenceSource[];
      dataPoints: EvidenceDataPoint[];
      gaps: string[];
      usesBaseline: boolean;
    }
  > = new Map();

  /** Initialize a component evidence slot. */
  startComponent(name: CIIComponentName, maxScore: number): void {
    this.components.set(name, {
      score: 0,
      maxScore,
      sources: [],
      dataPoints: [],
      gaps: [],
      usesBaseline: false,
    });
  }

  /** Set the final score for a component. */
  setScore(name: CIIComponentName, score: number): void {
    const c = this.components.get(name);
    if (c) c.score = score;
  }

  /** Mark a component as using a static baseline. */
  markBaseline(name: CIIComponentName, reason: string): void {
    const c = this.components.get(name);
    if (c) {
      c.usesBaseline = true;
      c.gaps.push(reason);
    }
  }

  /** Record data points from a specific source layer. */
  addSource(component: CIIComponentName, layerId: string, sourceName: string, dataPoints: EvidenceDataPoint[]): void {
    const c = this.components.get(component);
    if (!c) return;

    // Source-level provenance
    const prov = getProvenance(layerId);
    const freshness: Freshness = prov ? computeFreshness(prov) : 'offline';
    const lastFetched = prov?.fetchedAt ?? 0;

    c.sources.push({
      name: sourceName,
      layerId,
      dataPointCount: dataPoints.length,
      freshness,
      lastFetched,
    });

    c.dataPoints.push(...dataPoints);
  }

  /** Record a data gap for a component. */
  addGap(component: CIIComponentName, gap: string): void {
    const c = this.components.get(component);
    if (c) c.gaps.push(gap);
  }

  /** Produce the final evidence chain. */
  build(countryCode: string): CIIEvidenceChain {
    const componentEvidence: CIIEvidence[] = [];
    const totalSources = new Set<string>();
    let totalDataPoints = 0;
    const allGaps: string[] = [];

    for (const [name, data] of this.components) {
      const confidence = computeComponentConfidence(data);
      componentEvidence.push({
        component: name,
        score: Math.round(data.score * 10) / 10,
        maxScore: data.maxScore,
        confidence,
        sourceCount: data.sources.length,
        sources: data.sources,
        dataPoints: data.dataPoints.slice(0, 10), // cap at 10 per component
        gaps: data.gaps,
        usesBaseline: data.usesBaseline,
      });

      for (const s of data.sources) totalSources.add(s.name);
      totalDataPoints += data.dataPoints.length;
      allGaps.push(...data.gaps);
    }

    const overallConfidence = computeOverallConfidence(componentEvidence);

    return {
      countryCode,
      overallConfidence,
      components: componentEvidence,
      totalSourceCount: totalSources.size,
      totalDataPoints,
      summaryGaps: [...new Set(allGaps)],
    };
  }
}

// ---------------------------------------------------------------------------
// Confidence Computation
// ---------------------------------------------------------------------------

function computeComponentConfidence(data: {
  sources: EvidenceSource[];
  dataPoints: EvidenceDataPoint[];
  usesBaseline: boolean;
}): ConfidenceLevel {
  // Static baseline components are always MEDIUM
  if (data.usesBaseline && data.sources.length === 0) return 'medium';

  const liveOrRecent = data.sources.filter((s) => s.freshness === 'live' || s.freshness === 'recent');
  const sourceCount = data.sources.length;
  const pointCount = data.dataPoints.length;

  // HIGH: 3+ sources, all live/recent, 10+ data points
  if (sourceCount >= 3 && liveOrRecent.length === sourceCount && pointCount >= 10) {
    return 'high';
  }

  // HIGH: 2+ sources, all live/recent, 5+ data points (slightly relaxed)
  if (sourceCount >= 2 && liveOrRecent.length === sourceCount && pointCount >= 5) {
    return 'high';
  }

  // MEDIUM: 2+ sources OR 3+ data points
  if (sourceCount >= 2 || pointCount >= 3) {
    return 'medium';
  }

  // LOW: everything else
  return 'low';
}

function computeOverallConfidence(components: CIIEvidence[]): ConfidenceLevel {
  if (components.length === 0) return 'low';

  const counts = { high: 0, medium: 0, low: 0 };
  for (const c of components) counts[c.confidence]++;

  // Overall HIGH: majority of components are HIGH, none LOW
  if (counts.high >= 4 && counts.low === 0) return 'high';

  // Overall LOW: majority LOW or 3+ LOW
  if (counts.low >= 3) return 'low';

  // Otherwise MEDIUM
  return 'medium';
}

// ---------------------------------------------------------------------------
// Confidence display helpers
// ---------------------------------------------------------------------------

export function confidenceColor(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'var(--color-signal-ok)';
    case 'medium':
      return 'var(--color-signal-warning)';
    case 'low':
      return 'var(--color-signal-critical)';
  }
}

export function confidenceIcon(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return '◆'; // solid diamond
    case 'medium':
      return '◇'; // hollow diamond
    case 'low':
      return '▽'; // down triangle — uncertainty
  }
}

export function confidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'HIGH CONFIDENCE';
    case 'medium':
      return 'MEDIUM CONFIDENCE';
    case 'low':
      return 'LOW CONFIDENCE';
  }
}
