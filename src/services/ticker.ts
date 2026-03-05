import { fetchWithRetry } from '../utils/fetch.ts';
import type { TickerData, SparklineData } from '../types/index.ts';

export async function fetchTickerData(): Promise<TickerData> {
  const res = await fetchWithRetry('/api/stocks?action=ticker');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { items: data.items, marketStatus: data.marketStatus };
}

export async function fetchSparklines(symbols: string[]): Promise<SparklineData> {
  if (symbols.length === 0) return {};
  const res = await fetchWithRetry(`/api/stocks?action=sparklines&symbols=${symbols.join(',')}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.sparklines ?? {};
}
