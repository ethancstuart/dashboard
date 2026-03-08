export interface PanelConfig {
  id: string;
  title: string;
  enabled: boolean;
  refreshInterval: number;
  priority?: number;
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

export interface CompanyProfile {
  name: string;
  ticker: string;
  logo: string;
  industry: string;
  marketCap: number;
  weburl: string;
}

export interface KeyMetrics {
  marketCap: number;
  peRatio: number;
  eps: number;
  high52w: number;
  low52w: number;
  beta: number;
}

// News
export type NewsCategory = 'us' | 'world' | 'markets' | 'tech' | 'science' | 'entertainment' | 'x';

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

// Prediction markets
export interface PredictionMarket {
  id: string;
  question: string;
  probability: number;
  volume: number;
  source: 'polymarket' | 'kalshi';
  url: string;
}

// Sports
export type SportsLeague = 'nba' | 'nfl' | 'mlb' | 'epl';

export interface SportsGame {
  id: string;
  league: SportsLeague;
  status: 'scheduled' | 'in_progress' | 'final';
  statusDetail: string;
  startTime: string;
  homeTeam: SportsTeamScore;
  awayTeam: SportsTeamScore;
  broadcast?: string;
  venue?: string;
}

export interface SportsTeamScore {
  id: string;
  name: string;
  abbreviation: string;
  logo: string;
  score: number | null;
  record?: string;
}

export interface SportsHeadline {
  title: string;
  link: string;
  source: string;
  published: string;
}

export interface SportsData {
  league: SportsLeague;
  games: SportsGame[];
  headlines: SportsHeadline[];
  fetchedAt: number;
}

// Crypto
export interface CryptoCoin {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
  volume: number;
  sparkline: number[];
  rank: number;
  high24h: number;
  low24h: number;
  ath: number;
  athChange: number;
}

export interface CryptoData {
  coins: CryptoCoin[];
  fetchedAt: number;
}

// Chat
export type ChatProvider = 'anthropic' | 'openai' | 'google' | 'xai';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  title: string;
}

// Auth
export type UserTier = 'guest' | 'free' | 'premium';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
  provider: 'google' | 'github';
  tier: UserTier;
  isAdmin?: boolean;
  createdAt: string;
}

// Social / X feed
export interface SocialPost {
  id: string;
  author: string;
  handle: string;
  text: string;
  timestamp: string;
  link: string;
}
