import { createElement } from '../utils/dom.ts';
import { WeatherPanel } from '../panels/WeatherPanel.ts';
import { geocodeCity } from '../services/weather.ts';
import { getTheme, applyTheme } from '../config/theme.ts';
import { getDensity, applyDensity } from '../config/density.ts';
import { getPreferences, setPreference } from '../config/preferences.ts';
import { getUntriggeredCount } from '../services/alerts.ts';
import { openAlertsModal } from '../ui/alertsModal.ts';
import { exportConfig, importConfig } from '../services/configSync.ts';
import { getAnalyticsSummary } from '../services/analytics.ts';
import { resetOnboarding } from '../ui/onboarding.ts';
import { logout } from '../services/auth.ts';
import { getCustomFeeds, saveCustomFeeds } from '../services/news.ts';
import { searchSymbols } from '../services/stocks.ts';
import { isCalendarConnected, connectCalendar, disconnectCalendar } from '../services/calendar.ts';
import { storeApiKey, getProvider, setProvider, PROVIDER_LABELS, PROVIDER_PLACEHOLDERS } from '../services/chat.ts';
import { getSpaces, addWidgetToSpace, removeWidgetFromSpace, saveSpaces } from '../services/spaces.ts';
import { getCurrentTier } from '../services/tier.ts';
import * as storage from '../services/storage.ts';
import type { ThemeName } from '../config/themes.ts';
import type { DensityMode } from '../config/density.ts';
import type { App } from '../App.ts';
import type { SavedLocation, ChatProvider, WidgetSize } from '../types/index.ts';

type SettingsTab = 'general' | 'overview' | 'markets' | 'globe' | 'personal';

let modalEl: HTMLElement | null = null;
let backdrop: HTMLElement | null = null;
let activeTab: SettingsTab = 'general';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'overview', label: 'Overview' },
  { id: 'markets', label: 'Markets' },
  { id: 'globe', label: 'Globe' },
  { id: 'personal', label: 'Personal' },
];

export function initSettingsPanel(app: App): void {
  document.addEventListener('dashview:open-settings', ((e: CustomEvent) => {
    const tab = e.detail?.tab as SettingsTab | undefined;
    if (tab) activeTab = tab;
    openSettings(app, tab);
  }) as EventListener);
}

function closeSettings(): void {
  if (modalEl) {
    modalEl.classList.add('settings-modal-exit');
    setTimeout(() => {
      modalEl?.remove();
      modalEl = null;
    }, 150);
  }
  if (backdrop) {
    backdrop.remove();
    backdrop = null;
  }
}

function openSettings(app: App, tab?: SettingsTab): void {
  closeSettings();
  if (tab) activeTab = tab;

  backdrop = createElement('div', { className: 'settings-panel-backdrop' });
  backdrop.addEventListener('click', closeSettings);
  document.body.appendChild(backdrop);

  modalEl = createElement('div', { className: 'settings-modal' });
  modalEl.setAttribute('role', 'dialog');
  modalEl.setAttribute('aria-label', 'Settings');

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeSettings();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Header
  const header = createElement('div', { className: 'settings-panel-header' });
  const title = createElement('div', { className: 'settings-panel-title', textContent: 'SETTINGS' });
  const closeBtn = createElement('button', { className: 'settings-panel-close', textContent: '\u00D7' });
  closeBtn.addEventListener('click', closeSettings);
  header.appendChild(title);
  header.appendChild(closeBtn);
  modalEl.appendChild(header);

  // Tab bar
  const tabs = createElement('div', { className: 'settings-tabs' });
  for (const t of SETTINGS_TABS) {
    const btn = createElement('button', {
      className: `settings-tab ${t.id === activeTab ? 'settings-tab-active' : ''}`,
      textContent: t.label,
    });
    btn.addEventListener('click', () => {
      activeTab = t.id;
      tabs.querySelectorAll('.settings-tab').forEach((el, i) => {
        el.classList.toggle('settings-tab-active', SETTINGS_TABS[i].id === activeTab);
      });
      renderTabContent(body, app);
    });
    tabs.appendChild(btn);
  }
  modalEl.appendChild(tabs);

  // Body
  const body = createElement('div', { className: 'settings-panel-body' });
  renderTabContent(body, app);
  modalEl.appendChild(body);

  document.body.appendChild(modalEl);
}

function renderTabContent(body: HTMLElement, app: App): void {
  body.textContent = '';
  switch (activeTab) {
    case 'general': renderGeneralTab(body, app); break;
    case 'overview': renderOverviewTab(body, app); break;
    case 'markets': renderMarketsTab(body); break;
    case 'globe': renderGlobeTab(body); break;
    case 'personal': renderPersonalTab(body); break;
  }
}

// --- General Tab ---
function renderGeneralTab(body: HTMLElement, app: App): void {
  // Theme
  addSection(body, 'APPEARANCE');
  const themeRow = createElement('div', { className: 'settings-panel-radio-row' });
  const themeOpts: { id: ThemeName; label: string }[] = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'oled', label: 'OLED' },
  ];
  const currentTheme = getTheme();
  for (const opt of themeOpts) {
    const label = createElement('label', { className: 'settings-panel-radio' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'sp-theme';
    radio.value = opt.id;
    radio.checked = opt.id === currentTheme;
    radio.addEventListener('change', () => applyTheme(opt.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: opt.label }));
    themeRow.appendChild(label);
  }
  body.appendChild(themeRow);

  // Density
  const densityRow = createElement('div', { className: 'settings-panel-radio-row' });
  const densityOpts: { id: DensityMode; label: string }[] = [
    { id: 'compact', label: 'Compact' },
    { id: 'comfortable', label: 'Comfort' },
    { id: 'spacious', label: 'Spacious' },
  ];
  const currentDensity = getDensity();
  for (const opt of densityOpts) {
    const label = createElement('label', { className: 'settings-panel-radio' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'sp-density';
    radio.value = opt.id;
    radio.checked = opt.id === currentDensity;
    radio.addEventListener('change', () => applyDensity(opt.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: opt.label }));
    densityRow.appendChild(label);
  }
  body.appendChild(densityRow);

  // Home Location
  addSection(body, 'HOME LOCATION');
  const wp = app.getPanel('weather');
  const weatherPanel = wp instanceof WeatherPanel ? wp : null;
  if (weatherPanel) {
    const locList = createElement('div', { className: 'settings-panel-locations' });
    function renderLocs() {
      locList.textContent = '';
      if (!weatherPanel) return;
      const locs = weatherPanel.getLocations();
      const activeIdx = weatherPanel.getActiveIndex();
      for (let i = 0; i < locs.length; i++) {
        const loc = locs[i];
        const item = createElement('div', {
          className: `settings-panel-loc${i === activeIdx ? ' active' : ''}`,
        });
        const name = createElement('span', {
          textContent: loc.name ?? `${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}`,
        });
        name.style.cursor = 'pointer';
        name.style.flex = '1';
        name.addEventListener('click', () => {
          weatherPanel.setActiveLocation(i);
          renderLocs();
        });
        item.appendChild(name);
        if (locs.length > 1) {
          const removeBtn = createElement('button', { className: 'settings-panel-loc-remove', textContent: '\u00D7' });
          removeBtn.addEventListener('click', () => {
            weatherPanel.removeLocation(i);
            renderLocs();
          });
          item.appendChild(removeBtn);
        }
        locList.appendChild(item);
      }
    }
    renderLocs();
    body.appendChild(locList);

    const inputRow = createElement('div', { className: 'settings-panel-input-row' });
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add city\u2026';
    input.className = 'settings-panel-input';
    const goBtn = createElement('button', { className: 'settings-panel-btn', textContent: 'Add' });
    inputRow.appendChild(input);
    inputRow.appendChild(goBtn);
    body.appendChild(inputRow);

    const handleSearch = async () => {
      const query = input.value.trim();
      if (!query) return;
      goBtn.textContent = '\u2026';
      try {
        const result = await geocodeCity(query);
        const loc: SavedLocation = { lat: result.lat, lon: result.lon, name: `${result.name}, ${result.country}` };
        weatherPanel.addLocation(loc);
        const locs = weatherPanel.getLocations();
        const idx = locs.findIndex((l) => Math.abs(l.lat - loc.lat) < 0.01 && Math.abs(l.lon - loc.lon) < 0.01);
        if (idx >= 0) weatherPanel.setActiveLocation(idx);
        input.value = '';
        renderLocs();
      } catch { /* ignore */ }
      goBtn.textContent = 'Add';
    };
    goBtn.addEventListener('click', () => void handleSearch());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void handleSearch(); });
  }

  // Units
  addSection(body, 'UNITS');
  const prefs = getPreferences();
  const tempRow = createElement('div', { className: 'settings-panel-radio-row' });
  for (const opt of [{ id: 'F' as const, label: '\u00B0F' }, { id: 'C' as const, label: '\u00B0C' }]) {
    const label = createElement('label', { className: 'settings-panel-radio' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'sp-temp';
    radio.value = opt.id;
    radio.checked = opt.id === prefs.tempUnit;
    radio.addEventListener('change', () => setPreference('tempUnit', opt.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: opt.label }));
    tempRow.appendChild(label);
  }
  body.appendChild(tempRow);

  const timeRow = createElement('div', { className: 'settings-panel-radio-row' });
  for (const opt of [{ id: '12h' as const, label: '12h' }, { id: '24h' as const, label: '24h' }]) {
    const label = createElement('label', { className: 'settings-panel-radio' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'sp-time';
    radio.value = opt.id;
    radio.checked = opt.id === prefs.timeFormat;
    radio.addEventListener('change', () => setPreference('timeFormat', opt.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: opt.label }));
    timeRow.appendChild(label);
  }
  body.appendChild(timeRow);

  // Data
  addSection(body, 'DATA');
  const exportBtn = createElement('button', { className: 'settings-panel-action', textContent: 'Export config' });
  exportBtn.addEventListener('click', () => exportConfig());
  body.appendChild(exportBtn);

  const importBtn = createElement('button', { className: 'settings-panel-action', textContent: 'Import config' });
  importBtn.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const result = await importConfig(file);
      importBtn.textContent = result.message;
      setTimeout(() => {
        importBtn.textContent = 'Import config';
        if (result.success) location.reload();
      }, 2000);
    });
    fileInput.click();
  });
  body.appendChild(importBtn);

  // Account
  addSection(body, 'ACCOUNT');

  // Usage stats
  const summary = getAnalyticsSummary();
  const statsGrid = createElement('div', { className: 'settings-panel-stats' });
  const statsItems = [
    [`${summary.daysActive}`, 'Days'],
    [`${summary.totalPanelViews}`, 'Views'],
    [`${summary.alertsCreated}`, 'Alerts'],
    [`${summary.notesAdded}`, 'Notes'],
  ];
  for (const [value, label] of statsItems) {
    const cell = createElement('div', { className: 'settings-panel-stat' });
    cell.appendChild(createElement('div', { className: 'settings-panel-stat-value', textContent: value }));
    cell.appendChild(createElement('div', { className: 'settings-panel-stat-label', textContent: label }));
    statsGrid.appendChild(cell);
  }
  body.appendChild(statsGrid);

  const logoutBtn = createElement('button', { className: 'settings-panel-action', textContent: 'Sign Out' });
  logoutBtn.addEventListener('click', () => logout());
  body.appendChild(logoutBtn);

  const resetBtn = createElement('button', { className: 'settings-panel-action' });
  resetBtn.textContent = 'Reset onboarding';
  resetBtn.style.opacity = '0.5';
  resetBtn.addEventListener('click', () => {
    resetOnboarding();
    resetBtn.textContent = 'Reset on next visit';
  });
  body.appendChild(resetBtn);
}

// --- Overview Tab ---
function renderOverviewTab(body: HTMLElement, app: App): void {
  addSection(body, 'WIDGETS');
  const hint = createElement('div', { className: 'settings-panel-hint' });
  hint.textContent = 'Toggle panels in the Overview space and set their size.';
  body.appendChild(hint);

  const spaces = getSpaces();
  const overviewSpace = spaces.find(s => s.id === 'overview');
  const allPanels = app.getPanels();
  const colSpanMap: Record<WidgetSize, number> = { compact: 3, medium: 6, large: 12 };

  for (const panel of allPanels) {
    const row = createElement('div', { className: 'settings-widget-row' });
    const isInSpace = overviewSpace?.widgets.some(w => w.panelId === panel.id) ?? false;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isInSpace;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        addWidgetToSpace('overview', panel.id, 'medium');
      } else {
        removeWidgetFromSpace('overview', panel.id);
      }
    });

    const nameEl = createElement('span', { className: 'settings-widget-name', textContent: panel.title });

    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'settings-widget-size';
    const currentWidget = overviewSpace?.widgets.find(w => w.panelId === panel.id);
    for (const size of ['compact', 'medium', 'large'] as WidgetSize[]) {
      const opt = document.createElement('option');
      opt.value = size;
      opt.textContent = size;
      if (currentWidget?.size === size) opt.selected = true;
      sizeSelect.appendChild(opt);
    }
    sizeSelect.addEventListener('change', () => {
      const newSize = sizeSelect.value as WidgetSize;
      // Update the widget size in the space
      const spaces = getSpaces();
      const space = spaces.find(s => s.id === 'overview');
      const widget = space?.widgets.find(w => w.panelId === panel.id);
      if (widget) {
        widget.size = newSize;
        widget.colSpan = colSpanMap[newSize];
        saveSpaces(spaces);
      }
    });

    row.appendChild(checkbox);
    row.appendChild(nameEl);
    row.appendChild(sizeSelect);
    body.appendChild(row);
  }

  // Sports
  addSection(body, 'SPORTS');
  const leagueHint = createElement('div', { className: 'settings-panel-hint' });
  leagueHint.textContent = 'Default league for the Sports panel.';
  body.appendChild(leagueHint);

  const leagueRow = createElement('div', { className: 'settings-panel-radio-row' });
  const currentLeague = storage.get<string>('dashview-sports-league', 'nba');
  for (const lg of [{ id: 'nba', label: 'NBA' }, { id: 'nfl', label: 'NFL' }, { id: 'mlb', label: 'MLB' }, { id: 'epl', label: 'EPL' }]) {
    const label = createElement('label', { className: 'settings-panel-radio' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'sp-league';
    radio.value = lg.id;
    radio.checked = lg.id === currentLeague;
    radio.addEventListener('change', () => storage.set('dashview-sports-league', lg.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: lg.label }));
    leagueRow.appendChild(label);
  }
  body.appendChild(leagueRow);

  // Sports favorites
  const favs = new Set(storage.get<string[]>('dashview-sports-favorites', []));
  if (favs.size > 0) {
    const favHint = createElement('div', { className: 'settings-panel-hint' });
    favHint.textContent = `Favorite teams: ${[...favs].join(', ')}`;
    body.appendChild(favHint);
  }

  // Entertainment
  addSection(body, 'ENTERTAINMENT');
  const entHint = createElement('div', { className: 'settings-panel-hint' });
  entHint.textContent = 'Default tab for the Entertainment panel.';
  body.appendChild(entHint);

  const entRow = createElement('div', { className: 'settings-panel-radio-row' });
  const currentEnt = storage.get<string>('dashview-entertainment-tab', 'trending');
  for (const tab of [{ id: 'trending', label: 'Trending' }, { id: 'movies', label: 'Movies' }, { id: 'tv', label: 'TV' }, { id: 'upcoming', label: 'Upcoming' }]) {
    const label = createElement('label', { className: 'settings-panel-radio' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'sp-ent';
    radio.value = tab.id;
    radio.checked = tab.id === currentEnt;
    radio.addEventListener('change', () => storage.set('dashview-entertainment-tab', tab.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: tab.label }));
    entRow.appendChild(label);
  }
  body.appendChild(entRow);
}

// --- Markets Tab ---
function renderMarketsTab(body: HTMLElement): void {
  addSection(body, 'STOCK WATCHLIST');

  const watchlist = storage.get<string[]>('dashview-watchlist', ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']);
  const nameCache = storage.get<Record<string, string>>('dashview-stock-names', {});
  const favorites = new Set(storage.get<string[]>('dashview-favorites', []));

  const listContainer = createElement('div', {});

  function renderWatchlist() {
    listContainer.textContent = '';
    const currentList = storage.get<string[]>('dashview-watchlist', watchlist);
    for (const symbol of currentList) {
      const row = createElement('div', { className: 'settings-watchlist-item' });
      const symbolEl = createElement('span', { className: 'settings-watchlist-symbol', textContent: symbol });
      const nameEl = createElement('span', { className: 'settings-watchlist-name', textContent: nameCache[symbol] || '' });

      const isFav = favorites.has(symbol);
      const starBtn = createElement('button', {
        className: `stocks-row-star ${isFav ? 'stocks-row-star-active' : ''}`,
        textContent: isFav ? '\u2605' : '\u2606',
      });
      starBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;color:var(--color-text-muted)';
      starBtn.addEventListener('click', () => {
        if (favorites.has(symbol)) {
          favorites.delete(symbol);
        } else {
          favorites.add(symbol);
        }
        storage.set('dashview-favorites', [...favorites]);
        renderWatchlist();
      });

      const removeBtn = createElement('button', { className: 'settings-watchlist-remove', textContent: '\u00D7' });
      removeBtn.addEventListener('click', () => {
        const list = storage.get<string[]>('dashview-watchlist', []);
        const updated = list.filter(s => s !== symbol);
        storage.set('dashview-watchlist', updated);
        favorites.delete(symbol);
        storage.set('dashview-favorites', [...favorites]);
        renderWatchlist();
      });

      row.appendChild(starBtn);
      row.appendChild(symbolEl);
      row.appendChild(nameEl);
      row.appendChild(removeBtn);
      listContainer.appendChild(row);
    }
  }

  renderWatchlist();
  body.appendChild(listContainer);

  // Search to add
  const searchWrap = createElement('div', { className: 'settings-panel-input-row' });
  searchWrap.style.position = 'relative';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search ticker or company...';
  searchInput.className = 'settings-panel-input';
  searchWrap.appendChild(searchInput);
  body.appendChild(searchWrap);

  const dropdown = createElement('div', { className: 'settings-search-dropdown' });
  dropdown.style.display = 'none';
  searchWrap.appendChild(dropdown);

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);
    if (query.length < 1) {
      dropdown.style.display = 'none';
      return;
    }
    searchTimeout = setTimeout(() => {
      void (async () => {
        try {
          const results = await searchSymbols(query);
          dropdown.textContent = '';
          if (results.length === 0) {
            const empty = createElement('div', { textContent: 'No results', className: 'settings-search-result' });
            dropdown.appendChild(empty);
          } else {
            const currentList = storage.get<string[]>('dashview-watchlist', []);
            for (const r of results.slice(0, 8)) {
              const row = createElement('div', { className: 'settings-search-result' });
              const sym = createElement('span', { className: 'settings-search-result-symbol', textContent: r.symbol });
              const name = createElement('span', { className: 'settings-search-result-name', textContent: r.description });
              row.appendChild(sym);
              row.appendChild(name);
              if (!currentList.includes(r.symbol)) {
                const addBtn = createElement('button', { className: 'settings-search-result-add', textContent: '+ Add' });
                addBtn.addEventListener('click', () => {
                  const list = storage.get<string[]>('dashview-watchlist', []);
                  if (list.length >= 10 || list.includes(r.symbol)) return;
                  list.push(r.symbol);
                  storage.set('dashview-watchlist', list);
                  const names = storage.get<Record<string, string>>('dashview-stock-names', {});
                  names[r.symbol] = r.description;
                  nameCache[r.symbol] = r.description;
                  storage.set('dashview-stock-names', names);
                  dropdown.style.display = 'none';
                  searchInput.value = '';
                  renderWatchlist();
                });
                row.appendChild(addBtn);
              }
              dropdown.appendChild(row);
            }
          }
          dropdown.style.display = '';
        } catch {
          dropdown.style.display = 'none';
        }
      })();
    }, 300);
  });

  // Price Alerts
  addSection(body, 'PRICE ALERTS');
  const alertsBtn = createElement('button', { className: 'settings-panel-action', textContent: `Manage Alerts (${getUntriggeredCount()} active)` });
  alertsBtn.addEventListener('click', () => {
    closeSettings();
    openAlertsModal();
  });
  body.appendChild(alertsBtn);

  // Crypto
  addSection(body, 'CRYPTO');
  const cryptoHint = createElement('div', { className: 'settings-panel-hint' });
  cryptoHint.textContent = 'Shows top coins by market cap. No customization needed.';
  body.appendChild(cryptoHint);
}

// --- Globe Tab ---
function renderGlobeTab(body: HTMLElement): void {
  // News categories
  addSection(body, 'NEWS CATEGORIES');
  const catHint = createElement('div', { className: 'settings-panel-hint' });
  catHint.textContent = 'Toggle which categories appear in the globe feed.';
  body.appendChild(catHint);

  const enabledCats = storage.get<string[]>('dashview-globe-categories', ['world', 'us', 'tech', 'science', 'markets']);
  for (const cat of ['world', 'us', 'tech', 'science', 'markets']) {
    const row = createElement('label', { className: 'settings-panel-row' });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabledCats.includes(cat);
    checkbox.addEventListener('change', () => {
      const current = storage.get<string[]>('dashview-globe-categories', ['world', 'us', 'tech', 'science', 'markets']);
      if (checkbox.checked) {
        if (!current.includes(cat)) current.push(cat);
      } else {
        const idx = current.indexOf(cat);
        if (idx >= 0) current.splice(idx, 1);
      }
      storage.set('dashview-globe-categories', current);
    });
    const text = createElement('span', { textContent: cat.charAt(0).toUpperCase() + cat.slice(1) });
    row.appendChild(checkbox);
    row.appendChild(text);
    body.appendChild(row);
  }

  // Custom Feeds
  addSection(body, 'CUSTOM FEEDS');
  let feeds = getCustomFeeds();
  const feedList = createElement('div', {});

  function renderFeeds() {
    feedList.textContent = '';
    const enabledFeeds = feeds.filter(f => f.enabled);
    if (enabledFeeds.length === 0) {
      const empty = createElement('div', { className: 'settings-panel-hint' });
      empty.textContent = 'No custom feeds enabled.';
      feedList.appendChild(empty);
    } else {
      for (const feed of enabledFeeds) {
        const row = createElement('div', { className: 'settings-feed-item' });
        const nameEl = createElement('span', { className: 'settings-feed-name', textContent: feed.name });
        const removeBtn = createElement('button', { className: 'settings-feed-remove', textContent: '\u00D7' });
        removeBtn.addEventListener('click', () => {
          feeds = feeds.filter(f => f.id !== feed.id);
          saveCustomFeeds(feeds);
          renderFeeds();
        });
        row.appendChild(nameEl);
        row.appendChild(removeBtn);
        feedList.appendChild(row);
      }
    }

    const limit = getCurrentTier() === 'premium' ? Infinity : 3;
    const countText = limit === Infinity
      ? `${enabledFeeds.length} feeds`
      : `${enabledFeeds.length}/${limit} feeds`;
    const countEl = createElement('div', { className: 'settings-panel-hint' });
    countEl.textContent = countText;
    feedList.appendChild(countEl);
  }

  renderFeeds();
  body.appendChild(feedList);

  // Add feed input
  const feedInputRow = createElement('div', { className: 'settings-panel-input-row' });
  const feedInput = document.createElement('input');
  feedInput.type = 'url';
  feedInput.placeholder = 'https://example.com/feed.xml';
  feedInput.className = 'settings-panel-input';
  const feedAddBtn = createElement('button', { className: 'settings-panel-btn', textContent: 'Add' });
  feedAddBtn.addEventListener('click', async () => {
    const url = feedInput.value.trim();
    if (!url) return;
    try { new URL(url); } catch { return; }

    const limit = getCurrentTier() === 'premium' ? Infinity : 3;
    if (feeds.filter(f => f.enabled).length >= limit) return;
    if (feeds.some(f => f.url === url)) return;

    feedAddBtn.textContent = '\u2026';
    try {
      const res = await fetch('/api/news-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        feeds.push({
          id: crypto.randomUUID(),
          url,
          name: data.title || 'Custom Feed',
          enabled: true,
        });
        saveCustomFeeds(feeds);
        feedInput.value = '';
        renderFeeds();
      }
    } catch { /* ignore */ }
    feedAddBtn.textContent = 'Add';
  });
  feedInputRow.appendChild(feedInput);
  feedInputRow.appendChild(feedAddBtn);
  body.appendChild(feedInputRow);

  // Display options
  addSection(body, 'DISPLAY');
  const rotationRow = createElement('label', { className: 'settings-panel-row' });
  const rotationCheck = document.createElement('input');
  rotationCheck.type = 'checkbox';
  rotationCheck.checked = storage.get<boolean>('dashview-globe-rotation', true);
  rotationCheck.addEventListener('change', () => {
    storage.set('dashview-globe-rotation', rotationCheck.checked);
  });
  rotationRow.appendChild(rotationCheck);
  rotationRow.appendChild(createElement('span', { textContent: 'Auto-rotation' }));
  body.appendChild(rotationRow);

  const weatherRow = createElement('label', { className: 'settings-panel-row' });
  const weatherCheck = document.createElement('input');
  weatherCheck.type = 'checkbox';
  weatherCheck.checked = storage.get<boolean>('dashview-globe-weather', true);
  weatherCheck.addEventListener('change', () => {
    storage.set('dashview-globe-weather', weatherCheck.checked);
  });
  weatherRow.appendChild(weatherCheck);
  weatherRow.appendChild(createElement('span', { textContent: 'Weather overlay' }));
  body.appendChild(weatherRow);
}

// --- Personal Tab ---
function renderPersonalTab(body: HTMLElement): void {
  // AI Provider
  addSection(body, 'AI PROVIDER');
  const aiHint = createElement('div', { className: 'settings-panel-hint' });
  aiHint.textContent = 'Add your API key for unlimited AI chat. Keys are stored securely server-side.';
  body.appendChild(aiHint);

  const form = createElement('div', { className: 'settings-provider-form' });

  // Provider selector
  const select = document.createElement('select');
  select.className = 'settings-provider-select';
  const currentProvider = getProvider();
  for (const [value, label] of Object.entries(PROVIDER_LABELS)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === currentProvider) option.selected = true;
    select.appendChild(option);
  }
  form.appendChild(select);

  // Key input + save
  const keyRow = createElement('div', { className: 'settings-provider-row' });
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.placeholder = PROVIDER_PLACEHOLDERS[currentProvider];
  keyInput.className = 'settings-panel-input';
  const saveBtn = createElement('button', { className: 'settings-panel-btn', textContent: 'Save' });

  select.addEventListener('change', () => {
    const provider = select.value as ChatProvider;
    setProvider(provider);
    keyInput.placeholder = PROVIDER_PLACEHOLDERS[provider];
  });

  const status = createElement('div', { className: 'settings-panel-hint' });

  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) return;
    setProvider(select.value as ChatProvider);
    saveBtn.textContent = '\u2026';
    try {
      await storeApiKey(key);
      status.textContent = 'Key saved successfully!';
      status.style.color = 'var(--color-positive)';
      keyInput.value = '';
      // Refresh provider status
      void renderProviderStatus(statusContainer);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Failed to save';
      status.style.color = 'var(--color-negative)';
    }
    saveBtn.textContent = 'Save';
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 3000);
  });

  keyRow.appendChild(keyInput);
  keyRow.appendChild(saveBtn);
  form.appendChild(keyRow);
  form.appendChild(status);

  // Provider status badges
  const statusContainer = createElement('div', { className: 'settings-provider-status' });
  form.appendChild(statusContainer);
  void renderProviderStatus(statusContainer);

  body.appendChild(form);

  // Chat
  addSection(body, 'CHAT');
  const msgCount = storage.get<Array<unknown>>('dashview-chat-messages', []).length;
  const chatHint = createElement('div', { className: 'settings-panel-hint' });
  chatHint.textContent = `${msgCount} messages in history`;
  body.appendChild(chatHint);

  const clearBtn = createElement('button', { className: 'settings-panel-action', textContent: 'Clear conversation history' });
  clearBtn.addEventListener('click', () => {
    storage.set('dashview-chat-messages', []);
    clearBtn.textContent = 'Cleared!';
    chatHint.textContent = '0 messages in history';
    setTimeout(() => { clearBtn.textContent = 'Clear conversation history'; }, 1500);
  });
  body.appendChild(clearBtn);

  // Connectors & Integrations
  addSection(body, 'CONNECTORS & INTEGRATIONS');

  // Google Calendar
  const calRow = createElement('div', { className: 'settings-integration-row' });
  const calDot = createElement('div', { className: 'settings-integration-status settings-integration-status-disconnected' });
  const calName = createElement('span', { className: 'settings-integration-name', textContent: 'Google Calendar' });
  const calBtn = createElement('button', { className: 'settings-integration-btn', textContent: 'Connect' });
  calRow.appendChild(calDot);
  calRow.appendChild(calName);
  calRow.appendChild(calBtn);
  body.appendChild(calRow);

  // Check calendar connection status
  void (async () => {
    const connected = await isCalendarConnected();
    if (connected) {
      calDot.classList.remove('settings-integration-status-disconnected');
      calDot.classList.add('settings-integration-status-connected');
      calBtn.textContent = 'Disconnect';
      calBtn.addEventListener('click', async () => {
        await disconnectCalendar();
        calDot.classList.remove('settings-integration-status-connected');
        calDot.classList.add('settings-integration-status-disconnected');
        calBtn.textContent = 'Connect';
      });
    } else {
      calBtn.addEventListener('click', () => connectCalendar());
    }
  })();

  // Apple Calendar (coming soon)
  const appleCalRow = createElement('div', { className: 'settings-integration-row' });
  const appleCalDot = createElement('div', { className: 'settings-integration-status settings-integration-status-disconnected' });
  const appleCalName = createElement('span', { className: 'settings-integration-name', textContent: 'Apple Calendar' });
  const appleCalBadge = createElement('span', { className: 'settings-integration-badge', textContent: 'Coming Soon' });
  appleCalBadge.title = 'CalDAV support is planned for a future release';
  appleCalRow.appendChild(appleCalDot);
  appleCalRow.appendChild(appleCalName);
  appleCalRow.appendChild(appleCalBadge);
  body.appendChild(appleCalRow);

  // Apple Notes
  const notesRow = createElement('div', { className: 'settings-integration-row' });
  const notesDot = createElement('div', { className: 'settings-integration-status settings-integration-status-disconnected' });
  const notesName = createElement('span', { className: 'settings-integration-name', textContent: 'Apple Notes' });
  const notesBadge = createElement('span', { className: 'settings-integration-badge', textContent: 'Not Available' });
  notesBadge.title = 'No public API available for web apps';
  notesRow.appendChild(notesDot);
  notesRow.appendChild(notesName);
  notesRow.appendChild(notesBadge);
  body.appendChild(notesRow);

  // Premium
  addSection(body, 'PREMIUM');
  const tier = getCurrentTier();
  if (tier === 'premium') {
    const premiumHint = createElement('div', { className: 'settings-panel-hint' });
    premiumHint.textContent = 'Premium active. Unlimited alerts, feeds, and priority refresh.';
    body.appendChild(premiumHint);
  } else {
    const premiumHint = createElement('div', { className: 'settings-panel-hint' });
    premiumHint.textContent = 'Free tier. Upgrade for unlimited alerts, custom feeds, and priority refresh rates.';
    body.appendChild(premiumHint);
    const upgradeBtn = createElement('button', { className: 'settings-panel-action', textContent: 'Learn about Premium' });
    upgradeBtn.addEventListener('click', () => {
      closeSettings();
      window.location.hash = '#/roadmap';
    });
    body.appendChild(upgradeBtn);
  }
}

async function renderProviderStatus(container: HTMLElement): Promise<void> {
  container.textContent = '';
  const providers: ChatProvider[] = ['anthropic', 'openai', 'google', 'xai'];
  for (const p of providers) {
    const badge = createElement('span', { className: 'settings-provider-badge' });
    const has = await hasProviderKey(p);
    if (has) {
      const check = createElement('span', { className: 'settings-provider-badge-check', textContent: '\u2713 ' });
      badge.appendChild(check);
    }
    badge.appendChild(document.createTextNode(PROVIDER_LABELS[p].split(' ')[0]));
    container.appendChild(badge);
  }
}

async function hasProviderKey(provider: ChatProvider): Promise<boolean> {
  try {
    const res = await fetch('/api/keys');
    const data = await res.json();
    return Array.isArray(data.keys) && data.keys.includes(provider);
  } catch {
    return false;
  }
}

function addSection(parent: HTMLElement, title: string): void {
  const el = createElement('div', { className: 'settings-panel-section', textContent: title });
  parent.appendChild(el);
}
