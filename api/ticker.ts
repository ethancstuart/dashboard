import type { VercelRequest, VercelResponse } from '@vercel/node';

const CORS_ORIGIN = 'https://dashpulse.app';
function setCors(res: VercelResponse): VercelResponse {
  return res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
}

export const config = { runtime: 'nodejs' };

interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

// ETFs that track major indices (free tier compatible)
const INDICES = [
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'NASDAQ' },
  { symbol: 'DIA', name: 'DOW' },
  { symbol: 'EWU', name: 'FTSE 100' },
  { symbol: 'EWJ', name: 'Nikkei 225' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Ticker service unavailable' });
  }

  try {
    const symbols = INDICES.map(i => i.symbol).join(',');
    const url = `https://api.twelvedata.com/quote?symbol=${symbols}&apikey=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    const quotes: IndexQuote[] = [];

    for (const idx of INDICES) {
      const quote = data[idx.symbol] || data;
      if (quote && quote.close && !quote.code) {
        const price = parseFloat(quote.close);
        const change = parseFloat(quote.change || '0');
        const changePercent = parseFloat(quote.percent_change || '0');

        quotes.push({
          symbol: idx.symbol,
          name: idx.name,
          price,
          change,
          changePercent,
        });
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ quotes });
  } catch (err) {
    console.error('Ticker API error:', err);
    return res.status(500).json({ error: 'Failed to fetch index quotes' });
  }
}
