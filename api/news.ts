import type { VercelRequest, VercelResponse } from '@vercel/node';
import Parser from 'rss-parser';

export const config = { runtime: 'nodejs' };

function isPrivateHost(hostname: string): boolean {
  // Block cloud metadata endpoints
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return true;
  // Block localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') return true;
  // Block private IP ranges
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  // Block link-local
  if (/^169\.254\./.test(hostname)) return true;
  return false;
}

interface FeedSource {
  name: string;
  url: string;
  country: string;
  lat: number;
  lon: number;
}

const FEEDS: Record<string, FeedSource[]> = {
  us: [
    { name: 'AP News', url: 'https://rsshub.app/apnews/topics/apf-topnews', country: 'US', lat: 40.76, lon: -73.98 },
    { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', country: 'US', lat: 38.89, lon: -77.01 },
    { name: 'CNN', url: 'https://rss.cnn.com/rss/cnn_topstories.rss', country: 'US', lat: 33.75, lon: -84.39 },
    { name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', country: 'US', lat: 40.76, lon: -73.98 },
    { name: 'USA Today', url: 'https://rssfeeds.usatoday.com/usatoday-NewsTopStories', country: 'US', lat: 38.89, lon: -77.01 },
    { name: 'Washington Post', url: 'https://feeds.washingtonpost.com/rss/national', country: 'US', lat: 38.89, lon: -77.01 },
    { name: 'PBS NewsHour', url: 'https://pbs.org/newshour/feeds/rss/headlines', country: 'US', lat: 38.89, lon: -77.01 },
  ],
  world: [
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', country: 'GB', lat: 51.51, lon: -0.13 },
    { name: 'AP News', url: 'https://rsshub.app/apnews/topics/apf-topnews', country: 'US', lat: 40.76, lon: -73.98 },
    { name: 'Reuters', url: 'https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best', country: 'GB', lat: 51.51, lon: -0.13 },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', country: 'QA', lat: 25.29, lon: 51.53 },
    { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', country: 'US', lat: 38.89, lon: -77.01 },
    { name: 'NHK World', url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/', country: 'JP', lat: 35.68, lon: 139.69 },
    { name: 'SCMP', url: 'https://www.scmp.com/rss/91/feed', country: 'HK', lat: 22.28, lon: 114.16 },
    { name: 'The Hindu', url: 'https://www.thehindu.com/news/international/feeder/default.rss', country: 'IN', lat: 13.08, lon: 80.27 },
    { name: 'France24', url: 'https://www.france24.com/en/rss', country: 'FR', lat: 48.86, lon: 2.35 },
    { name: 'DW', url: 'https://rss.dw.com/xml/rss-en-all', country: 'DE', lat: 50.72, lon: 7.09 },
    { name: 'ABC Australia', url: 'https://www.abc.net.au/news/feed/2942460/rss.xml', country: 'AU', lat: -33.87, lon: 151.21 },
  ],
  tech: [
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', country: 'US', lat: 37.77, lon: -122.42 },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', country: 'US', lat: 40.74, lon: -73.99 },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', country: 'US', lat: 37.77, lon: -122.42 },
    { name: 'Wired', url: 'https://www.wired.com/feed/rss', country: 'US', lat: 37.77, lon: -122.42 },
    { name: 'Hacker News', url: 'https://hnrss.org/frontpage', country: 'US', lat: 37.77, lon: -122.42 },
  ],
  markets: [
    { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', country: 'US', lat: 40.72, lon: -74.0 },
    { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', country: 'US', lat: 40.71, lon: -74.01 },
    { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss', country: 'US', lat: 40.76, lon: -73.98 },
    { name: 'WSJ Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', country: 'US', lat: 40.71, lon: -74.01 },
    { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', country: 'US', lat: 37.42, lon: -122.08 },
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

const VALID_CATEGORIES = new Set([...Object.keys(FEEDS), 'custom']);
const GLOBE_CATEGORIES = ['world', 'us', 'tech', 'science', 'markets'];

// Extract capitalized place names from article titles
function extractLocation(title: string): string | null {
  // Match sequences of capitalized words that look like place names
  // Excludes common non-place capitalized words
  const STOP_WORDS = new Set([
    'The', 'A', 'An', 'In', 'On', 'At', 'To', 'For', 'Of', 'And', 'But', 'Or',
    'Is', 'Are', 'Was', 'Were', 'Has', 'Have', 'Had', 'Will', 'Can', 'May',
    'New', 'How', 'Why', 'What', 'Who', 'When', 'Where', 'Which',
    'First', 'Last', 'After', 'Before', 'Against', 'About', 'Over', 'Under',
    'Says', 'Said', 'Report', 'Reports', 'Update', 'Breaking',
    'CEO', 'Trump', 'Biden', 'Pope', 'King', 'Queen', 'President', 'PM',
    'AI', 'GDP', 'FDA', 'FBI', 'CIA', 'NATO', 'UN', 'EU', 'IMF', 'WHO',
  ]);

  // Pattern: "... in/from/hits/near PLACE" or "PLACE ..." at start
  const prepositionPattern = /(?:in|from|hits|near|across|throughout)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;
  let match: RegExpExecArray | null;
  while ((match = prepositionPattern.exec(title)) !== null) {
    const candidate = match[1];
    const words = candidate.split(/\s+/);
    if (words.length <= 3 && !words.every(w => STOP_WORDS.has(w))) {
      return candidate;
    }
  }

  // Pattern: city names with known suffixes
  const cityPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
  while ((match = cityPattern.exec(title)) !== null) {
    const candidate = match[1];
    if (!STOP_WORDS.has(candidate) && candidate.length > 2) {
      return candidate;
    }
  }

  return null;
}

// In-memory geocode cache (per invocation — Vercel KV used if available)
const geocodeCache = new Map<string, { lat: number; lon: number } | null>();

async function geocodeLocation(location: string): Promise<{ lat: number; lon: number } | null> {
  const key = location.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  // Try Vercel KV first
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const kvKey = `news-geocode:${key}`;

  if (kvUrl && kvToken) {
    try {
      const kvRes = await fetch(`${kvUrl}/get/${encodeURIComponent(kvKey)}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      if (kvRes.ok) {
        const kvData = await kvRes.json();
        if (kvData.result) {
          const cached = JSON.parse(kvData.result) as { lat: number; lon: number };
          geocodeCache.set(key, cached);
          return cached;
        }
      }
    } catch { /* KV unavailable, continue */ }
  }

  // Call OpenWeatherMap geocoding API
  const owmKey = process.env.OPENWEATHER_API_KEY;
  if (!owmKey) {
    geocodeCache.set(key, null);
    return null;
  }

  try {
    const res = await fetch(
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${owmKey}`,
    );
    if (!res.ok) {
      geocodeCache.set(key, null);
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      geocodeCache.set(key, null);
      return null;
    }

    const result = { lat: data[0].lat, lon: data[0].lon };
    geocodeCache.set(key, result);

    // Store in KV with 7-day TTL
    if (kvUrl && kvToken) {
      try {
        await fetch(`${kvUrl}/set/${encodeURIComponent(kvKey)}/${encodeURIComponent(JSON.stringify(result))}/ex/604800`, {
          headers: { Authorization: `Bearer ${kvToken}` },
        });
      } catch { /* best-effort */ }
    }

    return result;
  } catch {
    geocodeCache.set(key, null);
    return null;
  }
}

interface Article {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description: string;
  sourceCountry: string;
  lat: number;
  lon: number;
  category?: string;
}

async function fetchCategory(
  category: string,
  parser: Parser,
  customSources?: FeedSource[],
): Promise<Article[]> {
  const sources = FEEDS[category];
  const allSources = category === 'custom' ? (customSources || []) : [...(sources || []), ...(customSources || [])];

  if (allSources.length === 0) return [];

  const results = await Promise.allSettled(
    allSources.map(async (source) => {
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
        category,
      }));
    }),
  );

  const articles: Article[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      articles.push(...r.value);
    }
  }
  return articles;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Multi-category mode for globe
  const categoriesParam = req.query.categories as string | undefined;
  if (categoriesParam) {
    const requested = categoriesParam.split(',').filter(c => GLOBE_CATEGORIES.includes(c));
    if (requested.length === 0) {
      return res.status(400).json({ error: 'No valid categories' });
    }

    const parser = new Parser({ timeout: 5000 });

    // Fetch all categories in parallel
    const categoryResults = await Promise.allSettled(
      requested.map(cat => fetchCategory(cat, parser)),
    );

    let allArticles: Article[] = [];
    for (const r of categoryResults) {
      if (r.status === 'fulfilled') {
        allArticles.push(...r.value);
      }
    }

    // Sort by date
    allArticles.sort((a, b) => {
      const da = new Date(a.pubDate).getTime() || 0;
      const db = new Date(b.pubDate).getTime() || 0;
      return db - da;
    });

    // Deduplicate by link
    const seen = new Set<string>();
    allArticles = allArticles.filter((a) => {
      if (!a.link || seen.has(a.link)) return false;
      seen.add(a.link);
      return true;
    }).slice(0, 100);

    // Geocode articles — extract location from title and override coords
    const geocodePromises = allArticles.map(async (article) => {
      const location = extractLocation(article.title);
      if (location) {
        const coords = await geocodeLocation(location);
        if (coords) {
          article.lat = coords.lat;
          article.lon = coords.lon;
        }
      }
      return article;
    });

    await Promise.allSettled(geocodePromises);

    return res
      .setHeader('Cache-Control', 'max-age=600')
      .json({ articles: allArticles, categories: requested, fetchedAt: Date.now() });
  }

  // Single-category mode (existing behavior)
  const category = (req.query.category as string | undefined) || 'world';
  if (!VALID_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  // Handle custom feeds
  let customSources: FeedSource[] = [];
  const customUrlsParam = req.query.customUrls as string | undefined;
  if (customUrlsParam) {
    try {
      const parsed = JSON.parse(customUrlsParam) as { url: string; name: string; lat?: number; lon?: number }[];
      customSources = parsed.slice(0, 10)
        .filter(f => { try { return !isPrivateHost(new URL(f.url).hostname); } catch { return false; } })
        .map(f => ({
          name: f.name || 'Custom',
          url: f.url,
          country: '',
          lat: f.lat || 0,
          lon: f.lon || 0,
        }));
    } catch { /* ignore invalid JSON */ }
  }

  const parser = new Parser({ timeout: 5000 });
  const articles = await fetchCategory(category, parser, customSources);

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
