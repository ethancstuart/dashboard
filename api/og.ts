import { ImageResponse } from '@vercel/og';
import type { VercelRequest } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { htmlToSatori } from './_lib/satori-html.js';

export const config = { runtime: 'edge' };

/**
 * Top-level OG image generator at /api/og.
 *
 * Three marquee variants for marketing surfaces:
 *   - type=site                       Default site card. Wordmark + tagline + Free. badge.
 *   - type=brief&date=YYYY-MM-DD      Daily brief card. Date, headline, tension index.
 *   - type=country&iso=XX             Country card. Name, flag emoji, current CII score.
 *   - type=ledger                     The book, as it stands. Open/resolved counts.
 *   - type=call&id=N                  ONE call: the claim, the stated probability,
 *                                     the resolution date, and the outcome if any.
 *
 * The ledger and call cards exist because /ledger and /call/:id are the two
 * pages the whole positioning rests on being forwardable, and both unfurled to
 * NOTHING: api/_lib/ssr-shell.ts declared twitter:card=summary_large_image and
 * emitted no image. Everything on the call card is read from the calls row —
 * the claim, the probability and the resolution date, all frozen at issue. If
 * the row cannot be read, the generic site card is served rather than a card
 * with invented numbers on it.
 *
 * Output: 1200x630 PNG, JetBrains-mono terminal copy, dark bg.
 * Cache: public, max-age=3600, s-maxage=86400.
 *
 * The product is FREE — no Pro/Founding/$X tier copy lives in any of these
 * templates. Tier-specific marketing cards live in /api/og/social for the
 * automated marketing pipeline.
 */

const COUNTRY_NAMES: Record<string, string> = {
  AF: 'Afghanistan',
  AR: 'Argentina',
  AU: 'Australia',
  BD: 'Bangladesh',
  BF: 'Burkina Faso',
  BR: 'Brazil',
  CA: 'Canada',
  CD: 'DR Congo',
  CN: 'China',
  CO: 'Colombia',
  DE: 'Germany',
  EG: 'Egypt',
  ET: 'Ethiopia',
  FR: 'France',
  GB: 'United Kingdom',
  HT: 'Haiti',
  IL: 'Israel',
  IN: 'India',
  IQ: 'Iraq',
  IR: 'Iran',
  IT: 'Italy',
  JP: 'Japan',
  KP: 'North Korea',
  KR: 'South Korea',
  LB: 'Lebanon',
  LY: 'Libya',
  ML: 'Mali',
  MM: 'Myanmar',
  MX: 'Mexico',
  NG: 'Nigeria',
  PK: 'Pakistan',
  PL: 'Poland',
  PS: 'Palestine',
  RO: 'Romania',
  RU: 'Russia',
  SA: 'Saudi Arabia',
  SD: 'Sudan',
  SO: 'Somalia',
  SS: 'South Sudan',
  SY: 'Syria',
  TD: 'Chad',
  TR: 'Turkey',
  TW: 'Taiwan',
  UA: 'Ukraine',
  US: 'United States',
  VE: 'Venezuela',
  YE: 'Yemen',
  ZA: 'South Africa',
};

function flag(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}

function ciiColor(score: number): string {
  if (score >= 70) return '#dc2626';
  if (score >= 50) return '#ff6600';
  if (score >= 30) return '#e5a913';
  return '#00d4aa';
}

function ciiLabel(score: number): string {
  if (score >= 70) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 30) return 'ELEVATED';
  return 'LOW';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
// Source Serif 4 is being added by Track D; until that lands, fall back to a
// system serif so this endpoint always renders cleanly.
const SERIF = "'Source Serif 4', 'Tiempos Headline', Georgia, 'Times New Roman', serif";

function renderSiteCard(): string {
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#04050a;padding:64px 72px;font-family:${MONO};">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#ff6600;font-size:22px;font-weight:700;letter-spacing:0.18em;">NEXUSWATCH</span>
      <span style="color:#04050a;background:#00d4aa;font-size:13px;font-weight:700;letter-spacing:0.18em;padding:6px 14px;border-radius:999px;">FREE.</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;">
      <span style="color:#ededed;font-size:64px;font-weight:600;line-height:1.1;font-family:${SERIF};">Real-time geopolitical intelligence.</span>
      <span style="color:#7a8290;font-size:22px;font-weight:500;line-height:1.4;">45+ live data layers · 86 countries scored · daily AI brief</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#5a6370;font-size:14px;letter-spacing:0.08em;">nexuswatch.dev</span>
      <span style="color:#5a6370;font-size:14px;letter-spacing:0.08em;">// terminal for the world</span>
    </div>
  </div>`;
}

function renderBriefCard(date: string, headline: string, tension: number | null): string {
  const tColor = tension == null ? '#7a8290' : ciiColor(tension);
  const tLabel = tension == null ? 'TENSION INDEX' : `TENSION ${tension}`;
  const safeHeadline = escapeHtml(headline.slice(0, 140));
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#04050a;padding:64px 72px;font-family:${MONO};">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#ff6600;font-size:18px;font-weight:700;letter-spacing:0.18em;">NEXUSWATCH · BRIEF</span>
      <span style="color:#04050a;background:#00d4aa;font-size:11px;font-weight:700;letter-spacing:0.18em;padding:5px 12px;border-radius:999px;">FREE.</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:18px;">
      <span style="color:#7a8290;font-size:18px;letter-spacing:0.14em;">SITREP · ${escapeHtml(date)}</span>
      <span style="color:#ededed;font-size:46px;font-weight:600;line-height:1.2;font-family:${SERIF};">${safeHeadline}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="color:${tColor};font-size:16px;font-weight:700;letter-spacing:0.14em;">${tLabel}</span>
      <span style="color:#5a6370;font-size:14px;">nexuswatch.dev/brief/${escapeHtml(date)}</span>
    </div>
  </div>`;
}

function renderCountryCard(iso: string, name: string, score: number | null): string {
  const color = score == null ? '#7a8290' : ciiColor(score);
  const label = score == null ? 'NO DATA' : ciiLabel(score);
  const display = score == null ? '—' : String(score);
  const emoji = flag(iso);
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#04050a;padding:64px 72px;font-family:${MONO};">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#ff6600;font-size:18px;font-weight:700;letter-spacing:0.18em;">NEXUSWATCH · COUNTRY</span>
      <span style="color:${color};font-size:12px;font-weight:700;letter-spacing:0.18em;padding:5px 12px;border:1px solid ${color};border-radius:4px;">${label}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:center;gap:24px;">
        <span style="font-size:88px;line-height:1;">${emoji}</span>
        <span style="color:#ededed;font-size:56px;font-weight:600;font-family:${SERIF};">${escapeHtml(name)}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:18px;">
        <span style="color:${color};font-size:128px;font-weight:700;font-family:${MONO};line-height:1;">${display}</span>
        <span style="color:#7a8290;font-size:18px;letter-spacing:0.14em;">CII · 0-100</span>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#04050a;background:#00d4aa;font-size:11px;font-weight:700;letter-spacing:0.18em;padding:5px 12px;border-radius:999px;">FREE.</span>
      <span style="color:#5a6370;font-size:14px;">nexuswatch.dev/country/${escapeHtml(iso)}</span>
    </div>
  </div>`;
}

export interface LedgerFacts {
  open: number;
  resolved: number;
  hits: number;
  nextResolves: string | null;
}

export interface CallFacts {
  id: number;
  countryCode: string;
  claim: string;
  probability: number;
  resolvesOn: string;
  madeOn: string;
  status: string;
}

/** HIT green / MISS red / anything unresolved in the muted grey. */
function statusColor(status: string): string {
  if (status === 'hit') return '#00d4aa';
  if (status === 'miss') return '#dc2626';
  return '#7a8290';
}

export function renderLedgerCard(f: LedgerFacts | null): string {
  // With nothing resolved there is no accuracy number to show, and inventing
  // one on the most forwardable surface we have would be the exact failure
  // the ledger exists to make impossible. Show the open book instead.
  const leftValue = f === null ? '—' : String(f.open);
  const rightValue = f === null || f.resolved === 0 ? '—' : `${f.hits}/${f.resolved}`;
  const rightLabel = f === null || f.resolved === 0 ? 'NOTHING RESOLVED YET' : 'CALLS THAT LANDED';
  const foot =
    f === null
      ? 'nexuswatch.dev/ledger'
      : f.nextResolves && f.resolved === 0
        ? `first resolves ${escapeHtml(f.nextResolves)}`
        : `nexuswatch.dev/ledger`;
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#04050a;padding:64px 72px;font-family:${MONO};">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#ff6600;font-size:18px;font-weight:700;letter-spacing:0.18em;">NEXUSWATCH · THE LEDGER</span>
      <span style="color:#04050a;background:#00d4aa;font-size:11px;font-weight:700;letter-spacing:0.18em;padding:5px 12px;border-radius:999px;">FREE.</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:22px;">
      <span style="color:#ededed;font-size:44px;font-weight:600;line-height:1.15;font-family:${SERIF};">Every call we make, scored against something that isn’t us.</span>
      <div style="display:flex;align-items:flex-end;gap:64px;">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <span style="color:#ededed;font-size:96px;font-weight:700;line-height:1;font-family:${MONO};">${leftValue}</span>
          <span style="color:#7a8290;font-size:15px;letter-spacing:0.14em;">CALLS OPEN</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <span style="color:#00d4aa;font-size:96px;font-weight:700;line-height:1;font-family:${MONO};">${rightValue}</span>
          <span style="color:#7a8290;font-size:15px;letter-spacing:0.14em;">${rightLabel}</span>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#5a6370;font-size:14px;letter-spacing:0.08em;">resolved by an external source, on a date fixed in advance</span>
      <span style="color:#5a6370;font-size:14px;letter-spacing:0.08em;">${foot}</span>
    </div>
  </div>`;
}

export function renderCallCard(c: CallFacts): string {
  const color = statusColor(c.status);
  const verdict = c.status === 'hit' ? 'HIT' : c.status === 'miss' ? 'MISS' : c.status === 'void' ? 'VOID' : 'OPEN';
  const stated = `${Math.round(c.probability * 100)}%`;
  // Truncated in JS, not by CSS: Satori has no reliable line-clamp, and a
  // claim that overflows the card is a claim nobody can read.
  const claim = escapeHtml(c.claim.length > 130 ? `${c.claim.slice(0, 129)}…` : c.claim);
  const resolutionLine =
    c.status === 'pending' ? `RESOLVES ${escapeHtml(c.resolvesOn)}` : `RESOLVED ${escapeHtml(c.resolvesOn)}`;
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#04050a;padding:64px 72px;font-family:${MONO};">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#ff6600;font-size:18px;font-weight:700;letter-spacing:0.18em;">NEXUSWATCH · CALL #${c.id}</span>
      <span style="color:${color};font-size:12px;font-weight:700;letter-spacing:0.18em;padding:5px 12px;border:1px solid ${color};border-radius:4px;">${verdict}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:20px;">
      <span style="color:#7a8290;font-size:18px;letter-spacing:0.14em;">${escapeHtml(c.countryCode)} · STATED ${escapeHtml(c.madeOn)}</span>
      <span style="color:#ededed;font-size:40px;font-weight:600;line-height:1.2;font-family:${SERIF};">${claim}</span>
      <div style="display:flex;align-items:baseline;gap:20px;">
        <span style="color:#ff6600;font-size:104px;font-weight:700;line-height:1;font-family:${MONO};">${stated}</span>
        <span style="color:#7a8290;font-size:18px;letter-spacing:0.14em;">WHAT WE SAID</span>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="color:${color};font-size:16px;font-weight:700;letter-spacing:0.14em;">${resolutionLine}</span>
      <span style="color:#5a6370;font-size:14px;">nexuswatch.dev/call/${c.id}</span>
    </div>
  </div>`;
}

async function fetchLedgerFacts(): Promise<LedgerFacts | null> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  try {
    const sql = neon(dbUrl);
    // The seismicity exclusion mirrors api/ledger.ts exactly. It is a
    // calibration harness, not a claim, and a card that counted it would
    // disagree with the page it links to.
    const rows = (await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending' AND kind <> 'seismicity_window')::int AS open,
        COUNT(*) FILTER (WHERE status <> 'pending' AND kind <> 'seismicity_window')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'hit' AND kind <> 'seismicity_window')::int AS hits,
        MIN(resolves_on) FILTER (WHERE status = 'pending')::text AS next_resolves
      FROM calls
    `) as Array<{ open: number; resolved: number; hits: number; next_resolves: string | null }>;
    if (rows.length === 0) return null;
    return {
      open: rows[0].open ?? 0,
      resolved: rows[0].resolved ?? 0,
      hits: rows[0].hits ?? 0,
      nextResolves: rows[0].next_resolves,
    };
  } catch {
    return null;
  }
}

async function fetchCallFacts(id: number): Promise<CallFacts | null> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  try {
    const sql = neon(dbUrl);
    const rows = (await sql`
      SELECT id, country_code, claim, probability::float AS probability,
             resolves_on::text AS resolves_on, made_on::text AS made_on, status
      FROM calls WHERE id = ${id}
    `) as Array<{
      id: number;
      country_code: string;
      claim: string;
      probability: number;
      resolves_on: string;
      made_on: string;
      status: string;
    }>;
    if (rows.length === 0) return null;
    const r = rows[0];
    if (typeof r.probability !== 'number' || !Number.isFinite(r.probability)) return null;
    return {
      id: r.id,
      countryCode: r.country_code,
      claim: r.claim,
      probability: r.probability,
      resolvesOn: r.resolves_on,
      madeOn: r.made_on,
      status: r.status,
    };
  } catch {
    return null;
  }
}

async function fetchBrief(date: string): Promise<{ headline: string; tension: number | null }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { headline: 'Daily geopolitical intelligence brief.', tension: null };
  try {
    const sql = neon(dbUrl);
    const rows = (await sql`
      SELECT summary, content FROM daily_briefs WHERE brief_date = ${date} LIMIT 1
    `) as Array<{ summary: string | null; content: unknown }>;
    if (rows.length === 0) return { headline: 'Daily geopolitical intelligence brief.', tension: null };
    let headline = (rows[0].summary || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    let tension: number | null = null;
    try {
      const c =
        typeof rows[0].content === 'string'
          ? (JSON.parse(rows[0].content) as { tensionIndex?: number; topRiskCountries?: Array<{ name?: string }> })
          : (rows[0].content as { tensionIndex?: number; topRiskCountries?: Array<{ name?: string }> }) || {};
      if (typeof c.tensionIndex === 'number') tension = Math.round(c.tensionIndex);
      if (!headline && c.topRiskCountries?.[0]?.name) {
        headline = `Top risk: ${c.topRiskCountries[0].name}.`;
      }
    } catch {
      /* fall back */
    }
    if (!headline) headline = 'Daily geopolitical intelligence brief.';
    return { headline, tension };
  } catch {
    return { headline: 'Daily geopolitical intelligence brief.', tension: null };
  }
}

async function fetchCountryScore(iso: string): Promise<number | null> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  try {
    const sql = neon(dbUrl);
    const rows = (await sql`
      SELECT score FROM country_cii_history
      WHERE country_code = ${iso}
      ORDER BY computed_at DESC NULLS LAST, snapshot_date DESC NULLS LAST
      LIMIT 1
    `) as Array<{ score: number | string }>;
    if (rows.length === 0) return null;
    const n = typeof rows[0].score === 'string' ? parseFloat(rows[0].score) : rows[0].score;
    return Number.isFinite(n) ? Math.round(n) : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest) {
  const url = new URL(req.url!, 'https://nexuswatch.dev');
  const type = url.searchParams.get('type') || 'site';

  let html: string;

  if (type === 'brief') {
    const date = (url.searchParams.get('date') || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
    const { headline, tension } = await fetchBrief(safeDate);
    html = renderBriefCard(safeDate, headline, tension);
  } else if (type === 'ledger') {
    html = renderLedgerCard(await fetchLedgerFacts());
  } else if (type === 'call') {
    const idRaw = url.searchParams.get('id') ?? '';
    const id = Number.parseInt(idRaw, 10);
    const call = Number.isInteger(id) && id > 0 && String(id) === idRaw ? await fetchCallFacts(id) : null;
    // No row, no card about it. A fabricated call card is worse than a
    // generic one, and this endpoint is reachable with any id in the query.
    html = call === null ? renderSiteCard() : renderCallCard(call);
  } else if (type === 'country') {
    const iso = (url.searchParams.get('iso') || 'US')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 2);
    const name = COUNTRY_NAMES[iso] || iso;
    const score = await fetchCountryScore(iso);
    html = renderCountryCard(iso, name, score);
  } else {
    html = renderSiteCard();
  }

  // htmlToSatori, NOT `html as any`. Satori takes an element tree; handed a
  // raw string it renders the markup itself as prose and still returns a valid
  // 1200x630 PNG — which is what production was serving on every one of these
  // cards until 2026-08-28 (blank white, verified by curl + eyes, not by
  // status code). See api/_lib/satori-html.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = new ImageResponse(htmlToSatori(html) as any, { width: 1200, height: 630 });
  // ImageResponse sets its own headers; layer cache headers on top.
  response.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  return response;
}
