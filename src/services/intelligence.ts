import type { PulseItem, StocksData, CryptoData, WeatherData, SportsData, NewsData } from '../types/index.ts';

const panelData = new Map<string, unknown>();
let pulseItems: PulseItem[] = [];
let intervalId: ReturnType<typeof setInterval> | null = null;

export function initIntelligence(): void {
  // Subscribe to panel data events
  document.addEventListener('dashview:panel-data', (e) => {
    const detail = (e as CustomEvent).detail;
    if (detail.panelId && detail.data) {
      panelData.set(detail.panelId, detail.data);
    }
  });

  // Run correlation rules periodically
  runCorrelation();
  intervalId = setInterval(runCorrelation, 60000);
}

export function destroyIntelligence(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function getPulseItems(): PulseItem[] {
  return pulseItems;
}

function runCorrelation(): void {
  const items: PulseItem[] = [];

  // Market threshold: watchlist stock >2% daily change
  const stocks = panelData.get('stocks') as StocksData | undefined;
  if (stocks?.watchlist) {
    for (const q of stocks.watchlist) {
      if (Math.abs(q.changePercent) > 2) {
        const sign = q.changePercent >= 0 ? '+' : '';
        items.push({
          id: `stock-${q.symbol}`,
          type: 'market',
          priority: Math.abs(q.changePercent) > 5 ? 0 : 1,
          text: `${q.symbol} ${sign}${q.changePercent.toFixed(1)}%`,
          icon: q.changePercent >= 0 ? '\uD83D\uDCC8' : '\uD83D\uDCC9',
          panelId: 'stocks',
        });
      }
    }
  }

  // Crypto swing: top coins >5% daily change
  const crypto = panelData.get('crypto') as CryptoData | undefined;
  if (crypto?.coins) {
    for (const coin of crypto.coins.slice(0, 10)) {
      if (Math.abs(coin.change24h) > 5) {
        const sign = coin.change24h >= 0 ? '+' : '';
        items.push({
          id: `crypto-${coin.symbol}`,
          type: 'crypto',
          priority: 1,
          text: `${coin.symbol.toUpperCase()} ${sign}${coin.change24h.toFixed(1)}%`,
          icon: coin.change24h >= 0 ? '\u25B2' : '\u25BC',
          panelId: 'crypto',
        });
      }
    }
  }

  // Weather: check for rain/snow
  const weather = panelData.get('weather') as WeatherData | undefined;
  if (weather?.current) {
    const cond = weather.current.condition.toLowerCase();
    if (cond.includes('rain') || cond.includes('snow') || cond.includes('storm')) {
      items.push({
        id: 'weather-alert',
        type: 'weather',
        priority: 1,
        text: `${weather.current.condition} in ${weather.name}`,
        icon: cond.includes('snow') ? '\u2744\uFE0F' : '\uD83C\uDF27\uFE0F',
        panelId: 'weather',
        expiry: Date.now() + 3600000,
      });
    }
  }

  // Sports: games starting soon (within 30min)
  const sports = panelData.get('sports') as SportsData | undefined;
  if (sports?.games) {
    const now = Date.now();
    for (const game of sports.games) {
      if (game.status === 'scheduled') {
        const gameTime = new Date(game.startTime).getTime();
        const diff = gameTime - now;
        if (diff > 0 && diff < 1800000) {
          const mins = Math.round(diff / 60000);
          items.push({
            id: `sports-${game.id}`,
            type: 'sports',
            priority: 1,
            text: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation} in ${mins}m`,
            icon: '\u26BD',
            panelId: 'sports',
            expiry: gameTime,
          });
        }
      }
      if (game.status === 'in_progress') {
        items.push({
          id: `sports-live-${game.id}`,
          type: 'sports',
          priority: 0,
          text: `LIVE: ${game.awayTeam.abbreviation} ${game.awayTeam.score ?? 0}-${game.homeTeam.score ?? 0} ${game.homeTeam.abbreviation}`,
          icon: '\uD83D\uDD34',
          panelId: 'sports',
        });
      }
    }
  }

  // News: check for correlated headlines with watchlist stocks
  const news = panelData.get('news') as NewsData | undefined;
  if (news?.articles && stocks?.watchlist) {
    const symbols = stocks.watchlist.map((q) => q.symbol.toLowerCase());
    for (const article of news.articles.slice(0, 5)) {
      const titleLower = article.title.toLowerCase();
      for (const sym of symbols) {
        if (titleLower.includes(sym)) {
          items.push({
            id: `news-corr-${sym}-${article.title.slice(0, 20)}`,
            type: 'news',
            priority: 2,
            text: `${sym.toUpperCase()} in news: ${article.title.slice(0, 50)}`,
            icon: '\uD83D\uDCF0',
            panelId: 'news',
          });
          break;
        }
      }
    }
  }

  // Sort by priority, filter expired
  const now = Date.now();
  pulseItems = items
    .filter((item) => !item.expiry || item.expiry > now)
    .sort((a, b) => a.priority - b.priority);

  // Emit update
  document.dispatchEvent(new CustomEvent('dashview:pulse-update', { detail: { items: pulseItems } }));
}
