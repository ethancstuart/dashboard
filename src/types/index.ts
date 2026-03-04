export interface PanelConfig {
  id: string;
  title: string;
  enabled: boolean;
  refreshInterval: number;
}

export interface PanelSettings {
  enabled: boolean;
  [key: string]: unknown;
}

export interface PanelState {
  panels: Record<string, PanelSettings>;
}

// Weather
export interface ForecastDay {
  day: string;
  icon: string;
  high: number;
  low: number;
}

export interface WeatherCurrent {
  temp: number;
  feelsLike: number;
  condition: string;
  icon: string;
  high: number;
  low: number;
  sunrise: number;
  sunset: number;
  humidity: number;
  windSpeed: number;
}

export interface WeatherData {
  current: WeatherCurrent;
  forecast: ForecastDay[];
  name: string;
}

export interface GeocodingResult {
  name: string;
  lat: number;
  lon: number;
  country: string;
}
