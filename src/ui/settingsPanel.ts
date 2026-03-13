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
import type { ThemeName } from '../config/themes.ts';
import type { DensityMode } from '../config/density.ts';
import type { App } from '../App.ts';
import type { SavedLocation } from '../types/index.ts';

let panelEl: HTMLElement | null = null;
let backdrop: HTMLElement | null = null;

export function initSettingsPanel(app: App): void {
  document.addEventListener('dashview:open-settings', () => {
    toggleSettings(app);
  });
}

function toggleSettings(app: App): void {
  if (panelEl) {
    closeSettings();
  } else {
    openSettings(app);
  }
}

function closeSettings(): void {
  if (panelEl) {
    panelEl.classList.add('settings-panel-exit');
    setTimeout(() => {
      panelEl?.remove();
      panelEl = null;
    }, 200);
  }
  if (backdrop) {
    backdrop.remove();
    backdrop = null;
  }
}

function openSettings(app: App): void {
  closeSettings();

  backdrop = createElement('div', { className: 'settings-panel-backdrop' });
  backdrop.addEventListener('click', closeSettings);
  document.body.appendChild(backdrop);

  panelEl = createElement('div', { className: 'settings-panel' });
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-label', 'Settings');

  const header = createElement('div', { className: 'settings-panel-header' });
  const title = createElement('div', { className: 'settings-panel-title', textContent: 'SETTINGS' });
  const closeBtn = createElement('button', { className: 'settings-panel-close', textContent: '\u00D7' });
  closeBtn.addEventListener('click', closeSettings);
  header.appendChild(title);
  header.appendChild(closeBtn);
  panelEl.appendChild(header);

  const body = createElement('div', { className: 'settings-panel-body' });

  // --- Panels section ---
  addSection(body, 'PANELS');
  const panels = app.getPanels();
  for (const panel of panels) {
    const row = createElement('label', { className: 'settings-panel-row' });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = panel.enabled;
    checkbox.addEventListener('change', () => {
      app.togglePanel(panel.id, checkbox.checked);
    });
    const text = createElement('span', { textContent: panel.title });
    row.appendChild(checkbox);
    row.appendChild(text);
    body.appendChild(row);
  }

  // --- Theme ---
  addSection(body, 'THEME');
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

  // --- Density ---
  addSection(body, 'DENSITY');
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

  // --- Units ---
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

  // --- Locations ---
  addSection(body, 'LOCATIONS');
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
    const goBtn = createElement('button', { className: 'settings-panel-btn', textContent: 'Go' });
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
      goBtn.textContent = 'Go';
    };
    goBtn.addEventListener('click', () => void handleSearch());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void handleSearch(); });
  }

  // --- Config ---
  addSection(body, 'CONFIG');
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

  // --- Alerts ---
  const alertsBtn = createElement('button', { className: 'settings-panel-action', textContent: `Price Alerts (${getUntriggeredCount()})` });
  alertsBtn.addEventListener('click', () => {
    closeSettings();
    openAlertsModal();
  });
  body.appendChild(alertsBtn);

  // --- Stats ---
  addSection(body, 'USAGE');
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

  // --- Account ---
  addSection(body, 'ACCOUNT');
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

  panelEl.appendChild(body);
  document.body.appendChild(panelEl);
}

function addSection(parent: HTMLElement, title: string): void {
  const el = createElement('div', { className: 'settings-panel-section', textContent: title });
  parent.appendChild(el);
}
