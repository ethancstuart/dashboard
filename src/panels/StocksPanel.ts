import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchStocks, searchSymbols, fetchCandles, fetchCompanyNews, fetchProfile, fetchMetrics } from '../services/stocks.ts';
import { renderChart } from '../ui/chart.ts';
import * as storage from '../services/storage.ts';
import type { StocksData, StockQuote, SymbolSearchResult, CandleData, CompanyNews, CompanyProfile, KeyMetrics } from '../types/index.ts';

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

const CHEVRON_DOWN = '\u25BE';
const CHEVRON_UP = '\u25B4';

export class StocksPanel extends Panel {
  private watchlist: string[];
  private favorites: Set<string>;
  private nameCache: Record<string, string>;
  private data: StocksData | null = null;
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private dragFromIndex: number = -1;
  private dragOverIndex: number = -1;
  private gripActive: boolean = false;
  private selectedSymbol: string | null = null;
  private selectedPeriod: string = '1M';
  private detailCandles: CandleData | null = null;
  private detailNews: CompanyNews[] | null = null;
  private detailLoading: boolean = false;
  private detailProfile: CompanyProfile | null = null;
  private detailMetrics: KeyMetrics | null = null;

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
      if (d.watchlist[i].symbol === this.selectedSymbol) {
        this.contentEl.appendChild(this.createDetailPanel(d.watchlist[i].symbol));
      }
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
    const isSelected = q.symbol === this.selectedSymbol;
    const row = createElement('div', {
      className: `stocks-row stocks-row-clickable ${isSelected ? 'stocks-row-selected' : ''}`,
    });
    row.setAttribute('draggable', 'true');

    // Click to toggle detail view
    row.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.stocks-row-remove') || target.closest('.stocks-row-star') || target.closest('.stocks-row-grip')) return;
      if (this.selectedSymbol === q.symbol) {
        this.selectedSymbol = null;
        this.detailCandles = null;
        this.detailNews = null;
        this.detailProfile = null;
        this.detailMetrics = null;
      } else {
        this.selectedSymbol = q.symbol;
        this.selectedPeriod = '1M';
        this.detailCandles = null;
        this.detailNews = null;
        this.detailProfile = null;
        this.detailMetrics = null;
        void this.loadDetailData(q.symbol, '1M');
      }
      if (this.data) this.render(this.data);
    });

    // Grip handle
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

    // Chevron indicator
    const chevron = createElement('span', {
      className: 'stocks-row-chevron',
      textContent: isSelected ? CHEVRON_UP : CHEVRON_DOWN,
    });

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
    row.appendChild(chevron);
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

  private static readonly PERIODS: { key: string; label: string; resolution: string; daysBack: number | 'ytd' }[] = [
    { key: '1D', label: '1D', resolution: '5', daysBack: 1 },
    { key: '7D', label: '7D', resolution: '15', daysBack: 7 },
    { key: '1M', label: '1M', resolution: 'D', daysBack: 30 },
    { key: '6M', label: '6M', resolution: 'D', daysBack: 180 },
    { key: '1Y', label: '1Y', resolution: 'D', daysBack: 365 },
    { key: 'YTD', label: 'YTD', resolution: 'D', daysBack: 'ytd' },
    { key: 'Max', label: 'Max', resolution: 'W', daysBack: 1825 },
  ];

  private getPeriodParams(periodKey: string): { resolution: string; from: number; to: number } {
    const period = StocksPanel.PERIODS.find((p) => p.key === periodKey) ?? StocksPanel.PERIODS[2];
    const now = Math.floor(Date.now() / 1000);
    let from: number;
    if (period.daysBack === 'ytd') {
      from = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
    } else {
      from = now - period.daysBack * 86400;
    }
    return { resolution: period.resolution, from, to: now };
  }

  private async loadDetailData(symbol: string, periodKey: string): Promise<void> {
    this.detailLoading = true;
    if (this.data) this.render(this.data);

    const { resolution, from, to } = this.getPeriodParams(periodKey);
    const toDate = new Date().toISOString().split('T')[0];
    const fromDate = new Date(from * 1000).toISOString().split('T')[0];

    // Fetch all independently so one failure doesn't kill the rest
    const [candleResult, newsResult, profileResult, metricsResult] = await Promise.allSettled([
      fetchCandles(symbol, resolution, from, to),
      fetchCompanyNews(symbol, fromDate, toDate),
      fetchProfile(symbol),
      fetchMetrics(symbol),
    ]);

    if (this.selectedSymbol === symbol) {
      this.detailCandles = candleResult.status === 'fulfilled'
        ? candleResult.value
        : { t: [], c: [], h: [], l: [], o: [], v: [] };
      this.detailNews = newsResult.status === 'fulfilled' ? newsResult.value : [];
      this.detailProfile = profileResult.status === 'fulfilled' ? profileResult.value : null;
      this.detailMetrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null;
      this.detailLoading = false;
      if (this.data) this.render(this.data);
    }
  }

  private formatMarketCap(cap: number): string {
    if (cap >= 1000) return `$${(cap / 1000).toFixed(1)}T`;
    if (cap >= 1) return `$${cap.toFixed(1)}B`;
    return `$${(cap * 1000).toFixed(0)}M`;
  }

  private createDetailPanel(symbol: string): HTMLElement {
    const detail = createElement('div', { className: 'stocks-detail stocks-detail-slide' });

    // Find the quote for this symbol to get day stats
    const quote = this.data?.watchlist.find((q) => q.symbol === symbol);

    if (this.detailLoading) {
      const loading = createElement('div', { className: 'stocks-detail-loading' });
      const dot = createElement('div', { className: 'panel-loading-dot' });
      loading.appendChild(dot);
      detail.appendChild(loading);
      return detail;
    }

    // Day stats row (from the live quote — always available)
    if (quote) {
      const dayGrid = createElement('div', { className: 'stocks-metrics-grid' });
      const dayItems: [string, string][] = [
        ['Open', `$${quote.open.toFixed(2)}`],
        ['Day High', `$${quote.high.toFixed(2)}`],
        ['Day Low', `$${quote.low.toFixed(2)}`],
        ['Prev Close', `$${quote.prevClose.toFixed(2)}`],
      ];
      for (const [label, value] of dayItems) {
        const cell = createElement('div', { className: 'stocks-metric-cell' });
        const lbl = createElement('span', { className: 'stocks-metric-label', textContent: label });
        const val = createElement('span', { className: 'stocks-metric-value', textContent: value });
        cell.appendChild(lbl);
        cell.appendChild(val);
        dayGrid.appendChild(cell);
      }
      detail.appendChild(dayGrid);
    }

    // Key metrics grid (from Finnhub metrics endpoint)
    if (this.detailMetrics) {
      const grid = createElement('div', { className: 'stocks-metrics-grid' });
      const m = this.detailMetrics;
      const items: [string, string][] = [
        ['Mkt Cap', m.marketCap ? this.formatMarketCap(m.marketCap) : '--'],
        ['P/E', m.peRatio ? m.peRatio.toFixed(1) : '--'],
        ['EPS', m.eps ? `$${m.eps.toFixed(2)}` : '--'],
        ['52W High', m.high52w ? `$${m.high52w.toFixed(2)}` : '--'],
        ['52W Low', m.low52w ? `$${m.low52w.toFixed(2)}` : '--'],
        ['Beta', m.beta ? m.beta.toFixed(2) : '--'],
      ];
      for (const [label, value] of items) {
        const cell = createElement('div', { className: 'stocks-metric-cell' });
        const lbl = createElement('span', { className: 'stocks-metric-label', textContent: label });
        const val = createElement('span', { className: 'stocks-metric-value', textContent: value });
        cell.appendChild(lbl);
        cell.appendChild(val);
        grid.appendChild(cell);
      }
      detail.appendChild(grid);
    }

    // Profile info (industry + link)
    if (this.detailProfile && this.detailProfile.industry) {
      const profileRow = createElement('div', { className: 'stocks-detail-profile' });
      const industry = createElement('span', {
        className: 'stocks-detail-industry',
        textContent: this.detailProfile.industry,
      });
      profileRow.appendChild(industry);
      if (this.detailProfile.weburl) {
        const webLink = document.createElement('a');
        webLink.href = this.detailProfile.weburl;
        webLink.target = '_blank';
        webLink.rel = 'noopener';
        webLink.className = 'stocks-detail-weblink';
        webLink.textContent = this.detailProfile.weburl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
        webLink.addEventListener('click', (e) => e.stopPropagation());
        profileRow.appendChild(webLink);
      }
      detail.appendChild(profileRow);
    }

    // Period buttons + chart (only show if candle data is available)
    const hasChart = this.detailCandles && this.detailCandles.t.length > 1;

    const periods = createElement('div', { className: 'stocks-detail-periods' });
    for (const p of StocksPanel.PERIODS) {
      const btn = createElement('button', {
        className: `stocks-detail-period ${p.key === this.selectedPeriod ? 'stocks-detail-period-active' : ''}`,
        textContent: p.label,
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedPeriod = p.key;
        this.detailCandles = null;
        this.detailNews = null;
        void this.loadDetailData(symbol, p.key);
      });
      periods.appendChild(btn);
    }
    detail.appendChild(periods);

    if (hasChart) {
      const canvas = document.createElement('canvas');
      canvas.className = 'stocks-detail-chart';
      detail.appendChild(canvas);
      requestAnimationFrame(() => {
        renderChart(canvas, {
          timestamps: this.detailCandles!.t,
          prices: this.detailCandles!.c,
        });
      });
    }

    // Company news
    if (this.detailNews && this.detailNews.length > 0) {
      const newsList = createElement('div', { className: 'stocks-detail-news' });
      for (const article of this.detailNews.slice(0, 5)) {
        const row = createElement('div', { className: 'stocks-detail-article' });

        const link = document.createElement('a');
        link.href = article.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'stocks-detail-headline';
        link.textContent = article.headline;
        link.addEventListener('click', (e) => e.stopPropagation());
        row.appendChild(link);

        const meta = createElement('div', { className: 'stocks-detail-meta' });
        const timeAgo = this.relativeTime(article.datetime);
        meta.textContent = `${article.source}${timeAgo ? ' \u00b7 ' + timeAgo : ''}`;
        row.appendChild(meta);

        newsList.appendChild(row);
      }
      detail.appendChild(newsList);
    }

    return detail;
  }

  private relativeTime(timestamp: number): string {
    const now = Date.now();
    const then = timestamp * 1000;
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
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
