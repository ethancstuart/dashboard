export type WidgetSize = 'compact' | 'medium' | 'large';
export type PanelCategory = 'markets' | 'world' | 'personal' | 'dev' | 'utility';

export interface SpaceWidget {
  panelId: string;
  size: WidgetSize;
  colSpan: number;    // 2-12
  position: number;   // order in grid
}

export interface Space {
  id: string;
  name: string;
  icon: string;
  widgets: SpaceWidget[];
}

export interface PulseItem {
  id: string;
  type: 'market' | 'weather' | 'news' | 'sports' | 'calendar' | 'crypto';
  priority: number;   // 0=critical, 1=important, 2=info
  text: string;
  icon: string;
  panelId?: string;
  expiry?: number;
}

export interface PanelConfig {
  id: string;
  title: string;
  enabled: boolean;
  refreshInterval: number;
  priority?: number;
  category?: PanelCategory;
}

export interface PanelSettings {
  enabled: boolean;
  [key: string]: unknown;
}

export interface PanelState {
  panels: Record<string, PanelSettings>;
}

// Weather — saved locations
export interface SavedLocation {
  lat: number;
  lon: number;
  name?: string;
  isAutoDetected?: boolean;
}

export interface WeatherLocations {
  locations: SavedLocation[];
  activeIndex: number;
}

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

// Custom Feeds
export interface CustomFeed {
  id: string;
  url: string;
  name: string;
  lat?: number;
  lon?: number;
  enabled: boolean;
}

// Calendar
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  calendarColor?: string;
}

// News
export type NewsCategory = 'us' | 'world' | 'markets' | 'tech' | 'science' | 'entertainment' | 'x' | 'custom';

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
export type UserTier = 'free' | 'premium';

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

// Notes
export interface Note {
  id: string;
  text: string;
  createdAt: number;
  done?: boolean;
}

// Price Alerts
export interface PriceAlert {
  id: string;
  symbol: string;
  type: 'stock' | 'crypto';
  condition: 'above' | 'below' | 'change_above' | 'change_below' | 'outside_range' | 'crosses_above' | 'crosses_below';
  threshold: number;
  threshold2?: number;
  referencePrice?: number;
  lastPrice?: number;
  createdAt: number;
  triggeredAt?: number;
  acknowledged?: boolean;
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

// Entertainment (TMDB)
export type EntertainmentTab = 'trending' | 'movies' | 'tv' | 'upcoming';

export interface EntertainmentItem {
  id: number;
  title: string;
  mediaType: 'movie' | 'tv';
  posterPath: string | null;
  year: string;
  rating: number;
  overview: string;
  genreIds: number[];
}

export interface EntertainmentData {
  items: EntertainmentItem[];
  tab: EntertainmentTab;
  fetchedAt: number;
}

// Globe
export interface GlobeMarker {
  lat: number;
  lng: number;
  size: number;
  color: string;
  articles: NewsArticle[];
  label: string;
}

export interface GlobeWeatherPin {
  lat: number;
  lng: number;
  temp: number;
  condition: string;
  name: string;
}
