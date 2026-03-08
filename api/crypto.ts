import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs' };

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  sparkline_in_7d?: { price: number[] };
  market_cap_rank: number;
  high_24h: number;
  low_24h: number;
  ath: number;
  ath_change_percentage: number;
}

const TOP_COINS = [
  'bitcoin', 'ethereum', 'solana', 'xrp', 'cardano',
  'dogecoin', 'avalanche-2', 'chainlink', 'polkadot', 'polygon',
];

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const ids = TOP_COINS.join(',');
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`,
    );
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Crypto data service error' });
    }

    const data = (await response.json()) as CoinGeckoMarket[];

    const coins = data.map((coin) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h ?? 0,
      marketCap: coin.market_cap,
      volume: coin.total_volume,
      sparkline: coin.sparkline_in_7d?.price
        ? sampleSparkline(coin.sparkline_in_7d.price, 24)
        : [],
      rank: coin.market_cap_rank,
      high24h: coin.high_24h,
      low24h: coin.low_24h,
      ath: coin.ath,
      athChange: coin.ath_change_percentage,
    }));

    return res
      .setHeader('Cache-Control', 'max-age=120')
      .json({ coins, fetchedAt: Date.now() });
  } catch (err) {
    console.error('Crypto API error:', err instanceof Error ? err.message : err);
    return res.status(502).json({ error: 'Crypto data service error' });
  }
}

function sampleSparkline(prices: number[], points: number): number[] {
  if (prices.length <= points) return prices;
  const step = Math.floor(prices.length / points);
  const sampled: number[] = [];
  for (let i = 0; i < points; i++) {
    sampled.push(prices[i * step]);
  }
  return sampled;
}
