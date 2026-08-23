/**
 * Release Notes / What's New page.
 */

import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';

export function renderReleaseNotes(container: HTMLElement): void {
  setPageSeo(PAGE_SEO.releaseNotes);
  container.innerHTML = '';
  container.className = 'nw-releases-page';

  const header = createElement('header', { className: 'nw-releases-header' });
  header.innerHTML = `
    <a href="#/intel" class="nw-releases-back">← Back to Intel Map</a>
    <h1>What's New</h1>
    <p class="nw-releases-subtitle">Building in public. Shipped, not coming soon.</p>
  `;
  container.appendChild(header);

  const notes = [
    {
      date: '2026-04-19',
      version: 'v2.5',
      title: 'Persona UX Overhaul',
      highlights: [
        'Map coverage expanded to ~157 countries (client-computed estimates; 85 countries carry scored daily history)',
        'Layer presets — one-click modes: Conflict, Trade, Hazards, Intelligence, Everything',
        '13 theater presets (was 7) — Balkans, Gulf, Central Asia, SE Asia, Central America, Nordic',
        '13 compare presets — new regional comparisons for expanded country coverage',
        '"Since you left" — welcome-back card showing CII changes since last visit',
        'CII delta badges — every country score shows change since last session',
        'Regional Risk aggregates — 9 regions with avg/max CII and rising count',
        'Notification bell — unread alert count badge, dropdown with timestamps',
        'Country search — instant results with live CII scores, then Nominatim locations',
        'Saved map views — bookmark camera + layers as named presets (max 10)',
        'Terminal autocomplete — typeahead for commands and locations',
        'First-visit layer key — floating legend explaining the 6 default layers',
        'First-visit aha moment — nearest high-risk country card on first load',
        'FAQ page — 10 answers to predicted support questions',
        'Brief social sharing — Twitter/X + LinkedIn + copy link',
        'Alert rule templates expanded — CII spike, watchlist, chokepoint, multi-signal',
        'Watchlist country markers on globe — orange rings for watched countries',
        'Enriched country detail panel — Watch/Audit/Compare quick actions',
        'Landing headline: "See the world\'s risk in real time"',
        'Error recovery with retry button + status page link',
        '404 page with navigation links',
        'Sentry error monitoring for production',
        'Empty states with CTAs across feed, entities, compare, portfolio',
        'Brief archive pagination (20/page + load more)',
        'Watchlist sorting (CII / trend / name)',
        'Portfolio weight validation with normalize button',
        'Compare page country autocomplete (names + codes)',
        'Mobile sidebar backdrop overlay with tap-to-close',
        'Color contrast fix (WCAG AA compliance)',
        'Help button repositioned (no longer overlaps zoom controls)',
        'New keyboard shortcuts: N (bell), / (search), D (drawer)',
      ],
    },
    {
      date: '2026-04-14',
      version: 'v2.0',
      title: 'Verified Intelligence Platform — Launch',
      highlights: [
        'Map coverage expanded to 150+ countries (up from 23) with a 3-tier system; scored daily history remains a smaller set',
        'Intelligence Confidence System — every CII score decomposes to source data',
        'Verification Engine — CONFIRMED / CORROBORATED / UNVERIFIED badges',
        'Scenario Simulation Engine — 7 preset what-if scenarios',
        'AI Analyst with tool use — cited responses with confidence tags',
        'Portfolio Geopolitical Exposure — map holdings to country risk',
        'Crisis Playbooks — auto-trigger on CII spikes and major events',
        'Time-Travel Scrubber — navigate historical CII data',
        'Prediction Ledger — public accuracy tracking over time',
        'Intelligence API v2 — REST access with attribution',
        'Risk Cascade Engine — 56 cross-border dependency rules',
        'Composite Alerts — AND/OR multi-condition rules with CII thresholds',
        '5 new layers — protest, nuclear threat, cyber, chokepoint threat, refugees',
        'Light Intel Dossier email redesign — every brief, alert, welcome',
        'Platform Data Confidence score in header',
        'Keyboard shortcuts overlay (? key)',
        'Country detail panel with full evidence chain UI',
      ],
    },
    {
      date: '2026-04-11',
      version: 'v1.5',
      title: 'Data Accuracy Autonomy',
      highlights: [
        'Self-healing data pipeline foundations (circuit breakers)',
        'Data health dashboard (admin-gated)',
        'Social autonomy queue (X, LinkedIn, Reddit drafters)',
        'CII history + sparkline visualizations',
        'Timeline bar with historical events',
      ],
    },
    {
      date: '2026-04-08',
      version: 'v1.0',
      title: 'Intelligence Engine Complete',
      highlights: [
        '30 data layers shipped',
        'Personal watchlist system',
        'AI terminal with command interface',
        'Auto-threat detection',
        'Cinema mode global tension index',
      ],
    },
  ];

  const container2 = createElement('div', { className: 'nw-releases-list' });
  for (const note of notes) {
    const entry = createElement('article', { className: 'nw-release-entry' });
    entry.innerHTML = `
      <div class="nw-release-header">
        <div class="nw-release-version">${note.version}</div>
        <div class="nw-release-date">${note.date}</div>
      </div>
      <h2>${note.title}</h2>
      <ul>
        ${note.highlights.map((h) => `<li>${h}</li>`).join('')}
      </ul>
    `;
    container2.appendChild(entry);
  }
  container.appendChild(container2);

  const footer = createElement('footer', { className: 'nw-releases-footer' });
  footer.innerHTML = `
    <p>
      Missing a feature? Want something built next? Email
      <a href="mailto:hello@nexuswatch.dev">hello@nexuswatch.dev</a>.
      We read everything.
    </p>
  `;
  container.appendChild(footer);
}
