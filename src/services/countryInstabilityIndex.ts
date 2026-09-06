/**
 * Country Instability Index (CII)
 *
 * 6-component per-country 0-100 risk score:
 *   Conflict (20%) + Disasters (15%) + Sentiment (15%) +
 *   Infrastructure (15%) + Governance (15%) + Market Exposure (20%)
 *
 * Computed from live layer data every 5 minutes.
 * Complements the global Tension Index (cinema mode) with per-country depth.
 *
 * Every score includes a full evidence chain: click 72 → see the 14 ACLED
 * events, 2 USGS quakes, and 23 GDELT articles that computed it. Plus
 * explicit disclosure of data gaps.
 */

import { EvidenceBuilder, type CIIEvidenceChain, type ConfidenceLevel } from './confidenceScoring.ts';

export interface CIIScore {
  countryCode: string;
  countryName: string;
  score: number; // 0-100
  trend: 'rising' | 'falling' | 'stable';
  tier: CountryTier;
  confidence: ConfidenceLevel;
  /** Data quality grade: A (4+ live sources), B (2-3), C (1), D (baselines only). */
  dataQuality: 'A' | 'B' | 'C' | 'D';
  /** Number of live data sources contributing to this score. */
  liveSourceCount: number;
  components: {
    conflict: number; // 0-20
    disasters: number; // 0-15
    sentiment: number; // 0-15
    infrastructure: number; // 0-15
    governance: number; // 0-15
    marketExposure: number; // 0-20
  };
  topSignals: string[]; // Human-readable top 3 contributing factors
  /** Full evidence chain — source data, confidence, gaps. The receipt for every number. */
  evidence: CIIEvidenceChain;
}

// Tier system for coverage depth transparency:
//   core     — 6-component live scoring, all feeds active, CII history tracked
//   extended — 6-component scoring, partial feed coverage, CII tracked
//   monitor  — baseline + global feed pass-through, lower refresh priority
export type CountryTier = 'core' | 'extended' | 'monitor';

// Countries to score — 150+ nations across every inhabited continent.
// Core: geopolitical hotspots + G7/G20 + major US allies/adversaries.
// Extended: regionally significant nations with active risk vectors.
// Monitor: stable or small nations tracked for completeness and correlation detection.
const MONITORED_COUNTRIES: {
  code: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  tier: CountryTier;
}[] = [
  // ── Active conflict zones & fragile states ──
  { code: 'UA', name: 'Ukraine', lat: 48.4, lon: 31.2, radius: 6, tier: 'core' },
  { code: 'RU', name: 'Russia', lat: 55.8, lon: 37.6, radius: 15, tier: 'core' },
  { code: 'IL', name: 'Israel', lat: 31.0, lon: 35.0, radius: 3, tier: 'core' },
  { code: 'PS', name: 'Palestine', lat: 31.9, lon: 35.2, radius: 2, tier: 'core' },
  { code: 'SY', name: 'Syria', lat: 34.8, lon: 38.9, radius: 4, tier: 'core' },
  { code: 'IQ', name: 'Iraq', lat: 33.2, lon: 43.7, radius: 5, tier: 'core' },
  { code: 'YE', name: 'Yemen', lat: 15.6, lon: 48.5, radius: 5, tier: 'core' },
  { code: 'SD', name: 'Sudan', lat: 15.5, lon: 32.5, radius: 8, tier: 'core' },
  { code: 'SS', name: 'South Sudan', lat: 4.9, lon: 31.6, radius: 5, tier: 'core' },
  { code: 'ET', name: 'Ethiopia', lat: 9.1, lon: 40.5, radius: 6, tier: 'core' },
  { code: 'SO', name: 'Somalia', lat: 2.0, lon: 45.3, radius: 5, tier: 'core' },
  { code: 'CD', name: 'DR Congo', lat: -1.5, lon: 29.0, radius: 8, tier: 'core' },
  { code: 'MM', name: 'Myanmar', lat: 19.8, lon: 96.1, radius: 5, tier: 'core' },
  { code: 'AF', name: 'Afghanistan', lat: 33.9, lon: 67.7, radius: 6, tier: 'core' },
  { code: 'LY', name: 'Libya', lat: 26.3, lon: 17.2, radius: 6, tier: 'core' },
  { code: 'ML', name: 'Mali', lat: 17.6, lon: -4.0, radius: 5, tier: 'core' },
  { code: 'BF', name: 'Burkina Faso', lat: 12.3, lon: -1.5, radius: 4, tier: 'core' },
  { code: 'HT', name: 'Haiti', lat: 18.5, lon: -72.3, radius: 3, tier: 'core' },
  { code: 'NE', name: 'Niger', lat: 17.6, lon: 8.1, radius: 5, tier: 'core' },
  { code: 'CF', name: 'Central African Rep.', lat: 6.6, lon: 20.9, radius: 5, tier: 'core' },

  // ── Major powers & G7/G20 ──
  { code: 'US', name: 'United States', lat: 39.8, lon: -98.5, radius: 15, tier: 'core' },
  { code: 'CN', name: 'China', lat: 35.9, lon: 104.2, radius: 12, tier: 'core' },
  { code: 'IN', name: 'India', lat: 20.6, lon: 78.9, radius: 10, tier: 'core' },
  { code: 'JP', name: 'Japan', lat: 36.2, lon: 138.3, radius: 5, tier: 'core' },
  { code: 'DE', name: 'Germany', lat: 52.5, lon: 13.4, radius: 5, tier: 'core' },
  { code: 'GB', name: 'United Kingdom', lat: 51.5, lon: -0.1, radius: 4, tier: 'core' },
  { code: 'FR', name: 'France', lat: 48.9, lon: 2.3, radius: 4, tier: 'core' },
  { code: 'BR', name: 'Brazil', lat: -15.8, lon: -47.9, radius: 10, tier: 'core' },
  { code: 'SA', name: 'Saudi Arabia', lat: 24.7, lon: 46.7, radius: 8, tier: 'core' },
  { code: 'TR', name: 'Turkey', lat: 39.9, lon: 32.9, radius: 5, tier: 'core' },
  { code: 'KR', name: 'South Korea', lat: 37.6, lon: 127.0, radius: 3, tier: 'core' },
  { code: 'IR', name: 'Iran', lat: 32.4, lon: 53.7, radius: 8, tier: 'core' },

  // ── Strategic flashpoints & energy chokepoints ──
  { code: 'TW', name: 'Taiwan', lat: 23.5, lon: 121.0, radius: 3, tier: 'core' },
  { code: 'KP', name: 'North Korea', lat: 40.0, lon: 127.0, radius: 4, tier: 'core' },
  { code: 'PK', name: 'Pakistan', lat: 30.4, lon: 69.3, radius: 6, tier: 'core' },
  { code: 'LB', name: 'Lebanon', lat: 33.9, lon: 35.5, radius: 2, tier: 'core' },
  { code: 'VE', name: 'Venezuela', lat: 8.0, lon: -66.0, radius: 5, tier: 'core' },

  // ── Extended: regionally significant ──
  { code: 'NG', name: 'Nigeria', lat: 9.1, lon: 7.5, radius: 6, tier: 'extended' },
  { code: 'EG', name: 'Egypt', lat: 30.0, lon: 31.2, radius: 5, tier: 'extended' },
  { code: 'ZA', name: 'South Africa', lat: -30.6, lon: 22.9, radius: 6, tier: 'extended' },
  { code: 'MX', name: 'Mexico', lat: 19.4, lon: -99.1, radius: 6, tier: 'extended' },
  { code: 'ID', name: 'Indonesia', lat: -2.5, lon: 118.0, radius: 10, tier: 'extended' },
  { code: 'PH', name: 'Philippines', lat: 14.6, lon: 121.0, radius: 5, tier: 'extended' },
  { code: 'BD', name: 'Bangladesh', lat: 23.7, lon: 90.4, radius: 4, tier: 'extended' },
  { code: 'CO', name: 'Colombia', lat: 4.6, lon: -74.3, radius: 5, tier: 'extended' },
  { code: 'KE', name: 'Kenya', lat: -1.3, lon: 36.8, radius: 5, tier: 'extended' },
  { code: 'MZ', name: 'Mozambique', lat: -15.4, lon: 40.5, radius: 5, tier: 'extended' },
  { code: 'UG', name: 'Uganda', lat: 0.3, lon: 32.6, radius: 4, tier: 'extended' },
  { code: 'TD', name: 'Chad', lat: 12.1, lon: 15.0, radius: 5, tier: 'extended' },
  { code: 'CU', name: 'Cuba', lat: 21.5, lon: -80.0, radius: 4, tier: 'extended' },
  { code: 'TH', name: 'Thailand', lat: 15.9, lon: 100.9, radius: 5, tier: 'extended' },
  { code: 'VN', name: 'Vietnam', lat: 14.1, lon: 108.3, radius: 5, tier: 'extended' },
  { code: 'MY', name: 'Malaysia', lat: 4.2, lon: 101.9, radius: 4, tier: 'extended' },
  { code: 'PL', name: 'Poland', lat: 51.9, lon: 19.1, radius: 4, tier: 'extended' },
  { code: 'RO', name: 'Romania', lat: 45.9, lon: 24.9, radius: 4, tier: 'extended' },
  { code: 'AU', name: 'Australia', lat: -25.3, lon: 133.8, radius: 12, tier: 'extended' },
  { code: 'CA', name: 'Canada', lat: 56.1, lon: -106.3, radius: 15, tier: 'extended' },
  { code: 'IT', name: 'Italy', lat: 41.9, lon: 12.6, radius: 4, tier: 'extended' },
  { code: 'ES', name: 'Spain', lat: 40.5, lon: -3.7, radius: 4, tier: 'extended' },
  { code: 'AR', name: 'Argentina', lat: -38.4, lon: -63.6, radius: 8, tier: 'extended' },
  { code: 'CL', name: 'Chile', lat: -35.7, lon: -71.5, radius: 6, tier: 'extended' },
  { code: 'PE', name: 'Peru', lat: -9.2, lon: -75.0, radius: 5, tier: 'extended' },
  { code: 'DZ', name: 'Algeria', lat: 28.0, lon: 1.7, radius: 6, tier: 'extended' },
  { code: 'MA', name: 'Morocco', lat: 31.8, lon: -7.1, radius: 4, tier: 'extended' },
  { code: 'TN', name: 'Tunisia', lat: 33.9, lon: 9.5, radius: 3, tier: 'extended' },

  // ── Monitor: correlation detection, completeness, emerging risk ──
  // Africa — West
  { code: 'GH', name: 'Ghana', lat: 7.9, lon: -1.0, radius: 4, tier: 'monitor' },
  { code: 'SN', name: 'Senegal', lat: 14.5, lon: -14.5, radius: 3, tier: 'monitor' },
  { code: 'CM', name: 'Cameroon', lat: 7.4, lon: 12.4, radius: 4, tier: 'monitor' },
  { code: 'CI', name: "C\u00f4te d'Ivoire", lat: 7.5, lon: -5.5, radius: 4, tier: 'monitor' },
  { code: 'GN', name: 'Guinea', lat: 9.9, lon: -12.1, radius: 3, tier: 'monitor' },
  { code: 'SL', name: 'Sierra Leone', lat: 8.5, lon: -11.8, radius: 2, tier: 'monitor' },
  { code: 'LR', name: 'Liberia', lat: 6.4, lon: -9.4, radius: 2, tier: 'monitor' },
  { code: 'TG', name: 'Togo', lat: 8.6, lon: 1.2, radius: 2, tier: 'monitor' },
  { code: 'BJ', name: 'Benin', lat: 9.3, lon: 2.3, radius: 2, tier: 'monitor' },
  { code: 'MR', name: 'Mauritania', lat: 21.0, lon: -10.9, radius: 5, tier: 'monitor' },
  { code: 'GM', name: 'Gambia', lat: 13.4, lon: -16.6, radius: 1, tier: 'monitor' },
  // Africa — East
  { code: 'AO', name: 'Angola', lat: -11.2, lon: 17.9, radius: 5, tier: 'monitor' },
  { code: 'TZ', name: 'Tanzania', lat: -6.4, lon: 34.9, radius: 5, tier: 'monitor' },
  { code: 'RW', name: 'Rwanda', lat: -1.9, lon: 29.9, radius: 2, tier: 'monitor' },
  { code: 'BI', name: 'Burundi', lat: -3.4, lon: 29.9, radius: 2, tier: 'monitor' },
  { code: 'ER', name: 'Eritrea', lat: 15.2, lon: 39.8, radius: 3, tier: 'monitor' },
  { code: 'DJ', name: 'Djibouti', lat: 11.6, lon: 43.1, radius: 1, tier: 'monitor' },
  { code: 'MG', name: 'Madagascar', lat: -18.9, lon: 47.5, radius: 5, tier: 'monitor' },
  // Africa — Southern
  { code: 'ZW', name: 'Zimbabwe', lat: -19.0, lon: 29.2, radius: 4, tier: 'monitor' },
  { code: 'ZM', name: 'Zambia', lat: -13.1, lon: 27.8, radius: 4, tier: 'monitor' },
  { code: 'BW', name: 'Botswana', lat: -22.3, lon: 24.7, radius: 4, tier: 'monitor' },
  { code: 'NA', name: 'Namibia', lat: -22.6, lon: 17.1, radius: 5, tier: 'monitor' },
  { code: 'MW', name: 'Malawi', lat: -13.3, lon: 34.3, radius: 3, tier: 'monitor' },
  // Central Asia & Caucasus
  { code: 'KZ', name: 'Kazakhstan', lat: 48.0, lon: 68.0, radius: 8, tier: 'monitor' },
  { code: 'UZ', name: 'Uzbekistan', lat: 41.3, lon: 64.6, radius: 5, tier: 'monitor' },
  { code: 'GE', name: 'Georgia', lat: 42.3, lon: 43.4, radius: 3, tier: 'monitor' },
  { code: 'AZ', name: 'Azerbaijan', lat: 40.1, lon: 47.6, radius: 3, tier: 'monitor' },
  { code: 'AM', name: 'Armenia', lat: 40.1, lon: 44.5, radius: 2, tier: 'monitor' },
  { code: 'TM', name: 'Turkmenistan', lat: 38.9, lon: 59.6, radius: 5, tier: 'monitor' },
  { code: 'KG', name: 'Kyrgyzstan', lat: 41.2, lon: 74.8, radius: 3, tier: 'monitor' },
  { code: 'TJ', name: 'Tajikistan', lat: 38.6, lon: 68.8, radius: 3, tier: 'monitor' },
  { code: 'MN', name: 'Mongolia', lat: 46.9, lon: 103.8, radius: 6, tier: 'monitor' },
  // South Asia
  { code: 'NP', name: 'Nepal', lat: 28.4, lon: 84.1, radius: 3, tier: 'monitor' },
  { code: 'LK', name: 'Sri Lanka', lat: 7.9, lon: 80.8, radius: 3, tier: 'monitor' },
  { code: 'BT', name: 'Bhutan', lat: 27.5, lon: 90.4, radius: 2, tier: 'monitor' },
  { code: 'MV', name: 'Maldives', lat: 3.2, lon: 73.2, radius: 1, tier: 'monitor' },
  // Southeast Asia & Pacific
  { code: 'KH', name: 'Cambodia', lat: 12.6, lon: 104.9, radius: 3, tier: 'monitor' },
  { code: 'SG', name: 'Singapore', lat: 1.4, lon: 103.8, radius: 1, tier: 'monitor' },
  { code: 'LA', name: 'Laos', lat: 18.0, lon: 102.6, radius: 3, tier: 'monitor' },
  { code: 'BN', name: 'Brunei', lat: 4.9, lon: 114.9, radius: 1, tier: 'monitor' },
  { code: 'TL', name: 'Timor-Leste', lat: -8.6, lon: 125.7, radius: 2, tier: 'monitor' },
  { code: 'PG', name: 'Papua New Guinea', lat: -6.3, lon: 143.9, radius: 5, tier: 'monitor' },
  { code: 'FJ', name: 'Fiji', lat: -17.7, lon: 178.1, radius: 2, tier: 'monitor' },
  // East Asia
  { code: 'HK', name: 'Hong Kong', lat: 22.3, lon: 114.2, radius: 1, tier: 'monitor' },
  // Oceania
  { code: 'NZ', name: 'New Zealand', lat: -40.9, lon: 174.9, radius: 4, tier: 'monitor' },
  // Middle East & Gulf
  { code: 'JO', name: 'Jordan', lat: 30.6, lon: 36.2, radius: 3, tier: 'monitor' },
  { code: 'AE', name: 'UAE', lat: 23.4, lon: 53.8, radius: 3, tier: 'monitor' },
  { code: 'QA', name: 'Qatar', lat: 25.4, lon: 51.2, radius: 2, tier: 'monitor' },
  { code: 'KW', name: 'Kuwait', lat: 29.3, lon: 47.5, radius: 2, tier: 'monitor' },
  { code: 'BH', name: 'Bahrain', lat: 26.0, lon: 50.5, radius: 1, tier: 'monitor' },
  { code: 'OM', name: 'Oman', lat: 21.5, lon: 55.9, radius: 4, tier: 'monitor' },
  // Europe — Balkans & Eastern
  { code: 'RS', name: 'Serbia', lat: 44.0, lon: 20.9, radius: 3, tier: 'monitor' },
  { code: 'BA', name: 'Bosnia', lat: 43.9, lon: 17.7, radius: 3, tier: 'monitor' },
  { code: 'XK', name: 'Kosovo', lat: 42.6, lon: 20.9, radius: 2, tier: 'monitor' },
  { code: 'ME', name: 'Montenegro', lat: 42.7, lon: 19.4, radius: 2, tier: 'monitor' },
  { code: 'MK', name: 'North Macedonia', lat: 41.5, lon: 21.7, radius: 2, tier: 'monitor' },
  { code: 'AL', name: 'Albania', lat: 41.3, lon: 19.8, radius: 2, tier: 'monitor' },
  { code: 'BY', name: 'Belarus', lat: 53.7, lon: 27.9, radius: 4, tier: 'monitor' },
  { code: 'MD', name: 'Moldova', lat: 47.0, lon: 28.8, radius: 3, tier: 'monitor' },
  { code: 'BG', name: 'Bulgaria', lat: 42.7, lon: 25.5, radius: 3, tier: 'monitor' },
  { code: 'HR', name: 'Croatia', lat: 45.1, lon: 15.2, radius: 3, tier: 'monitor' },
  { code: 'HU', name: 'Hungary', lat: 47.2, lon: 19.5, radius: 3, tier: 'monitor' },
  { code: 'CZ', name: 'Czech Republic', lat: 49.8, lon: 15.5, radius: 3, tier: 'monitor' },
  { code: 'SK', name: 'Slovakia', lat: 48.7, lon: 19.7, radius: 3, tier: 'monitor' },
  { code: 'GR', name: 'Greece', lat: 39.1, lon: 21.8, radius: 3, tier: 'monitor' },
  // Europe — Nordics & Baltics
  { code: 'SE', name: 'Sweden', lat: 60.1, lon: 18.6, radius: 5, tier: 'monitor' },
  { code: 'FI', name: 'Finland', lat: 61.9, lon: 25.7, radius: 5, tier: 'monitor' },
  { code: 'NO', name: 'Norway', lat: 60.5, lon: 8.5, radius: 5, tier: 'monitor' },
  { code: 'DK', name: 'Denmark', lat: 56.3, lon: 9.5, radius: 3, tier: 'monitor' },
  { code: 'EE', name: 'Estonia', lat: 58.6, lon: 25.0, radius: 2, tier: 'monitor' },
  { code: 'LV', name: 'Latvia', lat: 56.9, lon: 24.1, radius: 2, tier: 'monitor' },
  { code: 'LT', name: 'Lithuania', lat: 55.2, lon: 23.9, radius: 2, tier: 'monitor' },
  // Europe — Western
  { code: 'NL', name: 'Netherlands', lat: 52.1, lon: 5.3, radius: 2, tier: 'monitor' },
  { code: 'BE', name: 'Belgium', lat: 50.5, lon: 4.5, radius: 2, tier: 'monitor' },
  { code: 'CH', name: 'Switzerland', lat: 46.8, lon: 8.2, radius: 2, tier: 'monitor' },
  { code: 'AT', name: 'Austria', lat: 47.5, lon: 14.6, radius: 2, tier: 'monitor' },
  { code: 'PT', name: 'Portugal', lat: 39.4, lon: -8.2, radius: 3, tier: 'monitor' },
  { code: 'IE', name: 'Ireland', lat: 53.1, lon: -7.7, radius: 3, tier: 'monitor' },
  // Central America & Caribbean
  { code: 'GT', name: 'Guatemala', lat: 14.6, lon: -90.5, radius: 3, tier: 'monitor' },
  { code: 'HN', name: 'Honduras', lat: 14.1, lon: -87.2, radius: 3, tier: 'monitor' },
  { code: 'SV', name: 'El Salvador', lat: 13.7, lon: -88.9, radius: 2, tier: 'monitor' },
  { code: 'NI', name: 'Nicaragua', lat: 12.9, lon: -85.2, radius: 3, tier: 'monitor' },
  { code: 'PA', name: 'Panama', lat: 8.5, lon: -80.8, radius: 3, tier: 'monitor' },
  { code: 'CR', name: 'Costa Rica', lat: 9.7, lon: -83.8, radius: 3, tier: 'monitor' },
  { code: 'DO', name: 'Dominican Republic', lat: 18.7, lon: -70.2, radius: 3, tier: 'monitor' },
  { code: 'JM', name: 'Jamaica', lat: 18.1, lon: -77.3, radius: 2, tier: 'monitor' },
  { code: 'TT', name: 'Trinidad & Tobago', lat: 10.4, lon: -61.3, radius: 1, tier: 'monitor' },
  // South America
  { code: 'EC', name: 'Ecuador', lat: -1.8, lon: -78.2, radius: 4, tier: 'monitor' },
  { code: 'BO', name: 'Bolivia', lat: -16.3, lon: -63.6, radius: 5, tier: 'monitor' },
  { code: 'PY', name: 'Paraguay', lat: -23.4, lon: -58.4, radius: 4, tier: 'monitor' },
  { code: 'UY', name: 'Uruguay', lat: -32.5, lon: -55.8, radius: 3, tier: 'monitor' },
  { code: 'GY', name: 'Guyana', lat: 4.9, lon: -58.9, radius: 3, tier: 'monitor' },
];

export function getMonitoredCountries(): typeof MONITORED_COUNTRIES {
  return MONITORED_COUNTRIES;
}

/** Total monitored country count — used in UI badges. */
export const COUNTRY_COUNT = MONITORED_COUNTRIES.length;

// ── Caching & trend computation ──

let cachedScores: CIIScore[] = [];
let previousScores: Map<string, number> = new Map();
let lastComputed = 0;

export function getCachedCII(): CIIScore[] {
  return cachedScores;
}

export function getLastComputed(): number {
  return lastComputed;
}

// ── Session snapshot — stores CII scores for "since you left" and delta computation ──

interface CIISnapshot {
  timestamp: number;
  scores: Record<string, number>; // countryCode → score
}

const SNAPSHOT_KEY = 'nw:cii-snapshot';
const LAST_VISIT_KEY = 'nw:last-visit';

/** Save current CII scores as a snapshot for delta computation on next visit. */
export function saveCIISnapshot(): void {
  if (cachedScores.length === 0) return;
  const snapshot: CIISnapshot = {
    timestamp: Date.now(),
    scores: Object.fromEntries(cachedScores.map((s) => [s.countryCode, s.score])),
  };
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
  } catch {
    // quota exceeded — non-critical
  }
}

/** Get the previous session's CII snapshot for delta computation. */
export function getPreviousSnapshot(): CIISnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CIISnapshot;
  } catch {
    return null;
  }
}

/** Get the last visit timestamp. */
export function getLastVisitTimestamp(): number {
  return parseInt(localStorage.getItem(LAST_VISIT_KEY) || '0', 10);
}

/** Get the CII delta (current - previous snapshot) for a country. Returns null if no previous data. */
export function getCIIDelta(countryCode: string): number | null {
  const snapshot = getPreviousSnapshot();
  if (!snapshot) return null;
  const prevScore = snapshot.scores[countryCode];
  if (prevScore === undefined) return null;
  const current = cachedScores.find((s) => s.countryCode === countryCode);
  if (!current) return null;
  return Math.round((current.score - prevScore) * 10) / 10;
}

export function getCountryCII(code: string): CIIScore | undefined {
  return cachedScores.find((s) => s.countryCode === code);
}

// Distance check (simplified euclidean for speed — good enough for country-level)
function isNear(lat1: number, lon1: number, lat2: number, lon2: number, radius: number): boolean {
  return Math.sqrt((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2) < radius;
}

/**
 * Compute CII scores for all monitored countries from live layer data.
 * Caches results and computes trends from previous scores.
 */
export function computeAllCII(layerData: Map<string, unknown>): CIIScore[] {
  // Save previous scores for trend computation
  if (cachedScores.length > 0) {
    previousScores = new Map(cachedScores.map((s) => [s.countryCode, s.score]));
  }

  const scores = MONITORED_COUNTRIES.map((country) => {
    const cii = computeCountryCII(country, layerData);
    // Compute trend from previous cycle
    const prev = previousScores.get(country.code);
    if (prev !== undefined) {
      const delta = cii.score - prev;
      cii.trend = delta >= 3 ? 'rising' : delta <= -3 ? 'falling' : 'stable';
    }
    return cii;
  });

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  cachedScores = scores;
  lastComputed = Date.now();

  return scores;
}

// Conflict baselines — ensures countries at war don't show 0 when ACLED is unavailable.
// IMPORTANT: These must stay in sync with api/_lib/cii-baselines.ts (v2.2.0).
// The server cron (compute-cii.ts) imports from cii-baselines.ts directly.
// These client-side copies are used only as fallback during initial page load.
const BASELINE_CONFLICT: Record<string, number> = {
  // Active war zones
  UA: 19,
  RU: 12,
  SD: 19,
  SS: 17,
  YE: 18,
  SY: 17,
  PS: 19,
  IL: 16, // Active regional conflict — raised from 8
  IR: 14, // Proxy conflicts, nuclear program, sanctions — NEW
  LB: 14, // Hezbollah conflict — raised from 6
  // Insurgencies & civil conflict
  MM: 15,
  AF: 15,
  SO: 15,
  CD: 14,
  IQ: 11,
  LY: 12,
  ML: 13,
  BF: 13,
  CF: 13,
  NE: 11,
  HT: 12,
  NG: 10,
  MZ: 8,
  ET: 11,
  TD: 10,
  PK: 8,
  CO: 7,
  KP: 12, // Raised — active nuclear provocations, militarized regime
  UG: 5,
  CM: 6,
  // Low-level / frozen conflicts
  VE: 6,
  PH: 4,
  TH: 3,
  DZ: 4,
  GE: 4,
  AZ: 5,
  AM: 5,
  LK: 2,
  NP: 1,
  RW: 3,
  ZW: 3,
  JO: 4,
  TR: 5, // Kurdish conflict, Syria border ops
  CN: 4, // Taiwan Strait tensions, internal ethnic tensions
  TW: 8, // Taiwan Strait threat exposure
};

// Governance baselines — authoritarian regimes, election crises, sanctions
const BASELINE_GOVERNANCE: Record<string, number> = {
  KP: 12,
  VE: 10,
  AF: 10,
  SD: 9,
  MM: 10,
  IR: 9,
  RU: 8,
  SY: 10,
  BY: 9,
  NI: 8,
  CU: 8,
  CD: 7,
  SS: 8,
  YE: 9,
  SO: 8,
  CF: 7,
  LY: 8,
  HT: 8,
  ER: 10,
};

// Sentiment baselines — persistently negative news coverage for war zones
const BASELINE_SENTIMENT: Record<string, number> = {
  UA: 11,
  RU: 9,
  IL: 10,
  PS: 12,
  SY: 10,
  YE: 10,
  SD: 11,
  AF: 9,
  IR: 9,
  MM: 9,
  SO: 9,
  VE: 7,
  KP: 8,
  LB: 8,
  HT: 9,
  CD: 8,
  SS: 9,
};

function computeCountryCII(
  country: { code: string; name: string; lat: number; lon: number; radius: number; tier: CountryTier },
  layerData: Map<string, unknown>,
): CIIScore {
  const signals: string[] = [];
  const eb = new EvidenceBuilder();

  // ── Component 1: Conflict (0-20) — live data + baseline ──
  eb.startComponent('conflict', 20);
  let conflict = BASELINE_CONFLICT[country.code] ?? 0;
  if (conflict > 0) {
    eb.markBaseline('conflict', `Baseline conflict score ${conflict}/20 from known conflict status`);
  }
  const acled = layerData.get('acled') as
    | Array<{ lat: number; lon: number; fatalities?: number; event_type?: string }>
    | undefined;
  if (acled) {
    const nearby = acled.filter((e) => isNear(e.lat, e.lon, country.lat, country.lon, country.radius));
    const eventCount = nearby.length;
    const fatalities = nearby.reduce((sum, e) => sum + (e.fatalities || 0), 0);
    const liveConflict = (eventCount / 5) * 8 + (fatalities / 50) * 12;
    conflict = Math.min(20, Math.max(conflict, liveConflict));
    if (eventCount > 10) signals.push(`${eventCount} conflict events this week`);
    if (fatalities > 100) signals.push(`${fatalities} casualties reported`);
    eb.addSource(
      'conflict',
      'acled',
      'ACLED',
      nearby.slice(0, 10).map((e) => ({
        text: `${e.event_type || 'Conflict event'} — ${e.fatalities || 0} fatalities`,
        lat: e.lat,
        lon: e.lon,
        timestamp: 0,
        source: 'ACLED',
      })),
    );
  } else {
    eb.addGap('conflict', 'ACLED data unavailable — using baseline conflict score only');
  }
  eb.setScore('conflict', conflict);

  // ── Component 2: Disasters (0-15) ──
  eb.startComponent('disasters', 15);
  let disasters = 0;
  const quakes = layerData.get('earthquakes') as
    | Array<{ lat: number; lon: number; magnitude?: number; place?: string; time?: number }>
    | undefined;
  if (quakes) {
    const nearby = quakes.filter((e) => isNear(e.lat, e.lon, country.lat, country.lon, country.radius));
    const maxMag = Math.max(0, ...nearby.map((e) => e.magnitude || 0));
    disasters += Math.min(8, nearby.length * 1.5 + (maxMag > 5 ? (maxMag - 5) * 4 : 0));
    if (maxMag >= 5) signals.push(`M${maxMag.toFixed(1)} earthquake`);
    eb.addSource(
      'disasters',
      'earthquakes',
      'USGS',
      nearby.slice(0, 5).map((e) => ({
        text: `M${(e.magnitude || 0).toFixed(1)} earthquake${e.place ? ` — ${e.place}` : ''}`,
        lat: e.lat,
        lon: e.lon,
        timestamp: e.time || 0,
        source: 'USGS',
      })),
    );
  } else {
    eb.addGap('disasters', 'USGS earthquake data unavailable');
  }
  const fires = layerData.get('fires') as Array<{ lat: number; lon: number }> | undefined;
  if (fires) {
    const nearby = fires.filter((e) => isNear(e.lat, e.lon, country.lat, country.lon, country.radius));
    disasters += Math.min(7, nearby.length / 10);
    if (nearby.length > 50) signals.push(`${nearby.length} active fire hotspots`);
    if (nearby.length > 0) {
      eb.addSource(
        'disasters',
        'fires',
        'NASA FIRMS',
        nearby.slice(0, 5).map((e) => ({
          text: 'Active fire hotspot',
          lat: e.lat,
          lon: e.lon,
          timestamp: 0,
          source: 'NASA FIRMS',
        })),
      );
    }
  } else {
    eb.addGap('disasters', 'NASA FIRMS fire data unavailable');
  }
  disasters = Math.min(15, disasters);
  eb.setScore('disasters', disasters);

  // ── Component 3: Sentiment (0-15) ──
  eb.startComponent('sentiment', 15);
  let sentiment = BASELINE_SENTIMENT[country.code] ?? 0;
  if (sentiment > 0) {
    eb.markBaseline('sentiment', `Baseline sentiment ${sentiment}/15 from known ongoing crisis coverage`);
  }
  const news = layerData.get('news') as
    | Array<{ lat?: number; lon?: number; tone?: number; country?: string; title?: string; source?: string }>
    | undefined;
  if (news) {
    const nearby = news.filter(
      (e) =>
        (e.lat && e.lon && isNear(e.lat, e.lon, country.lat, country.lon, country.radius)) ||
        (e.country && e.country.includes(country.name)),
    );
    if (nearby.length > 0) {
      const avgTone = nearby.reduce((s, e) => s + (e.tone || 0), 0) / nearby.length;
      const liveSentiment = Math.min(15, Math.max(0, (-avgTone / 10) * 15));
      // Take max of baseline and live — never lose the baseline floor
      sentiment = Math.max(sentiment, liveSentiment);
      if (avgTone < -5) signals.push(`Strongly negative sentiment (${avgTone.toFixed(1)})`);
      eb.addSource(
        'sentiment',
        'news',
        'GDELT',
        nearby.slice(0, 5).map((e) => ({
          text: e.title || `News article (tone: ${(e.tone || 0).toFixed(1)})`,
          lat: e.lat || country.lat,
          lon: e.lon || country.lon,
          timestamp: 0,
          source: e.source || 'GDELT',
        })),
      );
    } else {
      eb.addGap('sentiment', `No GDELT news articles matched ${country.name} — sentiment score is 0`);
    }
  } else {
    eb.addGap('sentiment', 'GDELT news data unavailable — sentiment unscored');
  }
  eb.setScore('sentiment', sentiment);

  // ── Component 4: Infrastructure (0-15) ──
  eb.startComponent('infrastructure', 15);
  let infrastructure = 0;
  const outages = layerData.get('internet-outages') as
    | Array<{ code?: string; severity?: string; score?: number }>
    | undefined;
  if (outages) {
    const match = outages.find((o) => o.code === country.code);
    if (match) {
      const outageScore =
        match.score || (match.severity === 'critical' ? 1.0 : match.severity === 'high' ? 0.75 : 0.25);
      infrastructure += outageScore * 10;
      if (outageScore > 0.5) signals.push(`Internet disruption: ${match.severity}`);
      eb.addSource('infrastructure', 'internet-outages', 'Cloudflare Radar', [
        {
          text: `Internet ${match.severity || 'disruption'} detected`,
          lat: country.lat,
          lon: country.lon,
          timestamp: 0,
          source: 'Cloudflare Radar',
        },
      ]);
    }
  } else {
    eb.addGap('infrastructure', 'Cloudflare Radar data unavailable');
  }
  const gpsJamming = layerData.get('gps-jamming') as Array<{ lat: number; lon: number }> | undefined;
  if (gpsJamming) {
    const nearby = gpsJamming.filter((e) => isNear(e.lat, e.lon, country.lat, country.lon, country.radius));
    infrastructure += Math.min(5, nearby.length * 2.5);
    if (nearby.length > 0) {
      signals.push(`GPS jamming zone detected`);
      eb.addSource(
        'infrastructure',
        'gps-jamming',
        'GPS Jamming Monitor',
        nearby.slice(0, 3).map((e) => ({
          text: 'GPS jamming zone',
          lat: e.lat,
          lon: e.lon,
          timestamp: 0,
          source: 'GPS Monitor',
        })),
      );
    }
  }
  infrastructure = Math.min(15, infrastructure);
  eb.setScore('infrastructure', infrastructure);

  // ── Component 5: Governance (0-15) ──
  eb.startComponent('governance', 15);
  let governance = BASELINE_GOVERNANCE[country.code] ?? 0;
  if (governance > 0) {
    eb.markBaseline(
      'governance',
      `Baseline governance ${governance}/15 from authoritarian regime / institutional fragility`,
    );
  }
  const elections = layerData.get('elections') as
    | Array<{ lat: number; lon: number; date?: string; significance?: string }>
    | undefined;
  if (elections) {
    const nearby = elections.filter((e) => isNear(e.lat, e.lon, country.lat, country.lon, country.radius));
    for (const el of nearby) {
      if (el.date) {
        const daysUntil = (new Date(el.date).getTime() - Date.now()) / 86400000;
        if (daysUntil > 0 && daysUntil < 90) {
          governance += Math.min(8, (90 - daysUntil) / 10);
          signals.push(`Election in ${Math.ceil(daysUntil)} days`);
          eb.addSource('governance', 'elections', 'NexusWatch Election Calendar', [
            {
              text: `Election in ${Math.ceil(daysUntil)} days`,
              lat: el.lat,
              lon: el.lon,
              timestamp: new Date(el.date).getTime(),
              source: 'Election Calendar',
            },
          ]);
        }
      }
    }
  }
  const sanctions = layerData.get('sanctions') as Array<{ code?: string; severity?: string }> | undefined;
  if (sanctions) {
    const match = sanctions.find((s) => s.code === country.code);
    if (match) {
      governance += match.severity === 'comprehensive' ? 7 : match.severity === 'targeted' ? 4 : 2;
      signals.push(`Under ${match.severity} sanctions`);
      eb.addSource('governance', 'sanctions', 'OFAC Sanctions', [
        {
          text: `Under ${match.severity} sanctions`,
          lat: country.lat,
          lon: country.lon,
          timestamp: 0,
          source: 'OFAC',
        },
      ]);
    }
  }
  if (!elections && !sanctions) {
    eb.addGap('governance', 'No election or sanctions data available for this country');
  }
  governance = Math.min(15, governance);
  eb.setScore('governance', governance);

  // ── Component 6: Market Exposure (0-20) ──
  // This component uses cached market data when available
  // For now, use static risk weights based on known economic vulnerability
  const MARKET_RISK: Record<string, number> = {
    // Sanctioned / isolated economies — highest market distortion
    KP: 20,
    AF: 19,
    SY: 18,
    YE: 18,
    IR: 18,
    SS: 17,
    SO: 17,
    VE: 17,
    SD: 16,
    CF: 16,
    TW: 16,
    HT: 16,
    UA: 15,
    CD: 15,
    PS: 15,
    RU: 14,
    MM: 14,
    LB: 14,
    BF: 14,
    TD: 14,
    LY: 13,
    ML: 13,
    NE: 13,
    IQ: 12,
    SA: 12,
    AR: 12,
    CU: 12,
    NG: 11,
    MZ: 11,
    CN: 10,
    PK: 10,
    TR: 9,
    UG: 9,
    EG: 8,
    CO: 7,
    KE: 7,
    BD: 7,
    BR: 6,
    ZA: 6,
    PH: 6,
    IN: 5,
    MX: 5,
    ID: 5,
    IL: 5,
    DZ: 5,
    PE: 5,
    KR: 4,
    TH: 4,
    VN: 4,
    RO: 4,
    GE: 4,
    AZ: 4,
    AM: 4,
    FR: 3,
    JP: 3,
    PL: 3,
    CL: 3,
    MA: 3,
    TN: 3,
    LK: 3,
    NP: 3,
    KH: 3,
    JO: 3,
    CM: 3,
    AO: 3,
    US: 2,
    DE: 2,
    GB: 2,
    IT: 2,
    ES: 2,
    CA: 2,
    AU: 2,
    NZ: 2,
    GH: 4,
    SN: 4,
    TZ: 4,
    RW: 3,
    ZW: 6,
    KZ: 4,
    UZ: 5,
    SG: 1,
    AE: 2,
    QA: 2,
  };
  const marketExposure = MARKET_RISK[country.code] ?? 8;

  // Market exposure evidence — always baseline since we use static weights
  eb.startComponent('marketExposure', 20);
  eb.markBaseline('marketExposure', 'Static baseline — economic vulnerability weight, not live market data');
  eb.setScore('marketExposure', marketExposure);

  // ── Total Score ──
  const score = Math.round(
    Math.min(100, conflict + disasters + sentiment + infrastructure + governance + marketExposure),
  );

  // ── Build evidence chain ──
  const evidence = eb.build(country.code);

  // Count live sources contributing to this score
  const liveCount = evidence.components.filter((c) => c.sources.length > 0 && !c.usesBaseline).length;
  const grade: CIIScore['dataQuality'] = liveCount >= 4 ? 'A' : liveCount >= 2 ? 'B' : liveCount >= 1 ? 'C' : 'D';

  return {
    countryCode: country.code,
    countryName: country.name,
    score,
    trend: 'stable', // Overwritten by computeAllCII when previous scores exist
    tier: country.tier,
    confidence: evidence.overallConfidence,
    dataQuality: grade,
    liveSourceCount: liveCount,
    components: {
      conflict: Math.round(conflict * 10) / 10,
      disasters: Math.round(disasters * 10) / 10,
      sentiment: Math.round(sentiment * 10) / 10,
      infrastructure: Math.round(infrastructure * 10) / 10,
      governance: Math.round(governance * 10) / 10,
      marketExposure: Math.round(marketExposure * 10) / 10,
    },
    topSignals: signals.slice(0, 3),
    evidence,
  };
}

/** Get a color for a CII score */
export function ciiColor(score: number): string {
  if (score >= 75) return 'var(--color-signal-critical)';
  if (score >= 50) return '#f97316';
  if (score >= 25) return '#eab308';
  return 'var(--color-signal-ok)';
}

/** Get a label for a CII score */
export function ciiLabel(score: number): string {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'ELEVATED';
  return 'STABLE';
}
