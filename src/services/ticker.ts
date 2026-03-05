import { fetchWithRetry } from '../utils/fetch.ts';
import type { TickerData } from '../types/index.ts';

export async function fetchTickerData(): Promise<TickerData> {
  const res = await fetchWithRetry('/api/stocks?action=ticker');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { items: data.items, marketStatus: data.marketStatus };
}
