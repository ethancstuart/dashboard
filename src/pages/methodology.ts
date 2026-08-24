import '../styles/briefs.css'; // Reuse briefs page styling
import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';

/**
 * CII Methodology page — explains the Country Instability Index algorithm.
 * Route: /#/methodology
 */
export function renderMethodology(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.methodology);
  root.textContent = '';

  const page = createElement('div', { className: 'briefs-page' });
  page.innerHTML = `
    <nav class="briefs-nav">
      <a href="#/" class="briefs-nav-logo">NexusWatch</a>
      <div class="briefs-nav-links">
        <a href="#/intel" class="briefs-nav-link">PLATFORM</a>
        <a href="#/briefs" class="briefs-nav-link">BRIEFS</a>
        <a href="https://brief.nexuswatch.dev" target="_blank" class="briefs-nav-link briefs-nav-subscribe">SUBSCRIBE</a>
      </div>
    </nav>

    <article class="brief-article method-article">
      <div class="method-eyebrow">METHODOLOGY</div>
      <h1 class="method-title">How NexusWatch scores risk</h1>
      <p class="method-lede">Data sources, trust layer, and verification methodology behind every CII score.</p>

      <h2 class="brief-section-header">The Trust Layer</h2>
      <p>Every NexusWatch number is <strong>auditable</strong>. Click any CII score in the platform and you'll see the data points that computed it — USGS quakes, OONI censorship measurements, GDELT-derived signals — and, just as importantly, which components are static baselines rather than live feeds. Alongside, we publish:</p>
      <ul class="method-list">
        <li><strong>Confidence levels</strong> (HIGH/MEDIUM/LOW) based on source count, freshness, and data volume</li>
        <li><strong>Verification badges</strong> — events are CONFIRMED (3+ sources), CORROBORATED (2), UNVERIFIED (1), or CONTESTED</li>
        <li><strong>Explicit data gaps</strong> — we show you what we DON'T have, not just what we do</li>
        <li><strong>Source freshness</strong> — live/recent/stale/offline indicators on every feed</li>
        <li><strong>The Ledger</strong> — every dated, falsifiable call, resolved against external sources, at <a class="method-link" href="#/ledger">/ledger</a></li>
      </ul>

      <h2 class="brief-section-header">What is CII?</h2>
      <p>As of <strong>2026-08-23</strong> the Country Instability Index is <strong>two numbers, never one sum</strong>:</p>
      <ul class="method-list">
        <li><strong>The structural level (0–100)</strong> — conflict, governance and market-exposure baselines, reviewed and vintage-dated. It changes when the baselines are reviewed, not daily. Bands: ≥80 severe, 60–79 elevated, 40–59 mixed, &lt;40 stable.</li>
        <li><strong>The daily deviation (points)</strong> — today's live signal on top of the level: earthquakes (USGS), confirmed censorship (OONI), FX stress, attention spikes (Wikipedia). 0 is a quiet day, and it mean-reverts by construction as rolling feeds age out.</li>
      </ul>
      <p>Why the split: measured over 90 days of our own history, the conflict component moved in <strong>0 of 85 countries</strong>, governance in 7 and market exposure in 16 — those were a slow baseline wearing a live label — while the old "sentiment" component was defined as conflict×0.5 + disasters×0.3, an echo of other components that double-counted both. Summing a static level with mean-reverting live noise produced daily "moves" that were mostly a rolling 24-hour feed aging out. Publishing the two parts separately is the honest version of the same information.</p>
      <p>NexusWatch keeps <strong>scored daily history for 85 countries</strong> — the set every forecast, snapshot and ledger call runs on. The map additionally displays client-computed estimates for roughly 157 countries across three tiers (Core, Extended, Monitor); those estimates carry no scored history and are labelled accordingly.</p>
      <p>CII powers the daily intelligence brief, correlation detection engine, scenario simulation, verification engine, and portfolio exposure calculations.</p>

      <h2 class="brief-section-header">Data Sources (12 primary)</h2>
      <p>Every CII component and every layer displays which sources contributed. Current primary sources:</p>
      <ul class="method-list">
        <li><strong>UCDP GED</strong> — Uppsala Conflict Data Program georeferenced events: monthly candidate files (~1 month lag) plus annual curated releases; drives the derived conflict baseline. GDELT-derived headlines remain a brief-side signal. ACLED is not an input (legacy API retired; account read-access pending).</li>
        <li><strong>USGS</strong> — earthquake hazards feed (60s refresh)</li>
        <li><strong>NASA FIRMS</strong> — active fire hotspots via MODIS/VIIRS (10min)</li>
        <li><strong>GDELT</strong> — global news events with tone analysis, 65+ languages (15min)</li>
        <li><strong>WHO</strong> — disease outbreak news (hourly)</li>
        <li><strong>Open-Meteo</strong> — severe weather alerts (15min)</li>
        <li><strong>OpenSky</strong> — live aircraft positions from ADS-B (30s)</li>
        <li><strong>AIS Marine Traffic</strong> — ship positions (5min)</li>
        <li><strong>Polymarket</strong> — prediction market odds (5min)</li>
        <li><strong>Cloudflare Radar</strong> — internet traffic anomalies (5min)</li>
        <li><strong>OFAC</strong> — US sanctions list (daily)</li>
        <li><strong>UNHCR</strong> — refugee displacement data (daily)</li>
      </ul>

      <h2 class="brief-section-header">The Components</h2>
      <p>The <strong>structural level</strong> is the rescaled sum of Conflict + Governance + Market Exposure (55 native points → 0–100). The <strong>daily deviation</strong> is the sum of Disasters + Infrastructure/Censorship + Attention + FX stress, reported in raw points. The two are never added together:</p>

      <div class="method-components">
        <div class="method-component">
          <div class="method-component-header">
            <span class="method-component-name">Conflict (structural)</span>
            <span class="method-component-range">0–20 pts</span>
          </div>
          <p>As of <strong>2026-08-24</strong>: the maximum of two parts. A <strong>UCDP-derived score</strong> — trailing-12-month battle-related deaths from the UCDP Georeferenced Event Dataset (monthly candidate files + annual curated releases), through a documented log curve (100 deaths/yr ≈ 4, 1,000 ≈ 9, 100,000 → 20) — and a <strong>hand-set fragility floor</strong> that encodes what trailing deaths miss: frozen conflicts (Yemen, Syria), suppressed ones (North Korea), and Palestine, whose events UCDP codes under Israel. The derived side is what caught Mexico sitting at a hand-set zero with ~3,100 cartel-war deaths a year. Both parts are published in the component breakdown (<code>conflictDerived</code>, <code>conflictFloor</code>).</p>
          <p class="method-formula">Structural side = max(fragility floor, UCDP-derived curve), reviewed monthly as new UCDP candidate files land. Live same-day conflict events (when a real-time feed is restored) count toward the daily deviation instead.</p>
        </div>

        <div class="method-component">
          <div class="method-component-header">
            <span class="method-component-name">Disasters (deviation)</span>
            <span class="method-component-range">0–15 pts</span>
          </div>
          <p>Natural disaster exposure. Based on <strong>USGS earthquake data</strong> — counts nearby seismic events and weights by magnitude. A single M6.0+ earthquake near a country can push this component to maximum.</p>
          <p class="method-formula">Score = (nearby_quake_count × 1.5) + (max_magnitude > 5 ? (mag - 5) × 4 : 0), capped at 15</p>
        </div>

        <div class="method-component">
          <div class="method-component-header">
            <span class="method-component-name">Attention (deviation)</span>
            <span class="method-component-range">0–8 pts</span>
          </div>
          <p>Wikipedia pageview z-score spikes only. The old "sentiment" definition (conflict×0.5 + disasters×0.3) was retired 2026-08-23: it was an echo of other components, not a signal, and it silently raised the effective conflict weight to 30/100 while this page said 20.</p>
          <p class="method-formula">Score = conflict × 0.5 + disasters × 0.3, capped at 15</p>
        </div>

        <div class="method-component">
          <div class="method-component-header">
            <span class="method-component-name">Infrastructure / Censorship (deviation)</span>
            <span class="method-component-range">0–15 pts</span>
          </div>
          <p>Infrastructure disruption risk. Currently sourced from <strong>IODA internet outage monitoring</strong>. Critical outages score 15, high outages score 10, moderate score 5. Countries with frequent communications blackouts during crises score persistently high.</p>
          <p class="method-formula">Score = severity-based: critical=15, high=10, moderate=5, low=1</p>
        </div>

        <div class="method-component">
          <div class="method-component-header">
            <span class="method-component-name">Governance (structural)</span>
            <span class="method-component-range">0–15 pts</span>
          </div>
          <p>Structural governance risk. Uses <strong>baseline scores</strong> reflecting authoritarianism, sanctions exposure, and institutional fragility. Also adjusts upward when conflict is elevated — countries at war have degraded governance by definition. North Korea (15), Iran (13), and Syria (13) lead this component.</p>
          <p class="method-formula">Score = max(baseline_governance, conflict_derived), capped at 15</p>
        </div>

        <div class="method-component">
          <div class="method-component-header">
            <span class="method-component-name">Market Exposure (structural)</span>
            <span class="method-component-range">0–20 pts</span>
          </div>
          <p>Economic vulnerability to instability. <strong>Static weights</strong> reflecting a country's impact on global energy markets, supply chains, and trade routes. North Korea scores 20 (maximum unpredictability), Afghanistan 19, while stable economies like the US, Germany, and UK score 2-3.</p>
          <p class="method-formula">Score = static_weight per country (0-20), reflecting global economic impact potential</p>
        </div>
      </div>

      <h2 class="brief-section-header">How Scores Are Computed</h2>
      <p><strong>CII = Conflict + Disasters + Sentiment + Infrastructure + Governance + Market Exposure</strong></p>
      <p>Maximum theoretical score: 100 (20 + 15 + 15 + 15 + 15 + 20). In practice, no country currently scores above 60.</p>

      <h2 class="brief-section-header">Threat Levels</h2>
      <div class="method-levels">
        <div class="method-level"><span class="method-level-tag is-critical">&#x1f534; Critical</span> — CII ≥ 70. Active crisis requiring immediate attention.</div>
        <div class="method-level"><span class="method-level-tag is-high">&#x1f7e0; High</span> — CII 50–69. Elevated instability across multiple domains.</div>
        <div class="method-level"><span class="method-level-tag is-med">&#x1f7e1; Elevated</span> — CII 30–49. Notable risk factors present.</div>
        <div class="method-level"><span class="method-level-tag is-low">&#x1f7e2; Low</span> — CII < 30. Stable conditions with manageable risk.</div>
      </div>

      <h2 class="brief-section-header">Data Sources</h2>
      <table class="method-table">
        <tr><td>ACLED</td><td>Armed conflict events — <strong>feed offline</strong>; conflict currently baseline + GDELT-derived</td><td>Unavailable</td></tr>
        <tr><td>USGS</td><td>Earthquake events, magnitude, location</td><td>Every 5 min</td></tr>
        <tr><td>IODA</td><td>Internet outage monitoring by country</td><td>Hourly</td></tr>
        <tr><td>NexusWatch Baselines</td><td>Conflict, governance, market exposure weights</td><td>Updated monthly</td></tr>
      </table>

      <h2 class="brief-section-header">Update Frequency</h2>
      <p>CII scores are recomputed <strong>every 5 minutes</strong> via a Vercel cron job. Historical scores are stored in a PostgreSQL database with timestamps, enabling 7-day, 14-day, and 30-day trend analysis.</p>
      <p>The daily NexusWatch Brief includes CII trajectory analysis — identifying which countries are rising, falling, or volatile over the past week.</p>

      <h2 class="brief-section-header">Live CII Scores</h2>
      <div id="method-live-cii" class="method-live-cii" aria-busy="true" aria-live="polite">
        <div class="nw-skel" style="height:18px;width:100%;margin-bottom:var(--space-2)"></div>
        <div class="nw-skel" style="height:14px;width:80%;margin-bottom:var(--space-2)"></div>
        <div class="nw-skel" style="height:14px;width:90%;margin-bottom:var(--space-2)"></div>
        <div class="nw-skel" style="height:14px;width:70%"></div>
      </div>

      <h2 class="brief-section-header">Limitations & Future Work</h2>
      <ul class="method-list">
        <li><strong>Sentiment</strong> is currently approximated from conflict/disaster intensity. GDELT news tone analysis will provide true media sentiment when IP access is restored.</li>
        <li><strong>Infrastructure</strong> primarily covers internet outages. Future versions will incorporate power grid, water, and healthcare facility data.</li>
        <li><strong>Baseline scores</strong> for conflict, governance, and market exposure are manually curated. An automated calibration system using historical event data is planned.</li>
        <li><strong>50 countries</strong> are monitored. Coverage will expand based on user demand and data source availability.</li>
      </ul>

      <h2 class="brief-section-header">Open Source</h2>
      <p>The CII computation is fully open source. The algorithm runs in <code class="method-code">api/cron/compute-cii.ts</code> and can be inspected on <a class="method-link" href="https://github.com/ethancstuart/nexus-watch" target="_blank" rel="noopener">GitHub</a>.</p>

      <div class="method-cta-row">
        <a href="#/intel" class="method-cta">EXPLORE CII ON THE LIVE MAP →</a>
      </div>
    </article>

    <footer class="briefs-footer">
      <span>NexusWatch Intelligence Platform</span>
      <a href="#/briefs">Briefs</a>
      <a href="#/intel">Live Map</a>
    </footer>
  `;

  root.appendChild(page);

  // Load live CII scores
  const ciiEl = document.getElementById('method-live-cii');
  if (ciiEl) {
    fetch('/api/v1/cii')
      .then((r) => r.json())
      .then((data) => {
        const scores = (data.scores || []) as Array<{
          countryName: string;
          score: number;
          components: Record<string, number>;
        }>;
        ciiEl.removeAttribute('aria-busy');
        if (scores.length === 0) {
          ciiEl.innerHTML = `
            <div class="nw-state">
              <p class="nw-state-title">No CII scores available</p>
              <p class="nw-state-body">Live scores will appear here once the cron job completes its next cycle.</p>
            </div>
          `;
          return;
        }

        const sorted = scores.sort((a, b) => b.score - a.score);
        ciiEl.innerHTML = `
          <table class="method-table method-cii-table">
            <tr>
              <th>Country</th><th>CII</th><th>Conflict</th><th>Disasters</th>
              <th>Sentiment</th><th>Infra</th><th>Governance</th><th>Market</th>
            </tr>
            ${sorted
              .slice(0, 20)
              .map((s) => {
                const tier = s.score >= 70 ? 'critical' : s.score >= 50 ? 'high' : s.score >= 30 ? 'med' : 'low';
                return `<tr>
                  <td>${s.countryName}</td>
                  <td class="nw-tier-${tier} method-cii-score">${s.score}</td>
                  <td>${s.components.conflict ?? 0}</td>
                  <td>${s.components.disasters ?? 0}</td>
                  <td>${s.components.sentiment ?? 0}</td>
                  <td>${s.components.infrastructure ?? 0}</td>
                  <td>${s.components.governance ?? 0}</td>
                  <td>${s.components.marketExposure ?? 0}</td>
                </tr>`;
              })
              .join('')}
          </table>
          <p class="method-cii-meta">Showing top 20 of ${scores.length} monitored countries. Updated every 5 minutes.</p>
        `;
      })
      .catch(() => {
        ciiEl.removeAttribute('aria-busy');
        ciiEl.innerHTML = `
          <div class="nw-state nw-state-error" role="alert">
            <p class="nw-state-title">Couldn't load live CII</p>
            <p class="nw-state-body">Live data is temporarily unavailable. Check the
              <a class="method-link" href="#/status">status page</a> or try again.</p>
            <button class="nw-state-cta method-cii-retry" type="button">Try again</button>
          </div>
        `;
        ciiEl.querySelector('.method-cii-retry')?.addEventListener('click', () => renderMethodology(root));
      });
  }
}
