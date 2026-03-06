import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchWeather } from '../services/weather.ts';
import { renderSparkline } from '../ui/chart.ts';
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

  updateLocation(lat: number, lon: number): void {
    this.lat = lat;
    this.lon = lon;
    void this.fetchData();
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
    this.contentEl.appendChild(createElement('div', { className: 'weather-divider' }));

    // Hourly sparkline
    if (w.hourly && w.hourly.length >= 2) {
      const temps = w.hourly.map((h) => h.temp);
      const lo = Math.round(Math.min(...temps));
      const hi = Math.round(Math.max(...temps));

      const sparklineLabel = createElement('div', { className: 'weather-sparkline-label' });
      const labelLeft = createElement('span', { textContent: 'Next 36h' });
      const labelRight = createElement('span', {
        className: 'weather-sparkline-range',
        textContent: `${lo}\u00B0 \u2014 ${hi}\u00B0`,
      });
      sparklineLabel.appendChild(labelLeft);
      sparklineLabel.appendChild(labelRight);
      this.contentEl.appendChild(sparklineLabel);

      const sparklineWrap = createElement('div', { className: 'weather-sparkline-wrap' });
      const hourlyCanvas = document.createElement('canvas');
      hourlyCanvas.className = 'weather-hourly';
      sparklineWrap.appendChild(hourlyCanvas);

      // Hour labels row
      const hourLabels = createElement('div', { className: 'weather-hour-labels' });
      const labelCount = 6;
      const step = Math.max(1, Math.floor((w.hourly.length - 1) / (labelCount - 1)));
      for (let j = 0; j < labelCount; j++) {
        const i = Math.min(j * step, w.hourly.length - 1);
        const h = new Date(w.hourly[i].time * 1000);
        const hrs = h.getHours();
        const label = createElement('span', {
          textContent: hrs === 0 ? '12a' :
            hrs < 12 ? `${hrs}a` :
            hrs === 12 ? '12p' : `${hrs - 12}p`,
        });
        hourLabels.appendChild(label);
      }
      sparklineWrap.appendChild(hourLabels);

      this.contentEl.appendChild(sparklineWrap);
      requestAnimationFrame(() => {
        renderSparkline(hourlyCanvas, temps, {
          color: '#3b82f6',
          width: hourlyCanvas.offsetWidth || 200,
          height: 72,
          showDots: true,
        });
      });

      this.contentEl.appendChild(createElement('div', { className: 'weather-divider' }));
    }

    // Atmospheric stats grid
    const stats = createElement('div', { className: 'weather-stats' });

    const sunriseTime = this.formatShortTime(w.current.sunrise);
    const sunsetTime = this.formatShortTime(w.current.sunset);
    const windDir = this.degToCompass(w.current.windDirection ?? 0);

    const statItems = [
      { icon: '\uD83D\uDCA7', text: `${w.current.humidity}%` },
      { icon: '\uD83D\uDCA8', text: `${w.current.windSpeed}mph ${windDir}` },
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
