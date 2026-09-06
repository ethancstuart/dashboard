/**
 * Public API Documentation (/api).
 * Documentation for the Intelligence API v2.
 */

import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';
import { pageShell } from '../ui/kit/index.ts';

export function renderApiDocsPage(container: HTMLElement): void {
  setPageSeo(PAGE_SEO.apidocs);
  const main = pageShell(container, { active: '/api' });

  const header = createElement('header', { className: 'nw-apidocs-header' });
  header.innerHTML = `
    <h1>NexusWatch API v2</h1>
    <p class="nw-apidocs-subtitle">
      Verified geopolitical intelligence for your product. Every response includes
      source attribution, confidence levels, and methodology metadata.
    </p>
  `;
  main.appendChild(header);

  // Quick start
  const quickstart = createElement('section', { className: 'nw-apidocs-section' });
  quickstart.innerHTML = `
    <h2>Quick Start</h2>
    <p>
      No key, no auth, no signup. Every endpoint below is open JSON — the same
      data the site renders. Please be reasonable; this runs on a hobby budget.
    </p>
    <pre><code>curl https://nexuswatch.dev/api/calls/ledger</code></pre>
  `;
  main.appendChild(quickstart);

  // Endpoints
  const endpoints = createElement('section', { className: 'nw-apidocs-section' });
  endpoints.innerHTML = `
    <h2>Endpoints</h2>

    <div class="nw-endpoint">
      <div class="nw-endpoint-method">GET</div>
      <div class="nw-endpoint-path">/api/v1/cii</div>
      <div class="nw-endpoint-desc">All 85 scored countries with CII scores, components, and confidence.</div>
      <details>
        <summary>Example response</summary>
        <pre><code>{
  "data": [
    {
      "country_code": "UA",
      "cii_score": 87,
      "confidence": "high",
      "components": {
        "conflict": 18.2,
        "disasters": 1.8,
        "sentiment": 11.4,
        "infrastructure": 5.2,
        "governance": 3.0,
        "market_exposure": 15.0
      },
      "source_count": 5,
      "data_point_count": 47,
      "snapshot_date": "2026-04-14"
    }
  ],
  "meta": {
    "source": "NexusWatch Country Instability Index",
    "methodology": "6-component model...",
    "date": "2026-04-14",
    "count": 86,
    "attribution": "Data sourced from ACLED, USGS, NASA FIRMS, GDELT..."
  }
}</code></pre>
      </details>
    </div>

    <div class="nw-endpoint">
      <div class="nw-endpoint-method">GET</div>
      <div class="nw-endpoint-path">/api/v1/cii?country=UA</div>
      <div class="nw-endpoint-desc">Single country with full evidence chain.</div>
    </div>

    <div class="nw-endpoint">
      <div class="nw-endpoint-method">GET</div>
      
    </div>

    <div class="nw-endpoint">
      <div class="nw-endpoint-method">GET</div>
      <div class="nw-endpoint-path">/api/v1/brief</div>
      <div class="nw-endpoint-desc">The latest daily brief from the archive, ledger line included.</div>
    </div>

    <div class="nw-endpoint">
      <div class="nw-endpoint-method">GET</div>
      <div class="nw-endpoint-path">/api/v1/brief?date=2026-09-05</div>
      <div class="nw-endpoint-desc">A dated brief — the first resolution day, for instance.</div>
    </div>
  `;
  main.appendChild(endpoints);

  // Rate limits + SLA
  const limits = createElement('section', { className: 'nw-apidocs-section' });
  limits.innerHTML = `
    <h2>Rate Limits</h2>
    <p>
      None are enforced today, and we won't advertise limits we don't enforce.
      Limits will be introduced before they are documented, not after.
      Questions: <a href="mailto:hello@nexuswatch.dev">hello@nexuswatch.dev</a>.
    </p>
    <p>Data freshness: the ledger resolves daily at 09:45 UTC; the brief publishes at 10:00 UTC.</p>
  `;
  main.appendChild(limits);

  // Attribution
  const attribution = createElement('section', { className: 'nw-apidocs-section' });
  attribution.innerHTML = `
    <h2>Attribution Requirements</h2>
    <p>
      NexusWatch data is free to use in commercial and non-commercial applications, provided:
    </p>
    <ul>
      <li>You credit NexusWatch as the source</li>
      <li>You link to <code>nexuswatch.dev</code></li>
      <li>You do not remove or hide our confidence levels or source attribution</li>
      <li>You do not claim the data as your own original research</li>
    </ul>
    <p>Example: "Geopolitical risk data via <a href="https://nexuswatch.dev">NexusWatch</a>"</p>
  `;
  main.appendChild(attribution);
}
