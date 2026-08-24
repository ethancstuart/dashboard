/**
 * WGI → governance structural score. Adopted 2026-08-24 (owner decision),
 * same vintage as the UCDP conflict derivation — the structural level is now
 * two-thirds derived (UCDP conflict, WGI governance), with only market
 * exposure still an editorial table.
 *
 * WHAT THIS REPLACED. The hand-set governance table scored governance only
 * where it was a live crisis — most countries sat at 0. World Bank WGI
 * scores it as the continuous structural property it is, and the comparison
 * run before adoption showed the difference concentrated exactly where a
 * sparse table fails: Chad, Zimbabwe, Pakistan, Bangladesh — weak
 * governance, no acute crisis, hand-set ≈ 0, derived ≈ 11.
 *
 * THE MAP. Mean of the six WGI estimates (voice & accountability, political
 * stability, government effectiveness, regulatory quality, rule of law,
 * control of corruption; each ~[−2.5, +2.5], higher = better), through an
 * anchored linear map: +1.8 (Denmark-tier) → 0 instability points, −2.0
 * (Somalia-tier) → 15. Anchors chosen from the observed 2024 range
 * (best +1.80, worst −1.92) rather than the theoretical ±2.5, so the scale
 * spans countries that exist. Like the conflict curve: the map is a
 * judgment, the INPUT is measured.
 *
 * WGI is annual (source-worldbank-governance cron, monthly check); the
 * hand-set table survives only as the fallback for countries WGI does not
 * cover (Taiwan).
 */

export function governanceFromWgi(meanEstimate: number): number {
  const v = (15 * (1.8 - meanEstimate)) / 3.8;
  return Math.round(Math.min(15, Math.max(0, v)) * 10) / 10;
}
