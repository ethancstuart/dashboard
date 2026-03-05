import { fetchWithRetry } from '../utils/fetch.ts';
import type { NewsCategory, NewsData } from '../types/index.ts';

export async function fetchNews(category: NewsCategory): Promise<NewsData> {
  const res = await fetchWithRetry(`/api/news?category=${category}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as NewsData;
}
