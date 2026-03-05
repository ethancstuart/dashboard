import { fetchWithRetry } from '../utils/fetch.ts';
import type { StockQuote, StocksData } from '../types/index.ts';

const INDEX_SYMBOLS = ['SPY', 'DIA', 'QQQ'];

export async function fetchStocks(watchlist: string[]): Promise<StocksData> {
  const all = [...INDEX_SYMBOLS, ...watchlist];
  const res = await fetchWithRetry(`/api/stocks?symbols=${all.join(',')}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const quotes: StockQuote[] = data.quotes;
  return splitResponse(quotes, watchlist, data.timestamp);
}

function splitResponse(
  quotes: StockQuote[],
  watchlistSymbols: string[],
  timestamp: number,
): StocksData {
  const watchSet = new Set(watchlistSymbols.map((s) => s.toUpperCase()));
  const indices: StockQuote[] = [];
  const watchlist: StockQuote[] = [];

  for (const q of quotes) {
    if (watchSet.has(q.symbol.toUpperCase())) {
      watchlist.push(q);
    } else {
      indices.push(q);
    }
  }

  return { indices, watchlist, timestamp };
}
