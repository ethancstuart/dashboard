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
