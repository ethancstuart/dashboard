/**
 * Seismicity calibration-harness tuning — committed so the thresholds in
 * api/_lib/seismicity.ts are reproducible rather than asserted.
 *
 * For each tectonic region box, finds the magnitude threshold whose Poisson
 * rate over a 14-day window puts P(≥1 event) nearest 0.5, from ten years of
 * USGS history. Also prints the Gutenberg–Richter b-value implied by the
 * count ratios at adjacent magnitudes — for a real catalogue it should sit
 * near 1.0, which is the analytic sanity check this domain exists to provide:
 * if our machinery cannot reproduce ~0 skill and on-diagonal calibration
 * against these base rates, the machinery is broken, not the world.
 *
 * Usage: npx tsx scripts/tune-seismicity.ts
 * Paste the emitted table into SEISMIC_REGIONS in api/_lib/seismicity.ts,
 * with the run date.
 */
import { SEISMIC_REGION_BOXES } from '../api/_lib/seismicity.js';

const YEARS = 10;
const H = 14; // days, matching the other call domains
const end = new Date();
const start = new Date(end.getTime() - YEARS * 365.25 * 86400000);
const totalDays = (end.getTime() - start.getTime()) / 86400000;

const fmt = (d: Date) => d.toISOString().slice(0, 10);

async function usgsCount(
  box: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  minMag: number,
): Promise<number> {
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/count?format=geojson` +
    `&starttime=${fmt(start)}&endtime=${fmt(end)}&minmagnitude=${minMag}` +
    `&minlatitude=${box.minLat}&maxlatitude=${box.maxLat}` +
    `&minlongitude=${box.minLon}&maxlongitude=${box.maxLon}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`usgs_${r.status}: ${url}`);
  const d = (await r.json()) as { count: number };
  return d.count;
}

const MAGS = [4.0, 4.25, 4.5, 4.75, 5.0, 5.25, 5.5, 5.75, 6.0];

console.log(`[tune-seismicity] ${YEARS}y of USGS history, ${H}-day windows, target P≈0.5\n`);
console.log('region          mag   n/10y   λ/14d    P(≥1)   b-value(adjacent)');

for (const [code, box] of Object.entries(SEISMIC_REGION_BOXES)) {
  const counts = new Map<number, number>();
  for (const m of MAGS) {
    counts.set(m, await usgsCount(box, m));
    await new Promise((r) => setTimeout(r, 300)); // be polite to USGS
  }
  let best: { mag: number; p: number; lambda: number } | null = null;
  for (const m of MAGS) {
    const lambda = ((counts.get(m) ?? 0) * H) / totalDays;
    const p = 1 - Math.exp(-lambda);
    if (best === null || Math.abs(p - 0.5) < Math.abs(best.p - 0.5)) best = { mag: m, p, lambda };
  }
  if (!best) continue;
  // G–R b-value from the count ratio one step below/above the chosen mag:
  // log10(N(m)) is linear in m with slope −b, so b = Δlog10(N)/Δm.
  const lo = counts.get(Math.max(4.0, best.mag - 0.5)) ?? 0;
  const hi = counts.get(Math.min(6.0, best.mag + 0.5)) ?? 0;
  const b = lo > 0 && hi > 0 ? (Math.log10(lo) - Math.log10(hi)) / 1.0 : NaN;
  console.log(
    `${code.padEnd(15)} ${best.mag.toFixed(2)}  ${String(counts.get(best.mag)).padStart(6)}  ${best.lambda.toFixed(3)}   ${best.p.toFixed(3)}   ${Number.isFinite(b) ? b.toFixed(2) : 'n/a'}`,
  );
}
console.log('\nPaste chosen (mag, baseRate=P) into SEISMIC_REGIONS with this run date.');
