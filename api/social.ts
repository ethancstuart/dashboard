import type { VercelRequest, VercelResponse } from '@vercel/node';
import Parser from 'rss-parser';

export const config = { runtime: 'nodejs' };

const TWITTER_FEEDS = [
  { handle: 'Reuters', name: 'Reuters' },
  { handle: 'AP', name: 'AP News' },
  { handle: 'BBCBreaking', name: 'BBC Breaking' },
  { handle: 'business', name: 'Bloomberg Business' },
  { handle: 'WSJ', name: 'Wall Street Journal' },
  { handle: 'nikifriedman', name: 'Niki Friedman' },
];

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const parser = new Parser({ timeout: 5000 });

  const results = await Promise.allSettled(
    TWITTER_FEEDS.map(async (feed) => {
      // Use nitter/RSSHub instances as public Twitter RSS proxies
      const urls = [
        `https://rsshub.app/twitter/user/${feed.handle}`,
        `https://nitter.privacydev.net/${feed.handle}/rss`,
      ];

      for (const url of urls) {
        try {
          const parsed = await parser.parseURL(url);
          return (parsed.items || []).slice(0, 5).map((item) => ({
            id: item.guid || item.link || '',
            author: feed.name,
            handle: `@${feed.handle}`,
            text: (item.contentSnippet || item.title || '').slice(0, 280),
            timestamp: item.pubDate || item.isoDate || '',
            link: item.link || `https://x.com/${feed.handle}`,
          }));
        } catch {
          continue;
        }
      }
      return [];
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

  return res
    .setHeader('Cache-Control', 'max-age=300')
    .json({ posts: posts.slice(0, 20) });
}
