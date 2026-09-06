/**
 * Data source registry — Track D.1 (Data Accuracy Autonomy)
 *
 * Maps each of the 30 Intel Map layers to its primary upstream source plus any
 * known fallbacks. Consumed by:
 *   - api/cron/data-health.ts  — probes each layer's active source every 15m
 *   - api/admin/data-health.ts — surfaces current state to the admin dashboard
 *
 * Layer IDs mirror the `readonly id` declared on each MapDataLayer in
 * src/map/layers/*.ts. Keep this file in sync when adding new layers.
 *
 * Probe URL guidance
 * ------------------
 * Prefer probing the internal Vercel function proxy (e.g. /api/fires) rather
 * than hitting upstream APIs directly — the proxy fails fast when the upstream
 * is down and the cron can run the probe without CORS or auth concerns.
 * When probed from the cron, relative `/api/*` paths are expanded to the
 * deployment URL via process.env.VERCEL_URL.
 *
 * For static-dataset layers (cables, chokepoints, etc.) we point the primary
 * source at the source-of-truth URL used to refresh the hard-coded data, so
 * the cron can still detect "the upstream that would refresh this layer is
 * broken" even though the map itself renders from bundled JSON.
 */

export interface LayerSource {
  /** Short identifier used in logs/DB rows (e.g. 'usgs', 'proxy'). */
  name: string;
  /** Lightweight URL the cron will GET to check health. Relative `/api/*` allowed. */
  probeUrl: string;
  /** Per-probe timeout in milliseconds — cron enforces this with AbortSignal. */
  probeTimeoutMs: number;
  /** How stale is "too stale" — max acceptable age for the freshest record. */
  freshnessWindowSeconds: number;
}

export interface LayerConfig {
  /** Matches the `readonly id` on the corresponding MapDataLayer. */
  id: string;
  /** Primary upstream the layer uses in the happy path. */
  primary: LayerSource;
  /**
   * Ordered list of alternative sources to cycle through when the circuit
   * breaker opens. Empty array = no known fallback (cron handles gracefully).
   */
  fallbacks: LayerSource[];
}

// Default timeout and freshness windows used across most layers.
const DEFAULT_TIMEOUT_MS = 5000;
const FRESH_6H = 6 * 3600;
const FRESH_24H = 24 * 3600;
const FRESH_30D = 30 * 24 * 3600;

export const DATA_SOURCES: LayerConfig[] = [
  // -------------------------------------------------------------------------
  // The register's inputs (PR-9, 2026-09-06). The previous thirty entries
  // were the Intel Map's layers — deleted with the map — so /status was
  // reporting health for a product that no longer existed. What deserves a
  // heartbeat now is exactly the set of upstreams whose silence would corrupt
  // a resolution or starve the brief:
  //
  //   ooni        → resolves every censorship call
  //   fx-rates    → resolves every FX call
  //   sanctions   → the brief's designation-delta section
  //   wikipedia   → the CII attention component
  //   governance  → the CII structural component (yearly cadence upstream)
  //   ucdp        → the CII conflict component (yearly cadence upstream)
  //
  // Probes hit the SAME upstream the collector calls, so a red row means the
  // next collector run will fail, not that some proxy endpoint is moody.
  // -------------------------------------------------------------------------
  {
    id: 'ooni',
    primary: {
      name: 'ooni-api',
      probeUrl:
        'https://api.ooni.io/api/v1/aggregation?probe_cc=TR&test_name=web_connectivity&since=2026-01-01&until=2026-01-02',
      probeTimeoutMs: DEFAULT_TIMEOUT_MS,
      freshnessWindowSeconds: FRESH_6H,
    },
    fallbacks: [],
  },
  {
    id: 'fx-rates',
    primary: {
      name: 'open-er-api',
      probeUrl: 'https://open.er-api.com/v6/latest/USD',
      probeTimeoutMs: DEFAULT_TIMEOUT_MS,
      freshnessWindowSeconds: FRESH_24H,
    },
    fallbacks: [],
  },
  {
    id: 'sanctions',
    primary: {
      name: 'ofac-sdn',
      probeUrl: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV',
      probeTimeoutMs: DEFAULT_TIMEOUT_MS,
      freshnessWindowSeconds: FRESH_24H,
    },
    fallbacks: [
      {
        name: 'un-consolidated',
        probeUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
        probeTimeoutMs: DEFAULT_TIMEOUT_MS,
        freshnessWindowSeconds: FRESH_24H,
      },
    ],
  },
  {
    id: 'wikipedia',
    primary: {
      name: 'wikimedia-pageviews',
      probeUrl:
        'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/Ukraine/daily/2026010100/2026010200',
      probeTimeoutMs: DEFAULT_TIMEOUT_MS,
      freshnessWindowSeconds: FRESH_24H,
    },
    fallbacks: [],
  },
  {
    id: 'governance',
    primary: {
      name: 'worldbank-wgi',
      probeUrl: 'https://api.worldbank.org/v2/country/TUR/indicator/VA.EST?format=json&per_page=1',
      probeTimeoutMs: DEFAULT_TIMEOUT_MS,
      freshnessWindowSeconds: FRESH_30D,
    },
    fallbacks: [],
  },
  {
    id: 'ucdp',
    primary: {
      name: 'ucdp-api',
      probeUrl: 'https://ucdpapi.pcr.uu.se/api/gedevents/25.1?pagesize=1',
      probeTimeoutMs: DEFAULT_TIMEOUT_MS,
      freshnessWindowSeconds: FRESH_30D,
    },
    fallbacks: [],
  },
];

/**
 * Picks the active source for a layer given its circuit breaker state.
 * - circuit 'closed' or 'half_open' → primary
 * - circuit 'open'                  → fallback at index (failures / 5 - 1)
 * If the fallback index exceeds the fallback list, wraps around to 0.
 * Returns null if the layer has no fallbacks and the circuit is open.
 */
export function pickSource(
  layer: LayerConfig,
  circuitState: 'closed' | 'open' | 'half_open',
  consecutiveFailures: number,
): LayerSource | null {
  if (circuitState !== 'open') return layer.primary;
  if (layer.fallbacks.length === 0) return null;
  // Each 5 consecutive failures, advance to the next fallback.
  const bucket = Math.max(0, Math.floor(consecutiveFailures / 5) - 1);
  const idx = bucket % layer.fallbacks.length;
  return layer.fallbacks[idx] ?? null;
}
