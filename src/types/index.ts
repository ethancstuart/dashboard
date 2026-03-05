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

export interface HourlyForecast {
  time: number;
  temp: number;
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
  windDirection: number;
  pressure: number;
  visibility: number;
}

export interface WeatherData {
  current: WeatherCurrent;
  forecast: ForecastDay[];
  hourly: HourlyForecast[];
  name: string;
}

// Sparkline data for ticker
export interface SparklinePoint {
  price: number;
}

export interface SparklineData {
  [symbol: string]: number[];
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

// Ticker
export interface TickerItem {
  symbol: string;
  label: string;
  price: number;
  change: number;
  changePercent: number;
  type: 'index' | 'forex' | 'crypto';
}

export interface MarketStatus {
  isOpen: boolean;
  session: string;
}

export interface TickerData {
  items: TickerItem[];
  marketStatus: MarketStatus;
}

// Stock detail
export interface CandleData {
  t: number[];
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  v: number[];
}

export interface CompanyNews {
  headline: string;
  summary: string;
  url: string;
  source: string;
  datetime: number;
  image: string;
}

// News
export type NewsCategory = 'world' | 'tech' | 'business' | 'science' | 'entertainment';

export interface NewsArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description: string;
  sourceCountry: string;
  lat: number;
  lon: number;
}

export interface NewsData {
  articles: NewsArticle[];
  category: NewsCategory;
  fetchedAt: number;
}
