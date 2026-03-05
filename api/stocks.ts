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
  if (action === 'ticker') {
    return handleTicker(res, apiKey);
  }
  if (action === 'candle') {
    return handleCandle(req, res, apiKey);
  }
  if (action === 'news') {
    return handleCompanyNews(req, res, apiKey);
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

async function handleTicker(res: VercelResponse, apiKey: string) {
  const TICKER_SYMBOLS = [
    { symbol: 'SPY', label: 'S&P 500', type: 'index' as const },
    { symbol: 'DIA', label: 'Dow Jones', type: 'index' as const },
    { symbol: 'QQQ', label: 'Nasdaq', type: 'index' as const },
    { symbol: 'VIXY', label: 'VIX', type: 'index' as const },
    { symbol: 'BINANCE:BTCUSDT', label: 'BTC', type: 'crypto' as const },
    { symbol: 'BINANCE:ETHUSDT', label: 'ETH', type: 'crypto' as const },
  ];

  const FOREX_PAIRS = ['EUR', 'GBP', 'JPY'];

  try {
    const [quoteResults, forexResult, statusResult] = await Promise.allSettled([
      Promise.allSettled(
        TICKER_SYMBOLS.map(async (s) => {
          const response = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s.symbol)}&token=${apiKey}`,
          );
          if (!response.ok) return null;
          const data: FinnhubQuote = await response.json();
          if (data.c === 0 || data.d === null) return null;
          return {
            symbol: s.symbol,
            label: s.label,
            price: data.c,
            change: data.d,
            changePercent: data.dp,
            type: s.type,
          };
        }),
      ),
      fetch(`https://finnhub.io/api/v1/forex/rates?base=USD&token=${apiKey}`).then(r => r.json()),
      fetch(`https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${apiKey}`).then(r => r.json()),
    ]);

    const items: Array<{ symbol: string; label: string; price: number; change: number; changePercent: number; type: string }> = [];

    // Process quotes
    if (quoteResults.status === 'fulfilled') {
      for (const r of quoteResults.value) {
        if (r.status === 'fulfilled' && r.value) {
          items.push(r.value);
        }
      }
    }

    // Process forex
    if (forexResult.status === 'fulfilled' && forexResult.value?.quote) {
      const rates = forexResult.value.quote;
      for (const pair of FOREX_PAIRS) {
        const rate = rates[pair];
        if (rate) {
          // For EUR, GBP: show as EUR/USD = 1/rate (Finnhub gives USD-based rates)
          // For JPY: show as USD/JPY = rate
          if (pair === 'JPY') {
            items.push({
              symbol: 'USD/JPY',
              label: 'USD/JPY',
              price: Math.round(rate * 100) / 100,
              change: 0,
              changePercent: 0,
              type: 'forex',
            });
          } else {
            items.push({
              symbol: `${pair}/USD`,
              label: `${pair}/USD`,
              price: Math.round((1 / rate) * 10000) / 10000,
              change: 0,
              changePercent: 0,
              type: 'forex',
            });
          }
        }
      }
    }

    // Process market status
    let marketStatus = { isOpen: false, session: 'closed' };
    if (statusResult.status === 'fulfilled' && statusResult.value) {
      const s = statusResult.value;
      const isOpen = s.isOpen === true;
      let session = 'closed';
      if (s.session) {
        session = s.session;
      } else if (isOpen) {
        session = 'regular';
      }
      marketStatus = { isOpen, session };
    }

    return res
      .setHeader('Cache-Control', 'max-age=30')
      .json({ items, marketStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(502).json({ error: message });
  }
}

async function handleCandle(req: VercelRequest, res: VercelResponse, apiKey: string) {
  const symbol = req.query.symbol as string | undefined;
  const resolution = req.query.resolution as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  if (!symbol || !resolution || !from || !to) {
    return res.status(400).json({ error: 'Missing required parameters: symbol, resolution, from, to' });
  }

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}&from=${from}&to=${to}&token=${apiKey}`,
    );
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Candle request failed' });
    }

    const data = await response.json();
    if (data.s === 'no_data') {
      return res.json({ candles: { t: [], c: [], h: [], l: [], o: [], v: [] } });
    }

    return res
      .setHeader('Cache-Control', 'max-age=300')
      .json({
        candles: {
          t: data.t || [],
          c: data.c || [],
          h: data.h || [],
          l: data.l || [],
          o: data.o || [],
          v: data.v || [],
        },
      });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(502).json({ error: message });
  }
}

async function handleCompanyNews(req: VercelRequest, res: VercelResponse, apiKey: string) {
  const symbol = req.query.symbol as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  if (!symbol || !from || !to) {
    return res.status(400).json({ error: 'Missing required parameters: symbol, from, to' });
  }

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`,
    );
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Company news request failed' });
    }

    const data = await response.json();
    const news = (Array.isArray(data) ? data : []).slice(0, 10).map((item: {
      headline: string;
      summary: string;
      url: string;
      source: string;
      datetime: number;
      image: string;
    }) => ({
      headline: item.headline || '',
      summary: item.summary || '',
      url: item.url || '',
      source: item.source || '',
      datetime: item.datetime || 0,
      image: item.image || '',
    }));

    return res
      .setHeader('Cache-Control', 'max-age=600')
      .json({ news });
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
