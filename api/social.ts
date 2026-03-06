import type { VercelRequest, VercelResponse } from '@vercel/node';
import Parser from 'rss-parser';

export const config = { runtime: 'nodejs' };

// Breaking/wire-style feeds — short, frequent updates like a social timeline
const WIRE_FEEDS = [
  { name: 'Reuters', handle: '@Reuters', url: 'https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best' },
  { name: 'AP News', handle: '@AP', url: 'https://rsshub.app/apnews/topics/apf-topnews' },
  { name: 'BBC Breaking', handle: '@BBCBreaking', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'CNBC', handle: '@CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
  { name: 'NPR', handle: '@NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { name: 'Al Jazeera', handle: '@AJEnglish', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'The Verge', handle: '@verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'TechCrunch', handle: '@TechCrunch', url: 'https://techcrunch.com/feed/' },
];

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const parser = new Parser({ timeout: 5000 });

  const results = await Promise.allSettled(
    WIRE_FEEDS.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        return (parsed.items || []).slice(0, 5).map((item) => ({
          id: item.guid || item.link || '',
          author: feed.name,
          handle: feed.handle,
          text: (item.title || '').slice(0, 280),
          timestamp: item.pubDate || item.isoDate || '',
          link: item.link || '',
        }));
      } catch {
        return [];
      }
    }),
  );

  interface Post {
    id: string;
    author: string;
    handle: string;
    text: string;
    timestamp: string;
    link: string;
  }

  const posts: Post[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      posts.push(...r.value);
    }
  }

  // Sort by timestamp descending
  posts.sort((a, b) => {
    const da = new Date(a.timestamp).getTime() || 0;
    const db = new Date(b.timestamp).getTime() || 0;
    return db - da;
  });

  // Deduplicate by link
  const seen = new Set<string>();
  const unique = posts.filter((p) => {
    if (!p.link || seen.has(p.link)) return false;
    seen.add(p.link);
    return true;
  });

  return res
    .setHeader('Cache-Control', 'max-age=300')
    .json({ posts: unique.slice(0, 25) });
}
