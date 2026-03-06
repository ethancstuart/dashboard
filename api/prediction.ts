import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs' };

interface PolymarketEvent {
  id: string;
  title: string;
  markets: {
    id: string;
    question: string;
    outcomePrices: string;
    volume: number;
    clobTokenIds: string;
  }[];
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const markets: { id: string; question: string; probability: number; volume: number; source: string; url: string }[] = [];

    // Fetch from Polymarket CLOB API (public, no key needed)
    try {
      const polyRes = await fetch(
        'https://gamma-api.polymarket.com/events?closed=false&order=volume24hr&ascending=false&limit=10',
        { signal: AbortSignal.timeout(5000) },
      );
      if (polyRes.ok) {
        const events: PolymarketEvent[] = await polyRes.json();
        for (const event of events) {
          for (const m of event.markets.slice(0, 1)) {
            let prob = 50;
            try {
              const prices = JSON.parse(m.outcomePrices || '[]');
              if (prices.length > 0) {
                prob = Math.round(parseFloat(prices[0]) * 100);
              }
            } catch { /* use default */ }

            markets.push({
              id: m.id,
              question: m.question || event.title,
              probability: prob,
              volume: m.volume || 0,
              source: 'polymarket',
              url: `https://polymarket.com/event/${event.id}`,
            });
          }
        }
      }
    } catch {
      // Polymarket failed, continue
    }

    // Fetch from Kalshi public API
    try {
      const kalshiRes = await fetch(
        'https://api.elections.kalshi.com/trade-api/v2/markets?limit=10&status=open',
        { signal: AbortSignal.timeout(5000) },
      );
      if (kalshiRes.ok) {
        const data = await kalshiRes.json();
        const kalshiMarkets = data.markets || [];
        for (const m of kalshiMarkets) {
          const prob = m.last_price ? Math.round(m.last_price * 100) : (m.yes_ask ? Math.round(m.yes_ask * 100) : 50);
          markets.push({
            id: m.ticker || m.id,
            question: m.title || m.subtitle || '',
            probability: prob,
            volume: m.volume || 0,
            source: 'kalshi',
            url: `https://kalshi.com/markets/${m.ticker}`,
          });
        }
      }
    } catch {
      // Kalshi failed, continue
    }

    // Sort by volume descending, take top items
    markets.sort((a, b) => b.volume - a.volume);

    return res
      .setHeader('Cache-Control', 'max-age=300')
      .json({ markets: markets.slice(0, 12) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(502).json({ error: message });
  }
}
