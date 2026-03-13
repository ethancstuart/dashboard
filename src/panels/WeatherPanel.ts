import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchWeather } from '../services/weather.ts';
import { getPreferences } from '../config/preferences.ts';
import * as storage from '../services/storage.ts';
import type { WeatherData, SavedLocation, WeatherLocations } from '../types/index.ts';

const LOCATION_KEY = 'dashview-location';
const LOCATIONS_KEY = 'dashview-locations';
const DEFAULT_LAT = 40.71;
const DEFAULT_LON = -74.0;
const ICON_URL = 'https://openweathermap.org/img/wn';
const MAX_LOCATIONS = 5;

export class WeatherPanel extends Panel {
  private lat: number;
  private lon: number;
  private data: WeatherData | null = null;
  private locations: SavedLocation[] = [];
  private activeIndex: number = 0;

  constructor() {
    super({
      id: 'weather',
      title: 'Weather',
      enabled: true,
      refreshInterval: 1800000,
      priority: 0,
      category: 'world',
    });

    const saved = storage.get<WeatherLocations | null>(LOCATIONS_KEY, null);
    if (saved && saved.locations.length > 0) {
      this.locations = saved.locations;
      this.activeIndex = Math.min(saved.activeIndex, saved.locations.length - 1);
    } else {
      // Migrate from legacy single-location key
      const legacy = storage.get<SavedLocation | null>(LOCATION_KEY, null);
      if (legacy) {
        this.locations = [legacy];
        this.activeIndex = 0;
        this.saveLocations();
        storage.remove(LOCATION_KEY);
      } else {
        // Default to NYC + auto-detect
        this.locations = [{ lat: DEFAULT_LAT, lon: DEFAULT_LON, name: 'New York' }];
        this.activeIndex = 0;
        this.saveLocations();
        this.detectLocation();
      }
    }

    const active = this.locations[this.activeIndex];
    this.lat = active.lat;
    this.lon = active.lon;
  }

  private detectLocation(): void {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 100) / 100;
        const lon = Math.round(pos.coords.longitude * 100) / 100;
        const loc: SavedLocation = { lat, lon, isAutoDetected: true };
        this.addLocation(loc);
        this.setActiveLocation(0);
      },
      () => {
        // Geolocation denied or failed — keep default
      },
    );
  }

  addLocation(loc: SavedLocation): boolean {
    // Dedup by lat/lon proximity
    const isDuplicate = this.locations.some(
      (existing) => Math.abs(existing.lat - loc.lat) < 0.01 && Math.abs(existing.lon - loc.lon) < 0.01,
    );
    if (isDuplicate) {
      // Update existing entry if auto-detected
      if (loc.isAutoDetected) {
        const idx = this.locations.findIndex(
          (existing) => Math.abs(existing.lat - loc.lat) < 0.01 && Math.abs(existing.lon - loc.lon) < 0.01,
        );
        if (idx >= 0) {
          this.locations[idx] = { ...this.locations[idx], ...loc };
          this.saveLocations();
        }
      }
      return true;
    }
    if (this.locations.length >= MAX_LOCATIONS) return false;
    this.locations.push(loc);
    this.saveLocations();
    return true;
  }

  removeLocation(index: number): void {
    if (this.locations.length <= 1) return;
    this.locations.splice(index, 1);
    if (this.activeIndex >= this.locations.length) {
      this.activeIndex = this.locations.length - 1;
    } else if (this.activeIndex > index) {
      this.activeIndex--;
    } else if (this.activeIndex === index) {
      this.activeIndex = Math.min(this.activeIndex, this.locations.length - 1);
    }
    const active = this.locations[this.activeIndex];
    this.lat = active.lat;
    this.lon = active.lon;
    this.saveLocations();
    void this.fetchData();
  }

  setActiveLocation(index: number): void {
    if (index < 0 || index >= this.locations.length) return;
    this.activeIndex = index;
    const active = this.locations[this.activeIndex];
    this.lat = active.lat;
    this.lon = active.lon;
    this.saveLocations();
    void this.fetchData();
  }

  getLocations(): SavedLocation[] {
    return this.locations;
  }

  getActiveIndex(): number {
    return this.activeIndex;
  }

  getMaxLocations(): number {
    return MAX_LOCATIONS;
  }

  updateLocation(lat: number, lon: number): void {
    this.lat = lat;
    this.lon = lon;
    // Update active location in array
    if (this.locations[this.activeIndex]) {
      this.locations[this.activeIndex].lat = lat;
      this.locations[this.activeIndex].lon = lon;
      this.saveLocations();
    }
    void this.fetchData();
  }

  private saveLocations(): void {
    storage.set(LOCATIONS_KEY, {
      locations: this.locations,
      activeIndex: this.activeIndex,
    });
  }

  getLastData(): WeatherData | null {
    return this.data;
  }

  renderAtSize(size: import('../types/index.ts').WidgetSize): void {
    if (size === 'compact' && this.data) {
      this.contentEl.textContent = '';
      const wrap = createElement('div', { className: 'data-value' });
      wrap.style.cssText = 'text-align:center;padding:8px 0;font-size:20px';
      wrap.textContent = `${Math.round(this.data.current.temp)}\u00B0 ${this.data.current.icon || ''}`;
      const name = createElement('div', {});
      name.style.cssText = 'text-align:center;font-size:11px;color:var(--color-text-muted)';
      name.textContent = this.data.name;
      this.contentEl.appendChild(wrap);
      this.contentEl.appendChild(name);
      return;
    }
    if (this.data) this.render(this.data);
  }

  async fetchData(): Promise<void> {
    const prefs = getPreferences();
    const units = prefs.tempUnit === 'C' ? 'metric' : 'imperial';
    this.data = await fetchWeather(this.lat, this.lon, units);
    if (this.data.name) {
      const active = this.locations[this.activeIndex];
      if (active && !active.name) {
        active.name = this.data.name;
        this.saveLocations();
      }
    }
    // Cache weather data for map overlay
    storage.set('dashview-weather-cache', {
      temp: this.data.current.temp,
      condition: this.data.current.condition,
      icon: this.data.current.icon,
    });
    this.render(this.data);
  }

  render(data: unknown): void {
    const w = data as WeatherData;
    if (!w) {
      this.contentEl.textContent = '';
      const emptyState = createElement('div', { className: 'panel-empty-state' });
      emptyState.appendChild(createElement('div', { className: 'panel-empty-pulse' }));
      emptyState.appendChild(createElement('div', { textContent: 'Detecting your location...' }));
      this.contentEl.appendChild(emptyState);
      return;
    }

    this.contentEl.textContent = '';

    // Location bar (pills) — only when 2+ locations
    if (this.locations.length > 1) {
      const locBar = createElement('div', { className: 'weather-locations-bar' });
      this.locations.forEach((loc, i) => {
        const btn = createElement('button', {
          className: `weather-loc-btn${i === this.activeIndex ? ' active' : ''}`,
          textContent: loc.name ?? `${loc.lat.toFixed(1)}, ${loc.lon.toFixed(1)}`,
        });
        btn.addEventListener('click', () => this.setActiveLocation(i));
        locBar.appendChild(btn);
      });
      this.contentEl.appendChild(locBar);
    }

    // Location name
    const location = createElement('div', {
      className: 'weather-location',
      textContent: w.name,
    });
    this.contentEl.appendChild(location);

    // Current weather row: temp + icon/condition
    const currentRow = createElement('div', { className: 'weather-current' });

    const prefs = getPreferences();
    const unitSuffix = prefs.tempUnit === 'C' ? '°C' : '°F';

    const tempEl = createElement('span', {
      className: 'weather-temp',
      textContent: `${w.current.temp}${unitSuffix}`,
    });

    const infoCol = createElement('div', { className: 'weather-info' });
    const iconImg = document.createElement('img');
    iconImg.src = `${ICON_URL}/${w.current.icon}@2x.png`;
    iconImg.alt = w.current.condition;
    iconImg.className = 'weather-icon';
    iconImg.width = 48;
    iconImg.height = 48;

    const conditionEl = createElement('span', {
      className: 'weather-condition',
      textContent: w.current.condition.replace(/\b\w/g, (c) => c.toUpperCase()),
    });

    infoCol.appendChild(iconImg);
    infoCol.appendChild(conditionEl);

    currentRow.appendChild(tempEl);
    currentRow.appendChild(infoCol);
    this.contentEl.appendChild(currentRow);

    // Feels like
    const feelsLike = createElement('div', {
      className: 'weather-feels',
      textContent: `Feels like ${w.current.feelsLike}°`,
    });
    this.contentEl.appendChild(feelsLike);

    // High / Low
    const hiLo = createElement('div', {
      className: 'weather-hilo',
      textContent: `H: ${w.current.high}°  L: ${w.current.low}°`,
    });
    this.contentEl.appendChild(hiLo);

    // Divider
    this.contentEl.appendChild(createElement('div', { className: 'weather-divider' }));

    // Atmospheric stats grid
    const stats = createElement('div', { className: 'weather-stats' });

    const sunriseTime = this.formatShortTime(w.current.sunrise);
    const sunsetTime = this.formatShortTime(w.current.sunset);
    const windDir = this.degToCompass(w.current.windDirection ?? 0);

    const statItems = [
      { icon: '\uD83D\uDCA7', text: `${w.current.humidity}%` },
      { icon: '\uD83D\uDCA8', text: `${w.current.windSpeed}${prefs.tempUnit === 'C' ? 'km/h' : 'mph'} ${windDir}` },
      { icon: '\u2600\uFE0F', text: sunriseTime },
      { icon: '\uD83C\uDF19', text: sunsetTime },
    ];

    for (const item of statItems) {
      const stat = createElement('div', { className: 'weather-stat' });
      const iconEl = createElement('span', { className: 'weather-stat-icon', textContent: item.icon });
      const textEl = createElement('span', { textContent: item.text });
      stat.appendChild(iconEl);
      stat.appendChild(textEl);
      stats.appendChild(stat);
    }
    this.contentEl.appendChild(stats);

    // Divider
    this.contentEl.appendChild(createElement('div', { className: 'weather-divider' }));

    // 5-day forecast
    const forecastRow = createElement('div', { className: 'weather-forecast' });
    for (const day of w.forecast) {
      const col = createElement('div', { className: 'weather-forecast-day' });

      const dayName = createElement('span', {
        className: 'weather-forecast-label',
        textContent: day.day,
      });

      const dayIcon = document.createElement('img');
      dayIcon.src = `${ICON_URL}/${day.icon}@2x.png`;
      dayIcon.alt = '';
      dayIcon.className = 'weather-forecast-icon';
      dayIcon.width = 32;
      dayIcon.height = 32;

      const dayTemps = createElement('span', {
        className: 'weather-forecast-temps',
        textContent: `${day.high}° / ${day.low}°`,
      });

      col.appendChild(dayName);
      col.appendChild(dayIcon);
      col.appendChild(dayTemps);
      forecastRow.appendChild(col);
    }
    this.contentEl.appendChild(forecastRow);
  }

  private formatShortTime(unixTs: number): string {
    const date = new Date(unixTs * 1000);
    let hours = date.getHours();
    const mins = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'p' : 'a';
    hours = hours % 12 || 12;
    return `${hours}:${mins}${ampm}`;
  }

  private degToCompass(deg: number): string {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(deg / 45) % 8;
    return dirs[index];
  }
}
