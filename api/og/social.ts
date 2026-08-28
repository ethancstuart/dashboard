import { ImageResponse } from '@vercel/og';
import { htmlToSatori } from '../_lib/satori-html.js';
import type { VercelRequest } from '@vercel/node';

export const config = { runtime: 'edge' };

/**
 * Programmatic social card generator (D-5, 2026-04-18).
 *
 * Renders branded NexusWatch cards as PNG via @vercel/og (Satori engine).
 * Uses HTML string API (no JSX) since the project has no React dependency.
 *
 * Usage:
 *   GET /api/og/social?type=cii-card&country=UA&score=68&delta=3
 *   GET /api/og/social?type=crisis&country=SD&score=78&delta=8&signals=RSF+advances|Displacement
 *   GET /api/og/social?type=cii-card&country=TW&size=1080x1080  (Instagram)
 *   GET /api/og/social  (brand card, default)
 *
 * Sizes: 1200x630 (default), 1080x1080 (Instagram square)
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

/** Escape HTML entities to prevent XSS in rendered cards. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default async function handler(req: VercelRequest) {
  const url = new URL(req.url!, 'https://nexuswatch.dev');
  const type = url.searchParams.get('type') || 'brand';
  const sizeParam = url.searchParams.get('size') || '1200x630';
  const [width, height] = sizeParam.split('x').map(Number);

  // New marketing post-type params
  const rawTitle = url.searchParams.get('title') || 'NexusWatch Intelligence';
  const title = escapeHtml(rawTitle.slice(0, 80));
  const metric = escapeHtml(url.searchParams.get('metric') || '');
  const layer = escapeHtml(url.searchParams.get('layer') || '');
  const date = escapeHtml(url.searchParams.get('date') || new Date().toISOString().split('T')[0]);
  // country param for new templates: allow longer names (not just 2-letter codes)
  const countryDisplay = escapeHtml((url.searchParams.get('country') || '').slice(0, 40));

  // Legacy params for existing cii-card / crisis templates
  const legacyCountry = (url.searchParams.get('country') || 'UA')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2);
  const countryName = escapeHtml(COUNTRY_NAMES[legacyCountry] || legacyCountry);
  const score = Math.max(0, Math.min(100, parseInt(url.searchParams.get('score') || '65', 10) || 0));
  const delta = Math.max(-100, Math.min(100, parseFloat(url.searchParams.get('delta') || '3') || 0));
  const signals = escapeHtml(url.searchParams.get('signals') || '');
  const today = new Date().toISOString().split('T')[0]; // legacy templates only

  let html: string;

  if (type === 'alert') {
    html = renderMarketingAlert(title, countryDisplay, metric, layer);
  } else if (type === 'data_story') {
    html = renderMarketingDataStory(title, metric, layer, date);
  } else if (type === 'cta') {
    html = renderMarketingCta(title);
  } else if (type === 'product_update') {
    html = renderMarketingProductUpdate(title, date);
  } else if (type === 'cii-card') {
    html = renderCiiCard(legacyCountry, countryName, score, delta, today);
  } else if (type === 'crisis') {
    html = renderCrisisCard(legacyCountry, countryName, score, delta, signals, today);
  } else {
    html = renderBrandCard();
  }

  // htmlToSatori, NOT `html as any` — see api/_lib/satori-html.ts. Every card
  // in this file was rendering blank in production for the same reason
  // /api/og was: Satori takes an element tree, and a string handed to it is
  // laid out as prose, which still returns a valid PNG with a 200 on it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ImageResponse(htmlToSatori(html) as any, { width, height });
}

function renderCiiCard(country: string, countryName: string, score: number, delta: number, date: string): string {
  const color = ciiColor(score);
  const label = ciiLabel(score);
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  const arrow = delta >= 0 ? '▲' : '▼';
  const emoji = flag(country);

  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#0a0a0a;padding:48px 64px;font-family:Inter,system-ui,sans-serif;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#ff6600;font-size:18px;font-weight:700;letter-spacing:0.05em;">NEXUSWATCH</span>
      <span style="color:${color};font-size:12px;font-weight:700;letter-spacing:0.12em;padding:4px 12px;border:1px solid ${color};border-radius:4px;">${label}</span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;">
        <span style="font-size:40px;">${emoji}</span>
        <span style="color:#ededed;font-size:28px;font-weight:700;">${countryName}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:12px;">
        <span style="color:${color};font-size:72px;font-weight:700;font-family:monospace;line-height:1;">${score}</span>
        <span style="color:${delta >= 0 ? '#dc2626' : '#00d4aa'};font-size:24px;font-weight:600;font-family:monospace;">${arrow} ${deltaStr}</span>
      </div>
      <span style="color:#666;font-size:14px;margin-top:8px;letter-spacing:0.08em;">COUNTRY INSTABILITY INDEX</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#666;font-size:12px;">nexuswatch.dev</span>
      <span style="color:#666;font-size:12px;">${date}</span>
    </div>
  </div>`;
}

function renderCrisisCard(
  country: string,
  countryName: string,
  score: number,
  delta: number,
  signals: string,
  date: string,
): string {
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  const signalList = signals ? signals.split('|').slice(0, 3) : [];
  const emoji = flag(country);

  const signalHtml = signalList
    .map(
      (s) =>
        `<div style="display:flex;align-items:center;gap:8px;">
      <span style="color:#dc2626;font-size:14px;">●</span>
      <span style="color:#999;font-size:14px;">${s.trim()}</span>
    </div>`,
    )
    .join('');

  return `<div style="display:flex;flex-direction:column;width:100%;height:100%;background:#0a0a0a;font-family:Inter,system-ui,sans-serif;">
    <div style="display:flex;align-items:center;gap:12px;background:#dc2626;padding:16px 48px;">
      <span style="color:#fff;font-size:14px;font-weight:700;letter-spacing:0.12em;">🔴 NEXUSWATCH CRITICAL ALERT</span>
    </div>
    <div style="display:flex;flex-direction:column;flex:1;padding:32px 48px;justify-content:space-between;">
      <div style="display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
          <span style="font-size:40px;">${emoji}</span>
          <div style="display:flex;flex-direction:column;">
            <span style="color:#ededed;font-size:28px;font-weight:700;">${countryName}</span>
            <span style="color:#dc2626;font-size:18px;font-weight:700;font-family:monospace;">CII ${score} (${deltaStr} 24h)</span>
          </div>
        </div>
        ${signalHtml ? `<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;">${signalHtml}</div>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#ff6600;font-size:14px;font-weight:700;">NEXUSWATCH</span>
        <span style="color:#666;font-size:12px;">${date}</span>
      </div>
    </div>
  </div>`;
}

function renderBrandCard(): string {
  return `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;width:100%;height:100%;background:#0a0a0a;padding:48px;font-family:Inter,system-ui,sans-serif;">
    <span style="color:#ff6600;font-size:32px;font-weight:700;letter-spacing:0.08em;margin-bottom:16px;">NEXUSWATCH</span>
    <span style="color:#ededed;font-size:24px;font-weight:600;text-align:center;">Real-Time Geopolitical Intelligence</span>
    <span style="color:#666;font-size:14px;margin-top:16px;letter-spacing:0.05em;">45+ data layers · 86 countries · AI-powered daily briefs</span>
    <span style="color:#666;font-size:12px;margin-top:24px;">nexuswatch.dev</span>
  </div>`;
}

function renderMarketingAlert(title: string, country: string, metric: string, layer: string): string {
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#1a0505;padding:48px 64px;font-family:Inter,system-ui,sans-serif;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#ff6b35;font-size:16px;font-weight:700;letter-spacing:0.08em;">NEXUSWATCH</span>
      <span style="color:#fff;font-size:11px;font-weight:700;letter-spacing:0.14em;padding:4px 14px;background:#dc2626;border-radius:20px;">ALERT</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      ${country ? `<span style="color:#ff6b35;font-size:48px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${country}</span>` : ''}
      ${metric ? `<span style="color:#fff;font-size:72px;font-weight:700;line-height:1;">${metric}</span>` : ''}
      <span style="color:#e0e0e0;font-size:28px;font-weight:600;line-height:1.3;">${title}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      ${layer ? `<span style="color:#888;font-size:13px;letter-spacing:0.06em;">SOURCE: ${layer}</span>` : '<span></span>'}
      <span style="color:#ff6b35;font-size:13px;font-weight:600;">nexuswatch.dev</span>
    </div>
  </div>`;
}

function renderMarketingDataStory(title: string, metric: string, layer: string, date: string): string {
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#0a0f1e;padding:48px 64px;font-family:Inter,system-ui,sans-serif;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#ff6600;font-size:16px;font-weight:700;letter-spacing:0.08em;">NEXUSWATCH</span>
      <span style="color:#3b82f6;font-size:12px;letter-spacing:0.1em;">${date}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${metric ? `<span style="color:#3b82f6;font-size:56px;font-weight:700;line-height:1;">${metric}</span>` : ''}
      <span style="color:#ededed;font-size:32px;font-weight:600;line-height:1.3;">${title}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      ${layer ? `<span style="color:#666;font-size:13px;letter-spacing:0.06em;">via ${layer}</span>` : '<span></span>'}
      <span style="color:#666;font-size:13px;">nexuswatch.dev</span>
    </div>
  </div>`;
}

function renderMarketingCta(valueProp: string): string {
  return `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;width:100%;height:100%;background:#0a0f1e;padding:48px;font-family:Inter,system-ui,sans-serif;gap:20px;">
    <span style="color:#ff6600;font-size:48px;font-weight:700;letter-spacing:0.08em;">NEXUSWATCH</span>
    <span style="color:#ededed;font-size:24px;font-weight:500;text-align:center;max-width:800px;">${valueProp}</span>
    <span style="color:#f59e0b;font-size:18px;font-weight:600;letter-spacing:0.04em;">Free. Forever. No account required to read.</span>
    <span style="color:#555;font-size:14px;margin-top:8px;">nexuswatch.dev</span>
  </div>`;
}

function renderMarketingProductUpdate(title: string, date: string): string {
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#0a0f1e;padding:48px 64px;font-family:Inter,system-ui,sans-serif;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#10b981;font-size:12px;font-weight:700;letter-spacing:0.12em;padding:4px 14px;background:#052e16;border:1px solid #10b981;border-radius:20px;">NOW LIVE</span>
      <span style="color:#ff6600;font-size:16px;font-weight:700;letter-spacing:0.08em;">NEXUSWATCH</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px;">
      <span style="color:#ededed;font-size:40px;font-weight:700;line-height:1.2;">${title}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#666;font-size:12px;">${date}</span>
      <span style="color:#10b981;font-size:13px;">nexuswatch.dev</span>
    </div>
  </div>`;
}
