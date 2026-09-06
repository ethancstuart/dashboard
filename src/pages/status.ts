/**
 * Public Data Health Status Page (/#/status).
 *
 * Stripe-style service health dashboard showing real-time status of
 * all NexusWatch data sources. Public transparency — no login required.
 */

import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';
import { pageShell } from '../ui/kit/index.ts';

interface LayerStatus {
  layer: string;
  status: 'green' | 'amber' | 'red' | 'degraded';
  score: number;
  last_success: string | null;
  last_failure: string | null;
  active_source: string | null;
  circuit_state: string;
}

const LAYER_DISPLAY_NAMES: Record<string, string> = {
  earthquakes: 'USGS Earthquakes',
  fires: 'NASA FIRMS Wildfires',
  acled: 'ACLED Conflict Events',
  news: 'GDELT News Sentiment',
  'internet-outages': 'Cloudflare Radar',
  'weather-alerts': 'Open-Meteo Weather',
  flights: 'OpenSky Aircraft',
  ships: 'AIS Ship Tracking',
  'prediction-markets': 'Polymarket',
  'disease-outbreaks': 'WHO Outbreaks',
  sanctions: 'OFAC Sanctions',
  elections: 'Election Calendar',
  frontlines: 'Conflict Frontlines',
  'gps-jamming': 'GPS Jamming',
  cables: 'Undersea Cables',
  pipelines: 'Oil/Gas Pipelines',
  ports: 'Strategic Ports',
  nuclear: 'Nuclear Facilities',
  'air-quality': 'Air Quality (AQI)',
  satellites: 'Satellite Orbits',
  cyber: 'Cyber Threat Corridors',
  'military-bases': 'Military Bases',
  'conflict-zones': 'Conflict Zones',
  gdacs: 'GDACS Disasters',
  'trade-routes': 'Trade Routes',
  launches: 'Space Launches',
  energy: 'Energy Infrastructure',
  sentiment: 'Sentiment Index',
  displacement: 'Refugee Displacement',
  refugees: 'UNHCR Flows',
  'nuclear-threat': 'Nuclear Threat Composite',
  'cyber-threat': 'Cyber Threat Intel',
  protest: 'Global Protest Index',
  'chokepoint-threat': 'Chokepoint Threat',
  'chokepoint-status': 'Chokepoint Status',
  'air-quality-aqi': 'Air Quality AQI',
};

export async function renderStatusPage(container: HTMLElement): Promise<void> {
  setPageSeo(PAGE_SEO.status);
  const main = pageShell(container, { active: '/status' });

  const header = createElement('header', { className: 'nw-status-header' });
  header.innerHTML = `
    <h1>System Status</h1>
    <p class="nw-status-subtitle">
      Real-time health of every NexusWatch data source. If something's broken, you'll see it here first.
    </p>
  `;
  main.appendChild(header);

  const overall = createElement('div', { className: 'nw-status-overall' });
  overall.innerHTML = '<div class="nw-status-loading">Loading system status...</div>';
  main.appendChild(overall);

  const list = createElement('div', { className: 'nw-status-list' });
  main.appendChild(list);

  try {
    const res = await fetch('/api/public/status');
    if (!res.ok) throw new Error('status fetch failed');
    const data = (await res.json()) as { layers: LayerStatus[] };

    renderOverall(overall, data.layers);
    renderLayerList(list, data.layers);
  } catch {
    overall.innerHTML = `
      <div class="nw-status-banner nw-status-banner-amber">
        <span class="nw-status-dot"></span>
        <span>Status data unavailable — the status endpoint may be offline</span>
      </div>
    `;
  }

  // 2026-05-02 C4: also surface API endpoint health from /api/status.
  // The data-health view above shows layer freshness. This shows whether
  // each public endpoint is actually reachable + within latency budget.
  const apiSection = createElement('section', { className: 'nw-status-api-section' });
  apiSection.innerHTML = `
    <h2 class="nw-status-h2" style="margin-top:32px;font-size:18px">API Endpoints</h2>
    <p class="nw-status-subtitle" style="font-size:13px;margin:4px 0 12px">
      Real-time health of each public endpoint. Refreshes every minute.
    </p>
    <div class="nw-status-api-list" id="status-api-list">
      <div class="nw-status-loading">Pinging endpoints…</div>
    </div>
  `;
  main.appendChild(apiSection);

  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('api status fetch failed');
    const data = (await res.json()) as {
      overallHealth: 'ok' | 'degraded' | 'down';
      endpoints: Array<{
        path: string;
        category: string;
        status: 'ok' | 'degraded' | 'down';
        latencyMs: number;
        httpCode: number;
      }>;
    };
    const apiList = apiSection.querySelector('#status-api-list') as HTMLElement;
    apiList.innerHTML = '';
    for (const ep of data.endpoints) {
      const row = createElement('div', { className: 'nw-status-api-row' });
      const dotColor =
        ep.status === 'ok'
          ? 'var(--color-signal-ok)'
          : ep.status === 'degraded'
            ? '#eab308'
            : 'var(--color-signal-critical)';
      row.innerHTML = `
        <span class="nw-status-dot" style="background:${dotColor}"></span>
        <code style="font-size:12px;flex:1">${ep.path}</code>
        <span style="font-size:11px;color:var(--nw-text-muted, #757575)">${ep.httpCode || '—'} · ${ep.latencyMs}ms</span>
      `;
      apiList.appendChild(row);
    }
  } catch {
    const apiList = apiSection.querySelector('#status-api-list') as HTMLElement;
    apiList.innerHTML = '<div class="nw-status-banner nw-status-banner-amber">API status unavailable.</div>';
  }

  const footer = createElement('footer', { className: 'nw-status-footer' });
  footer.innerHTML = `
    <p><strong>How we compute health:</strong></p>
    <ul>
      <li><strong>Green</strong> — source responding within expected interval, data fresh</li>
      <li><strong>Amber</strong> — source responding but data stale or partial</li>
      <li><strong>Red</strong> — source unreachable, fallback may be active</li>
    </ul>
    <p>
      Circuit breakers automatically activate fallback sources after 3 consecutive failures.
      Status refreshes every 5 minutes. We publish the honest numbers — broken layers count against us.
    </p>
  `;
  main.appendChild(footer);
}

function renderOverall(container: HTMLElement, layers: LayerStatus[]): void {
  const green = layers.filter((l) => l.status === 'green').length;
  const amber = layers.filter((l) => l.status === 'amber' || l.status === 'degraded').length;
  const red = layers.filter((l) => l.status === 'red').length;
  const total = layers.length;

  let banner = 'green';
  let bannerText = 'All systems operational';
  if (red > 0) {
    banner = 'red';
    bannerText = `${red} source${red === 1 ? '' : 's'} down — fallbacks may be active`;
  } else if (amber > 2) {
    banner = 'amber';
    bannerText = 'Degraded performance on some sources';
  }

  container.innerHTML = `
    <div class="nw-status-banner nw-status-banner-${banner}">
      <span class="nw-status-dot"></span>
      <span>${bannerText}</span>
    </div>
    <div class="nw-status-summary">
      <div class="nw-status-stat"><span class="nw-status-stat-num" style="color: var(--color-signal-ok)">${green}</span><span class="nw-status-stat-label">GREEN</span></div>
      <div class="nw-status-stat"><span class="nw-status-stat-num" style="color: #eab308">${amber}</span><span class="nw-status-stat-label">AMBER</span></div>
      <div class="nw-status-stat"><span class="nw-status-stat-num" style="color: var(--color-signal-critical)">${red}</span><span class="nw-status-stat-label">RED</span></div>
      <div class="nw-status-stat"><span class="nw-status-stat-num">${total}</span><span class="nw-status-stat-label">TOTAL</span></div>
    </div>
  `;
}

function renderLayerList(container: HTMLElement, layers: LayerStatus[]): void {
  // Sort: problems first
  const sorted = [...layers].sort((a, b) => {
    const rank = { red: 0, degraded: 1, amber: 2, green: 3 };
    return (rank[a.status] ?? 99) - (rank[b.status] ?? 99);
  });

  for (const layer of sorted) {
    const color =
      layer.status === 'green'
        ? 'var(--color-signal-ok)'
        : layer.status === 'amber' || layer.status === 'degraded'
          ? '#eab308'
          : 'var(--color-signal-critical)';

    const row = createElement('div', { className: 'nw-status-row' });
    row.innerHTML = `
      <div class="nw-status-row-dot" style="background: ${color}"></div>
      <div class="nw-status-row-name">${LAYER_DISPLAY_NAMES[layer.layer] || layer.layer}</div>
      <div class="nw-status-row-source">${layer.active_source || 'primary'}</div>
      <div class="nw-status-row-score" style="color: ${color}">${layer.score}%</div>
    `;
    container.appendChild(row);
  }
}
