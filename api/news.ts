import type { VercelRequest, VercelResponse } from '@vercel/node';
import Parser from 'rss-parser';

export const config = { runtime: 'nodejs' };

interface FeedSource {
  name: string;
  url: string;
  country: string;
  lat: number;
  lon: number;
}

const FEEDS: Record<string, FeedSource[]> = {
  world: [
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', country: 'GB', lat: 51.51, lon: -0.13 },
    { name: 'AP News', url: 'https://rsshub.app/apnews/topics/apf-topnews', country: 'US', lat: 40.76, lon: -73.98 },
    { name: 'Reuters', url: 'https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best', country: 'GB', lat: 51.51, lon: -0.13 },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', country: 'QA', lat: 25.29, lon: 51.53 },
    { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', country: 'US', lat: 38.89, lon: -77.01 },
  ],
  tech: [
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', country: 'US', lat: 37.77, lon: -122.42 },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', country: 'US', lat: 40.74, lon: -73.99 },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', country: 'US', lat: 37.77, lon: -122.42 },
    { name: 'Wired', url: 'https://www.wired.com/feed/rss', country: 'US', lat: 37.77, lon: -122.42 },
    { name: 'Hacker News', url: 'https://hnrss.org/frontpage', country: 'US', lat: 37.77, lon: -122.42 },
  ],
  business: [
    { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', country: 'US', lat: 40.72, lon: -74.0 },
    { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', country: 'US', lat: 40.71, lon: -74.01 },
    { name: 'Financial Times', url: 'https://www.ft.com/?format=rss', country: 'GB', lat: 51.51, lon: -0.11 },
    { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss', country: 'US', lat: 40.76, lon: -73.98 },
  ],
  science: [
    { name: 'Nature', url: 'https://www.nature.com/nature.rss', country: 'GB', lat: 51.53, lon: -0.13 },
    { name: 'Scientific American', url: 'https://rss.sciam.com/ScientificAmerican-Global', country: 'US', lat: 40.74, lon: -73.99 },
    { name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', country: 'US', lat: 38.88, lon: -77.02 },
    { name: 'New Scientist', url: 'https://www.newscientist.com/section/news/feed/', country: 'GB', lat: 51.52, lon: -0.13 },
  ],
  entertainment: [
    { name: 'Variety', url: 'https://variety.com/feed/', country: 'US', lat: 34.06, lon: -118.36 },
    { name: 'Hollywood Reporter', url: 'https://www.hollywoodreporter.com/feed/', country: 'US', lat: 34.09, lon: -118.38 },
    { name: 'Rolling Stone', url: 'https://www.rollingstone.com/feed/', country: 'US', lat: 40.73, lon: -73.99 },
    { name: 'Pitchfork', url: 'https://pitchfork.com/feed/feed-news/rss', country: 'US', lat: 40.72, lon: -73.99 },
  ],
};

const VALID_CATEGORIES = new Set(Object.keys(FEEDS));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const category = (req.query.category as string | undefined) || 'world';
  if (!VALID_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  const sources = FEEDS[category];
  const parser = new Parser({ timeout: 5000 });

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const feed = await parser.parseURL(source.url);
      return (feed.items || []).slice(0, 10).map((item) => ({
        title: item.title || '',
        link: item.link || '',
        pubDate: item.pubDate || item.isoDate || '',
        source: source.name,
        description: (item.contentSnippet || item.content || '').slice(0, 200),
        sourceCountry: source.country,
        lat: source.lat,
        lon: source.lon,
      }));
    }),
  );

  interface Article {
    title: string;
    link: string;
    pubDate: string;
    source: string;
    description: string;
    sourceCountry: string;
    lat: number;
    lon: number;
  }

  const articles: Article[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      articles.push(...r.value);
    }
  }
  articles.sort((a, b) => {
    const da = new Date(a.pubDate).getTime() || 0;
    const db = new Date(b.pubDate).getTime() || 0;
    return db - da;
  });

  // Deduplicate by link
  const seen = new Set<string>();
  const unique = articles.filter((a) => {
    if (!a.link || seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  }).slice(0, 25);

  return res
    .setHeader('Cache-Control', 'max-age=600')
    .json({ articles: unique, category, fetchedAt: Date.now() });
}
