import { fetchWithRetry } from '../utils/fetch.ts';
import type { SportsLeague, SportsData, SportsHeadline } from '../types/index.ts';

export async function fetchScoreboard(league: SportsLeague): Promise<SportsData> {
  const res = await fetchWithRetry(`/api/sports?league=${league}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as SportsData;
}

export async function fetchSportsHeadlines(league: SportsLeague): Promise<SportsHeadline[]> {
  const res = await fetchWithRetry(`/api/sports?league=${league}&action=headlines`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.headlines as SportsHeadline[];
}
