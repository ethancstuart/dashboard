import { fetchWithRetry } from '../utils/fetch.ts';
import * as storage from './storage.ts';
import type { CustomFeed, NewsCategory, NewsData } from '../types/index.ts';

const CUSTOM_FEEDS_KEY = 'dashview-custom-feeds';

export function getCustomFeeds(): CustomFeed[] {
  return storage.get<CustomFeed[]>(CUSTOM_FEEDS_KEY, []);
}

export function saveCustomFeeds(feeds: CustomFeed[]): void {
  storage.set(CUSTOM_FEEDS_KEY, feeds);
}

export async function fetchNews(category: NewsCategory): Promise<NewsData> {
  let url = `/api/news?category=${category}`;

  if (category === 'custom') {
    const feeds = getCustomFeeds().filter(f => f.enabled);
    if (feeds.length === 0) {
      return { articles: [], category, fetchedAt: Date.now() };
    }
    const customUrls = feeds.map(f => ({ url: f.url, name: f.name, lat: f.lat, lon: f.lon }));
    url += `&customUrls=${encodeURIComponent(JSON.stringify(customUrls))}`;
  }

  const res = await fetchWithRetry(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as NewsData;
}
