import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchWeather } from '../services/weather.ts';
import * as storage from '../services/storage.ts';
import type { WeatherData } from '../types/index.ts';

const LOCATION_KEY = 'dashview-location';
const DEFAULT_LAT = 40.71;
const DEFAULT_LON = -74.0;
const ICON_URL = 'https://openweathermap.org/img/wn';

interface SavedLocation {
  lat: number;
  lon: number;
  name?: string;
}

export class WeatherPanel extends Panel {
  private lat: number;
  private lon: number;
  private data: WeatherData | null = null;

  constructor() {
    super({
      id: 'weather',
      title: 'Weather',
      enabled: true,
      refreshInterval: 1800000,
    });

    const saved = storage.get<SavedLocation | null>(LOCATION_KEY, null);
    if (saved) {
      this.lat = saved.lat;
      this.lon = saved.lon;
    } else {
      this.lat = DEFAULT_LAT;
      this.lon = DEFAULT_LON;
      this.detectLocation();
    }
  }

  private detectLocation(): void {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.lat = pos.coords.latitude;
        this.lon = pos.coords.longitude;
        storage.set(LOCATION_KEY, { lat: this.lat, lon: this.lon });
        void this.fetchData();
      },
      () => {
        // Geolocation denied or failed — keep default
      },
    );
  }

  async fetchData(): Promise<void> {
    this.data = await fetchWeather(this.lat, this.lon);
    if (this.data.name) {
      const saved = storage.get<SavedLocation | null>(LOCATION_KEY, null);
      storage.set(LOCATION_KEY, {
        lat: this.lat,
        lon: this.lon,
        name: saved?.name ?? this.data.name,
      });
    }
    this.render(this.data);
  }

  render(data: unknown): void {
    const w = data as WeatherData;
    if (!w) return;

    this.contentEl.textContent = '';

    // Location name
    const location = createElement('div', {
      className: 'weather-location',
      textContent: w.name,
    });
    this.contentEl.appendChild(location);

    // Current weather row: temp + icon/condition
    const currentRow = createElement('div', { className: 'weather-current' });

    const tempEl = createElement('span', {
      className: 'weather-temp',
      textContent: `${w.current.temp}°`,
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
    const divider = createElement('div', { className: 'weather-divider' });
    this.contentEl.appendChild(divider);

    // 3-day forecast
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
}
