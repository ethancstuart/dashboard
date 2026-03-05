import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchStocks, searchSymbols } from '../services/stocks.ts';
import * as storage from '../services/storage.ts';
import type { StocksData, StockQuote, SymbolSearchResult } from '../types/index.ts';

const WATCHLIST_KEY = 'dashview-watchlist';
const FAVORITES_KEY = 'dashview-favorites';
const MAX_WATCHLIST = 10;
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];

const INDEX_LABELS: Record<string, string> = {
  SPY: 'S&P 500',
  DIA: 'Dow Jones',
  QQQ: 'Nasdaq',
};

export class StocksPanel extends Panel {
  private watchlist: string[];
  private favorites: Set<string>;
  private data: StocksData | null = null;
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({
      id: 'stocks',
      title: 'Markets',
      enabled: true,
      refreshInterval: 300000,
    });

    this.watchlist = storage.get<string[]>(WATCHLIST_KEY, DEFAULT_WATCHLIST);
    this.favorites = new Set(storage.get<string[]>(FAVORITES_KEY, DEFAULT_WATCHLIST));
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
    watchCol.appendChild(this.createSearchRow());
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
    const isFav = this.favorites.has(q.symbol);

    const starBtn = createElement('button', {
      className: `stocks-row-star ${isFav ? 'stocks-row-star-active' : ''}`,
      textContent: isFav ? '\u2605' : '\u2606',
    });
    starBtn.addEventListener('click', () => {
      this.toggleFavorite(q.symbol);
    });

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

    row.appendChild(starBtn);
    row.appendChild(symbolEl);
    row.appendChild(priceEl);
    row.appendChild(changeEl);
    row.appendChild(removeBtn);
    return row;
  }

  private createSearchRow(): HTMLElement {
    const wrapper = createElement('div', { className: 'stocks-search-wrapper' });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search ticker or company...';
    input.className = 'stocks-search-input';

    const dropdown = createElement('div', { className: 'stocks-search-dropdown' });
    dropdown.style.display = 'none';

    input.addEventListener('input', () => {
      const query = input.value.trim();
      if (this.searchTimeout) clearTimeout(this.searchTimeout);

      if (query.length < 1) {
        dropdown.style.display = 'none';
        return;
      }

      this.searchTimeout = setTimeout(() => {
        void this.performSearch(query, dropdown);
      }, 300);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        dropdown.style.display = 'none';
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target as Node)) {
        dropdown.style.display = 'none';
      }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);
    return wrapper;
  }

  private async performSearch(query: string, dropdown: HTMLElement): Promise<void> {
    try {
      const results = await searchSymbols(query);
      dropdown.textContent = '';

      if (results.length === 0) {
        const empty = createElement('div', {
          className: 'stocks-search-empty',
          textContent: 'No results found',
        });
        dropdown.appendChild(empty);
      } else {
        for (const r of results) {
          dropdown.appendChild(this.createSearchResult(r, dropdown));
        }
      }

      dropdown.style.display = '';
    } catch {
      dropdown.style.display = 'none';
    }
  }

  private createSearchResult(r: SymbolSearchResult, dropdown: HTMLElement): HTMLElement {
    const row = createElement('div', { className: 'stocks-search-result' });
    const already = this.watchlist.includes(r.symbol);

    const symbolEl = createElement('span', {
      className: 'stocks-search-result-symbol',
      textContent: r.symbol,
    });

    const nameEl = createElement('span', {
      className: 'stocks-search-result-name',
      textContent: r.description,
    });

    const infoCol = createElement('div', { className: 'stocks-search-result-info' });
    infoCol.appendChild(symbolEl);
    infoCol.appendChild(nameEl);

    if (already) {
      const badge = createElement('span', {
        className: 'stocks-search-result-added',
        textContent: 'Added',
      });
      row.appendChild(infoCol);
      row.appendChild(badge);
    } else {
      const addBtn = createElement('button', {
        className: 'stocks-search-result-add',
        textContent: '+ Add',
      });
      addBtn.addEventListener('click', () => {
        this.addSymbol(r.symbol);
        dropdown.style.display = 'none';
        const input = this.contentEl.querySelector('.stocks-search-input') as HTMLInputElement;
        if (input) input.value = '';
      });
      row.appendChild(infoCol);
      row.appendChild(addBtn);
    }

    return row;
  }

  private addSymbol(symbol: string): void {
    if (this.watchlist.length >= MAX_WATCHLIST) return;
    if (this.watchlist.includes(symbol)) return;
    this.watchlist.push(symbol);
    storage.set(WATCHLIST_KEY, this.watchlist);
    void this.fetchData();
  }

  private removeSymbol(symbol: string): void {
    this.watchlist = this.watchlist.filter((s) => s !== symbol);
    this.favorites.delete(symbol);
    storage.set(WATCHLIST_KEY, this.watchlist);
    storage.set(FAVORITES_KEY, [...this.favorites]);
    if (this.data) {
      this.data.watchlist = this.data.watchlist.filter((q) => q.symbol !== symbol);
      this.render(this.data);
    }
  }

  private toggleFavorite(symbol: string): void {
    if (this.favorites.has(symbol)) {
      this.favorites.delete(symbol);
    } else {
      this.favorites.add(symbol);
    }
    storage.set(FAVORITES_KEY, [...this.favorites]);
    if (this.data) {
      this.render(this.data);
    }
  }
}
