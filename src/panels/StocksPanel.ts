import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchStocks } from '../services/stocks.ts';
import * as storage from '../services/storage.ts';
import type { StocksData, StockQuote } from '../types/index.ts';

const WATCHLIST_KEY = 'dashview-watchlist';
const MAX_WATCHLIST = 10;
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];

const INDEX_LABELS: Record<string, string> = {
  SPY: 'S&P 500',
  DIA: 'Dow Jones',
  QQQ: 'Nasdaq',
};

export class StocksPanel extends Panel {
  private watchlist: string[];
  private data: StocksData | null = null;

  constructor() {
    super({
      id: 'stocks',
      title: 'Markets',
      enabled: true,
      refreshInterval: 300000,
    });

    this.watchlist = storage.get<string[]>(WATCHLIST_KEY, DEFAULT_WATCHLIST);
    this.container.classList.add('panel-wide');
  }

  async fetchData(): Promise<void> {
    this.data = await fetchStocks(this.watchlist);
    this.render(this.data);
  }

  render(data: unknown): void {
    const d = data as StocksData;
    if (!d) return;

    this.contentEl.textContent = '';

    const layout = createElement('div', { className: 'stocks-layout' });

    // Left: indices
    const indicesCol = createElement('div', { className: 'stocks-indices' });
    for (const q of d.indices) {
      indicesCol.appendChild(this.createIndexCard(q));
    }
    layout.appendChild(indicesCol);

    // Right: watchlist
    const watchCol = createElement('div', { className: 'stocks-watchlist' });
    for (const q of d.watchlist) {
      watchCol.appendChild(this.createWatchlistRow(q));
    }
    watchCol.appendChild(this.createAddRow());
    layout.appendChild(watchCol);

    this.contentEl.appendChild(layout);
  }

  private createIndexCard(q: StockQuote): HTMLElement {
    const card = createElement('div', { className: 'stocks-index-card' });
    const label = INDEX_LABELS[q.symbol] ?? q.symbol;

    const nameEl = createElement('div', {
      className: 'stocks-index-label',
      textContent: label,
    });

    const priceEl = createElement('div', {
      className: 'stocks-index-price',
      textContent: `$${q.price.toFixed(2)}`,
    });

    const changeClass = q.changePercent >= 0 ? 'stocks-positive' : 'stocks-negative';
    const sign = q.changePercent >= 0 ? '+' : '';
    const changeEl = createElement('div', {
      className: `stocks-index-change ${changeClass}`,
      textContent: `${sign}${q.changePercent.toFixed(2)}%`,
    });

    card.appendChild(nameEl);
    card.appendChild(priceEl);
    card.appendChild(changeEl);
    return card;
  }

  private createWatchlistRow(q: StockQuote): HTMLElement {
    const row = createElement('div', { className: 'stocks-row' });

    const symbolEl = createElement('span', {
      className: 'stocks-row-symbol',
      textContent: q.symbol,
    });

    const priceEl = createElement('span', {
      className: 'stocks-row-price',
      textContent: `$${q.price.toFixed(2)}`,
    });

    const changeClass = q.changePercent >= 0 ? 'stocks-positive' : 'stocks-negative';
    const sign = q.changePercent >= 0 ? '+' : '';
    const changeEl = createElement('span', {
      className: `stocks-row-change ${changeClass}`,
      textContent: `${sign}${q.changePercent.toFixed(2)}%`,
    });

    const removeBtn = createElement('button', {
      className: 'stocks-row-remove',
      textContent: '\u00d7',
    });
    removeBtn.addEventListener('click', () => {
      this.removeSymbol(q.symbol);
    });

    row.appendChild(symbolEl);
    row.appendChild(priceEl);
    row.appendChild(changeEl);
    row.appendChild(removeBtn);
    return row;
  }

  private createAddRow(): HTMLElement {
    const row = createElement('div', { className: 'stocks-add-row' });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'TICKER';
    input.className = 'stocks-add-input';
    input.maxLength = 5;

    const btn = createElement('button', {
      className: 'settings-btn settings-btn-primary stocks-add-btn',
      textContent: '+ Add',
    });

    const add = () => {
      const symbol = input.value.trim().toUpperCase();
      if (!symbol) return;
      if (this.watchlist.length >= MAX_WATCHLIST) return;
      if (this.watchlist.includes(symbol)) return;
      this.watchlist.push(symbol);
      storage.set(WATCHLIST_KEY, this.watchlist);
      input.value = '';
      void this.fetchData();
    };

    btn.addEventListener('click', add);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
    });

    row.appendChild(input);
    row.appendChild(btn);
    return row;
  }

  private removeSymbol(symbol: string): void {
    this.watchlist = this.watchlist.filter((s) => s !== symbol);
    storage.set(WATCHLIST_KEY, this.watchlist);
    if (this.data) {
      this.data.watchlist = this.data.watchlist.filter((q) => q.symbol !== symbol);
      this.render(this.data);
    }
  }
}
