import type { VercelRequest, VercelResponse } from '@vercel/node';

const CORS_ORIGIN = 'https://nexuswatch.dev';
function setCors(res: VercelResponse): VercelResponse {
  return res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
}

export const config = { runtime: 'nodejs' };

// Module-level cache
let cachedData: MarketSnapshot | null = null;
let lastFetch = 0;
const CACHE_TTL = 60_000; // 1 minute

interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  category: 'index' | 'commodity' | 'fx' | 'crypto';
}

interface MarketSnapshot {
  quotes: MarketQuote[];
  timestamp: number;
}

// Symbols to track.
//
// EVERY EQUITY LINE HERE IS AN ETF, AND EACH IS NAMED AS ONE. They were
// previously labelled with the name of the thing they track — 'Crude Oil',
// 'Gold', 'S&P 500', 'US Dollar Index' — and the brief then printed the ETF's
// share price as the underlying's level. That produced published sentences
// like "energy flows are already priced tight at $130/barrel" (USO's share
// price) and "USD Index: $27.91" (UUP, against a DXY near 100). A markets
// reader stops at the first one of those and does not come back, and they are
// right to.
//
// USO in particular is a futures-roll product whose multi-day percentage
// change does not track spot crude under contango, so it cannot stand in for
// the barrel even directionally over a week.
//
// FXY WAS ALSO INVERTED. It holds yen, so FXY rising means a STRONGER yen,
// which is USD/JPY going DOWN. It was labelled 'USD/JPY', so every sentence
// derived from it had the direction backwards. Same for FXE and FXB, which
// hold EUR and GBP respectively.
const SYMBOLS = {
  indices: [
    { symbol: 'SPY', name: 'S&P 500 ETF (SPY)' },
    { symbol: 'QQQ', name: 'Nasdaq 100 ETF (QQQ)' },
    { symbol: 'DIA', name: 'Dow Jones ETF (DIA)' },
    { symbol: 'EWJ', name: 'Japan equities ETF (EWJ)' },
    { symbol: 'FXI', name: 'China large-cap ETF (FXI)' },
    { symbol: 'EWZ', name: 'Brazil equities ETF (EWZ)' },
  ],
  commodities: [
    { symbol: 'USO', name: 'Crude oil ETF (USO)' },
    { symbol: 'GLD', name: 'Gold ETF (GLD)' },
    { symbol: 'SLV', name: 'Silver ETF (SLV)' },
    { symbol: 'UNG', name: 'Natural gas ETF (UNG)' },
    { symbol: 'WEAT', name: 'Wheat ETF (WEAT)' },
    { symbol: 'CPER', name: 'Copper ETF (CPER)' },
  ],
  fx: [
    { symbol: 'UUP', name: 'Dollar index ETF (UUP)' },
    { symbol: 'FXE', name: 'Euro ETF (FXE, up = stronger EUR)' },
    { symbol: 'FXY', name: 'Yen ETF (FXY, up = stronger JPY)' },
    { symbol: 'FXB', name: 'Sterling ETF (FXB, up = stronger GBP)' },
  ],
  crypto: [
    { symbol: 'BTC-USD', name: 'Bitcoin' },
    { symbol: 'ETH-USD', name: 'Ethereum' },
  ],
};

async function fetchTwelveData(
  symbols: string[],
): Promise<Record<string, { price: number; change: number; pct: number }>> {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) return {};

  const results: Record<string, { price: number; change: number; pct: number }> = {};

  // TwelveData batch quote
  try {
    const symbolStr = symbols.join(',');
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=${symbolStr}&apikey=${apiKey}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return results;

    const data = (await res.json()) as Record<string, unknown>;

    // Handle single vs batch response
    if (typeof data.symbol === 'string') {
      // Single result
      results[data.symbol as string] = {
        price: parseFloat(String(data.close)) || 0,
        change: parseFloat(String(data.change)) || 0,
        pct: parseFloat(String(data.percent_change)) || 0,
      };
    } else {
      // Batch results
      for (const [sym, quote] of Object.entries(data)) {
        const q = quote as Record<string, string>;
        if (q?.close) {
          results[sym] = {
            price: parseFloat(q.close) || 0,
            change: parseFloat(q.change) || 0,
            pct: parseFloat(q.percent_change) || 0,
          };
        }
      }
    }
  } catch {
    // TwelveData failed
  }

  return results;
}

async function fetchFinnhub(
  symbols: string[],
): Promise<Record<string, { price: number; change: number; pct: number }>> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return {};

  const results: Record<string, { price: number; change: number; pct: number }> = {};

  // Finnhub requires individual requests
  const fetches = symbols.slice(0, 8).map(async (sym) => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${apiKey}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { c: number; d: number; dp: number };
      if (data.c > 0) {
        results[sym] = { price: data.c, change: data.d || 0, pct: data.dp || 0 };
      }
    } catch {
      // skip
    }
  });

  await Promise.all(fetches);
  return results;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (cachedData && Date.now() - lastFetch < CACHE_TTL) {
    return res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60').json(cachedData);
  }

  // Collect all symbols
  const allSymbols = [
    ...SYMBOLS.indices.map((s) => s.symbol),
    ...SYMBOLS.commodities.map((s) => s.symbol),
    ...SYMBOLS.fx.map((s) => s.symbol),
  ];
  const cryptoSymbols = SYMBOLS.crypto.map((s) => s.symbol);

  // Fetch from TwelveData (primary) and Finnhub (fallback for stocks)
  const [twelveData, finnhub] = await Promise.all([
    fetchTwelveData([...allSymbols, ...cryptoSymbols]),
    fetchFinnhub(SYMBOLS.indices.map((s) => s.symbol)),
  ]);

  // Merge — TwelveData takes priority, Finnhub fills gaps
  const merged = { ...finnhub, ...twelveData };

  const quotes: MarketQuote[] = [];

  const addQuotes = (items: { symbol: string; name: string }[], category: MarketQuote['category']) => {
    for (const item of items) {
      const data = merged[item.symbol];
      if (data) {
        quotes.push({
          symbol: item.symbol,
          name: item.name,
          price: data.price,
          change: data.change,
          changePct: data.pct,
          category,
        });
      }
    }
  };

  addQuotes(SYMBOLS.indices, 'index');
  addQuotes(SYMBOLS.commodities, 'commodity');
  addQuotes(SYMBOLS.fx, 'fx');
  addQuotes(SYMBOLS.crypto, 'crypto');

  const snapshot: MarketSnapshot = { quotes, timestamp: Date.now() };

  if (quotes.length > 0) {
    cachedData = snapshot;
    lastFetch = Date.now();
  }

  return res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60').json(snapshot);
}
