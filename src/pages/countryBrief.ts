/**
 * Printable Country Brief (/#/brief-country/:code).
 *
 * Professional single-page country brief designed for printing or
 * PDF export. CII score, 6-component breakdown, top signals, data
 * gaps, rule version, timestamp. Suitable for board meetings,
 * briefings, or forwarding.
 */

import { createElement } from '../utils/dom.ts';
import { getCachedCII, getMonitoredCountries, getCIIDelta } from '../services/countryInstabilityIndex.ts';
import { getEntitiesByCountry } from '../services/entityRegistry.ts';
import { CII_RULE_VERSION } from '../services/ruleVersion.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';

export function renderCountryBrief(root: HTMLElement, code: string): void {
  const countryCode = code.toUpperCase();
  setPageSeo({
    ...PAGE_SEO.countryBrief,
    title: `${countryCode} · Country Brief`,
    description: `Printable country brief for ${countryCode}: CII score, 6-component breakdown, top signals, data gaps, rule version. Free.`,
    canonicalPath: `/brief-country/${countryCode}`,
  });
  root.innerHTML = '';
  root.className = 'nw-country-brief-page';
  const scores = getCachedCII();
  const score = scores.find((s) => s.countryCode === countryCode);
  const monitored = getMonitoredCountries().find((c) => c.code === countryCode);

  // Print-optimized toolbar
  const toolbar = createElement('div', { className: 'nw-brief-toolbar no-print' });
  toolbar.innerHTML = `
    <a href="#/intel" class="nw-brief-back">← Back</a>
    <a href="#/live-brief/${countryCode}" class="nw-brief-print" style="text-decoration:none;">▸ Run Live Agent Brief</a>
    <button class="nw-brief-print" onclick="window.print()">🖨 Print / Save as PDF</button>
    <span class="nw-brief-toolbar-note">Tip: use your browser's print dialog → Save as PDF</span>
  `;
  root.appendChild(toolbar);

  const doc = createElement('div', { className: 'nw-brief-doc' });

  // Masthead
  const masthead = createElement('div', { className: 'nw-brief-masthead' });
  masthead.innerHTML = `
    <div class="nw-brief-brand">NEXUSWATCH INTELLIGENCE</div>
    <div class="nw-brief-doc-type">Country Brief</div>
    <div class="nw-brief-date">${new Date().toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    })}</div>
  `;
  doc.appendChild(masthead);

  // Country header
  const title = createElement('div', { className: 'nw-brief-title-section' });
  title.innerHTML = `
    <h1>${monitored?.name ?? countryCode}</h1>
    <div class="nw-brief-code">${countryCode}</div>
  `;
  doc.appendChild(title);

  if (!score) {
    const empty = createElement('div', { className: 'nw-brief-empty' });
    empty.innerHTML = `
      <p>No CII data available for ${countryCode}. The country may not be in the NexusWatch monitored list yet.</p>
      <p>Visit <a href="#/intel">the Intel Map</a> to see all monitored countries.</p>
    `;
    doc.appendChild(empty);
    root.appendChild(doc);
    return;
  }

  // Executive Summary
  const summary = createElement('div', { className: 'nw-brief-summary' });
  const tier = score.score >= 75 ? 'critical' : score.score >= 50 ? 'high' : score.score >= 25 ? 'med' : 'low';
  // Local color reference is still useful for the inline component bars below.
  const scoreColor =
    score.score >= 75
      ? 'var(--color-tension-critical)'
      : score.score >= 50
        ? 'var(--color-tension-high)'
        : score.score >= 25
          ? 'var(--color-tension-med)'
          : 'var(--color-tension-low)';
  const label = score.score >= 75 ? 'CRITICAL' : score.score >= 50 ? 'HIGH' : score.score >= 25 ? 'ELEVATED' : 'STABLE';

  summary.innerHTML = `
    <div class="nw-brief-score-block">
      <div class="nw-brief-score-value nw-tier-${tier}">${score.score}</div>
      <div class="nw-brief-score-label nw-tier-${tier}">${label}</div>
      <div class="nw-brief-score-scale">of 100 — Country Instability Index</div>
    </div>
    <div class="nw-brief-summary-meta">
      <div><strong>Tier:</strong> ${score.tier.toUpperCase()}</div>
      <div><strong>Confidence:</strong> ${score.confidence.toUpperCase()}</div>
      <div><strong>Trend:</strong> ${score.trend.toUpperCase()}</div>
      <div><strong>Rule:</strong> ${CII_RULE_VERSION}</div>
    </div>
  `;
  doc.appendChild(summary);

  // Quick actions (no-print)
  const actions = createElement('div', { className: 'nw-brief-actions no-print' });
  const delta = getCIIDelta(countryCode);
  const deltaText =
    delta !== null && Math.abs(delta) >= 0.5
      ? `<span style="color:${delta > 0 ? '#dc2626' : '#22c55e'};font-family:monospace;font-weight:700">${delta > 0 ? '+' : ''}${delta} since last visit</span> · `
      : '';
  actions.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 0;border-top:1px solid #ddd;border-bottom:1px solid #ddd;margin:16px 0;font-size:12px">
      ${deltaText}
      <a href="#/audit/${countryCode}" style="color:#9a1b1b;text-decoration:none">Evidence Chain \u2192</a>
      <a href="#/compare?codes=${countryCode}" style="color:#9a1b1b;text-decoration:none">Compare \u2192</a>
      <a href="#/watchlist" style="color:#9a1b1b;text-decoration:none">Watchlist \u2192</a>
      <a href="#/intel?country=${countryCode}" style="color:#9a1b1b;text-decoration:none">View on Map \u2192</a>
    </div>
  `;
  doc.appendChild(actions);

  // 6-component breakdown
  const components = createElement('div', { className: 'nw-brief-components' });
  components.innerHTML = '<h2>Risk Components</h2>';
  const COMP_DEFS = [
    { key: 'conflict', label: 'Conflict', max: 20, value: score.components.conflict },
    { key: 'disasters', label: 'Disasters', max: 15, value: score.components.disasters },
    { key: 'sentiment', label: 'Sentiment', max: 15, value: score.components.sentiment },
    { key: 'infrastructure', label: 'Infrastructure', max: 15, value: score.components.infrastructure },
    { key: 'governance', label: 'Governance', max: 15, value: score.components.governance },
    { key: 'marketExposure', label: 'Market Exposure', max: 20, value: score.components.marketExposure },
  ];
  for (const comp of COMP_DEFS) {
    const pct = (comp.value / comp.max) * 100;
    const row = createElement('div', { className: 'nw-brief-comp-row' });
    row.innerHTML = `
      <div class="nw-brief-comp-label">${comp.label}</div>
      <div class="nw-brief-comp-bar-container">
        <div class="nw-brief-comp-bar" style="width: ${pct}%; background: ${scoreColor}"></div>
      </div>
      <div class="nw-brief-comp-value">${comp.value.toFixed(1)} / ${comp.max}</div>
    `;
    components.appendChild(row);
  }
  doc.appendChild(components);

  // Top signals
  if (score.topSignals.length > 0) {
    const signals = createElement('div', { className: 'nw-brief-signals' });
    signals.innerHTML = `
      <h2>Top Signals</h2>
      <ul>${score.topSignals.map((s) => `<li>${s}</li>`).join('')}</ul>
    `;
    doc.appendChild(signals);
  }

  // Evidence sources
  if (score.evidence.components.some((c) => c.sources.length > 0)) {
    const sources = createElement('div', { className: 'nw-brief-sources' });
    sources.innerHTML = '<h2>Evidence Sources</h2>';
    const uniqueSources = new Set<string>();
    for (const c of score.evidence.components) {
      for (const s of c.sources) uniqueSources.add(s.name);
    }
    sources.innerHTML += `<p>${Array.from(uniqueSources).join(' · ')}</p>`;
    sources.innerHTML += `<p class="nw-brief-meta">${score.evidence.totalSourceCount} distinct sources contributed · ${score.evidence.totalDataPoints} data points aggregated</p>`;
    doc.appendChild(sources);
  }

  // Data gaps
  if (score.evidence.summaryGaps.length > 0) {
    const gaps = createElement('div', { className: 'nw-brief-gaps' });
    gaps.innerHTML = "<h2>What We Don't Have</h2>";
    gaps.innerHTML += `<ul>${score.evidence.summaryGaps.map((g) => `<li>${g}</li>`).join('')}</ul>`;
    doc.appendChild(gaps);
  }

  // Associated entities
  const entities = getEntitiesByCountry(countryCode);
  if (entities.length > 0) {
    const entSection = createElement('div', { className: 'nw-brief-entities' });
    entSection.innerHTML = '<h2>Associated Entities</h2>';
    const list = entities.slice(0, 10).map((e) => {
      const sanct = e.sanctioned ? ' 🚫' : '';
      return `<li><strong>${e.name}</strong>${sanct} — ${e.type.replace(/_/g, ' ')}</li>`;
    });
    entSection.innerHTML += `<ul>${list.join('')}</ul>`;
    doc.appendChild(entSection);
  }

  // Methodology footer
  const footer = createElement('div', { className: 'nw-brief-footer' });
  footer.innerHTML = `
    <p><strong>Methodology:</strong> 6-component CII (Conflict 20%, Disasters 15%, Sentiment 15%, Infrastructure 15%, Governance 15%, Market Exposure 20%). Rule version ${CII_RULE_VERSION}. See <a href="https://nexuswatch.dev/#/methodology">nexuswatch.dev/#/methodology</a> for full detail.</p>
    <p><strong>Evidence chain:</strong> Every computation logged and queryable at <a href="https://nexuswatch.dev/#/audit/${countryCode}">nexuswatch.dev/#/audit/${countryCode}</a></p>
    <p class="nw-brief-disclaimer">This brief reflects the state of NexusWatch data at the timestamp shown. Not investment or policy advice. For analytical use only.</p>
  `;
  doc.appendChild(footer);

  root.appendChild(doc);
}
