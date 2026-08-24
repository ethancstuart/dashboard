/**
 * The seismicity calibration harness — region boxes, tuned thresholds,
 * Poisson helpers.
 *
 * WHY THIS DOMAIN EXISTS (data-science review, 2026-08-23): USGS seismicity
 * has the best statistical properties available to the ledger by a distance —
 * genuinely exogenous, approximately Poisson, near-independent across
 * tectonic regions, resolves on a public feed, and the thresholds can be
 * tuned so the base rate sits near 0.5. Editorially it is the weakest
 * domain; nobody buys a geopolitical product for earthquake counts. It is
 * therefore a CALIBRATION HARNESS, not a headline: a domain where the right
 * answer is computable analytically (Gutenberg–Richter), so it validates the
 * Brier/skill/calibration machinery while the political domains accumulate
 * slowly. Our stated probability IS the climatology — the harness is
 * expected to produce skill ≈ 0 and on-diagonal calibration, and a pipeline
 * that cannot reproduce that is broken regardless of what it says about
 * politics. Ledger surfaces label the kind as a harness and exclude it from
 * headline claim counts.
 */

export interface RegionBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Well-separated, seismically active boxes. Separation is what buys
 *  independence across calls (n_eff ≈ n), unlike the political domains. */
export const SEISMIC_REGION_BOXES: Record<string, RegionBox> = {
  JAPAN: { minLat: 30, maxLat: 45, minLon: 128, maxLon: 148 },
  CHILE: { minLat: -45, maxLat: -17, minLon: -75, maxLon: -66 },
  ALASKA: { minLat: 50, maxLat: 62, minLon: -180, maxLon: -145 },
  INDONESIA: { minLat: -11, maxLat: 6, minLon: 95, maxLon: 141 },
  PHILIPPINES: { minLat: 5, maxLat: 20, minLon: 119, maxLon: 127 },
  TURKEY: { minLat: 36, maxLat: 42, minLon: 26, maxLon: 45 },
  IRAN: { minLat: 26, maxLat: 38, minLon: 44, maxLon: 62 },
  MEXICO: { minLat: 14, maxLat: 20, minLon: -106, maxLon: -92 },
  PERU: { minLat: -18, maxLat: -3, minLon: -82, maxLon: -68 },
  GREECE: { minLat: 34, maxLat: 41, minLon: 19, maxLon: 29 },
  CALIFORNIA: { minLat: 32, maxLat: 42, minLon: -125, maxLon: -114 },
  HIMALAYA: { minLat: 26, maxLat: 31, minLon: 78, maxLon: 90 },
  PNG: { minLat: -12, maxLat: -3, minLon: 140, maxLon: 160 },
  ICELAND: { minLat: 62, maxLat: 67, minLon: -25, maxLon: -13 },
};

export interface SeismicRegion {
  code: string;
  /** Magnitude threshold tuned so P(≥1 in 14d) ≈ 0.5. */
  mag: number;
  /** Poisson base rate at tuning time — the call's stated probability. */
  baseRate: number;
}

/**
 * Tuned by scripts/tune-seismicity.ts on 2026-08-24 from 10 years of USGS
 * history (14-day windows, target P≈0.5). The adjacent-magnitude
 * Gutenberg–Richter b-values came out 0.92–1.33 for every region except
 * Indonesia (0.50) and PNG (0.65), where the estimate clips at the M6.0
 * edge of the candidate grid — a grid artifact, not a catalogue anomaly.
 * Re-run the script and refresh this table when re-tuning; the recorder
 * refuses regions absent from it.
 */
export const SEISMIC_REGIONS: SeismicRegion[] = [
  { code: 'JAPAN', mag: 5.5, baseRate: 0.548 },
  { code: 'CHILE', mag: 5.5, baseRate: 0.458 },
  { code: 'ALASKA', mag: 5.25, baseRate: 0.521 },
  { code: 'INDONESIA', mag: 6.0, baseRate: 0.46 },
  { code: 'PHILIPPINES', mag: 5.5, baseRate: 0.508 },
  { code: 'TURKEY', mag: 5.0, baseRate: 0.431 },
  { code: 'IRAN', mag: 5.0, baseRate: 0.454 },
  { code: 'MEXICO', mag: 5.0, baseRate: 0.611 },
  { code: 'PERU', mag: 5.25, baseRate: 0.361 },
  { code: 'GREECE', mag: 5.0, baseRate: 0.483 },
  { code: 'CALIFORNIA', mag: 4.5, baseRate: 0.431 },
  { code: 'HIMALAYA', mag: 4.5, baseRate: 0.458 },
  { code: 'PNG', mag: 5.75, baseRate: 0.435 },
  { code: 'ICELAND', mag: 4.5, baseRate: 0.429 },
];

export const SEISMIC_HORIZON_DAYS = 14;

/** The USGS count query the resolver uses — built from STORED params, so the
 *  criterion cannot drift if the region table changes after issue. */
export function usgsCountUrl(box: RegionBox, minMag: number, startDate: string, endDate: string): string {
  return (
    `https://earthquake.usgs.gov/fdsnws/event/1/count?format=geojson` +
    `&starttime=${startDate}&endtime=${endDate}&minmagnitude=${minMag}` +
    `&minlatitude=${box.minLat}&maxlatitude=${box.maxLat}` +
    `&minlongitude=${box.minLon}&maxlongitude=${box.maxLon}`
  );
}
