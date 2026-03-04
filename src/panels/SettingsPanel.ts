import { Panel } from './Panel.ts';
import { WeatherPanel } from './WeatherPanel.ts';
import { createElement } from '../utils/dom.ts';
import { geocodeCity } from '../services/weather.ts';
import * as storage from '../services/storage.ts';
import type { App } from '../App.ts';

const LOCATION_KEY = 'dashview-location';

interface SavedLocation {
  lat: number;
  lon: number;
  name?: string;
}

export class SettingsPanel extends Panel {
  private app: App;
  private locationDisplay: HTMLElement | null = null;

  constructor(app: App) {
    super({
      id: 'settings',
      title: 'Settings',
      enabled: true,
      refreshInterval: 0,
    });
    this.app = app;
  }

  async fetchData(): Promise<void> {
    this.render(null);
  }

  render(_data: unknown): void {
    this.contentEl.textContent = '';

    // Section title
    const sectionTitle = createElement('div', {
      className: 'settings-section-title',
      textContent: 'Location',
    });
    this.contentEl.appendChild(sectionTitle);

    // Input row
    const inputRow = createElement('div', { className: 'settings-input-row' });

    const input = createElement('input', {}) as HTMLInputElement;
    input.type = 'text';
    input.placeholder = 'Enter city name…';
    input.className = 'settings-text-input';

    const searchBtn = createElement('button', {
      className: 'settings-btn settings-btn-primary',
      textContent: 'Search',
    });

    const detectBtn = createElement('button', {
      className: 'settings-btn settings-btn-ghost',
      textContent: 'Detect',
    });

    inputRow.appendChild(input);
    inputRow.appendChild(searchBtn);
    inputRow.appendChild(detectBtn);
    this.contentEl.appendChild(inputRow);

    // Current location display
    this.locationDisplay = createElement('div', {
      className: 'settings-location-display',
    });
    this.updateLocationDisplay();
    this.contentEl.appendChild(this.locationDisplay);

    // Search handler
    const handleSearch = async () => {
      const query = input.value.trim();
      if (!query) return;

      searchBtn.textContent = '…';
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
        this.updateLocationDisplay();
        this.refreshWeather(loc.lat, loc.lon);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Geocoding failed';
        this.locationDisplay!.textContent = msg;
        this.locationDisplay!.style.color = 'var(--color-negative)';
        setTimeout(() => {
          if (this.locationDisplay) {
            this.locationDisplay.style.color = '';
            this.updateLocationDisplay();
          }
        }, 3000);
      } finally {
        searchBtn.textContent = 'Search';
        searchBtn.removeAttribute('disabled');
      }
    };

    searchBtn.addEventListener('click', () => void handleSearch());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void handleSearch();
    });

    // Detect handler
    detectBtn.addEventListener('click', () => {
      if (!navigator.geolocation) return;

      detectBtn.textContent = '…';
      detectBtn.setAttribute('disabled', '');

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Math.round(pos.coords.latitude * 100) / 100;
          const lon = Math.round(pos.coords.longitude * 100) / 100;
          const loc: SavedLocation = { lat, lon };
          storage.set(LOCATION_KEY, loc);
          this.updateLocationDisplay();
          this.refreshWeather(lat, lon);
          detectBtn.textContent = 'Detect';
          detectBtn.removeAttribute('disabled');
        },
        () => {
          detectBtn.textContent = 'Detect';
          detectBtn.removeAttribute('disabled');
        },
      );
    });
  }

  private updateLocationDisplay(): void {
    if (!this.locationDisplay) return;
    const saved = storage.get<SavedLocation | null>(LOCATION_KEY, null);
    if (saved?.name) {
      this.locationDisplay.textContent = `${saved.name} (${saved.lat}, ${saved.lon})`;
    } else if (saved) {
      this.locationDisplay.textContent = `Custom location (${saved.lat}, ${saved.lon})`;
    } else {
      this.locationDisplay.textContent = 'No location set — using default';
    }
  }

  private refreshWeather(lat: number, lon: number): void {
    const weather = this.app.getPanel('weather');
    if (weather instanceof WeatherPanel) {
      weather.updateLocation(lat, lon);
    }
  }
}
