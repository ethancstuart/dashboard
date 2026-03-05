import { fetchWithRetry } from '../utils/fetch.ts';
import type { StockQuote, StocksData, SymbolSearchResult } from '../types/index.ts';

export async function fetchStocks(watchlist: string[]): Promise<StocksData> {
  const res = await fetchWithRetry(`/api/stocks?symbols=${watchlist.join(',')}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  return { indices: [], watchlist: data.quotes as StockQuote[], timestamp: data.timestamp };
}

export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const res = await fetchWithRetry(`/api/stocks?action=search&q=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.results as SymbolSearchResult[];
}
