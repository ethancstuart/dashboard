import { createElement } from '../utils/dom.ts';
import { fetchTickerData, fetchSparklines } from '../services/ticker.ts';
import { renderSparkline } from './chart.ts';
import type { TickerItem, TickerData, SparklineData } from '../types/index.ts';

const REFRESH_INTERVAL = 60000;

export function createTicker(): HTMLElement {
  const bar = createElement('div', { className: 'ticker-bar' });

  const statusBadge = createElement('div', { className: 'ticker-status' });
  const cardsContainer = createElement('div', { className: 'ticker-cards' });
  const delayNote = createElement('span', { className: 'ticker-delay' });

  bar.appendChild(statusBadge);
  bar.appendChild(cardsContainer);
  bar.appendChild(delayNote);

  let sparklineData: SparklineData = {};

  async function update() {
    try {
      const data = await fetchTickerData();
      renderTicker(data, sparklineData, statusBadge, cardsContainer, delayNote);

      // Fetch sparklines for equity/ETF symbols (not crypto/forex which use different symbol formats)
      const sparklineSymbols = data.items
        .filter((item) => item.type === 'index' && !item.symbol.includes(':'))
        .map((item) => item.symbol);

      if (sparklineSymbols.length > 0) {
        try {
          sparklineData = await fetchSparklines(sparklineSymbols);
          renderTicker(data, sparklineData, statusBadge, cardsContainer, delayNote);
        } catch {
          // Sparklines are optional, keep showing without them
        }
      }
    } catch {
      // Silently fail — keep showing last data
    }
  }

  void update();
  setInterval(() => void update(), REFRESH_INTERVAL);

  return bar;
}

function renderTicker(
  data: TickerData,
  sparklines: SparklineData,
  statusBadge: HTMLElement,
  cardsContainer: HTMLElement,
  delayNote: HTMLElement,
) {
  // Market status badge
  const { isOpen, session } = data.marketStatus;
  let statusText = 'CLOSED';
  let dotClass = 'ticker-dot-closed';
  if (session === 'pre-market' || session === 'pre') {
    statusText = 'PRE-MKT';
    dotClass = 'ticker-dot-pre';
  } else if (session === 'post-market' || session === 'post') {
    statusText = 'AFTER-HRS';
    dotClass = 'ticker-dot-pre';
  } else if (isOpen || session === 'regular') {
    statusText = 'OPEN';
    dotClass = 'ticker-dot-open';
  }

  statusBadge.textContent = '';
  const dot = createElement('span', { className: `ticker-dot ${dotClass}` });
  const label = createElement('span', { textContent: statusText });
  statusBadge.appendChild(dot);
  statusBadge.appendChild(label);

  // Delay indicator
  if (isOpen || session === 'regular') {
    delayNote.textContent = 'Delayed 15min';
    delayNote.style.display = '';
  } else {
    delayNote.style.display = 'none';
  }

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
