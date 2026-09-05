/**
 * Public API Documentation (/api).
 * Documentation for the Intelligence API v2.
 */

import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';

export function renderApiDocsPage(container: HTMLElement): void {
  setPageSeo(PAGE_SEO.apidocs);
  container.innerHTML = '';
  container.className = 'nw-apidocs-page';

  const header = createElement('header', { className: 'nw-apidocs-header' });
  header.innerHTML = `
    <a href="#/intel" class="nw-apidocs-back">← Back to Intel Map</a>
    <h1>NexusWatch API v2</h1>
    <p class="nw-apidocs-subtitle">
      Verified geopolitical intelligence for your product. Every response includes
      source attribution, confidence levels, and methodology metadata.
    </p>
  `;
  container.appendChild(header);

  // Quick start
  const quickstart = createElement('section', { className: 'nw-apidocs-section' });
  quickstart.innerHTML = `
    <h2>Quick Start</h2>
    <p>
      All endpoints require an API key in the <code>X-API-Key</code> header or
      <code>?apikey=</code> query parameter. Request a key via
      <a href="mailto:hello@nexuswatch.dev?subject=API%20Access">hello@nexuswatch.dev</a>.
    </p>
    <pre><code>curl -H "X-API-Key: your_key_here" \\
  https://nexuswatch.dev/api/v2/cii</code></pre>
  `;
  container.appendChild(quickstart);

  // Endpoints
  const endpoints = createElement('section', { className: 'nw-apidocs-section' });
  endpoints.innerHTML = `
    <h2>Endpoints</h2>

    <div class="nw-endpoint">
      <div class="nw-endpoint-method">GET</div>
      <div class="nw-endpoint-path">/api/v2/cii</div>
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
      <div class="nw-endpoint-path">/api/v2/cii?code=UA</div>
      <div class="nw-endpoint-desc">Single country with full evidence chain.</div>
    </div>

    <div class="nw-endpoint">
      <div class="nw-endpoint-method">GET</div>
      
    </div>

    <div class="nw-endpoint">
      <div class="nw-endpoint-method">GET</div>
      <div class="nw-endpoint-path">/api/v2/scenario</div>
      <div class="nw-endpoint-desc">List all available scenario simulations.</div>
    </div>

    <div class="nw-endpoint">
      <div class="nw-endpoint-method">GET</div>
      <div class="nw-endpoint-path">/api/v2/scenario?id=hormuz-closure</div>
      <div class="nw-endpoint-desc">Run a specific scenario simulation.</div>
    </div>
  `;
  container.appendChild(endpoints);

  // Rate limits + SLA
  const limits = createElement('section', { className: 'nw-apidocs-section' });
  limits.innerHTML = `
    <h2>Rate Limits</h2>
    <ul>
      <li><strong>Default:</strong> 1,000 requests/day per API key, with webhooks</li>
      <li><strong>Need more?</strong> Email <a href="mailto:hello@nexuswatch.dev">hello@nexuswatch.dev</a> for higher limits</li>
    </ul>
    <p>Data freshness: CII scores update every 5 minutes. Snapshots recorded daily.</p>
  `;
  container.appendChild(limits);

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
  container.appendChild(attribution);
}
