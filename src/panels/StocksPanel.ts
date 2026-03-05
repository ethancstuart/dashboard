import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchStocks, searchSymbols } from '../services/stocks.ts';
import * as storage from '../services/storage.ts';
import type { StocksData, StockQuote, SymbolSearchResult } from '../types/index.ts';

const WATCHLIST_KEY = 'dashview-watchlist';
const FAVORITES_KEY = 'dashview-favorites';
const NAMES_KEY = 'dashview-stock-names';
const MAX_WATCHLIST = 10;
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];

const DEFAULT_NAMES: Record<string, string> = {
  AAPL: 'Apple Inc',
  MSFT: 'Microsoft Corp',
  GOOGL: 'Alphabet Inc',
  AMZN: 'Amazon.com Inc',
  TSLA: 'Tesla Inc',
  META: 'Meta Platforms',
  NVDA: 'NVIDIA Corp',
  NFLX: 'Netflix Inc',
  JPM: 'JPMorgan Chase',
  V: 'Visa Inc',
};

export class StocksPanel extends Panel {
  private watchlist: string[];
  private favorites: Set<string>;
  private nameCache: Record<string, string>;
  private data: StocksData | null = null;
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private dragFromIndex: number = -1;
  private dragOverIndex: number = -1;
  private gripActive: boolean = false;

  constructor() {
    super({
      id: 'stocks',
      title: 'Markets',
      enabled: true,
      refreshInterval: 300000,
    });

    this.watchlist = storage.get<string[]>(WATCHLIST_KEY, DEFAULT_WATCHLIST);
    this.favorites = new Set(storage.get<string[]>(FAVORITES_KEY, DEFAULT_WATCHLIST));
    this.nameCache = { ...DEFAULT_NAMES, ...storage.get<Record<string, string>>(NAMES_KEY, {}) };
  }

  async fetchData(): Promise<void> {
    this.data = await fetchStocks(this.watchlist);
    this.render(this.data);
  }

  render(data: unknown): void {
    const d = data as StocksData;
    if (!d) return;

    this.contentEl.textContent = '';

    const watchHeader = createElement('div', { className: 'stocks-watchlist-header' });
    const watchTitle = createElement('span', {
      className: 'stocks-section-header',
      textContent: 'Watchlist',
    });
    const watchContext = createElement('span', {
      className: 'stocks-column-label',
      textContent: 'Day Change',
    });
    watchHeader.appendChild(watchTitle);
    watchHeader.appendChild(watchContext);
    this.contentEl.appendChild(watchHeader);

    for (let i = 0; i < d.watchlist.length; i++) {
      this.contentEl.appendChild(this.createWatchlistRow(d.watchlist[i], i));
    }
    this.contentEl.appendChild(this.createSearchRow());

    const updated = createElement('div', {
      className: 'stocks-updated',
      textContent: `Updated ${this.formatTime(d.timestamp)}`,
    });
    this.contentEl.appendChild(updated);
  }

  private formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  private createWatchlistRow(q: StockQuote, index: number): HTMLElement {
    const row = createElement('div', { className: 'stocks-row' });
    row.setAttribute('draggable', 'true');

    // Grip handle — drag initiator
    const grip = createElement('span', {
      className: 'stocks-row-grip',
      textContent: '\u2630',
    });
    grip.addEventListener('mousedown', () => { this.gripActive = true; });

    row.addEventListener('dragstart', (e) => {
      if (!this.gripActive) {
        e.preventDefault();
        return;
      }
      this.dragFromIndex = index;
      row.classList.add('stocks-row-dragging');
      (e as DragEvent).dataTransfer!.effectAllowed = 'move';
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.dragFromIndex === -1) return;
      this.clearDragIndicators();
      this.dragOverIndex = index;
      if (index < this.dragFromIndex) {
        row.classList.add('stocks-row-drag-above');
      } else if (index > this.dragFromIndex) {
        row.classList.add('stocks-row-drag-below');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('stocks-row-drag-above', 'stocks-row-drag-below');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (this.dragFromIndex !== -1 && this.dragFromIndex !== index) {
        this.reorderWatchlist(this.dragFromIndex, index);
      }
      this.cleanupDragState();
    });

    row.addEventListener('dragend', () => {
      this.cleanupDragState();
    });

    const isFav = this.favorites.has(q.symbol);

    const starBtn = createElement('button', {
      className: `stocks-row-star ${isFav ? 'stocks-row-star-active' : ''}`,
      textContent: isFav ? '\u2605' : '\u2606',
    });
    starBtn.addEventListener('click', () => {
      this.toggleFavorite(q.symbol);
    });

    const identCol = createElement('div', { className: 'stocks-row-ident' });
    const symbolEl = createElement('span', {
      className: 'stocks-row-symbol',
      textContent: q.symbol,
    });
    const companyName = this.nameCache[q.symbol] ?? '';
    const nameEl = createElement('span', {
      className: 'stocks-row-name',
      textContent: companyName,
    });
    identCol.appendChild(symbolEl);
    identCol.appendChild(nameEl);

    const priceEl = createElement('span', {
      className: 'stocks-row-price',
      textContent: `$${q.price.toFixed(2)}`,
    });

    const changeClass = q.changePercent >= 0 ? 'stocks-positive' : 'stocks-negative';
    const sign = q.changePercent >= 0 ? '+' : '';

    const changeCol = createElement('div', { className: `stocks-row-change-col ${changeClass}` });
    const changePct = createElement('span', {
      className: 'stocks-row-change-pct',
      textContent: `${sign}${q.changePercent.toFixed(2)}%`,
    });
    const changeDollar = createElement('span', {
      className: 'stocks-row-change-dollar',
      textContent: `${sign}${q.change.toFixed(2)}`,
    });
    changeCol.appendChild(changePct);
    changeCol.appendChild(changeDollar);

    const removeBtn = createElement('button', {
      className: 'stocks-row-remove',
      textContent: '\u00d7',
    });
    removeBtn.addEventListener('click', () => {
      this.removeSymbol(q.symbol);
    });

    row.appendChild(grip);
    row.appendChild(starBtn);
    row.appendChild(identCol);
    row.appendChild(priceEl);
    row.appendChild(changeCol);
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
        this.addSymbol(r.symbol, r.description);
        dropdown.style.display = 'none';
        const input = this.contentEl.querySelector('.stocks-search-input') as HTMLInputElement;
        if (input) input.value = '';
      });
      row.appendChild(infoCol);
      row.appendChild(addBtn);
    }

    return row;
  }

  private addSymbol(symbol: string, name?: string): void {
    if (this.watchlist.length >= MAX_WATCHLIST) return;
    if (this.watchlist.includes(symbol)) return;
    this.watchlist.push(symbol);
    storage.set(WATCHLIST_KEY, this.watchlist);
    if (name) {
      this.nameCache[symbol] = name;
      storage.set(NAMES_KEY, this.nameCache);
    }
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

  private reorderWatchlist(from: number, to: number): void {
    const [symbol] = this.watchlist.splice(from, 1);
    this.watchlist.splice(to, 0, symbol);
    storage.set(WATCHLIST_KEY, this.watchlist);
    if (this.data) {
      const [quote] = this.data.watchlist.splice(from, 1);
      this.data.watchlist.splice(to, 0, quote);
      this.render(this.data);
    }
  }

  private clearDragIndicators(): void {
    const rows = this.contentEl.querySelectorAll('.stocks-row');
    rows.forEach((r) => r.classList.remove('stocks-row-drag-above', 'stocks-row-drag-below'));
  }

  private cleanupDragState(): void {
    this.clearDragIndicators();
    const rows = this.contentEl.querySelectorAll('.stocks-row');
    rows.forEach((r) => r.classList.remove('stocks-row-dragging'));
    this.dragFromIndex = -1;
    this.dragOverIndex = -1;
    this.gripActive = false;
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
