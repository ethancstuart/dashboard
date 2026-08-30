import '../styles/briefs.css'; // Reuse briefs page styling
import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';
// The published thresholds are READ FROM THE RESOLVER'S OWN MODULE, never retyped.
// api/_lib/calls.ts has no imports of its own, so it bundles into the client
// cleanly - and this page cannot drift from the rule that governs live
// resolutions the way its previous wording did.
import { MIN_MEASUREMENTS_PER_REQUIRED_DAY, coverageRequirement } from '../../api/_lib/calls.ts';

/**
 * CII Methodology page — explains the Country Instability Index algorithm.
 * Route: /#/methodology
 */
export function renderMethodology(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.methodology);
  root.textContent = '';

  // The worked example is the censorship horizon; both figures are DERIVED,
  // so changing the rule changes this page without anyone editing it.
  const cov14 = coverageRequirement(14);
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

      <h2 class="brief-section-header">How the Ledger forecasts — and what the first score can show</h2>
      <p><em>Published 2026-08-28, before the first calls resolve on 5 September. We are stating this
      ahead of the number rather than after it, because after a bad number the same paragraph would
      read as an excuse.</em></p>
      <p>Each call's probability is that country's own long-run rate, re-weighted toward its recent
      behaviour. The base rate we score against is <strong>that same long-run rate</strong>. The
      forecast and the baseline are therefore two summaries of one series, and the honest description
      of what the first cohort measures is narrower than "the world, graded":
      <strong>does weighting recent behaviour beat the long-run average?</strong></p>
      <p>That is a real and answerable question, and as far as we know nobody publishes the answer.
      But it is not a claim to understand geopolitics, and we would rather say so ourselves than have
      a careful reader say it for us. A negative score means recency weighting did not help — a valid
      result we expect to publish in the same size type as any other.</p>
      <p>It is also why the Ledger <strong>withholds any skill number until three independent
      resolution batches exist</strong>. One fortnight cannot separate a forecasting method from the
      weather it happened to land in, and 39 calls issued on one day against one data source are far
      fewer independent observations than 39.</p>
      <p>What changes next: we are building a forecast input that is genuinely independent of the
      base-rate series — election and referendum dates, sanctions designations, conflict deltas — so
      that a future version of this number measures something about the world rather than about our
      own choice of window. That work is dated and will be described here when it ships.</p>

      <h2 class="brief-section-header">When a call cannot be resolved</h2>
      <p><em>Published 2026-08-28, before this rule was applied to any call. Amended 2026-08-30,
      before the first resolution, to state the threshold the resolver actually uses.</em></p>
      <p>A call is resolved by counting qualifying events at an external source inside a window fixed
      before the outcome was known. Sometimes we did not look hard enough at that country, in that
      window, to be entitled to an answer either way.</p>
      <p><strong>Absence of evidence is not evidence of absence, and we will not score it as a miss.</strong>
      Before a censorship call can be scored as a miss, the window has to clear two bars — days and
      volume, because either alone can be passed by a window nobody really watched:</p>
      <ul class="method-list">
        <li><strong>Days.</strong> OONI must have observed the country on at least <strong>half the
        days</strong> in the call&rsquo;s window, rounded up. For a fourteen-day call that is
        <strong>${cov14.minDays} days</strong>. A single busy day cannot certify a fortnight.</li>
        <li><strong>Volume.</strong> At least <strong>${MIN_MEASUREMENTS_PER_REQUIRED_DAY}
        measurements per required day</strong> &mdash; <strong>${cov14.minMeasurements} measurements</strong>
        across a fourteen-day call. This number is a judgement and we state it as one: below roughly
        fifty measurements a country-day is one or two probes, and one volunteer&rsquo;s network
        conditions should not decide a public verdict. It is not tuned to a publishing count.</li>
      </ul>
      <p>Both bars are <em>derived from the window the call declared</em>, not held in a list, so a
      future call with a different horizon is governed by construction rather than because somebody
      remembered to extend a table. The figures above are read from the same module the resolver
      runs on; this page cannot state a threshold the resolver is not using.</p>
      <p><strong>The rule cuts one way only.</strong> A confirmed block we <em>did</em> observe
      resolves the call as a <strong>hit</strong> no matter how thin the coverage &mdash; seeing
      something happen is evidence that it happened. It is the <em>absence</em> of a block that needs
      a well-observed window to mean anything. Coverage is queried only on the way to a miss.</p>
      <p>Below the line, the call is not scored:</p>
      <ul class="method-list">
        <li>It stays <code>pending</code> while late evidence could still arrive. OONI&rsquo;s ingest
        lags roughly a day and our collector fetches only the previous day, so a backfill or a
        collector fix is a real possibility, not a formality.</li>
        <li>If the coverage has still not appeared <strong>7 days after the resolution date</strong>,
        the call is marked <code>unresolvable</code> with the reason recorded in the row, and it is
        <strong>excluded from every number we publish</strong>.</li>
        <li>Unresolvable calls stay visible on the Ledger with their reason, counted in their own
        column beside hits and misses. A withdrawn call that vanishes is indistinguishable from a
        moved goalpost, so nothing is ever deleted.</li>
      </ul>
      <p><strong>Unresolvable is not the same as void.</strong> A call is <em>void</em> when our own
      criterion was unsound &mdash; our mistake, withdrawn by us. It is <em>unresolvable</em> when the
      world did not supply enough evidence to judge either way. Neither is ever scored.</p>
      <p>The distinction that matters: this rule fires on how much the
      <em>resolver</em> saw, never on whether we liked the answer. Coverage is counted from OONI&rsquo;s
      own measurement volume, which we neither produce nor influence, and the window was fixed when
      the call was made. A call heading for a miss in a <em>well-observed</em> country cannot be
      withheld by it &mdash; that call is scored as a miss.</p>
      <p><strong>But we should state the asymmetry rather than let you find it.</strong> Because the
      gate governs only the would-be miss, it can remove misses from the record and can never remove a
      hit. That is deliberate &mdash; a block we observed is evidence regardless of how thin the
      window was, while the absence of a block means nothing unless we looked &mdash; and it is still
      an asymmetry. So the unresolvable calls stay on the Ledger, in their own column, with the days
      and measurement counts that put them there, and the count is published beside every result. A
      rule that quietly deleted its own inconvenient cases would be indistinguishable from this one
      if we did not show you the cases.</p>
      <p><strong>And the uncomfortable part, which belongs here permanently.</strong> OONI is a
      volunteer network, and its coverage is thinnest in precisely the places where running a
      measurement tool is most dangerous &mdash; the Sahel and the Horn. Our coverage is
      <em>anti-correlated</em> with the thing we are trying to measure: the countries we most want to
      be right about are the ones we have least evidence for. That is a property of the instrument,
      not a gap we can close by tuning a threshold, and no number on this site should be read without
      it. The count of calls currently expected to be unresolvable, and the countries, are recomputed
      live on <a href="#/ledger">the Ledger</a> rather than stated here, because a number written into
      a page is only true on the day it is typed.</p>

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
          <p>As of <strong>2026-08-24</strong>: derived from the World Bank Worldwide Governance Indicators — the mean of the six 2024 estimates (voice &amp; accountability, political stability, government effectiveness, regulatory quality, rule of law, control of corruption) through an anchored linear map (+1.8, Denmark-tier → 0 points; −2.0, Somalia-tier → 15). This replaced a hand-set table that scored governance only where it was a live crisis and zeroed the middle — Chad, Zimbabwe, Pakistan and Bangladesh sat at ≈0 while WGI places them near 11. The hand-set value survives only as the fallback where WGI has no coverage (Taiwan); the component breakdown flags which source produced each country's value.</p>
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
