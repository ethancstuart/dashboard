import { fetchWithRetry } from '../utils/fetch.ts';
import type { EntertainmentTab, EntertainmentData } from '../types/index.ts';

export async function fetchEntertainment(tab: EntertainmentTab): Promise<EntertainmentData> {
  const res = await fetchWithRetry(`/api/entertainment?tab=${tab}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as EntertainmentData;
}
