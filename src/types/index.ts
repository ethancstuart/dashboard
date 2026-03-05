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

// Stocks
export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
}

export interface StocksData {
  indices: StockQuote[];
  watchlist: StockQuote[];
  timestamp: number;
}

export interface SymbolSearchResult {
  symbol: string;
  description: string;
  type: string;
}
