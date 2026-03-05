import { fetchWithRetry } from '../utils/fetch.ts';
import type { StockQuote, StocksData, SymbolSearchResult, CandleData, CompanyNews } from '../types/index.ts';

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

export async function fetchCandles(
  symbol: string,
  resolution: string,
  from: number,
  to: number,
): Promise<CandleData> {
  const res = await fetchWithRetry(
    `/api/stocks?action=candle&symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}&from=${from}&to=${to}`,
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.candles as CandleData;
}

export async function fetchCompanyNews(
  symbol: string,
  fromDate: string,
  toDate: string,
): Promise<CompanyNews[]> {
  const res = await fetchWithRetry(
    `/api/stocks?action=news&symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}`,
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.news as CompanyNews[];
}
