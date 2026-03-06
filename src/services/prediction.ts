import { fetchWithRetry } from '../utils/fetch.ts';
import type { PredictionMarket } from '../types/index.ts';

export async function fetchPredictions(): Promise<PredictionMarket[]> {
  const res = await fetchWithRetry('/api/prediction');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.markets as PredictionMarket[];
}
