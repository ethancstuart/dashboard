import { fetchWithRetry } from '../utils/fetch.ts';
import type { CryptoData } from '../types/index.ts';

export async function fetchCryptoData(): Promise<CryptoData> {
  const res = await fetchWithRetry('/api/crypto');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as CryptoData;
}
