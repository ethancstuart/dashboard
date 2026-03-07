import { createElement } from '../utils/dom.ts';
import { WeatherPanel } from '../panels/WeatherPanel.ts';
import { geocodeCity } from '../services/weather.ts';
import * as storage from '../services/storage.ts';
import { getUser, login, logout, onAuthChange } from '../services/auth.ts';
import { getTheme, applyTheme } from '../config/theme.ts';
import { getDensity, applyDensity } from '../config/density.ts';
import { getPreferences, setPreference } from '../config/preferences.ts';
import type { ThemeName } from '../config/themes.ts';
import type { DensityMode } from '../config/density.ts';
import type { App } from '../App.ts';

const LOCATION_KEY = 'dashview-location';

interface SavedLocation {
  lat: number;
  lon: number;
  name?: string;
}

const GEAR_SVG = `<svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatClock(now: Date): string {
  const day = DAYS[now.getDay()];
  const month = MONTHS[now.getMonth()];
  const date = now.getDate();
  const year = now.getFullYear();
  const prefs = getPreferences();
  let timeStr: string;
  if (prefs.timeFormat === '24h') {
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    timeStr = `${hours}:${minutes}`;
  } else {
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    timeStr = `${hours}:${minutes} ${ampm}`;
  }
  return `${day} ${month} ${date}, ${year} \u00b7 ${timeStr}`;
}

function buildDropdown(dropdown: HTMLElement, app: App): void {
  dropdown.textContent = '';

  // --- Panel toggles section ---
  const panelTitle = createElement('div', {
    className: 'settings-dropdown-title',
    textContent: 'Panels',
  });
  dropdown.appendChild(panelTitle);

  const panels = app.getPanels();
  for (const panel of panels) {
    const label = createElement('label', { className: 'settings-item' });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = panel.enabled;
    checkbox.addEventListener('change', () => {
      app.togglePanel(panel.id, checkbox.checked);
    });
    const text = createElement('span', { textContent: panel.title });
    label.appendChild(checkbox);
    label.appendChild(text);
    dropdown.appendChild(label);
  }

  // --- Divider ---
  dropdown.appendChild(createElement('div', { className: 'settings-dropdown-divider' }));

  // --- Theme section ---
  const themeTitle = createElement('div', {
    className: 'settings-dropdown-title',
    textContent: 'Theme',
  });
  dropdown.appendChild(themeTitle);

  const themeRow = createElement('div', { className: 'settings-radio-row' });
  const themeOptions: { id: ThemeName; label: string }[] = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'oled', label: 'OLED' },
  ];
  const currentTheme = getTheme();
  for (const opt of themeOptions) {
    const label = createElement('label', { className: 'settings-radio-label' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'theme';
    radio.value = opt.id;
    radio.checked = opt.id === currentTheme;
    radio.addEventListener('change', () => applyTheme(opt.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: opt.label }));
    themeRow.appendChild(label);
  }
  dropdown.appendChild(themeRow);

  // --- Divider ---
  dropdown.appendChild(createElement('div', { className: 'settings-dropdown-divider' }));

  // --- Density section ---
  const densityTitle = createElement('div', {
    className: 'settings-dropdown-title',
    textContent: 'Density',
  });
  dropdown.appendChild(densityTitle);

  const densityRow = createElement('div', { className: 'settings-radio-row' });
  const densityOptions: { id: DensityMode; label: string }[] = [
    { id: 'compact', label: 'Compact' },
    { id: 'comfortable', label: 'Comfort' },
    { id: 'spacious', label: 'Spacious' },
  ];
  const currentDensity = getDensity();
  for (const opt of densityOptions) {
    const label = createElement('label', { className: 'settings-radio-label' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'density';
    radio.value = opt.id;
    radio.checked = opt.id === currentDensity;
    radio.addEventListener('change', () => applyDensity(opt.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: opt.label }));
    densityRow.appendChild(label);
  }
  dropdown.appendChild(densityRow);

  // --- Divider ---
  dropdown.appendChild(createElement('div', { className: 'settings-dropdown-divider' }));

  // --- Units section ---
  const unitsTitle = createElement('div', {
    className: 'settings-dropdown-title',
    textContent: 'Units',
  });
  dropdown.appendChild(unitsTitle);

  const currentPrefs = getPreferences();

  // Temperature toggle
  const tempRow = createElement('div', { className: 'settings-radio-row' });
  for (const opt of [{ id: 'F' as const, label: '°F' }, { id: 'C' as const, label: '°C' }]) {
    const label = createElement('label', { className: 'settings-radio-label' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'tempUnit';
    radio.value = opt.id;
    radio.checked = opt.id === currentPrefs.tempUnit;
    radio.addEventListener('change', () => setPreference('tempUnit', opt.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: opt.label }));
    tempRow.appendChild(label);
  }
  dropdown.appendChild(tempRow);

  // Time format toggle
  const timeRow = createElement('div', { className: 'settings-radio-row' });
  for (const opt of [{ id: '12h' as const, label: '12h' }, { id: '24h' as const, label: '24h' }]) {
    const label = createElement('label', { className: 'settings-radio-label' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'timeFormat';
    radio.value = opt.id;
    radio.checked = opt.id === currentPrefs.timeFormat;
    radio.addEventListener('change', () => setPreference('timeFormat', opt.id));
    label.appendChild(radio);
    label.appendChild(createElement('span', { textContent: opt.label }));
    timeRow.appendChild(label);
  }
  dropdown.appendChild(timeRow);

  // --- Divider ---
  dropdown.appendChild(createElement('div', { className: 'settings-dropdown-divider' }));

  // --- Location section ---
  const locTitle = createElement('div', {
    className: 'settings-dropdown-title',
    textContent: 'Location',
  });
  dropdown.appendChild(locTitle);

  const inputRow = createElement('div', { className: 'settings-input-row' });
  inputRow.style.padding = '0 8px';

  const input = createElement('input', {}) as HTMLInputElement;
  input.type = 'text';
  input.placeholder = 'Enter city name\u2026';
  input.className = 'settings-text-input';

  const searchBtn = createElement('button', {
    className: 'settings-btn settings-btn-primary',
    textContent: 'Go',
  });

  inputRow.appendChild(input);
  inputRow.appendChild(searchBtn);
  dropdown.appendChild(inputRow);

  const locationDisplay = createElement('div', {
    className: 'settings-location-display',
  });
  locationDisplay.style.padding = '4px 8px';
  const saved = storage.get<SavedLocation | null>(LOCATION_KEY, null);
  if (saved?.name) {
    locationDisplay.textContent = saved.name;
  } else if (saved) {
    locationDisplay.textContent = `${saved.lat}, ${saved.lon}`;
  } else {
    locationDisplay.textContent = 'Auto-detected';
  }
  dropdown.appendChild(locationDisplay);

  const detectBtn = createElement('button', {
    className: 'settings-item',
    textContent: '\uD83D\uDCCD Detect my location',
  });
  dropdown.appendChild(detectBtn);

  // Search handler
  const handleSearch = async () => {
    const query = input.value.trim();
    if (!query) return;
    searchBtn.textContent = '\u2026';
    searchBtn.setAttribute('disabled', '');
    try {
      const result = await geocodeCity(query);
      const loc: SavedLocation = {
        lat: result.lat,
        lon: result.lon,
        name: `${result.name}, ${result.country}`,
      };
      storage.set(LOCATION_KEY, loc);
      input.value = '';
      locationDisplay.textContent = loc.name!;
      refreshWeather(app, loc.lat, loc.lon);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Geocoding failed';
      locationDisplay.textContent = msg;
      locationDisplay.style.color = 'var(--color-negative)';
      setTimeout(() => {
        locationDisplay.style.color = '';
      }, 3000);
    } finally {
      searchBtn.textContent = 'Go';
      searchBtn.removeAttribute('disabled');
    }
  };

  searchBtn.addEventListener('click', () => void handleSearch());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void handleSearch();
  });
  // Stop click from closing dropdown
  input.addEventListener('click', (e) => e.stopPropagation());

  detectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!navigator.geolocation) return;
    detectBtn.textContent = 'Detecting\u2026';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 100) / 100;
        const lon = Math.round(pos.coords.longitude * 100) / 100;
        const loc: SavedLocation = { lat, lon };
        storage.set(LOCATION_KEY, loc);
        locationDisplay.textContent = `${lat}, ${lon}`;
        refreshWeather(app, lat, lon);
        detectBtn.textContent = '\uD83D\uDCCD Detect my location';
      },
      () => {
        detectBtn.textContent = '\uD83D\uDCCD Detect my location';
      },
    );
  });
}

function refreshWeather(app: App, lat: number, lon: number): void {
  const weather = app.getPanel('weather');
  if (weather instanceof WeatherPanel) {
    weather.updateLocation(lat, lon);
  }
}

export function createHeader(app: App): HTMLElement {
  const header = createElement('header', { className: 'header' });
  header.setAttribute('role', 'banner');

  const title = createElement('span', {
    className: 'header-title',
    textContent: 'DashPulse',
  });

  const right = createElement('div', { className: 'header-right' });

  const clock = createElement('span', { className: 'header-clock' });
  clock.textContent = formatClock(new Date());
  setInterval(() => {
    clock.textContent = formatClock(new Date());
  }, 1000);

  const settingsWrap = createElement('div', { className: 'header-settings' });

  const gearBtn = createElement('button', { className: 'header-gear' });
  gearBtn.innerHTML = GEAR_SVG;
  gearBtn.setAttribute('aria-label', 'Settings');
  gearBtn.setAttribute('aria-haspopup', 'true');
  gearBtn.setAttribute('aria-expanded', 'false');

  const dropdown = createElement('div', { className: 'settings-dropdown' });
  dropdown.style.display = 'none';
  dropdown.setAttribute('role', 'menu');

  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : '';
    gearBtn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    if (!isOpen) buildDropdown(dropdown, app);
  });

  document.addEventListener('click', (e) => {
    if (!settingsWrap.contains(e.target as Node)) {
      dropdown.style.display = 'none';
    }
  });

  settingsWrap.appendChild(gearBtn);
  settingsWrap.appendChild(dropdown);

  // Auth section
  const authWrap = createElement('div', { className: 'header-auth' });
  function updateAuthUI() {
    authWrap.textContent = '';
    const user = getUser();
    if (user) {
      const avatar = document.createElement('img');
      avatar.src = user.avatar;
      avatar.alt = user.name;
      avatar.className = 'header-avatar';
      avatar.width = 28;
      avatar.height = 28;
      avatar.onerror = () => { avatar.style.display = 'none'; };

      const name = createElement('span', { className: 'header-username', textContent: user.name });
      const tierLabel = user.isAdmin ? 'admin' : user.tier;
      const tierClass = user.isAdmin ? 'admin' : user.tier;
      const tier = createElement('span', {
        className: `header-tier header-tier-${tierClass}`,
        textContent: tierLabel,
      });
      const logoutBtn = createElement('button', { className: 'header-gear', textContent: 'Sign Out' });
      logoutBtn.style.fontSize = '12px';
      logoutBtn.addEventListener('click', () => logout());

      authWrap.appendChild(avatar);
      authWrap.appendChild(name);
      authWrap.appendChild(tier);
      authWrap.appendChild(logoutBtn);
    } else {
      const signInBtn = createElement('button', { className: 'header-sign-in', textContent: 'Sign In' });
      const authDropdown = createElement('div', { className: 'header-auth-dropdown' });
      authDropdown.style.display = 'none';

      const googleBtn = createElement('button', { className: 'settings-item', textContent: 'Google' });
      googleBtn.addEventListener('click', () => login('google'));
      const githubBtn = createElement('button', { className: 'settings-item', textContent: 'GitHub' });
      githubBtn.addEventListener('click', () => login('github'));

      authDropdown.appendChild(googleBtn);
      authDropdown.appendChild(githubBtn);

      signInBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        authDropdown.style.display = authDropdown.style.display === 'none' ? '' : 'none';
      });

      authWrap.appendChild(signInBtn);
      authWrap.appendChild(authDropdown);
    }
  }
  updateAuthUI();
  onAuthChange(() => updateAuthUI());

  right.appendChild(clock);
  right.appendChild(authWrap);
  right.appendChild(settingsWrap);

  header.appendChild(title);
  header.appendChild(right);

  return header;
}
