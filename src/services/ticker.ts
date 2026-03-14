import { fetchWithRetry } from '../utils/fetch.ts';
import type { TickerData, SparklineData } from '../types/index.ts';

export async function fetchTickerData(): Promise<TickerData> {
  const res = await fetchWithRetry('/api/ticker');
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const items = (data.quotes || []).map((q: { symbol: string; name: string; price: number; change: number; changePercent: number }) => ({
    symbol: q.symbol,
    label: q.name,
    price: q.price,
    change: q.change,
    changePercent: q.changePercent,
    type: 'index' as const,
  }));

  return { items, marketStatus: { isOpen: true, session: '' } };
}

export async function fetchSparklines(_symbols: string[]): Promise<SparklineData> {
  // Sparklines not available from Twelve Data free tier
  return {};
}
