import { createElement } from '../utils/dom.ts';
import { fetchTickerData, fetchSparklines } from '../services/ticker.ts';
import { renderSparkline } from './chart.ts';
import type { TickerItem, TickerData, SparklineData } from '../types/index.ts';

const REFRESH_INTERVAL = 60000;

export function createTicker(): HTMLElement & { destroy(): void } {
  const bar = createElement('div', { className: 'ticker-bar' }) as unknown as HTMLElement & { destroy(): void };

  const cardsContainer = createElement('div', { className: 'ticker-cards' });

  bar.appendChild(cardsContainer);

  let sparklineData: SparklineData = {};

  async function update() {
    try {
      const data = await fetchTickerData();
      renderTicker(data, sparklineData, cardsContainer);

      // Fetch sparklines for equity/ETF symbols (not crypto/forex which use different symbol formats)
      const sparklineSymbols = data.items
        .filter((item) => item.type === 'index' && !item.symbol.includes(':'))
        .map((item) => item.symbol);

      if (sparklineSymbols.length > 0) {
        try {
          sparklineData = await fetchSparklines(sparklineSymbols);
          renderTicker(data, sparklineData, cardsContainer);
        } catch {
          // Sparklines are optional, keep showing without them
        }
      }
    } catch {
      // Silently fail — keep showing last data
    }
  }

  void update();
  const intervalId = setInterval(() => void update(), REFRESH_INTERVAL);

  bar.destroy = () => {
    clearInterval(intervalId);
  };

  // Auto-cleanup when ticker is removed from DOM (SPA navigation)
  requestAnimationFrame(() => {
    if (bar.parentNode) {
      const observer = new MutationObserver(() => {
        if (!bar.isConnected) {
          clearInterval(intervalId);
          observer.disconnect();
        }
      });
      observer.observe(bar.parentNode, { childList: true });
    }
  });

  return bar;
}

function renderTicker(
  data: TickerData,
  sparklines: SparklineData,
  cardsContainer: HTMLElement,
) {
  // Build static market cards
  cardsContainer.textContent = '';
  for (const item of data.items) {
    cardsContainer.appendChild(createTickerCard(item, sparklines[item.symbol]));
  }
}

function createTickerCard(item: TickerItem, sparklinePrices?: number[]): HTMLElement {
  const card = createElement('div', { className: 'ticker-card' });

  const info = createElement('div', { className: 'ticker-card-info' });

  const labelEl = createElement('span', {
    className: 'ticker-card-label',
    textContent: item.label,
  });

  let priceStr: string;
  if (item.type === 'forex') {
    priceStr = item.price.toFixed(item.symbol.includes('JPY') ? 2 : 4);
  } else if (item.type === 'crypto') {
    priceStr = `$${item.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  } else {
    priceStr = `$${item.price.toFixed(2)}`;
  }

  const priceEl = createElement('span', {
    className: 'ticker-card-price',
    textContent: priceStr,
  });

  info.appendChild(labelEl);
  info.appendChild(priceEl);

  const changeClass = item.changePercent >= 0 ? 'ticker-positive' : 'ticker-negative';
  const sign = item.changePercent >= 0 ? '+' : '';
  const changeEl = createElement('span', {
    className: `ticker-card-change ${changeClass}`,
    textContent: item.change !== 0 || item.changePercent !== 0
      ? `${sign}${item.changePercent.toFixed(2)}%`
      : '',
  });

  card.appendChild(info);
  card.appendChild(changeEl);

  // Sparkline canvas
  if (sparklinePrices && sparklinePrices.length >= 2) {
    const canvas = document.createElement('canvas');
    canvas.className = 'ticker-sparkline';
    card.appendChild(canvas);
    requestAnimationFrame(() => {
      renderSparkline(canvas, sparklinePrices, { width: 60, height: 20 });
    });
  }

  return card;
}
