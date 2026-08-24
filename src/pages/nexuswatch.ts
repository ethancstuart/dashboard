import '../styles/nexuswatch.css';
import { createElement } from '../utils/dom.ts';
import { cachedFetch } from '../utils/cachedFetch.ts';
import { getCiiWatchlist, addCiiWatch } from '../services/ciiWatchlist.ts';
import { MapView } from '../map/MapView.ts';
import { MapLayerManager } from '../map/MapLayerManager.ts';
// Core layers (always enabled by default) — eagerly loaded
import { EarthquakeLayer } from '../map/layers/earthquakeLayer.ts';
import { AcledLayer } from '../map/layers/acledLayer.ts';
import { NewsLayer } from '../map/layers/newsLayer.ts';
import { FireLayer } from '../map/layers/fireLayer.ts';
import { FlightLayer } from '../map/layers/flightLayer.ts';
import { ShipLayer } from '../map/layers/shipLayer.ts';
import { CyberLayer } from '../map/layers/cyberLayer.ts';
import { WeatherAlertLayer } from '../map/layers/weatherLayer.ts';
import { MilitaryBasesLayer } from '../map/layers/militaryBasesLayer.ts';
import { CablesLayer } from '../map/layers/cablesLayer.ts';
import { ConflictZonesLayer } from '../map/layers/conflictZonesLayer.ts';
import { FrontlinesLayer } from '../map/layers/frontlinesLayer.ts';
// Non-core layers — lazy-loaded via dynamic import (code-split by Vite)
import { LAZY_LAYERS } from '../map/layerRegistry.ts';
import {
  initGeoIntelligence,
  destroyGeoIntelligence,
  getIntelItems,
  getLayerData,
} from '../services/geoIntelligence.ts';
import {
  computeAllCII,
  getCachedCII,
  ciiColor,
  ciiLabel,
  COUNTRY_COUNT,
  getMonitoredCountries,
  saveCIISnapshot,
  getPreviousSnapshot,
  getLastVisitTimestamp,
  getCIIDelta,
  type CIIScore,
} from '../services/countryInstabilityIndex.ts';
import { getProvenance, computeFreshness, freshnessColor, relativeTime } from '../services/dataProvenance.ts';
import { confidenceColor, confidenceIcon } from '../services/confidenceScoring.ts';
import { computePlatformHealth } from '../services/platformHealth.ts';
import {
  runVerification,
  getVerifiedSignals,
  verificationColor,
  verificationIcon,
  verificationLabel,
} from '../services/verificationEngine.ts';
import { checkCrisisTriggers, syncFromServerTriggers } from '../services/crisisPlaybook.ts';
import { showCrisisModal } from '../ui/crisisModal.ts';
import { detectActiveCascades } from '../services/cascadeEngine.ts';
import { runDisagreementDetection } from '../services/sourceDisagreement.ts';
import { TimelineScrubber } from '../ui/timelineScrubber.ts';
import { registerShortcutsKey } from '../ui/shortcutsOverlay.ts';
import { showNewsView } from '../ui/newsView.ts';
import { downloadJson, copyPermalink } from '../utils/exports.ts';
import { initCascadeOverlay, toggleCascadeOverlay, refreshCascadeOverlay } from '../ui/cascadeOverlay.ts';
import { initScenarioOverlay, runScenarioVisual, hideScenarioOverlay } from '../ui/scenarioOverlay.ts';
import { generateSitrep } from '../services/sitrep.ts';
import { loadRules, checkRules, getTriggeredAlerts } from '../services/alertRules.ts';
import { computeTensionIndex, tensionColor, tensionLabel } from '../services/tensionIndex.ts';
import { createSparkline } from '../ui/sparkline.ts';
import { THEATER_PRESETS, applyTheaterPreset } from '../map/theaterPresets.ts';
import { TimelineBar } from '../ui/timelineBar.ts';
import { CrisisReplayPlayer, generateCrisisReplay } from '../ui/crisisReplay.ts';
import { EntityGraphPanel } from '../ui/entityGraph.ts';
import { MultiViewController } from '../ui/multiView.ts';
import { InvestigationManager } from '../ui/investigations.ts';
import { CommandHud } from '../ui/commandHud.ts';
import { NewsTicker } from '../ui/newsTicker.ts';
import { CctvPanel } from '../ui/cctvPanel.ts';
import { runThreatDetection, getAutoAlerts } from '../services/aiMonitor.ts';
import {
  loadWatchlist,
  scanForMatches,
  getWatchMatches,
  getWatchlist,
  addWatchItem,
  removeWatchItem,
} from '../services/watchlist.ts';
import { createMarketsTab } from '../ui/sidebarMarkets.ts';
import { createFeedsTab } from '../ui/sidebarFeeds.ts';
import { createMapSearch } from '../map/MapSearch.ts';
import { createMapLegend } from '../ui/mapLegend.ts';
import { createAiTerminal } from '../ui/aiTerminal.ts';
import { animateCounter } from '../ui/animatedCounter.ts';
import { identifyRegion } from '../utils/geo.ts';
import { FloatingWidgetManager } from '../map/FloatingWidget.ts';
import { createLayerDrawer } from '../map/LayerDrawer.ts';
import { createQuickLayerBar } from '../ui/quickLayerBar.ts';
// Cinema mode is lazy-loaded on first interaction to keep it out of the
// initial dashboard bundle (~80KB+ savings). See cinemaLoader below.
import type { CinemaMode } from '../cinema/CinemaMode.ts';
import { computeCorrelations } from '../services/correlationEngine.ts';
import { evaluateAlerts, setRules } from '../services/alertEngine.ts';
import { loadRulesFromStorage, openAlertBuilder } from '../ui/alertBuilder.ts';
import '../styles/alert-builder.css';
import '../styles/timeline.css';
import '../styles/brief.css';
import '../styles/user-menu.css';
// mobile.css is now imported globally from main.css.
// Old timeline slider replaced by TimelineBar
import { openBriefPanel } from '../ui/briefPanel.ts';
import { createUserMenu } from '../ui/userMenu.ts';
import { copyShareUrl, getViewStateFromUrl, type ViewState } from '../services/shareView.ts';
import { createMapStyleToggle } from '../map/MapStyleToggle.ts';
import type { IntelItem, MapLayerCategory } from '../types/index.ts';
import { readRouteParams } from '../router.ts';

let nwAbort: AbortController | null = null;

export async function renderNexusWatch(root: HTMLElement): Promise<void> {
  if (nwAbort) nwAbort.abort();
  nwAbort = new AbortController();
  const signal = nwAbort.signal;

  root.textContent = '';

  // ── Loading overlay (shown until map loads) ──
  const loadingOverlay = createElement('div', { className: 'nw-loading-overlay' });
  loadingOverlay.innerHTML = `
    <div class="nw-loading-content">
      <div class="nw-loading-logo">NexusWatch</div>
      <div class="nw-loading-subtitle">GEOPOLITICAL INTELLIGENCE PLATFORM</div>
      <div class="nw-loading-bar"><div class="nw-loading-bar-fill"></div></div>
      <div class="nw-loading-text">Connecting to intelligence feeds...</div>
    </div>
  `;
  // The stat row that used to sit here counted up "30 layers · 50 countries ·
  // 13 sources" on a 400ms timer, unrelated to anything actually loading — and
  // every one of those numbers was wrong (85 countries are scored, the brief
  // reads 5 feeds). A product whose pitch is a published track record cannot
  // fabricate a number on its own loading screen. The phase captions below are
  // real stages, so they stay; the invented counters are gone.
  const animateLoadStats = () => {
    const text = loadingOverlay.querySelector('.nw-loading-text');
    const bar = loadingOverlay.querySelector('.nw-loading-bar-fill') as HTMLElement;
    let step = 0;
    const tick = setInterval(() => {
      step++;
      if (bar) bar.style.width = `${Math.min(step * 15, 90)}%`;
      if (step === 2 && text) text.textContent = 'Loading map tiles...';
      if (step === 4 && text) text.textContent = 'Initializing data layers...';
      if (step === 6 && text) text.textContent = 'Computing instability scores...';
      if (step >= 7) clearInterval(tick);
    }, 400);
  };
  animateLoadStats();
  root.appendChild(loadingOverlay);

  // ── Build DOM structure synchronously ──
  const app = createElement('div', { className: 'nw-app' });

  // Top bar — 3 zones: left (brand), center (tension index), right (controls)
  const topbar = createElement('div', { className: 'nw-topbar' });

  // LEFT ZONE: logo + search
  const topLeft = createElement('div', { className: 'nw-topbar-left' });
  const logo = document.createElement('a');
  logo.className = 'nw-logo';
  logo.textContent = 'NexusWatch';
  logo.href = '#/';
  logo.title = 'Back to homepage';
  logo.style.textDecoration = 'none';
  logo.style.color = 'inherit';
  const searchSlot = createElement('div', {});
  topLeft.appendChild(logo);
  topLeft.appendChild(searchSlot);

  // CENTER ZONE: tension index (wired after data loads)
  const tensionSlot = createElement('div', { className: 'nw-topbar-center' });
  tensionSlot.innerHTML =
    '<span class="nw-tension-label">GLOBAL TENSION</span><span class="nw-tension-value" style="opacity:0.4;animation:nw-pulse 1.5s infinite">···</span>';

  // RIGHT ZONE: layers toggle + controls dropdown + status
  const topRight = createElement('div', { className: 'nw-topbar-right' });
  const drawerToggleSlot = createElement('div', {});

  const sitrepBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'SITREP' });
  sitrepBtn.title = 'Generate situation report (S)';
  const briefBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'MY BRIEF' });
  briefBtn.title = 'Daily intelligence briefing';
  const popoutSlot = createElement('div', {});

  // Map style toggle (collapsed into right zone)
  const styleToggle = createMapStyleToggle((styleUrl) => {
    mapView.getMap()?.setStyle(styleUrl);
    setTimeout(() => {
      for (const layer of layerManager.getEnabledLayers()) {
        layer.disable();
        layer.enable();
        void layer.refresh();
      }
    }, 1000);
  });

  const statusArea = createElement('div', { className: 'nw-topbar-status' });
  const liveDot = createElement('span', { className: 'nw-live-dot' });
  const clockEl = createElement('span', {});
  statusArea.appendChild(liveDot);
  statusArea.appendChild(clockEl);

  const invBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'CASES' });
  invBtn.title = 'Investigation workspaces — save & share views (I)';

  const multiBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'SPLIT' });
  multiBtn.title = 'Split view: map + graph + data table (V)';

  const graphBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'GRAPH' });
  graphBtn.title = 'Entity relationship graph (G)';

  const replayBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'REPLAY' });
  replayBtn.title = "Crisis replay — fly through this week's events (R)";

  const cinemaBtn = createElement('button', { className: 'nw-sitrep-btn nw-essential', textContent: 'CINEMA' });
  cinemaBtn.title = 'Immersive intelligence broadcast (C)';
  const alertBtn = createElement('button', { className: 'nw-sitrep-btn nw-essential', textContent: 'ALERTS' });
  alertBtn.title = 'Natural language alert builder (A)';
  alertBtn.addEventListener('click', () => {
    openAlertBuilder(mapContainer);
  });

  const shareBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'SHARE' });
  shareBtn.title = 'Copy shareable link to clipboard';
  shareBtn.addEventListener('click', () => {
    const state: ViewState = {
      c: mapView.getViewState().center,
      z: mapView.getViewState().zoom,
      p: mapView.getViewState().pitch,
      b: mapView.getViewState().bearing,
      l: layerManager.getEnabledLayers().map((l) => l.id),
      pr: cinema.isActive() ? cinema.getActiveProfileId() : undefined,
    };
    void copyShareUrl(state).then((ok) => {
      shareBtn.textContent = ok ? 'COPIED!' : 'FAILED';
      setTimeout(() => {
        shareBtn.textContent = 'SHARE';
      }, 2000);
    });
  });

  // Mobile sidebar toggle
  const mobileToggle = createElement('button', { className: 'nw-mobile-sidebar-toggle', textContent: '☰' });

  const userMenuSlot = createElement('div', {});

  // ── Notification Bell ──
  const bellWrapper = createElement('div', { className: 'nw-bell-wrapper' });
  bellWrapper.style.cssText = 'position:relative;display:inline-flex';
  const bellBtn = createElement('button', { className: 'nw-sitrep-btn nw-essential nw-bell-btn' });
  bellBtn.innerHTML = '\u{1F514}';
  bellBtn.title = 'Alerts since last visit';
  bellBtn.style.cssText = 'font-size:12px;padding:2px 6px';
  const bellBadge = createElement('span', { className: 'nw-bell-badge' });
  bellBadge.style.cssText =
    'position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;border-radius:7px;background:#dc2626;color:#fff;font-size:8px;font-weight:700;display:none;align-items:center;justify-content:center;font-family:var(--nw-font-mono);padding:0 3px';
  bellWrapper.appendChild(bellBtn);
  bellWrapper.appendChild(bellBadge);

  const bellDropdown = createElement('div', { className: 'nw-bell-dropdown' });
  bellDropdown.style.cssText =
    'display:none;position:absolute;top:100%;right:0;width:280px;max-height:320px;overflow-y:auto;background:var(--nw-bg);border:1px solid var(--nw-border);border-radius:6px;z-index:200;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.5)';
  bellWrapper.appendChild(bellDropdown);

  let bellOpen = false;
  bellBtn.addEventListener('click', () => {
    bellOpen = !bellOpen;
    bellDropdown.style.display = bellOpen ? 'block' : 'none';
    if (bellOpen) {
      renderBellDropdown();
      // Mark as read
      sessionStorage.setItem('nw:alerts-read-at', String(Date.now()));
      bellBadge.style.display = 'none';
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!bellWrapper.contains(e.target as Node) && bellOpen) {
      bellOpen = false;
      bellDropdown.style.display = 'none';
    }
  });

  function renderBellDropdown() {
    bellDropdown.innerHTML = '';
    const triggered = getTriggeredAlerts();
    const readAt = parseInt(sessionStorage.getItem('nw:alerts-read-at') || '0', 10);

    if (triggered.length === 0) {
      bellDropdown.innerHTML =
        '<div style="padding:16px;text-align:center;font-size:12px;color:var(--nw-text-muted)">No alerts triggered. Set rules with the ALERTS button.</div>';
      return;
    }

    const header = createElement('div', {});
    header.style.cssText =
      'padding:8px 12px;font-family:var(--nw-font-mono);font-size:10px;letter-spacing:1px;color:var(--nw-text-muted);border-bottom:1px solid var(--nw-border)';
    header.textContent = `TRIGGERED ALERTS (${triggered.length})`;
    bellDropdown.appendChild(header);

    for (const alert of triggered.slice(0, 15)) {
      const row = createElement('div', {});
      const isNew = alert.timestamp > readAt;
      row.style.cssText = `padding:8px 12px;border-bottom:1px solid var(--nw-border-subtle);font-size:12px;cursor:pointer;${isNew ? 'background:rgba(255,102,0,0.05);' : ''}`;
      const ago = Math.floor((Date.now() - alert.timestamp) / 60000);
      const agoText =
        ago < 1 ? 'now' : ago < 60 ? `${ago}m` : ago < 1440 ? `${Math.round(ago / 60)}h` : `${Math.round(ago / 1440)}d`;
      row.innerHTML = `<div style="color:var(--nw-text-secondary);line-height:1.4">${alert.message}</div><div style="font-size:10px;color:var(--nw-text-muted);margin-top:2px">${agoText} ago${isNew ? ' · <span style="color:var(--nw-accent)">NEW</span>' : ''}</div>`;
      bellDropdown.appendChild(row);
    }
  }

  function updateBellBadge() {
    const triggered = getTriggeredAlerts();
    const readAt = parseInt(sessionStorage.getItem('nw:alerts-read-at') || '0', 10);
    const unread = triggered.filter((a) => a.timestamp > readAt).length;
    if (unread > 0) {
      bellBadge.textContent = String(unread > 9 ? '9+' : unread);
      bellBadge.style.display = 'flex';
    } else {
      bellBadge.style.display = 'none';
    }
  }

  // Update bell on alert triggers
  document.addEventListener('dashview:layer-data', updateBellBadge, { signal });
  updateBellBadge();

  // Primary actions (always visible)
  topRight.appendChild(drawerToggleSlot);
  topRight.appendChild(sitrepBtn);
  topRight.appendChild(alertBtn);
  topRight.appendChild(bellWrapper);
  topRight.appendChild(cinemaBtn);
  topRight.appendChild(mobileToggle);

  // "More" dropdown for secondary actions
  const moreWrapper = createElement('div', { className: 'nw-more-wrapper' });
  const moreBtn = createElement('button', { className: 'nw-sitrep-btn nw-more-btn', textContent: 'MORE ▾' });
  moreBtn.title = 'More tools and views';
  const moreMenu = createElement('div', { className: 'nw-more-menu' });
  moreMenu.appendChild(briefBtn);
  moreMenu.appendChild(shareBtn);
  moreMenu.appendChild(graphBtn);
  moreMenu.appendChild(replayBtn);
  moreMenu.appendChild(multiBtn);
  moreMenu.appendChild(invBtn);
  moreMenu.appendChild(popoutSlot);
  const screenshotBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'EXPORT' });
  screenshotBtn.title = 'Export current map view as PNG';
  screenshotBtn.addEventListener('click', () => {
    const map = mapView.getMap();
    if (!map) return;
    const canvas = map.getCanvas();
    // Create a new canvas with watermark
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0);
    // Watermark
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = `${Math.round(canvas.height * 0.018)}px monospace`;
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    ctx.fillText(`NexusWatch \u00b7 ${timestamp}`, 12, canvas.height - 12);
    // Download
    const link = document.createElement('a');
    link.download = `nexuswatch-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    screenshotBtn.textContent = 'SAVED!';
    setTimeout(() => {
      screenshotBtn.textContent = 'EXPORT';
    }, 2000);
  });
  moreMenu.appendChild(screenshotBtn);

  const cctvBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'CCTV' });
  cctvBtn.title = 'Live cameras — ports, cities, launch sites';
  moreMenu.appendChild(cctvBtn);
  moreMenu.appendChild(styleToggle);
  moreWrapper.appendChild(moreBtn);
  moreWrapper.appendChild(moreMenu);
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle('open');
  });
  document.addEventListener('click', () => moreMenu.classList.remove('open'));

  topRight.appendChild(moreWrapper);
  topRight.appendChild(userMenuSlot);
  topRight.appendChild(statusArea);

  // Platform health badge — aggregate data confidence
  const healthSlot = createElement('div', { className: 'nw-topbar-health' });
  healthSlot.innerHTML = '<span class="nw-health-label">DATA CONFIDENCE</span><span class="nw-health-value">--</span>';
  healthSlot.title = 'Aggregate data confidence across all sources and countries';

  // Personal risk score — avg CII of watchlisted countries
  const riskSlot = createElement('div', { className: 'nw-topbar-risk' });
  riskSlot.style.cssText =
    'display:none;align-items:center;gap:4px;font-family:var(--nw-font-mono);font-size:10px;letter-spacing:0.5px;cursor:pointer;padding:0 8px';
  riskSlot.title = 'Average CII of your watchlisted countries';

  function updatePersonalRisk() {
    const watchlist = getCiiWatchlist();
    const scores = getCachedCII();
    if (watchlist.length === 0 || scores.length === 0) {
      riskSlot.style.display = 'none';
      return;
    }
    const watchedScores = watchlist
      .map((w) => scores.find((s) => s.countryCode === w.countryCode))
      .filter(Boolean) as typeof scores;
    if (watchedScores.length === 0) {
      riskSlot.style.display = 'none';
      return;
    }
    const avg = Math.round(watchedScores.reduce((sum, s) => sum + s.score, 0) / watchedScores.length);
    const rising = watchedScores.filter((s) => s.trend === 'rising').length;
    const riskColor = avg >= 75 ? '#dc2626' : avg >= 60 ? '#f97316' : avg >= 40 ? '#eab308' : '#22c55e';
    const trend = rising > watchedScores.length / 2 ? '\u2191' : '\u2192';
    riskSlot.style.display = 'flex';
    riskSlot.innerHTML = `<span style="color:var(--nw-text-muted)">YOUR RISK</span><span style="color:${riskColor};font-weight:700;font-size:13px">${avg}</span><span style="color:${riskColor};font-size:11px">${trend}</span>`;
  }

  riskSlot.addEventListener('click', () => {
    window.location.hash = '#/watchlist';
  });

  // Breaking event indicator
  const breakingSlot = createElement('div', { className: 'nw-topbar-breaking' });
  breakingSlot.style.cssText = 'display:none;align-items:center;gap:4px;cursor:pointer;padding:0 8px';

  let lastBreakingId = '';

  function checkBreakingEvents() {
    const scores = getCachedCII();
    const snapshot = getPreviousSnapshot();
    if (!snapshot || scores.length === 0) return;

    // Find CII spikes > 8 points
    for (const s of scores) {
      const prev = snapshot.scores[s.countryCode];
      if (prev === undefined) continue;
      const delta = s.score - prev;
      if (delta > 8 && s.countryCode !== lastBreakingId) {
        lastBreakingId = s.countryCode;
        breakingSlot.style.display = 'flex';
        breakingSlot.innerHTML = `<span style="background:#dc2626;color:#fff;font-family:var(--nw-font-mono);font-size:9px;font-weight:700;letter-spacing:1px;padding:2px 8px;border-radius:3px;animation:nw-pulse 1.5s infinite">BREAKING</span><span style="font-size:10px;color:var(--nw-text-secondary);font-family:var(--nw-font-mono)">${s.countryName} CII +${Math.round(delta)}</span>`;
        breakingSlot.onclick = () => {
          const country = getMonitoredCountries().find((c) => c.code === s.countryCode);
          if (country) mapView.flyTo(country.lon, country.lat, 5);
          showCountryDetail(document.querySelector('.nw-sidebar') || document.body, s);
          breakingSlot.style.display = 'none';
        };
        // Auto-dismiss after 5 minutes
        setTimeout(
          () => {
            breakingSlot.style.display = 'none';
          },
          5 * 60 * 1000,
        );
        return;
      }
    }
  }

  topbar.appendChild(topLeft);
  topbar.appendChild(tensionSlot);
  topbar.appendChild(healthSlot);
  topbar.appendChild(riskSlot);
  topbar.appendChild(breakingSlot);
  topbar.appendChild(topRight);

  // Main area
  const main = createElement('div', { className: 'nw-main' });

  // Sidebar
  const sidebar = createElement('div', { className: 'nw-sidebar' });
  const tabBar = createElement('div', { className: 'nw-sidebar-tabs' });
  const tabIntel = createElement('button', { className: 'nw-sidebar-tab', textContent: 'INTEL' });
  const tabMarkets = createElement('button', { className: 'nw-sidebar-tab', textContent: 'MARKETS' });
  const tabFeeds = createElement('button', { className: 'nw-sidebar-tab', textContent: 'FEEDS' });
  tabBar.appendChild(tabIntel);
  tabBar.appendChild(tabMarkets);
  tabBar.appendChild(tabFeeds);

  const sidebarContent = createElement('div', { className: 'nw-sidebar-content' });
  sidebar.appendChild(tabBar);
  sidebar.appendChild(sidebarContent);

  // Map container
  const mapContainer = createElement('div', { className: 'nw-map-container' });

  main.appendChild(sidebar);
  main.appendChild(mapContainer);

  // Status bar
  const statusBar = createElement('div', { className: 'nw-statusbar' });

  // Theater preset bar
  const theaterBar = createElement('div', { className: 'nw-theater-bar' });
  const theaterLabel = createElement('span', { className: 'nw-theater-label', textContent: 'THEATERS' });
  theaterBar.appendChild(theaterLabel);
  for (const preset of THEATER_PRESETS) {
    const pill = createElement('button', { className: 'nw-theater-pill' });
    pill.innerHTML = `<span class="nw-theater-emoji">${preset.emoji}</span><span class="nw-theater-name"> ${preset.name}</span>`;
    pill.dataset.theater = preset.id;
    pill.title = preset.description;
    pill.addEventListener('click', () => {
      const map = mapView.getMap();
      if (!map) return;
      // Remove active class from all pills
      theaterBar.querySelectorAll('.nw-theater-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      applyTheaterPreset(preset, map, layerManager);
    });
    theaterBar.appendChild(pill);
  }
  // "All Layers" reset button
  const resetPill = createElement('button', {
    className: 'nw-theater-pill nw-theater-reset',
    textContent: '↺ Reset',
  });
  resetPill.title = 'Reset to default view';
  resetPill.addEventListener('click', () => {
    theaterBar.querySelectorAll('.nw-theater-pill').forEach((p) => p.classList.remove('active'));
    const map = mapView.getMap();
    if (map) {
      map.flyTo({ center: [0, 20], zoom: 3.8, pitch: 10, bearing: 0, duration: 2000 });
    }
    // Re-enable saved layers
    for (const layer of layerManager.getAllLayers()) {
      layerManager.disable(layer.id);
    }
    layerManager.restoreSavedLayers();
  });
  theaterBar.appendChild(resetPill);

  // Assemble and render immediately
  app.appendChild(topbar);
  app.appendChild(theaterBar);
  app.appendChild(main);
  app.appendChild(statusBar);
  root.appendChild(app);

  // Onboarding deliberately absent. Three competing flows (a 45-second modal,
  // a tooltip tour, and /welcome) used to interrupt the first session; the
  // 42-persona study found they suppressed exploration rather than aiding it.
  // Interests are edited in /settings, and the map teaches itself by being a map.

  // ── Initialize map ──
  const mapView = new MapView(mapContainer);
  const map = mapView.init();

  // ── Layer manager ──
  const layerManager = new MapLayerManager();
  layerManager.setMap(map);

  // Core layers — loaded eagerly (always enabled, in main bundle)
  const coreLayers = [
    new EarthquakeLayer(),
    new AcledLayer(),
    new NewsLayer(),
    new FireLayer(),
    new FlightLayer(),
    new ShipLayer(),
    new CyberLayer(),
    new WeatherAlertLayer(),
    new MilitaryBasesLayer(),
    new CablesLayer(),
    new ConflictZonesLayer(),
    new FrontlinesLayer(),
  ];

  for (const layer of coreLayers) {
    layerManager.register(layer);
  }

  // Non-core layers — lazy-loaded via dynamic import (code-split by Vite).
  // These are loaded in the background after core layers are registered.
  // Users who never enable these layers never download their code.
  void (async () => {
    const lazyEntries = Object.entries(LAZY_LAYERS);
    for (let i = 0; i < lazyEntries.length; i++) {
      const [, factory] = lazyEntries[i];
      try {
        const layer = await factory();
        layerManager.register(layer);
      } catch (err) {
        console.error('[nexuswatch] Failed to load lazy layer:', err);
      }
      // Small delay between lazy loads to avoid flooding network
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 100));
    }
  })();

  map.on('load', () => {
    layerManager.initAll();
    initCascadeOverlay(map);
    initScenarioOverlay(map);

    // ── Watchlist markers on globe — pulsing orange rings for watched countries ──
    const watchlistSourceId = 'nw-watchlist-markers';
    const watchlistLayerId = 'nw-watchlist-rings';

    map.addSource(watchlistSourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: watchlistLayerId,
      type: 'circle',
      source: watchlistSourceId,
      paint: {
        'circle-radius': 12,
        'circle-color': 'transparent',
        'circle-stroke-color': '#ff6600',
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.6,
      },
    });

    const updateWatchlistMarkers = () => {
      const watchlist = getCiiWatchlist();
      const monitored = getMonitoredCountries();
      const features = watchlist
        .map((w) => {
          const country = monitored.find((c) => c.code === w.countryCode);
          if (!country) return null;
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [country.lon, country.lat] },
            properties: { code: country.code, name: country.name },
          };
        })
        .filter(Boolean);

      const source = map.getSource(watchlistSourceId);
      if (source && 'setData' in source) {
        (source as { setData: (data: unknown) => void }).setData({
          type: 'FeatureCollection',
          features,
        });
      }
    };

    updateWatchlistMarkers();
    document.addEventListener('nw:cii-watchlist-changed', updateWatchlistMarkers, { signal });

    // ── Country search → open detail panel ──
    document.addEventListener(
      'nw:country-search',
      ((e: CustomEvent<{ countryCode: string }>) => {
        const code = e.detail.countryCode;
        const score = getCachedCII().find((s) => s.countryCode === code);
        if (score) {
          showCountryDetail(document.querySelector('.nw-sidebar') || document.body, score);
        }
      }) as EventListener,
      { signal },
    );

    // Wait for priority layers to load before removing overlay.
    // Minimum 3 seconds so the user can read the loading message.
    // Then fade out over 600ms.
    const minLoadTime = new Promise((r) => setTimeout(r, 1500));
    const priorityLayersLoaded = new Promise<void>((resolve) => {
      let loaded = 0;
      const needed = 3;
      const onData = () => {
        loaded++;
        if (loaded >= needed) {
          document.removeEventListener('dashview:layer-data', onData);
          resolve();
        }
      };
      document.addEventListener('dashview:layer-data', onData);
      // Safety timeout — don't block forever if layers fail
      setTimeout(resolve, 12000);
    });

    Promise.all([minLoadTime, priorityLayersLoaded]).then(() => {
      loadingOverlay.classList.add('fade-out');
      setTimeout(() => loadingOverlay.remove(), 600);
    });
  });

  // ── Timeline Scrubber (time-travel intelligence) ──
  const timelineScrubber = new TimelineScrubber({
    container: mapContainer,
    onDateChange: (snapshot) => {
      if (snapshot) {
        document.body.classList.add('nw-historical-mode');
      } else {
        document.body.classList.remove('nw-historical-mode');
      }
    },
  });

  // Toggle scrubber with 'T' key
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.key === 't' || e.key === 'T') {
      timelineScrubber.toggle();
    }
  });

  // Register keyboard shortcuts cheatsheet (? key)
  registerShortcutsKey();

  // Toggle cascade overlay with 'R' (risk cascades)
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.key === 'r' || e.key === 'R') {
      toggleCascadeOverlay();
    }
  });

  // Listen for scenario run events from the terminal
  document.addEventListener('nw:run-scenario', ((e: CustomEvent) => {
    const { presetId } = e.detail as { presetId: string };
    runScenarioVisual(presetId);
  }) as EventListener);

  // Esc to hide scenario banner
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideScenarioOverlay();
    }
  });

  // ── User Menu ──
  createUserMenu(userMenuSlot);

  // ── Permalink handling — auto-open detail panel if ?country= present ──
  {
    const urlParams = new URLSearchParams(window.location.search);
    const countryCode = urlParams.get('country');
    const view = urlParams.get('view');
    if (countryCode && view === 'detail') {
      // Wait for CII to populate, then open the detail panel
      setTimeout(() => {
        const scores = getCachedCII();
        const match = scores.find((s) => s.countryCode === countryCode.toUpperCase());
        if (match) {
          const country = getMonitoredCountries().find((c) => c.code === countryCode.toUpperCase());
          if (country) mapView.flyTo(country.lon, country.lat, 5);
          showCountryDetail(document.querySelector('.nw-sidebar') || document.body, match);
        }
      }, 3000);
    }
  }

  // ── Theater preset deep-link ──
  const theaterParam = new URLSearchParams(window.location.search).get('theater');
  if (theaterParam) {
    const preset = THEATER_PRESETS.find((p) => p.id === theaterParam);
    if (preset) {
      const map = mapView.getMap();
      if (map) {
        // Wait for map to be ready
        const applyPreset = () => {
          applyTheaterPreset(preset, map, layerManager);
          const pill = theaterBar.querySelector(`[data-theater="${preset.id}"]`);
          pill?.classList.add('active');
        };
        if (map.loaded()) applyPreset();
        else map.on('load', applyPreset);
      }
    }
    history.replaceState(null, '', window.location.pathname + window.location.hash);
  }

  // ── Persistent help button (bottom-right) ──
  const helpBtn = createElement('button', { className: 'nw-help-btn' });
  helpBtn.textContent = '?';
  helpBtn.title = 'Keyboard shortcuts & help';
  helpBtn.addEventListener('click', () => showShortcutsHelp(mapContainer));
  mapContainer.appendChild(helpBtn);

  // ── Mobile Sidebar Toggle + Backdrop ──
  const backdrop = createElement('div', { className: 'nw-sidebar-backdrop' });
  mapContainer.appendChild(backdrop);

  const closeSidebar = () => {
    sidebar.classList.remove('mobile-open');
    backdrop.classList.remove('visible');
  };
  const openSidebar = () => {
    sidebar.classList.add('mobile-open');
    backdrop.classList.add('visible');
  };

  mobileToggle.addEventListener('click', () => {
    if (sidebar.classList.contains('mobile-open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });
  backdrop.addEventListener('click', closeSidebar);

  // ── Restore shared view state from URL ──
  const sharedView = getViewStateFromUrl();
  if (sharedView) {
    map.on('load', () => {
      mapView.getMap()?.flyTo({
        center: sharedView.c,
        zoom: sharedView.z,
        pitch: sharedView.p,
        bearing: sharedView.b,
        duration: 0,
      });
      // Enable shared layers
      for (const layer of layerManager.getAllLayers()) {
        if (sharedView.l.includes(layer.id) && !layer.isEnabled()) {
          layerManager.enable(layer.id);
        } else if (!sharedView.l.includes(layer.id) && layer.isEnabled()) {
          layerManager.disable(layer.id);
        }
      }
      // Enter cinema mode if shared with a profile
      if (sharedView.pr) {
        setTimeout(() => {
          cinema.enter();
          cinema.setProfile(sharedView.pr!);
        }, 2000);
      }
    });
  }

  // ── Country deep-link (/#/intel?country=UA) ──
  const hashParams = readRouteParams();
  const deepLinkCountry = hashParams.get('country');
  if (deepLinkCountry && !sharedView) {
    const code = deepLinkCountry.toUpperCase();
    const country = getMonitoredCountries().find((c) => c.code === code);
    if (country) {
      map.on('load', () => {
        setTimeout(() => {
          mapView.flyTo(country.lon, country.lat, 5);
          const score = getCachedCII().find((s) => s.countryCode === code);
          if (score) {
            showCountryDetail(document.querySelector('.nw-sidebar') || document.body, score);
          }
        }, 2500); // Wait for CII to compute
      });
    }
  }

  // ── Visit streak tracking ──
  const streakKey = 'nw:visit-streak';
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(streakKey);
    const data = raw ? (JSON.parse(raw) as { lastDate: string; count: number }) : null;
    if (data) {
      const lastDate = new Date(data.lastDate);
      const todayDate = new Date(today);
      const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        // Consecutive day — increment streak
        localStorage.setItem(streakKey, JSON.stringify({ lastDate: today, count: data.count + 1 }));
      } else if (diffDays === 0) {
        // Same day — no change
      } else {
        // Streak broken — reset to 1
        localStorage.setItem(streakKey, JSON.stringify({ lastDate: today, count: 1 }));
      }
    } else {
      localStorage.setItem(streakKey, JSON.stringify({ lastDate: today, count: 1 }));
    }
  } catch {
    // localStorage error — non-critical
  }

  // ── Command Center HUD ──
  const hud = new CommandHud(mapContainer, mapView);
  void hud;

  // ── Live News Ticker ──
  const ticker = new NewsTicker(app);
  void ticker;

  // ── CCTV Panel ──
  const cctvPanelCtrl = new CctvPanel(mapView);
  cctvBtn.addEventListener('click', () => cctvPanelCtrl.toggle(mapContainer));

  // ── Crisis Replay ──
  const crisisPlayer = new CrisisReplayPlayer(mapContainer, mapView);
  replayBtn.addEventListener('click', async () => {
    if (crisisPlayer.isPlaying()) {
      crisisPlayer.stop();
      replayBtn.textContent = 'REPLAY';
      return;
    }
    replayBtn.textContent = 'LOADING...';
    const replay = await generateCrisisReplay();
    if (replay && replay.events.length >= 3) {
      replayBtn.textContent = 'STOP';
      crisisPlayer.start(replay);
    } else {
      replayBtn.textContent = 'NO DATA';
      setTimeout(() => {
        replayBtn.textContent = 'REPLAY';
      }, 2000);
    }
  });

  // ── Entity Graph ──
  const entityGraph = new EntityGraphPanel(mapContainer, mapView);
  graphBtn.addEventListener('click', () => entityGraph.toggle());

  // ── Timeline ──
  const timeline = new TimelineBar(mapContainer, (date, snapshots, cii) => {
    document.dispatchEvent(new CustomEvent('dashview:timeline-scrub', { detail: { date, snapshots, cii } }));
  });

  // ── Multi-View Controller ──
  const multiView = new MultiViewController({
    mapContainer,
    mapView,
    layerManager,
    entityGraph,
    timeline,
  });
  multiBtn.addEventListener('click', () => {
    multiView.toggle();
    multiBtn.classList.toggle('active', multiView.isActive());
  });

  // ── Investigation Workspaces ──
  const investigations = new InvestigationManager(mapView, layerManager);
  invBtn.addEventListener('click', () => investigations.toggle(mapContainer));
  // Load investigation from URL if shared
  InvestigationManager.loadFromUrl(mapView, layerManager);

  // ── Cinema Mode (lazy-loaded) ──
  // Cinema is heavy (~80KB) and most users never enter it. Defer loading
  // the entire chunk until first interaction (button click, `c` shortcut,
  // shared-view deep link, or escape-while-active).
  let cinemaInstance: CinemaMode | null = null;
  let cinemaLoadPromise: Promise<CinemaMode> | null = null;
  const loadCinema = (): Promise<CinemaMode> => {
    if (cinemaInstance) return Promise.resolve(cinemaInstance);
    if (cinemaLoadPromise) return cinemaLoadPromise;
    cinemaLoadPromise = import('../cinema/CinemaMode.ts').then((m) => {
      cinemaInstance = new m.CinemaMode({
        app,
        mapContainer,
        mapView,
        layerManager,
        getLayerData,
        signal,
      });
      return cinemaInstance;
    });
    return cinemaLoadPromise;
  };
  const cinema = {
    isActive: (): boolean => cinemaInstance?.isActive() ?? false,
    getActiveProfileId: (): string | undefined => cinemaInstance?.getActiveProfile().id,
    toggle: (): void => {
      void loadCinema().then((c) => c.toggle());
    },
    enter: (): void => {
      void loadCinema().then((c) => c.enter());
    },
    exit: (): void => {
      cinemaInstance?.exit();
    },
    setProfile: (p: string): void => {
      void loadCinema().then((c) => c.setProfile(p));
    },
    destroy: (): void => {
      cinemaInstance?.destroy();
    },
  };
  cinemaBtn.addEventListener('click', () => cinema.toggle());

  // ── Floating widgets ──
  const floatMgr = new FloatingWidgetManager(mapContainer);

  // Add pop-out button
  const popoutBtn = createElement('button', { className: 'nw-sitrep-btn', textContent: 'POP-OUT' });
  popoutSlot.appendChild(popoutBtn);
  popoutBtn.addEventListener('click', () => {
    // Open a floating intel summary widget
    floatMgr.open('intel-summary', 'INTEL SUMMARY', (body) => {
      const items = getIntelItems();
      if (items.length === 0) {
        body.textContent = 'No active alerts';
        return;
      }
      for (const item of items.slice(0, 10)) {
        const row = createElement('div', { className: 'nw-alert-row' });
        const dot = createElement('span', { className: 'nw-alert-dot' });
        dot.classList.add(item.priority === 0 ? 'critical' : item.priority === 1 ? 'elevated' : 'monitor');
        const text = createElement('span', { className: 'nw-alert-text', textContent: item.text });
        row.appendChild(dot);
        row.appendChild(text);
        body.appendChild(row);
      }
    });
  });

  // ── Search bar ──
  const searchBar = createMapSearch(mapView);
  searchSlot.appendChild(searchBar);

  // ── Layer drawer ──
  const layerDrawer = createLayerDrawer(layerManager, getLayerData, () => mapView.getMap());
  drawerToggleSlot.appendChild(layerDrawer.toggleBtn);
  mapContainer.appendChild(layerDrawer.element);

  // ── Quick-Filter Bar (W3) — always-visible chip strip over the globe ──
  const quickBar = createQuickLayerBar(layerManager, {
    onMoreClick: () => layerDrawer.toggleBtn.click(),
  });
  mapContainer.appendChild(quickBar.element);

  // ── Contextual AI narration on map click ──
  const mapInst = mapView.getMap();
  if (mapInst) {
    mapInst.on('click', (e) => {
      const features = mapInst.queryRenderedFeatures(e.point);
      const hasLayerFeature = features.some((f) => f.source && !f.source.startsWith('carto'));
      if (hasLayerFeature) return;

      // Show region context in sidebar
      const lat = e.lngLat.lat;
      const lon = e.lngLat.lng;
      const region = identifyRegion(lat, lon);
      if (region && activeTab === 'intel') {
        // Add a contextual note at the top of the sidebar
        const contextNote = sidebarContent.querySelector('.nw-context-note');
        if (contextNote) contextNote.remove();
        const note = createElement('div', { className: 'nw-context-note' });
        note.innerHTML = `<span class="nw-context-label">VIEWING</span><span class="nw-context-region">${region}</span><span class="nw-context-coords">${lat.toFixed(2)}°, ${lon.toFixed(2)}°</span>`;
        sidebarContent.insertBefore(note, sidebarContent.firstChild);
      }
    });
  }

  // ── Map Legend ──
  const legend = createMapLegend(layerManager);
  mapContainer.appendChild(legend);

  // ── First-visit Layer Key (shows once, dismissed forever) ──
  if (!localStorage.getItem('nw:layer-key-dismissed')) {
    const layerKey = createElement('div', { className: 'nw-layer-key' });
    layerKey.style.cssText =
      'position:absolute;bottom:40px;left:16px;z-index:50;background:rgba(0,0,0,0.85);border:1px solid var(--nw-border, #222);border-radius:8px;padding:12px 16px;font-size:12px;max-width:220px;backdrop-filter:blur(4px);animation:nw-modal-fade-in 0.3s ease';
    layerKey.innerHTML = `
      <div style="font-family:var(--nw-font-mono);font-size:10px;letter-spacing:1px;color:var(--nw-text-muted);margin:0 0 8px;display:flex;justify-content:space-between;align-items:center">
        <span>WHAT YOU'RE SEEING</span>
        <button class="nw-layer-key-close" style="background:none;border:none;color:var(--nw-text-muted);cursor:pointer;font-size:14px;padding:0;line-height:1">\u2715</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:#ff3c3c;flex-shrink:0"></span><span style="color:var(--nw-text-secondary)">Earthquakes (USGS, live)</span></div>
        <div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0"></span><span style="color:var(--nw-text-secondary)">Active Conflicts (ACLED)</span></div>
        <div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:2px;background:rgba(239,68,68,0.3);flex-shrink:0"></span><span style="color:var(--nw-text-secondary)">Conflict Zones</span></div>
        <div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0"></span><span style="color:var(--nw-text-secondary)">Chokepoints (6 straits)</span></div>
        <div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:#ff6b00;flex-shrink:0"></span><span style="color:var(--nw-text-secondary)">Wildfires (NASA, live)</span></div>
        <div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:#eab308;flex-shrink:0"></span><span style="color:var(--nw-text-secondary)">News Events (GDELT)</span></div>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--nw-text-muted)">Press <kbd style="background:var(--nw-surface);padding:1px 4px;border-radius:3px;font-family:var(--nw-font-mono);font-size:10px">L</kbd> to see all 45+ layers</div>
    `;
    mapContainer.appendChild(layerKey);
    layerKey.querySelector('.nw-layer-key-close')!.addEventListener('click', () => {
      layerKey.remove();
      localStorage.setItem('nw:layer-key-dismissed', '1');
    });
    // Auto-dismiss after 20 seconds
    setTimeout(() => {
      if (layerKey.parentElement) {
        layerKey.style.transition = 'opacity 0.5s ease';
        layerKey.style.opacity = '0';
        setTimeout(() => {
          layerKey.remove();
          localStorage.setItem('nw:layer-key-dismissed', '1');
        }, 500);
      }
    }, 20000);
  }

  // ── First-visit Aha Moment — show nearest country CII card after fly-to ──
  if (!localStorage.getItem('nw:aha-shown')) {
    // Wait for CII data to populate (fires on dashview:layer-data)
    const showAha = () => {
      const scores = getCachedCII();
      if (scores.length === 0) return; // CII not ready yet
      document.removeEventListener('dashview:layer-data', showAha);

      // Find the nearest interesting country (CII >= 40) to the user's viewport center
      const mapInstance = mapView.getMap();
      if (!mapInstance) return;
      const center = mapInstance.getCenter();
      const monitored = getMonitoredCountries();

      let nearest: { code: string; dist: number } | null = null;
      for (const c of monitored) {
        const score = scores.find((s) => s.countryCode === c.code);
        if (!score || score.score < 40) continue;
        const dlat = c.lat - center.lat;
        const dlng = c.lon - center.lng;
        const dist = dlat * dlat + dlng * dlng;
        if (!nearest || dist < nearest.dist) {
          nearest = { code: c.code, dist };
        }
      }

      if (!nearest) return;
      const score = scores.find((s) => s.countryCode === nearest!.code);
      if (!score) return;

      const trendArrow = score.trend === 'rising' ? '\u2191' : score.trend === 'falling' ? '\u2193' : '\u2192';
      const color = score.score >= 75 ? '#dc2626' : score.score >= 50 ? '#f97316' : '#eab308';
      const topSignal = score.topSignals[0] || '';

      const ahaCard = createElement('div', { className: 'nw-aha-card' });
      ahaCard.style.cssText = `position:absolute;top:48px;right:16px;z-index:50;background:rgba(0,0,0,0.9);border:1px solid ${color}40;border-radius:8px;padding:14px 18px;max-width:280px;backdrop-filter:blur(4px);animation:nw-modal-fade-in 0.4s ease;font-family:var(--nw-font-body)`;
      ahaCard.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;margin:0 0 8px">
          <div>
            <div style="font-family:var(--nw-font-mono);font-size:10px;letter-spacing:1px;color:var(--nw-text-muted)">NEAREST RISK</div>
            <div style="font-size:16px;font-weight:700;color:var(--nw-text);margin:2px 0 0">${score.countryName}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:28px;font-weight:800;color:${color};line-height:1;font-family:var(--nw-font-mono)">${score.score}</div>
            <div style="font-size:11px;color:${color}">${trendArrow} ${score.trend}</div>
          </div>
        </div>
        ${topSignal ? `<div style="font-size:12px;color:var(--nw-text-secondary);line-height:1.4;margin:0 0 10px">${topSignal}</div>` : ''}
        <div style="display:flex;gap:8px;align-items:center">
          <a href="#/audit/${score.countryCode}" style="font-size:11px;color:var(--nw-accent);text-decoration:none">View evidence chain \u2192</a>
          <button class="nw-aha-dismiss" style="margin-left:auto;background:none;border:none;color:var(--nw-text-muted);cursor:pointer;font-size:12px">\u2715</button>
        </div>
      `;
      mapContainer.appendChild(ahaCard);
      localStorage.setItem('nw:aha-shown', '1');

      ahaCard.querySelector('.nw-aha-dismiss')!.addEventListener('click', () => ahaCard.remove());

      // Auto-dismiss after 12 seconds
      setTimeout(() => {
        if (ahaCard.parentElement) {
          ahaCard.style.transition = 'opacity 0.5s ease';
          ahaCard.style.opacity = '0';
          setTimeout(() => ahaCard.remove(), 500);
        }
      }, 12000);
    };

    // Listen for first CII computation — triggers after initial layer data loads
    document.addEventListener('dashview:layer-data', showAha);
  }

  // ── AI Terminal ──
  const terminal = createAiTerminal({ mapView, layerManager, getLayerData });
  mapContainer.appendChild(terminal);

  // ── Tab switching ──
  let activeTab: 'intel' | 'markets' | 'feeds' =
    (localStorage.getItem('nw:active-tab') as 'intel' | 'markets' | 'feeds') || 'intel';

  // Set initial active tab
  if (activeTab === 'markets') tabMarkets.classList.add('active');
  else if (activeTab === 'feeds') tabFeeds.classList.add('active');
  else tabIntel.classList.add('active');

  function setActiveTab(tab: typeof activeTab) {
    activeTab = tab;
    localStorage.setItem('nw:active-tab', tab);
    tabIntel.classList.toggle('active', tab === 'intel');
    tabMarkets.classList.toggle('active', tab === 'markets');
    tabFeeds.classList.toggle('active', tab === 'feeds');
    renderSidebarContent();
  }

  tabIntel.addEventListener('click', () => setActiveTab('intel'));
  tabMarkets.addEventListener('click', () => setActiveTab('markets'));
  tabFeeds.addEventListener('click', () => setActiveTab('feeds'));

  // ── Sidebar tab components ──
  const marketsTab = createMarketsTab();
  const feedsTab = createFeedsTab();

  let sidebarDebounce: ReturnType<typeof setTimeout> | null = null;
  function debouncedSidebarRender() {
    if (sidebarDebounce) clearTimeout(sidebarDebounce);
    sidebarDebounce = setTimeout(renderSidebarContent, 1000);
  }

  function renderSidebarContent() {
    sidebarContent.textContent = '';

    // Stop data cycles for inactive tabs
    marketsTab.stopDataCycle();
    feedsTab.stopDataCycle();

    if (activeTab === 'intel') {
      renderIntelTab(sidebarContent, mapView, layerManager);
    } else if (activeTab === 'markets') {
      sidebarContent.appendChild(marketsTab.element);
      marketsTab.startDataCycle();
    } else {
      sidebarContent.appendChild(feedsTab.element);
      feedsTab.startDataCycle();
    }
  }

  renderSidebarContent();

  // ── Status bar ──
  function updateStatusBar() {
    statusBar.textContent = '';
    for (const layer of layerManager.getAllLayers()) {
      if (!layer.isEnabled()) continue;
      const item = createElement('span', { className: 'nw-statusbar-item' });
      const dot = createElement('span', { className: 'nw-statusbar-dot' });
      dot.style.background = 'var(--nw-accent, #ff6600)';
      const text = createElement('span', {});
      text.textContent = `${layer.name}: ${layer.getFeatureCount()}`;
      item.appendChild(dot);
      item.appendChild(text);
      statusBar.appendChild(item);
    }

    const clock = createElement('span', { className: 'nw-statusbar-clock' });
    clock.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
    statusBar.appendChild(clock);
  }

  updateStatusBar();

  // ── Clock update ──
  const clockInterval = setInterval(() => {
    clockEl.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
    updateStatusBar();
  }, 1000);

  // ── Geo-intelligence + Alert Rules ──
  initGeoIntelligence(signal);
  loadRules();
  loadWatchlist();

  // Load NL alert rules from storage
  const savedNLRules = loadRulesFromStorage();
  if (savedNLRules.length > 0) setRules(savedNLRules);
  // Notification permission requested on first alert trigger, not page load

  document.addEventListener(
    'dashview:layer-data',
    ((e: CustomEvent) => {
      const ld = getLayerData();
      computeAllCII(ld);
      updatePersonalRisk();
      checkBreakingEvents();
      computeCorrelations(ld);
      evaluateAlerts(ld);
      runVerification(ld);
      runDisagreementDetection(ld);
      const newCrisis = checkCrisisTriggers(ld);
      if (newCrisis) showCrisisModal(newCrisis, mapView);
      // Also pull server-detected crises from the crisis-detection cron
      // (CII spikes + M7+ quakes). Non-blocking; first unseen one opens modal.
      void syncFromServerTriggers().then((newly) => {
        if (newly.length > 0) showCrisisModal(newly[0], mapView);
      });
      refreshCascadeOverlay();
      // Detect active risk cascades — visible in sidebar count
      const cascadeCount = detectActiveCascades().length;
      if (cascadeCount > 0) {
        document.body.dataset.activeCascades = String(cascadeCount);
      }

      // Update tension index
      const tension = computeTensionIndex(getLayerData());
      const tensionValue = tensionSlot.querySelector('.nw-tension-value');
      if (tensionValue) {
        tensionValue.textContent = String(tension.global);
        (tensionValue as HTMLElement).style.color = tensionColor(tension.global);
      }
      // Update or add trend arrow
      let trendEl = tensionSlot.querySelector('.nw-tension-trend') as HTMLElement;
      if (!trendEl) {
        trendEl = createElement('span', { className: 'nw-tension-trend' });
        tensionSlot.appendChild(trendEl);
      }
      trendEl.textContent = tension.trend === 'rising' ? '▲' : tension.trend === 'falling' ? '▼' : '—';
      trendEl.style.color =
        tension.trend === 'rising' ? '#dc2626' : tension.trend === 'falling' ? '#22c55e' : '#666666';
      // Update label
      let labelEl = tensionSlot.querySelector('.nw-tension-level') as HTMLElement;
      if (!labelEl) {
        labelEl = createElement('span', { className: 'nw-tension-level' });
        tensionSlot.appendChild(labelEl);
      }
      labelEl.textContent = tensionLabel(tension.global);
      labelEl.style.color = tensionColor(tension.global);
      // Apply severity class for badge glow
      tensionSlot.classList.remove('elevated', 'critical');
      if (tension.global >= 75) tensionSlot.classList.add('critical');
      else if (tension.global >= 50) tensionSlot.classList.add('elevated');
      // Sparkline for tension history
      const existingSpark = tensionSlot.querySelector('.nw-sparkline');
      if (existingSpark) existingSpark.remove();
      if (tension.history.length > 2) {
        const sparkValues = tension.history.slice(-24).map((h) => h.value);
        tensionSlot.appendChild(createSparkline(sparkValues, 40, 14, tensionColor(tension.global)));
      }
      // Update platform health badge
      const health = computePlatformHealth();
      const healthValue = healthSlot.querySelector('.nw-health-value');
      if (healthValue) {
        healthValue.textContent = `${health.score}%`;
        (healthValue as HTMLElement).style.color = health.color;
      }
      healthSlot.title = `DATA CONFIDENCE: ${health.score}% (${health.label}) — ${health.breakdown.layersFresh}/${health.breakdown.layersTotal} layers fresh, ${health.breakdown.mediumOrBetterCountries}/${health.breakdown.totalCountries} countries with medium-or-better confidence (${health.breakdown.highConfidenceCountries} high)`;

      layerDrawer.refresh();
      if (activeTab === 'intel') debouncedSidebarRender();

      // Check alert rules + watchlist + auto threat detection
      checkRules(getLayerData());
      scanForMatches(getLayerData());
      runThreatDetection(getLayerData());

      // Refresh pulse animation
      const flash = createElement('div', { className: 'nw-refresh-flash' });
      mapContainer.appendChild(flash);
      setTimeout(() => flash.remove(), 900);

      // Pulse the status bar item for this layer
      const layerId = e.detail?.layerId as string;
      if (layerId) {
        const items = statusBar.querySelectorAll('.nw-statusbar-item');
        for (const item of items) {
          if (item.textContent?.includes(layerManager.getLayer(layerId)?.name || '')) {
            item.classList.add('refreshing');
            setTimeout(() => item.classList.remove('refreshing'), 800);
          }
        }
      }
    }) as EventListener,
    { signal },
  );

  document.addEventListener(
    'dashview:intel-update',
    () => {
      if (activeTab === 'intel') debouncedSidebarRender();
    },
    { signal },
  );

  document.addEventListener(
    'dashview:watchlist-changed',
    () => {
      if (activeTab === 'intel') renderSidebarContent();
    },
    { signal },
  );

  // ── Sitrep button ──
  sitrepBtn.addEventListener('click', async () => {
    sitrepBtn.textContent = 'GENERATING...';
    sitrepBtn.disabled = true;
    try {
      const result = await generateSitrep('Global', getLayerData());
      showSitrep(mapContainer, result.sitrep, result.generatedAt);
    } catch (err) {
      showSitrep(mapContainer, `Error: ${err instanceof Error ? err.message : 'Failed'}`, '');
    } finally {
      sitrepBtn.textContent = 'SITREP';
      sitrepBtn.disabled = false;
    }
  });

  // ── Personal brief button — opens daily intelligence brief panel ──
  briefBtn.addEventListener('click', () => openBriefPanel(mapContainer));

  // ── Fullscreen toggle ──
  let exitBtn: HTMLElement | null = null;
  function toggleFullscreen() {
    const isFS = app.classList.toggle('nw-fullscreen');
    if (isFS) {
      exitBtn = createElement('button', { className: 'nw-fullscreen-exit', textContent: 'EXIT FULLSCREEN (Esc)' });
      exitBtn.addEventListener('click', toggleFullscreen);
      mapContainer.appendChild(exitBtn);
    } else {
      exitBtn?.remove();
      exitBtn = null;
    }
    // Trigger map resize after layout change
    setTimeout(() => mapView.getMap()?.resize(), 100);
  }

  // ── Keyboard shortcuts ──
  document.addEventListener(
    'keydown',
    (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7': {
          const layers = layerManager.getAllLayers();
          const idx = parseInt(e.key) - 1;
          if (idx < layers.length) {
            layerManager.toggle(layers[idx].id);
            layerDrawer.refresh();
          }
          break;
        }
        case 's':
          if (!e.ctrlKey && !e.metaKey) sitrepBtn.click();
          break;
        case 'a':
          if (!e.ctrlKey && !e.metaKey) {
            openAlertBuilder(mapContainer);
          }
          break;
        case 'l':
          if (!e.ctrlKey && !e.metaKey) {
            const logEl = document.querySelector('.cinema-event-log') as HTMLElement;
            if (logEl) logEl.style.display = logEl.style.display === 'none' ? '' : 'none';
          }
          break;
        case 't':
          if (!e.ctrlKey && !e.metaKey) {
            timeline.show();
          }
          break;
        case 'c':
          if (!e.ctrlKey && !e.metaKey) cinema.toggle();
          break;
        case 'g':
          if (!e.ctrlKey && !e.metaKey) entityGraph.toggle();
          break;
        case 'v':
          if (!e.ctrlKey && !e.metaKey) multiBtn.click();
          break;
        case 'i':
          if (!e.ctrlKey && !e.metaKey) invBtn.click();
          break;
        case 'Escape':
          if (cinema.isActive()) {
            cinema.exit();
            break;
          }
          mapContainer.querySelector('.nw-sitrep-overlay')?.remove();
          if (app.classList.contains('nw-fullscreen')) toggleFullscreen();
          break;
        case 'f':
          if (!e.ctrlKey && !e.metaKey) toggleFullscreen();
          break;
        case 'n':
          if (!e.ctrlKey && !e.metaKey) bellBtn.click();
          break;
        case '/':
          e.preventDefault();
          (searchSlot.querySelector('.nw-search-input') as HTMLInputElement | null)?.focus();
          break;
        case 'd': {
          if (!e.ctrlKey && !e.metaKey) {
            const drawerEl = mapContainer.querySelector('.nw-layer-drawer');
            drawerEl?.classList.toggle('nw-drawer-closed');
          }
          break;
        }
        case '?':
          showShortcutsHelp(mapContainer);
          break;
      }
    },
    { signal },
  );

  // ── Save CII snapshot on page leave (for "since you left" on return) ──
  const onLeave = () => saveCIISnapshot();
  window.addEventListener('beforeunload', onLeave, { signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') saveCIISnapshot();
    },
    { signal },
  );

  // ── Cleanup ──
  signal.addEventListener('abort', () => {
    saveCIISnapshot();
    clearInterval(clockInterval);
    cinema.destroy();
    timeline.destroy();
    mapView.destroy();
    layerManager.destroy();
    floatMgr.destroy();
    destroyGeoIntelligence();
  });

  window.addEventListener(
    'hashchange',
    () => {
      if (!['#/', '#/app', ''].includes(window.location.hash)) {
        nwAbort?.abort();
        nwAbort = null;
      }
    },
    { signal },
  );
}

// ── Intel Tab ──

function renderIntelTab(container: HTMLElement, mapView: MapView, layerMgr: MapLayerManager): void {
  // ── "Since you left" welcome-back card ──
  const lastVisit = getLastVisitTimestamp();
  const snapshot = getPreviousSnapshot();
  const currentScores = getCachedCII();
  const awayMinutes = lastVisit > 0 ? (Date.now() - lastVisit) / 60000 : 0;

  if (snapshot && currentScores.length > 0 && awayMinutes > 30 && !sessionStorage.getItem('nw:welcome-dismissed')) {
    const awayText =
      awayMinutes < 60
        ? `${Math.round(awayMinutes)}m`
        : awayMinutes < 1440
          ? `${Math.round(awayMinutes / 60)}h`
          : `${Math.round(awayMinutes / 1440)}d`;

    // Find top movers (biggest absolute delta from snapshot)
    const movers: { code: string; name: string; score: number; delta: number }[] = [];
    for (const s of currentScores) {
      const prev = snapshot.scores[s.countryCode];
      if (prev !== undefined) {
        const d = Math.round((s.score - prev) * 10) / 10;
        if (Math.abs(d) >= 1) {
          movers.push({ code: s.countryCode, name: s.countryName, score: s.score, delta: d });
        }
      }
    }
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const topMovers = movers.slice(0, 5);

    if (topMovers.length > 0) {
      const card = createElement('div', { className: 'nw-welcome-back' });
      card.style.cssText =
        'padding:12px;border:1px solid var(--nw-border);border-radius:6px;margin:0 0 12px;background:var(--nw-surface);position:relative';

      const dismissBtn = createElement('button', {});
      dismissBtn.textContent = '\u2715';
      dismissBtn.style.cssText =
        'position:absolute;top:8px;right:8px;background:none;border:none;color:var(--nw-text-muted);cursor:pointer;font-size:12px';
      dismissBtn.addEventListener('click', () => {
        card.remove();
        sessionStorage.setItem('nw:welcome-dismissed', '1');
      });
      card.appendChild(dismissBtn);

      const header = createElement('div', {});
      header.style.cssText =
        'font-family:var(--nw-font-mono);font-size:10px;letter-spacing:1px;color:var(--nw-text-muted);margin:0 0 8px';
      // Include streak if > 1 day
      let streakText = '';
      try {
        const streakData = JSON.parse(localStorage.getItem('nw:visit-streak') || '{}') as { count?: number };
        if (streakData.count && streakData.count > 1) {
          streakText = ` \u00b7 ${streakData.count}-day streak \u{1F525}`;
        }
      } catch {
        /* ignore */
      }
      header.textContent = `SINCE YOU LEFT (${awayText} AGO)${streakText}`;
      card.appendChild(header);

      for (const m of topMovers) {
        const row = createElement('div', {});
        row.style.cssText =
          'display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px';
        const sign = m.delta > 0 ? '+' : '';
        const dColor = m.delta > 0 ? '#dc2626' : '#22c55e';
        row.innerHTML = `<span style="color:var(--nw-text-secondary)">${m.name}</span><span><span style="color:${ciiColor(m.score)};font-weight:700;font-family:var(--nw-font-mono)">${m.score}</span> <span style="color:${dColor};font-size:10px;font-family:var(--nw-font-mono)">${sign}${m.delta}</span></span>`;
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          const country = getMonitoredCountries().find((c) => c.code === m.code);
          if (country) mapView.flyTo(country.lon, country.lat, 5);
        });
        card.appendChild(row);
      }

      container.appendChild(card);
    }
  }

  // Data summary strip
  const summary = createElement('div', { className: 'nw-data-summary' });
  const stats = [
    { id: 'earthquakes', label: 'QUAKES', color: '#ff3c3c' },
    { id: 'fires', label: 'FIRES', color: '#ff6b00' },
    { id: 'news', label: 'NEWS', color: '#eab308' },
    { id: 'flights', label: 'FLIGHTS', color: '#818cf8' },
    { id: 'conflicts', label: 'CONFLICTS', color: '#ef4444' },
  ];
  for (const stat of stats) {
    const layer = layerMgr.getLayer(stat.id);
    const count = layer?.getFeatureCount() || 0;
    const cell = createElement('div', { className: 'nw-stat-cell' });
    const valueEl = createElement('span', { className: 'nw-stat-value' });
    valueEl.style.color = stat.color;
    valueEl.textContent = String(count);
    valueEl.dataset.statId = stat.id;
    const labelEl = createElement('span', { className: 'nw-stat-label', textContent: stat.label });
    cell.appendChild(valueEl);
    cell.appendChild(labelEl);

    // Animate if we have a previous value
    const prevEl = document.querySelector(`.nw-stat-value[data-stat-id="${stat.id}"]`);
    if (prevEl && prevEl !== valueEl) {
      const prevCount = parseInt(prevEl.textContent || '0', 10);
      if (prevCount !== count) {
        valueEl.textContent = String(prevCount);
        requestAnimationFrame(() => animateCounter(valueEl, count));
      }
    }
    summary.appendChild(cell);
  }
  container.appendChild(summary);

  // ── Your Watchlist (CII-watched countries with deltas) ──
  const ciiWatchlist = getCiiWatchlist();
  const allScores = getCachedCII();
  if (ciiWatchlist.length > 0 && allScores.length > 0) {
    const wlHeader = createElement('div', { className: 'nw-section-header' });
    wlHeader.textContent = `YOUR WATCHLIST (${ciiWatchlist.length})`;
    container.appendChild(wlHeader);

    // Sort by delta magnitude (biggest movers first), then by CII score
    const wlEntries = ciiWatchlist
      .map((w) => {
        const s = allScores.find((sc) => sc.countryCode === w.countryCode);
        const d = getCIIDelta(w.countryCode);
        return { watch: w, score: s, delta: d };
      })
      .filter((e) => e.score)
      .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || b.score!.score - a.score!.score);

    for (const entry of wlEntries) {
      const s = entry.score!;
      const row = createElement('div', { className: 'nw-country-row' });
      const color = ciiColor(s.score);
      const flag = createElement('span', { className: 'nw-country-flag', textContent: countryFlag(s.countryCode) });
      const name = createElement('span', { className: 'nw-country-name', textContent: s.countryName });
      const scoreEl = createElement('span', { className: 'nw-country-score' });
      scoreEl.style.color = color;
      scoreEl.textContent = String(s.score);

      const deltaEl = createElement('span', {});
      if (entry.delta !== null && Math.abs(entry.delta) >= 0.5) {
        const sign = entry.delta > 0 ? '+' : '';
        deltaEl.textContent = `${sign}${entry.delta}`;
        deltaEl.style.cssText = `font-size:9px;font-family:var(--nw-font-mono);margin-left:3px;color:${entry.delta > 0 ? '#dc2626' : '#22c55e'}`;
      }

      const trendEl = createElement('span', { className: 'nw-country-trend' });
      if (s.trend === 'rising') {
        trendEl.textContent = '\u2191';
        trendEl.style.color = 'var(--color-signal-critical, #dc2626)';
      } else if (s.trend === 'falling') {
        trendEl.textContent = '\u2193';
        trendEl.style.color = 'var(--color-signal-ok, #22c55e)';
      }

      // Brief link
      const briefLink = createElement('a', {});
      briefLink.setAttribute('href', `#/brief-country/${s.countryCode}`);
      briefLink.textContent = '\u{1F4CB}';
      briefLink.title = `${s.countryName} country brief`;
      briefLink.style.cssText = 'font-size:10px;text-decoration:none;margin-left:4px;opacity:0.5';
      briefLink.addEventListener('click', (ev) => ev.stopPropagation());

      row.appendChild(flag);
      row.appendChild(name);
      row.appendChild(trendEl);
      row.appendChild(scoreEl);
      row.appendChild(deltaEl);
      row.appendChild(briefLink);
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const country = getMonitoredCountries().find((c) => c.code === s.countryCode);
        if (country) mapView.flyTo(country.lon, country.lat, 5);
        showCountryDetail(document.querySelector('.nw-sidebar') || document.body, s);
      });
      container.appendChild(row);
    }

    if (wlEntries.length === 0) {
      const emptyEl = createElement('div', { className: 'nw-placeholder' });
      emptyEl.innerHTML =
        'Add countries on the <a href="#/watchlist" style="color:var(--nw-accent)">Watchlist page</a>';
      container.appendChild(emptyEl);
    }
  }

  // Auto-generated threat alerts
  const autoAlerts = getAutoAlerts();
  if (autoAlerts.length > 0) {
    const autoHeader = createElement('div', { className: 'nw-section-header', textContent: 'THREAT DETECTION' });
    container.appendChild(autoHeader);
    for (const alert of autoAlerts.slice(0, 5)) {
      const row = createElement('div', { className: 'nw-alert-row' });
      const dot = createElement('span', { className: 'nw-alert-dot' });
      dot.classList.add(
        alert.severity === 'critical' ? 'critical' : alert.severity === 'elevated' ? 'elevated' : 'monitor',
      );
      const text = createElement('span', { className: 'nw-alert-text' });
      text.textContent = `[${alert.type.toUpperCase()}] ${alert.title}`;
      row.appendChild(dot);
      row.appendChild(text);
      if (alert.lat !== 0 || alert.lon !== 0) {
        row.addEventListener('click', () => mapView.flyTo(alert.lon, alert.lat, 6));
      }
      container.appendChild(row);
    }
  }

  // Watchlist matches
  const watchMatches = getWatchMatches();
  if (watchMatches.length > 0) {
    const watchHeader = createElement('div', { className: 'nw-section-header', textContent: 'WATCHLIST' });
    container.appendChild(watchHeader);
    for (const match of watchMatches.slice(0, 10)) {
      const row = createElement('div', { className: 'nw-alert-row' });
      const dot = createElement('span', { className: 'nw-alert-dot' });
      dot.style.background = 'var(--nw-accent, #ff6600)';
      const tag = createElement('span', { className: 'nw-watch-tag' });
      tag.textContent = match.watchLabel;
      const text = createElement('span', { className: 'nw-alert-text' });
      text.textContent = `[${match.source}] ${match.text}`;
      row.appendChild(dot);
      row.appendChild(tag);
      row.appendChild(text);
      if (match.lat !== 0 || match.lon !== 0) {
        row.addEventListener('click', () => mapView.flyTo(match.lon, match.lat, 6));
      }
      container.appendChild(row);
    }
  }

  // Watchlist management
  const watchMgmt = createElement('div', { className: 'nw-watch-mgmt' });
  const watchItems = getWatchlist();
  for (const item of watchItems) {
    const row = createElement('div', { className: 'nw-watch-item' });
    const label = createElement('span', { className: 'nw-watch-item-label', textContent: item.label });
    const removeBtn = createElement('button', { className: 'nw-watch-remove', textContent: '×' });
    removeBtn.addEventListener('click', () => {
      removeWatchItem(item.id);
      document.dispatchEvent(new CustomEvent('dashview:watchlist-changed'));
    });
    row.appendChild(label);
    row.appendChild(removeBtn);
    watchMgmt.appendChild(row);
  }
  // Add new item form
  const addRow = createElement('div', { className: 'nw-watch-add' });
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'nw-watch-input';
  addInput.placeholder = 'Add keyword...';
  const addBtn = createElement('button', { className: 'nw-watch-add-btn', textContent: '+' });
  addBtn.addEventListener('click', () => {
    const val = addInput.value.trim();
    if (val) {
      addWatchItem({ id: `w-${Date.now()}`, type: 'keyword', value: val.toLowerCase(), label: val });
      addInput.value = '';
      document.dispatchEvent(new CustomEvent('dashview:watchlist-changed'));
    }
  });
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  watchMgmt.appendChild(addRow);
  container.appendChild(watchMgmt);

  // Triggered alert rules
  const triggered = getTriggeredAlerts();
  if (triggered.length > 0) {
    const ruleHeader = createElement('div', { className: 'nw-section-header', textContent: 'TRIGGERED RULES' });
    container.appendChild(ruleHeader);
    for (const alert of triggered.slice(0, 5)) {
      const row = createElement('div', { className: 'nw-alert-row' });
      const dot = createElement('span', { className: 'nw-alert-dot critical' });
      const text = createElement('span', { className: 'nw-alert-text', textContent: alert.message });
      const time = createElement('span', { className: 'nw-alert-time' });
      const ago = Math.floor((Date.now() - alert.timestamp) / 60000);
      time.textContent = ago < 1 ? 'now' : `${ago}m`;
      row.appendChild(dot);
      row.appendChild(text);
      row.appendChild(time);
      container.appendChild(row);
    }
  }

  // Geo-intelligence alerts
  const alertHeader = createElement('div', { className: 'nw-section-header', textContent: 'INTELLIGENCE' });
  container.appendChild(alertHeader);

  const items = getIntelItems();
  if (items.length === 0) {
    container.appendChild(
      createElement('div', { className: 'nw-placeholder', textContent: 'Monitoring — no alerts yet' }),
    );
  } else {
    for (const item of items.slice(0, 20)) {
      container.appendChild(createAlertRow(item, mapView));
    }
  }

  // Country index section
  // Verified signals section — cross-source verified intelligence
  const verifiedSignals = getVerifiedSignals();
  if (verifiedSignals.length > 0) {
    const verifiedHeader = createElement('div', { className: 'nw-section-header' });
    verifiedHeader.textContent = `VERIFIED SIGNALS (${verifiedSignals.length})`;
    container.appendChild(verifiedHeader);

    for (const sig of verifiedSignals.slice(0, 8)) {
      const row = createElement('div', { className: 'nw-verified-row' });
      const badge = createElement('span', { className: 'nw-verified-badge' });
      badge.textContent = verificationIcon(sig.level);
      badge.style.color = verificationColor(sig.level);
      badge.title = `${verificationLabel(sig.level)} — ${sig.sources.length} sources: ${sig.sources.map((s) => s.name).join(', ')}`;

      const text = createElement('span', { className: 'nw-verified-text' });
      text.textContent = sig.summary.length > 60 ? sig.summary.slice(0, 57) + '...' : sig.summary;

      const sourceCount = createElement('span', { className: 'nw-verified-sources' });
      sourceCount.textContent = `${sig.sources.length} src`;
      sourceCount.style.color = verificationColor(sig.level);

      row.appendChild(badge);
      row.appendChild(text);
      row.appendChild(sourceCount);

      if (sig.lat && sig.lon) {
        row.addEventListener('click', () => mapView.flyTo(sig.lon, sig.lat, 6));
        row.style.cursor = 'pointer';
      }

      container.appendChild(row);
    }
  }

  // ── Top Movers — biggest CII changes since last visit ──
  const snapshotForMovers = getPreviousSnapshot();
  const scoresForMovers = getCachedCII();
  if (snapshotForMovers && scoresForMovers.length > 0) {
    const topMoversData = scoresForMovers
      .map((s) => {
        const prev = snapshotForMovers.scores[s.countryCode];
        if (prev === undefined) return null;
        const d = Math.round((s.score - prev) * 10) / 10;
        return Math.abs(d) >= 1 ? { score: s, delta: d } : null;
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b!.delta) - Math.abs(a!.delta))
      .slice(0, 8) as { score: CIIScore; delta: number }[];

    if (topMoversData.length > 0) {
      const moversHeader = createElement('div', { className: 'nw-section-header' });
      moversHeader.textContent = `TOP MOVERS (${topMoversData.length})`;
      container.appendChild(moversHeader);

      for (const { score: ms, delta: md } of topMoversData) {
        const row = createElement('div', { className: 'nw-country-row' });
        const flag = createElement('span', { className: 'nw-country-flag', textContent: countryFlag(ms.countryCode) });
        const name = createElement('span', { className: 'nw-country-name', textContent: ms.countryName });
        const scoreEl = createElement('span', { className: 'nw-country-score' });
        scoreEl.style.color = ciiColor(ms.score);
        scoreEl.textContent = String(ms.score);
        const deltaEl = createElement('span', {});
        const sign = md > 0 ? '+' : '';
        deltaEl.textContent = `${sign}${md}`;
        deltaEl.style.cssText = `font-size:10px;font-weight:700;font-family:var(--nw-font-mono);margin-left:4px;color:${md > 0 ? '#dc2626' : '#22c55e'}`;
        row.appendChild(flag);
        row.appendChild(name);
        row.appendChild(scoreEl);
        row.appendChild(deltaEl);
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          const country = getMonitoredCountries().find((c) => c.code === ms.countryCode);
          if (country) mapView.flyTo(country.lon, country.lat, 5);
          showCountryDetail(document.querySelector('.nw-sidebar') || document.body, ms);
        });
        container.appendChild(row);
      }
    }
  }

  // ── Regional Risk Aggregates ──
  const REGIONS: { name: string; codes: string[] }[] = [
    {
      name: 'Middle East',
      codes: ['IR', 'IQ', 'SY', 'YE', 'IL', 'PS', 'LB', 'JO', 'SA', 'AE', 'QA', 'KW', 'BH', 'OM'],
    },
    {
      name: 'Sahel & West Africa',
      codes: ['ML', 'BF', 'NE', 'NG', 'TD', 'CF', 'CM', 'GH', 'SN', 'CI', 'GN', 'SL', 'LR', 'TG', 'BJ', 'MR', 'GM'],
    },
    { name: 'Horn & East Africa', codes: ['SD', 'SS', 'ET', 'SO', 'KE', 'UG', 'ER', 'DJ', 'TZ', 'RW', 'BI'] },
    { name: 'Eastern Europe', codes: ['UA', 'RU', 'BY', 'MD', 'PL', 'RO', 'BG', 'HU', 'CZ', 'SK', 'GE', 'AM', 'AZ'] },
    { name: 'Balkans', codes: ['RS', 'BA', 'XK', 'ME', 'MK', 'AL', 'HR', 'GR'] },
    {
      name: 'East & SE Asia',
      codes: ['CN', 'TW', 'KP', 'KR', 'JP', 'PH', 'MM', 'TH', 'VN', 'KH', 'LA', 'MY', 'ID', 'SG', 'HK'],
    },
    { name: 'South Asia', codes: ['IN', 'PK', 'AF', 'BD', 'LK', 'NP', 'BT', 'MV'] },
    { name: 'Central Asia', codes: ['KZ', 'UZ', 'TM', 'KG', 'TJ', 'MN'] },
    {
      name: 'Americas',
      codes: ['MX', 'VE', 'CO', 'BR', 'AR', 'CL', 'PE', 'EC', 'BO', 'HT', 'CU', 'GT', 'HN', 'SV', 'NI', 'PA', 'CR'],
    },
  ];

  const allCiiScores = getCachedCII();
  if (allCiiScores.length > 0) {
    const regionHeader = createElement('div', { className: 'nw-section-header nw-section-collapsible' });
    regionHeader.textContent = 'REGIONAL RISK';
    let regionExpanded = false;
    const regionBody = createElement('div', {});
    regionBody.style.display = 'none';
    regionHeader.classList.add('collapsed');
    regionHeader.addEventListener('click', () => {
      regionExpanded = !regionExpanded;
      regionBody.style.display = regionExpanded ? '' : 'none';
      regionHeader.classList.toggle('collapsed', !regionExpanded);
    });
    container.appendChild(regionHeader);

    for (const region of REGIONS) {
      const regionScores = allCiiScores.filter((s) => region.codes.includes(s.countryCode));
      if (regionScores.length === 0) continue;
      const avg = Math.round(regionScores.reduce((sum, s) => sum + s.score, 0) / regionScores.length);
      const max = Math.max(...regionScores.map((s) => s.score));
      const rising = regionScores.filter((s) => s.trend === 'rising').length;
      const avgColor = avg >= 60 ? '#dc2626' : avg >= 40 ? '#f97316' : avg >= 20 ? '#eab308' : '#22c55e';

      const row = createElement('div', {});
      row.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:11px;cursor:pointer;border-bottom:1px solid var(--nw-border-subtle, #1a1a1a)';
      row.innerHTML = `<span style="color:var(--nw-text-secondary);flex:1">${region.name}</span><span style="display:flex;gap:10px;align-items:center;font-family:var(--nw-font-mono);font-size:10px"><span style="color:var(--nw-text-muted)">${regionScores.length}</span><span style="color:${avgColor};font-weight:700">avg ${avg}</span><span style="color:${ciiColor(max)}">max ${max}</span>${rising > 0 ? `<span style="color:#dc2626">${rising}\u2191</span>` : ''}</span>`;

      row.addEventListener('click', () => {
        const existing = regionBody.querySelector(`[data-region="${region.name}"]`);
        if (existing) {
          existing.remove();
          return;
        }
        const subList = createElement('div', {});
        subList.dataset.region = region.name;
        subList.style.cssText = 'padding:4px 0 8px 12px';
        for (const s of regionScores.sort((a, b) => b.score - a.score)) {
          const subRow = createElement('div', {});
          subRow.style.cssText =
            'display:flex;justify-content:space-between;padding:2px 0;font-size:10px;cursor:pointer';
          const ta = s.trend === 'rising' ? ' \u2191' : s.trend === 'falling' ? ' \u2193' : '';
          subRow.innerHTML = `<span style="color:var(--nw-text-secondary)">${countryFlag(s.countryCode)} ${s.countryName}</span><span style="color:${ciiColor(s.score)};font-family:var(--nw-font-mono);font-weight:700">${s.score}${ta}</span>`;
          subRow.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const c = getMonitoredCountries().find((mc) => mc.code === s.countryCode);
            if (c) mapView.flyTo(c.lon, c.lat, 5);
            showCountryDetail(document.querySelector('.nw-sidebar') || document.body, s);
          });
          subList.appendChild(subRow);
        }
        row.after(subList);
      });
      regionBody.appendChild(row);
    }
    container.appendChild(regionBody);
  }

  const countryHeader = createElement('div', { className: 'nw-section-header' });
  countryHeader.textContent = `COUNTRY INSTABILITY INDEX (${COUNTRY_COUNT})`;
  container.appendChild(countryHeader);

  const scores = getCachedCII();
  // Fetch 30-day CII history for sparklines
  const ciiHistoryMap = new Map<string, number[]>();
  fetch('/api/v1/timeline-data?days=30')
    .then((r) => r.json())
    .then((data: { cii?: Array<{ day: string; countries: Array<{ code: string; score: number }> }> }) => {
      if (!data.cii) return;
      // Build per-country score arrays (chronological)
      for (const day of data.cii) {
        for (const c of day.countries) {
          const arr = ciiHistoryMap.get(c.code) || [];
          arr.push(c.score);
          ciiHistoryMap.set(c.code, arr);
        }
      }
      // Update sparklines in rendered rows
      for (const [code, values] of ciiHistoryMap) {
        const sparkEl = container.querySelector(`[data-sparkline="${code}"]`);
        if (sparkEl && values.length >= 2) {
          const spark = createSparkline(values, 48, 14);
          sparkEl.replaceWith(spark);
          spark.dataset.sparkline = code;
        }
      }
    })
    .catch(() => {
      /* sparkline fetch failed — non-critical */
    });

  if (scores.length === 0) {
    for (let i = 0; i < 8; i++) {
      const sk = createElement('div', { className: 'nw-skeleton-row' });
      const bar1 = createElement('div', { className: 'nw-skeleton-bar' });
      bar1.style.width = '20px';
      bar1.style.flexShrink = '0';
      const bar2 = createElement('div', { className: 'nw-skeleton-bar' });
      bar2.style.flex = '1';
      const bar3 = createElement('div', { className: 'nw-skeleton-bar' });
      bar3.style.width = '32px';
      sk.appendChild(bar1);
      sk.appendChild(bar2);
      sk.appendChild(bar3);
      container.appendChild(sk);
    }
  } else {
    for (const score of scores) {
      container.appendChild(createCountryRow(score, mapView));
    }
  }

  // Layers section
  const layersHeader = createElement('div', { className: 'nw-section-header nw-section-collapsible' });
  layersHeader.textContent = `DATA LAYERS (${layerMgr.getAllLayers().length})`;
  let layersExpanded = true;
  layersHeader.addEventListener('click', () => {
    layersExpanded = !layersExpanded;
    layersBody.style.display = layersExpanded ? '' : 'none';
    layersHeader.classList.toggle('collapsed', !layersExpanded);
  });
  container.appendChild(layersHeader);

  const layersBody = createElement('div', {});
  const CATEGORY_ORDER: MapLayerCategory[] = ['natural', 'conflict', 'infrastructure', 'intelligence', 'weather'];
  const CATEGORY_LABELS: Record<string, string> = {
    natural: 'NATURAL',
    conflict: 'CONFLICT',
    infrastructure: 'INFRASTRUCTURE',
    intelligence: 'INTELLIGENCE',
    weather: 'WEATHER',
  };

  for (const cat of CATEGORY_ORDER) {
    const catLayers = layerMgr.getLayersByCategory(cat);
    if (catLayers.length === 0) continue;

    const catLabel = createElement('div', { className: 'nw-layer-cat-label', textContent: CATEGORY_LABELS[cat] });
    layersBody.appendChild(catLabel);

    for (const layer of catLayers) {
      const row = createElement('label', { className: 'nw-layer-row' });
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = layer.isEnabled();
      toggle.className = 'nw-layer-toggle';
      toggle.addEventListener('change', () => {
        layerMgr.toggle(layer.id);
      });

      const name = createElement('span', { className: 'nw-layer-name', textContent: layer.name });

      // Freshness indicator dot — shows data recency at a glance
      const freshDot = createElement('span', { className: 'nw-layer-fresh-dot' });
      const prov = getProvenance(layer.id);
      if (prov) {
        const freshness = computeFreshness(prov);
        freshDot.style.background = freshnessColor(freshness);
        freshDot.title = `${prov.source} · ${relativeTime(prov.fetchedAt)} · ${prov.dataPointCount} points`;
      }

      const count = createElement('span', { className: 'nw-layer-count' });
      if (layer.isEnabled() && layer.getFeatureCount() > 0) {
        count.textContent = String(layer.getFeatureCount());
      }

      row.appendChild(toggle);
      row.appendChild(freshDot);
      row.appendChild(name);
      row.appendChild(count);
      layersBody.appendChild(row);
    }
  }
  container.appendChild(layersBody);

  // ── Data Sources Status ──
  const sourcesHeader = createElement('div', { className: 'nw-section-header nw-section-collapsible collapsed' });
  sourcesHeader.textContent = 'DATA SOURCES';
  const sourcesBody = createElement('div', {});
  sourcesBody.style.display = 'none';
  sourcesHeader.addEventListener('click', () => {
    const expanded = sourcesBody.style.display !== 'none';
    sourcesBody.style.display = expanded ? 'none' : '';
    sourcesHeader.classList.toggle('collapsed', expanded);
  });
  container.appendChild(sourcesHeader);

  const enabledLayers = layerMgr.getEnabledLayers();
  const seenSources = new Set<string>();
  for (const layer of enabledLayers) {
    const prov = getProvenance(layer.id);
    if (!prov || seenSources.has(prov.source)) continue;
    seenSources.add(prov.source);
    const freshness = computeFreshness(prov);
    const color = freshnessColor(freshness);
    const ago = relativeTime(prov.fetchedAt);
    const row = createElement('div', {});
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:10px';
    row.innerHTML = `<span style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0"></span><span style="color:var(--nw-text-secondary)">${prov.source}</span></span><span style="color:var(--nw-text-muted)">${ago} \u00b7 ${prov.dataPointCount} pts</span>`;
    sourcesBody.appendChild(row);
  }
  if (seenSources.size === 0) {
    sourcesBody.innerHTML =
      '<div style="font-size:10px;color:var(--nw-text-muted);padding:4px 0">Loading data sources\u2026</div>';
  }
  container.appendChild(sourcesBody);
}

function createAlertRow(item: IntelItem, mapView: MapView): HTMLElement {
  const row = createElement('div', { className: 'nw-alert-row' });

  const dot = createElement('span', { className: 'nw-alert-dot' });
  dot.classList.add(item.priority === 0 ? 'critical' : item.priority === 1 ? 'elevated' : 'monitor');

  const text = createElement('span', { className: 'nw-alert-text', textContent: item.text });

  row.appendChild(dot);
  row.appendChild(text);

  if (item.lat !== 0 || item.lon !== 0) {
    row.addEventListener('click', () => mapView.flyTo(item.lon, item.lat, 6));
  }

  return row;
}

function createCountryRow(score: CIIScore, mapView: MapView): HTMLElement {
  const row = createElement('div', { className: 'nw-country-row' });
  const color = ciiColor(score.score);
  const label = ciiLabel(score.score);

  const flag = createElement('span', { className: 'nw-country-flag' });
  flag.textContent = countryFlag(score.countryCode);

  const name = createElement('span', { className: 'nw-country-name', textContent: score.countryName });

  // Tier badge for transparency — shows coverage depth
  if (score.tier !== 'core') {
    const tierBadge = createElement('span', { className: 'nw-country-tier' });
    tierBadge.textContent = score.tier === 'extended' ? 'EXT' : 'MON';
    tierBadge.title =
      score.tier === 'extended' ? 'Extended coverage — partial feed data' : 'Monitoring — baseline + global feeds';
    name.appendChild(tierBadge);
  }

  // Trend arrow
  const trendEl = createElement('span', { className: 'nw-country-trend' });
  if (score.trend === 'rising') {
    trendEl.textContent = '↑';
    trendEl.style.color = 'var(--color-signal-critical, #dc2626)';
  } else if (score.trend === 'falling') {
    trendEl.textContent = '↓';
    trendEl.style.color = 'var(--color-signal-ok, #22c55e)';
  }

  const labelEl = createElement('span', { className: 'nw-country-label' });
  labelEl.style.color = color;
  labelEl.textContent = label;

  const scoreEl = createElement('span', { className: 'nw-country-score' });
  scoreEl.style.color = color;
  scoreEl.textContent = String(score.score);

  // Delta badge — change since last visit
  const delta = getCIIDelta(score.countryCode);
  const deltaEl = createElement('span', { className: 'nw-country-delta' });
  if (delta !== null && Math.abs(delta) >= 0.5) {
    const sign = delta > 0 ? '+' : '';
    deltaEl.textContent = `${sign}${delta}`;
    deltaEl.style.cssText = `font-size:9px;font-family:var(--nw-font-mono);margin-left:3px;color:${delta > 0 ? '#dc2626' : '#22c55e'}`;
  }

  // Confidence indicator — the trust signal
  const confEl = createElement('span', { className: 'nw-country-confidence' });
  confEl.textContent = confidenceIcon(score.confidence);
  confEl.style.color = confidenceColor(score.confidence);
  const ev = score.evidence;
  confEl.title = `${score.confidence.toUpperCase()} CONFIDENCE — ${ev.totalSourceCount} sources, ${ev.totalDataPoints} data points${ev.summaryGaps.length > 0 ? ` | Gaps: ${ev.summaryGaps[0]}` : ''}`;

  // Sparkline placeholder — replaced when CII history loads
  const sparkPlaceholder = createElement('span', { className: 'nw-sparkline-placeholder' });
  sparkPlaceholder.dataset.sparkline = score.countryCode;
  sparkPlaceholder.style.width = '48px';
  sparkPlaceholder.style.height = '14px';
  sparkPlaceholder.style.display = 'inline-block';

  row.appendChild(flag);
  row.appendChild(name);
  row.appendChild(confEl);
  row.appendChild(trendEl);
  row.appendChild(sparkPlaceholder);
  row.appendChild(labelEl);
  row.appendChild(scoreEl);
  row.appendChild(deltaEl);

  // Click → fly to country AND show detail panel with evidence chain
  const countries = getMonitoredCountries();
  const match = countries.find((c) => c.code === score.countryCode);
  row.addEventListener('click', () => {
    if (match) mapView.flyTo(match.lon, match.lat, 5);
    showCountryDetail(document.querySelector('.nw-sidebar') || document.body, score);
  });

  return row;
}

// ── Country Detail Panel (Evidence Chain) ──

function showCountryDetail(container: HTMLElement, score: CIIScore): void {
  // Remove existing detail panel
  container.querySelector('.nw-country-detail')?.remove();

  const panel = createElement('div', { className: 'nw-country-detail' });
  const ev = score.evidence;

  // Header
  const header = createElement('div', { className: 'nw-detail-header' });
  const title = createElement('div', { className: 'nw-detail-title' });
  title.textContent = `${countryFlag(score.countryCode)} ${score.countryName}`;
  const closeBtn = createElement('button', { className: 'nw-detail-close', textContent: '✕' });
  closeBtn.addEventListener('click', () => panel.remove());
  const scoreBadge = createElement('div', { className: 'nw-detail-score' });
  scoreBadge.style.color = ciiColor(score.score);
  scoreBadge.textContent = `CII ${score.score}`;
  // Delta from last visit
  const detailDelta = getCIIDelta(score.countryCode);
  if (detailDelta !== null && Math.abs(detailDelta) >= 0.5) {
    const dSign = detailDelta > 0 ? '+' : '';
    const dSpan = createElement('span', {});
    dSpan.style.cssText = `font-size:14px;margin-left:6px;color:${detailDelta > 0 ? 'var(--color-signal-critical, #dc2626)' : 'var(--color-signal-ok, #22c55e)'}`;
    dSpan.textContent = `${dSign}${detailDelta}`;
    scoreBadge.appendChild(dSpan);
  }
  const confBadge = createElement('span', { className: 'nw-detail-conf' });
  confBadge.style.color = confidenceColor(score.confidence);
  confBadge.textContent = ` ${confidenceIcon(score.confidence)} ${score.confidence.toUpperCase()} CONFIDENCE`;
  scoreBadge.appendChild(confBadge);

  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);
  panel.appendChild(scoreBadge);

  // Data quality + tier + freshness — inline single-line badge.
  // 2026-05-02 P1.5: source-count + age badge styled via class, not inline.
  const qualityLine = createElement('div', { className: 'nw-detail-meta nw-detail-meta-quality' });
  const grade = score.dataQuality || 'C';
  const tierLabel = score.tier === 'core' ? 'CORE' : score.tier === 'extended' ? 'EXTENDED' : 'MONITOR';
  const lastComputed = (score as unknown as { _computedAt?: number })._computedAt;
  const ageStr = lastComputed
    ? (() => {
        const ago = Math.round((Date.now() - lastComputed) / 60000);
        return ago < 1 ? 'just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
      })()
    : 'last 5m';
  // Freshness color from age (green <10m, yellow <60m, orange <360m, red beyond).
  const ageMin = lastComputed ? (Date.now() - lastComputed) / 60000 : 5;
  const ageClass = ageMin < 10 ? 'is-fresh' : ageMin < 60 ? 'is-recent' : ageMin < 360 ? 'is-stale' : 'is-old';
  qualityLine.innerHTML = `
    <span class="nw-detail-grade nw-detail-grade-${grade.toLowerCase()}">Grade ${grade}</span>
    <span class="nw-detail-sources nw-detail-age-${ageClass}">${ev.totalSourceCount} sources · ${ageStr}</span>
    <span class="nw-detail-tier">${ev.totalDataPoints} data points · ${tierLabel}</span>
  `;
  panel.appendChild(qualityLine);

  // Action buttons
  const actions = createElement('div', { className: 'nw-detail-actions' });
  const newsBtn = createElement('button', { className: 'nw-detail-action-btn' });
  newsBtn.innerHTML = '📺 News';
  newsBtn.addEventListener('click', () => {
    void showNewsView(score.countryName, score.countryName);
  });
  actions.appendChild(newsBtn);

  const shareBtn = createElement('button', { className: 'nw-detail-action-btn' });
  shareBtn.innerHTML = '🔗 Share';
  shareBtn.addEventListener('click', async () => {
    const ok = await copyPermalink({ country: score.countryCode, view: 'detail' });
    shareBtn.innerHTML = ok ? '✓ Copied' : '✗ Failed';
    setTimeout(() => {
      shareBtn.innerHTML = '🔗 Share';
    }, 2000);
  });
  actions.appendChild(shareBtn);

  const exportBtn = createElement('button', { className: 'nw-detail-action-btn' });
  exportBtn.innerHTML = '⬇ Export';
  exportBtn.addEventListener('click', () => {
    downloadJson(score, `cii-${score.countryCode.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`);
  });
  actions.appendChild(exportBtn);

  // Second row: watchlist, audit, compare
  const actions2 = createElement('div', { className: 'nw-detail-actions' });
  actions2.style.marginTop = '4px';

  const watchBtn = createElement('button', { className: 'nw-detail-action-btn' });
  const isWatching = getCiiWatchlist().some((w) => w.countryCode === score.countryCode);
  watchBtn.innerHTML = isWatching ? '\u2605 Watching' : '\u2606 Watch';
  watchBtn.addEventListener('click', () => {
    if (!isWatching) {
      addCiiWatch(score.countryCode);
      watchBtn.innerHTML = '\u2605 Watching';
    }
  });
  actions2.appendChild(watchBtn);

  const auditBtn = createElement('button', { className: 'nw-detail-action-btn' });
  auditBtn.innerHTML = '\u26d3 Audit';
  auditBtn.addEventListener('click', () => {
    window.location.hash = `#/audit/${score.countryCode}`;
  });
  actions2.appendChild(auditBtn);

  const compareBtn = createElement('button', { className: 'nw-detail-action-btn' });
  compareBtn.innerHTML = '\u2194 Compare';
  compareBtn.addEventListener('click', () => {
    window.location.hash = `#/compare?codes=${score.countryCode}`;
  });
  actions2.appendChild(compareBtn);

  panel.appendChild(actions);
  panel.appendChild(actions2);

  // Component breakdown
  const COMPONENT_LABELS: Record<string, string> = {
    conflict: 'CONFLICT',
    disasters: 'DISASTERS',
    sentiment: 'SENTIMENT',
    infrastructure: 'INFRASTRUCTURE',
    governance: 'GOVERNANCE',
    marketExposure: 'MARKET EXPOSURE',
  };

  for (const comp of ev.components) {
    const compRow = createElement('div', { className: 'nw-detail-comp' });

    // Label + score bar
    const compHeader = createElement('div', { className: 'nw-detail-comp-header' });
    const compLabel = createElement('span', {});
    compLabel.textContent = COMPONENT_LABELS[comp.component] || comp.component;
    const compScore = createElement('span', {});
    compScore.style.color = confidenceColor(comp.confidence);
    compScore.textContent = `${comp.score}/${comp.maxScore} ${confidenceIcon(comp.confidence)}`;
    compHeader.appendChild(compLabel);
    compHeader.appendChild(compScore);
    compRow.appendChild(compHeader);

    // Score bar
    const barContainer = createElement('div', { className: 'nw-detail-bar' });
    const barFill = createElement('div', { className: 'nw-detail-bar-fill' });
    barFill.style.width = `${(comp.score / comp.maxScore) * 100}%`;
    barFill.style.background = confidenceColor(comp.confidence);
    barContainer.appendChild(barFill);
    compRow.appendChild(barContainer);

    // Sources
    if (comp.sources.length > 0) {
      const srcLine = createElement('div', { className: 'nw-detail-sources' });
      srcLine.textContent = comp.sources.map((s) => `${s.name} (${s.dataPointCount})`).join(' · ');
      compRow.appendChild(srcLine);
    }

    // Data points (top 3)
    for (const dp of comp.dataPoints.slice(0, 3)) {
      const dpLine = createElement('div', { className: 'nw-detail-datapoint' });
      dpLine.textContent = `▸ ${dp.text}`;
      dpLine.title = `Source: ${dp.source}`;
      compRow.appendChild(dpLine);
    }

    // Gaps
    for (const gap of comp.gaps) {
      const gapLine = createElement('div', { className: 'nw-detail-gap' });
      gapLine.textContent = `⚠ ${gap}`;
      compRow.appendChild(gapLine);
    }

    panel.appendChild(compRow);
  }

  // ── W6 enriched country sections (Top Entities / Trade / Alliances / Energy / Headlines) ──
  appendCountryEnrichedSections(panel, score.countryCode, score.countryName);

  // Summary gaps
  if (ev.summaryGaps.length > 0) {
    const gapSection = createElement('div', { className: 'nw-detail-gaps-section' });
    const gapHeader = createElement('div', { className: 'nw-detail-gaps-title' });
    gapHeader.textContent = "WHAT WE DON'T COVER";
    gapSection.appendChild(gapHeader);
    for (const gap of ev.summaryGaps.slice(0, 5)) {
      const g = createElement('div', { className: 'nw-detail-gap' });
      g.textContent = `⚠ ${gap}`;
      gapSection.appendChild(g);
    }
    panel.appendChild(gapSection);
  }

  container.appendChild(panel);
}

// ── Country panel enrichment helpers (W6) ──

function makeDetails(title: string, count?: string | number, expanded = false): HTMLDetailsElement {
  const d = document.createElement('details');
  d.className = 'nw-detail-section';
  if (expanded) d.open = true;
  const s = document.createElement('summary');
  s.className = 'nw-detail-section-summary';
  s.innerHTML = `<span class="nw-detail-section-title">${title}</span>${count !== undefined ? `<span class="nw-detail-section-count">${count}</span>` : ''}`;
  d.appendChild(s);
  return d;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appendCountryEnrichedSections(panel: HTMLElement, code: string, name: string): void {
  // 1) Top Entities (sync — from static graph) ────────────────────────
  void (async () => {
    try {
      const { getConnectedNodes } = await import('../data/entityGraph.ts');
      const sub = getConnectedNodes(code);
      const entities = sub.nodes.filter((n) => n.id !== code).slice(0, 10);
      if (entities.length === 0) return;
      const det = makeDetails('TOP ENTITIES', entities.length, true);
      const list = document.createElement('div');
      list.className = 'nw-detail-section-body';
      for (const ent of entities) {
        const row = document.createElement('div');
        row.className = 'nw-detail-entity-row';
        row.innerHTML = `<span class="nw-detail-entity-type">${escapeText(ent.type)}</span><span class="nw-detail-entity-label">${escapeText(ent.label)}</span>`;
        list.appendChild(row);
      }
      det.appendChild(list);
      panel.appendChild(det);
    } catch (e) {
      console.warn('[country-panel] entity graph load failed', e);
    }
  })();

  // 2) Trade Exposure (async — /api/trade-flows) ───────────────────────
  const tradeDet = makeDetails('TRADE EXPOSURE', '…', false);
  const tradeBody = document.createElement('div');
  tradeBody.className = 'nw-detail-section-body';
  tradeBody.textContent = 'Loading trading partners…';
  tradeDet.appendChild(tradeBody);
  panel.appendChild(tradeDet);
  void (async () => {
    try {
      const data = await cachedFetch<{
        flows?: Array<{ partnerCode: string; partnerName: string; share: number; exportValue: number }>;
        status?: string;
      }>(`/api/trade-flows?reporter=${encodeURIComponent(code)}`);
      const flows = data.flows || [];
      const summary = tradeDet.querySelector('.nw-detail-section-count');
      if (summary) summary.textContent = String(flows.length);
      tradeBody.innerHTML = '';
      if (flows.length === 0) {
        tradeBody.innerHTML = `<div class="nw-detail-empty">No trade data yet${data.status ? ` (${escapeText(data.status)})` : ''}.</div>`;
        return;
      }
      for (const f of flows) {
        const row = document.createElement('div');
        row.className = 'nw-detail-trade-row';
        row.innerHTML = `<span class="nw-detail-trade-name">${escapeText(f.partnerName || f.partnerCode)}</span><span class="nw-detail-trade-share">${f.share.toFixed(1)}%</span>`;
        tradeBody.appendChild(row);
      }
    } catch (e) {
      tradeBody.innerHTML = `<div class="nw-detail-empty">Trade data unavailable.</div>`;
      console.warn('[country-panel] trade-flows failed', e);
    }
  })();

  // 3) Alliances & Conflicts (sync) ────────────────────────────────────
  void (async () => {
    try {
      const { getAllianceInfo } = await import('../data/countryAlliances.ts');
      const a = getAllianceInfo(code);
      if (!a) return;
      const totalCount = a.alliances.length + a.defense.length + a.disputes.length;
      if (totalCount === 0) return;
      const det = makeDetails('ALLIANCES & CONFLICTS', totalCount, false);
      const body = document.createElement('div');
      body.className = 'nw-detail-section-body';
      const renderRow = (label: string, items: string[], cls = '') => {
        if (items.length === 0) return;
        const row = document.createElement('div');
        row.className = `nw-detail-alliance-row ${cls}`;
        row.innerHTML = `<span class="nw-detail-alliance-label">${label}</span><span class="nw-detail-alliance-items">${items.map(escapeText).join(' · ')}</span>`;
        body.appendChild(row);
      };
      renderRow('Memberships', a.alliances);
      renderRow('Defense', a.defense);
      renderRow('Disputes', a.disputes, 'is-dispute');
      det.appendChild(body);
      panel.appendChild(det);
    } catch (e) {
      console.warn('[country-panel] alliance lookup failed', e);
    }
  })();

  // 4) Energy mix (async — /api/energy) ────────────────────────────────
  const energyDet = makeDetails('ENERGY MIX', '…', false);
  const energyBody = document.createElement('div');
  energyBody.className = 'nw-detail-section-body';
  energyBody.textContent = 'Loading energy snapshot…';
  energyDet.appendChild(energyBody);
  panel.appendChild(energyDet);
  void (async () => {
    try {
      const data = await cachedFetch<{
        prices?: { wti?: number; brent?: number; henryHub?: number };
        source?: string;
        asOf?: string;
      }>('/api/energy');
      const p = data.prices || {};
      const summary = energyDet.querySelector('.nw-detail-section-count');
      if (summary) summary.textContent = data.source || 'EIA';
      const rows: string[] = [];
      if (p.wti !== undefined)
        rows.push(`<div class="nw-detail-energy-row"><span>WTI Crude</span><span>$${p.wti.toFixed(2)}</span></div>`);
      if (p.brent !== undefined)
        rows.push(`<div class="nw-detail-energy-row"><span>Brent</span><span>$${p.brent.toFixed(2)}</span></div>`);
      if (p.henryHub !== undefined)
        rows.push(
          `<div class="nw-detail-energy-row"><span>Henry Hub Gas</span><span>$${p.henryHub.toFixed(2)}/MMBtu</span></div>`,
        );
      energyBody.innerHTML =
        rows.length > 0
          ? rows.join('') +
            `<div class="nw-detail-energy-note">Global benchmark prices. Country-specific energy mix coming once ENTSO-E key is provisioned.</div>`
          : '<div class="nw-detail-empty">Energy snapshot unavailable.</div>';
    } catch (e) {
      energyBody.innerHTML = '<div class="nw-detail-empty">Energy snapshot unavailable.</div>';
      console.warn('[country-panel] energy failed', e);
    }
  })();

  // 5) Headlines (last 24h, async — /api/news-feed) ────────────────────
  const newsDet = makeDetails('HEADLINES — 24h', '…', false);
  const newsBody = document.createElement('div');
  newsBody.className = 'nw-detail-section-body';
  newsBody.textContent = 'Loading headlines…';
  newsDet.appendChild(newsBody);
  panel.appendChild(newsDet);
  void (async () => {
    try {
      const data = await cachedFetch<{
        articles?: Array<{ title: string; source: string; link: string; pubDate?: string }>;
      }>(`/api/news-feed?country=${encodeURIComponent(name)}`);
      const articles = (data.articles || []).slice(0, 8);
      const summary = newsDet.querySelector('.nw-detail-section-count');
      if (summary) summary.textContent = String(articles.length);
      newsBody.innerHTML = '';
      if (articles.length === 0) {
        newsBody.innerHTML = '<div class="nw-detail-empty">No recent headlines.</div>';
        return;
      }
      for (const art of articles) {
        const row = document.createElement('a');
        row.className = 'nw-detail-headline-row';
        row.href = art.link;
        row.target = '_blank';
        row.rel = 'noopener noreferrer';
        row.innerHTML = `<span class="nw-detail-headline-source">${escapeText(art.source || '')}</span><span class="nw-detail-headline-title">${escapeText(art.title)}</span>`;
        newsBody.appendChild(row);
      }
    } catch (e) {
      newsBody.innerHTML = '<div class="nw-detail-empty">Headlines unavailable.</div>';
      console.warn('[country-panel] news-feed failed', e);
    }
  })();
}

// ── Sitrep Overlay ──

function showSitrep(container: HTMLElement, text: string, generatedAt: string): void {
  container.querySelector('.nw-sitrep-overlay')?.remove();

  const overlay = createElement('div', { className: 'nw-sitrep-overlay' });

  const header = createElement('div', { className: 'nw-sitrep-header' });
  const title = createElement('span', { className: 'nw-sitrep-title', textContent: 'SITUATION REPORT' });
  const closeBtn = createElement('button', { className: 'nw-sitrep-close', textContent: 'X' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(title);
  if (generatedAt) {
    const time = createElement('span', {});
    time.style.color = 'var(--nw-text-muted, #444444)';
    time.style.fontSize = '9px';
    time.textContent = new Date(generatedAt).toLocaleTimeString();
    header.appendChild(time);
  }
  header.appendChild(closeBtn);

  const body = createElement('div', { className: 'nw-sitrep-body' });
  body.textContent = text;

  overlay.appendChild(header);
  overlay.appendChild(body);
  container.appendChild(overlay);
}

function showShortcutsHelp(container: HTMLElement): void {
  const text = [
    'C       Cinema Mode (immersive broadcast)',
    'A       Alert Builder (natural language)',
    'T       Timeline Playback (historical)',
    'L       Toggle Event Log (in Cinema)',
    'S       Generate SITREP',
    'F       Fullscreen mode',
    '1-7     Toggle first 7 layers',
    'Esc     Close overlays / exit mode',
    '?       This help',
    '',
    'Click   Layer chips to toggle',
    'Click   Country row to fly to location',
    'Click   Alert row to fly to event',
    'Hover   Map features for details',
  ].join('\n');
  showSitrep(container, text, '');
}

// ── Utils ──

// identifyRegion moved to src/utils/geo.ts

function countryFlag(code: string): string {
  const OFFSET = 0x1f1e6 - 65;
  return String.fromCodePoint(code.charCodeAt(0) + OFFSET, code.charCodeAt(1) + OFFSET);
}
