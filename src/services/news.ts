import { fetchWithRetry } from '../utils/fetch.ts';
import * as storage from './storage.ts';
import type { CustomFeed, NewsCategory, NewsData, GlobeNewsArticle, GlobeNewsCategory } from '../types/index.ts';

const CUSTOM_FEEDS_KEY = 'dashview-custom-feeds';

const GLOBE_CATEGORIES: GlobeNewsCategory[] = ['world', 'us', 'tech', 'science', 'markets'];

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

export async function fetchAllNews(categories?: GlobeNewsCategory[]): Promise<GlobeNewsArticle[]> {
  const cats = categories || GLOBE_CATEGORIES;
  const url = `/api/news?categories=${cats.join(',')}`;

  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Articles come back with category field from multi-category endpoint
    return (data.articles || []).map((a: GlobeNewsArticle & { category?: string }) => ({
      ...a,
      category: (a.category || 'world') as GlobeNewsCategory,
    }));
  } catch {
    // Fallback: fetch each category individually
    const results = await Promise.allSettled(
      cats.map(async (cat) => {
        const newsData = await fetchNews(cat as NewsCategory);
        return newsData.articles.map(a => ({
          ...a,
          category: cat,
        }));
      }),
    );

    const articles: GlobeNewsArticle[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        articles.push(...r.value);
      }
    }

    // Sort by date, deduplicate
    articles.sort((a, b) => {
      const da = new Date(a.pubDate).getTime() || 0;
      const db = new Date(b.pubDate).getTime() || 0;
      return db - da;
    });

    const seen = new Set<string>();
    return articles.filter(a => {
      if (!a.link || seen.has(a.link)) return false;
      seen.add(a.link);
      return true;
    }).slice(0, 100);
  }
}
