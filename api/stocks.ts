import type { VercelRequest, VercelResponse } from '@vercel/node';

interface FinnhubQuote {
  c: number;  // current price
  d: number;  // change
  dp: number; // change percent
  h: number;  // high
  l: number;  // low
  o: number;  // open
  pc: number; // previous close
}

export const config = { runtime: 'nodejs' };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Finnhub API key not configured' });
  }

  const action = req.query.action as string | undefined;
  if (action === 'search') {
    return handleSearch(req, res, apiKey);
  }

  const symbols = (req.query.symbols as string | undefined)?.split(',').filter(Boolean);
  if (!symbols || symbols.length === 0) {
    return res.status(400).json({ error: 'Missing symbols parameter' });
  }

  try {
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const response = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
        );
        if (!response.ok) throw new Error(`Finnhub error for ${symbol}`);
        const data: FinnhubQuote = await response.json();

        // Filter invalid symbols (c=0 means no data)
        if (data.c === 0 || data.d === null) return null;

        return {
          symbol,
          price: data.c,
          change: data.d,
          changePercent: data.dp,
          high: data.h,
          low: data.l,
          open: data.o,
          prevClose: data.pc,
        };
      }),
    );

    const quotes = results
      .filter((r): r is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof Object>>>> =>
        r.status === 'fulfilled' && r.value !== null,
      )
      .map((r) => r.value);

    return res
      .setHeader('Cache-Control', 'max-age=60')
      .json({ quotes, timestamp: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(502).json({ error: message });
  }
}

async function handleSearch(req: VercelRequest, res: VercelResponse, apiKey: string) {
  const q = req.query.q as string | undefined;
  if (!q) {
    return res.status(400).json({ error: 'Missing q parameter' });
  }

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${apiKey}`,
    );
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Search request failed' });
    }

    const data = await response.json();
    const results = (data.result ?? [])
      .filter((r: { type: string }) => r.type === 'Common Stock')
      .slice(0, 8)
      .map((r: { symbol: string; description: string; type: string }) => ({
        symbol: r.symbol,
        description: r.description,
        type: r.type,
      }));

    return res.setHeader('Cache-Control', 'max-age=300').json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(502).json({ error: message });
  }
}
