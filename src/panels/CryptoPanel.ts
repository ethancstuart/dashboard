import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchCryptoData } from '../services/crypto.ts';
import { checkAlerts } from '../services/alerts.ts';
import { openAlertsModal } from '../ui/alertsModal.ts';
import { renderSparkline } from '../ui/chart.ts';
import type { CryptoData, CryptoCoin } from '../types/index.ts';

export class CryptoPanel extends Panel {
  private data: CryptoData | null = null;
  private selectedCoin: string | null = null;

  constructor() {
    super({
      id: 'crypto',
      title: 'Crypto',
      enabled: true,
      refreshInterval: 120000,
      priority: 1,
    });
  }

  getLastData(): CryptoData | null {
    return this.data;
  }

  async fetchData(): Promise<void> {
    this.data = await fetchCryptoData();
    this.render(this.data);

    // Check price alerts
    if (this.data?.coins) {
      const prices = this.data.coins.map((c) => ({
        symbol: c.symbol.toUpperCase(),
        price: c.price,
        type: 'crypto' as const,
      }));
      checkAlerts(prices);
    }
  }

  render(data: unknown): void {
    const d = data as CryptoData;
    if (!d) return;

    this.contentEl.textContent = '';

    // Header row
    const header = createElement('div', { className: 'crypto-header' });
    const headerTitle = createElement('span', {
      className: 'stocks-section-header',
      textContent: 'Top Coins',
    });
    const headerLabel = createElement('span', {
      className: 'stocks-column-label',
      textContent: '24h Change',
    });
    header.appendChild(headerTitle);
    header.appendChild(headerLabel);
    this.contentEl.appendChild(header);

    if (d.coins.length === 0) {
      const empty = createElement('div', {
        className: 'panel-empty-state',
        textContent: 'No crypto data available',
      });
      this.contentEl.appendChild(empty);
      return;
    }

    for (const coin of d.coins) {
      this.contentEl.appendChild(this.createCoinRow(coin));
      if (coin.id === this.selectedCoin) {
        this.contentEl.appendChild(this.createDetailView(coin));
      }
    }
  }

  private createCoinRow(coin: CryptoCoin): HTMLElement {
    const isSelected = coin.id === this.selectedCoin;
    const row = createElement('div', {
      className: `stocks-row stocks-row-clickable ${isSelected ? 'stocks-row-selected' : ''}`,
    });

    row.addEventListener('click', () => {
      this.selectedCoin = this.selectedCoin === coin.id ? null : coin.id;
      if (this.data) this.render(this.data);
    });

    // Rank
    const rank = createElement('span', {
      className: 'crypto-rank',
      textContent: `#${coin.rank}`,
    });

    // Identity column
    const identCol = createElement('div', { className: 'stocks-row-ident' });
    const symbolEl = createElement('span', {
      className: 'stocks-row-symbol',
      textContent: coin.symbol,
    });
    const nameEl = createElement('span', {
      className: 'stocks-row-name',
      textContent: coin.name,
    });
    identCol.appendChild(symbolEl);
    identCol.appendChild(nameEl);

    // Price
    const priceEl = createElement('span', {
      className: 'stocks-row-price',
      textContent: this.formatPrice(coin.price),
    });

    // Change
    const changeClass = coin.change24h >= 0 ? 'stocks-positive' : 'stocks-negative';
    const sign = coin.change24h >= 0 ? '+' : '';
    const changeEl = createElement('span', {
      className: `stocks-row-change-pct ${changeClass}`,
      textContent: `${sign}${coin.change24h.toFixed(2)}%`,
    });

    // Sparkline
    const sparkWrap = createElement('div', { className: 'crypto-sparkline-wrap' });
    if (coin.sparkline.length >= 2) {
      const canvas = document.createElement('canvas');
      canvas.className = 'ticker-sparkline';
      sparkWrap.appendChild(canvas);
      requestAnimationFrame(() => {
        renderSparkline(canvas, coin.sparkline, {
          width: 60,
          height: 20,
          color: coin.change24h >= 0 ? '#22c55e' : '#ef4444',
        });
      });
    }

    // Alert bell
    const bellBtn = createElement('button', {
      className: 'stocks-row-bell',
      textContent: '\uD83D\uDD14',
    });
    bellBtn.setAttribute('aria-label', `Set alert for ${coin.symbol}`);
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAlertsModal({ symbol: coin.symbol.toUpperCase(), type: 'crypto' });
    });

    // Chevron
    const chevron = createElement('span', {
      className: 'stocks-row-chevron',
      textContent: isSelected ? '\u25B4' : '\u25BE',
    });

    row.appendChild(rank);
    row.appendChild(identCol);
    row.appendChild(priceEl);
    row.appendChild(sparkWrap);
    row.appendChild(changeEl);
    row.appendChild(bellBtn);
    row.appendChild(chevron);
    return row;
  }

  private createDetailView(coin: CryptoCoin): HTMLElement {
    const detail = createElement('div', { className: 'stocks-detail stocks-detail-slide' });

    const grid = createElement('div', { className: 'stocks-metrics-grid' });
    const items: [string, string][] = [
      ['Mkt Cap', this.formatCap(coin.marketCap)],
      ['24h Vol', this.formatCap(coin.volume)],
      ['24h High', this.formatPrice(coin.high24h)],
      ['24h Low', this.formatPrice(coin.low24h)],
      ['ATH', this.formatPrice(coin.ath)],
      ['From ATH', `${coin.athChange.toFixed(1)}%`],
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
    return detail;
  }

  private formatPrice(price: number): string {
    if (price >= 1) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${price.toFixed(6)}`;
  }

  private formatCap(value: number): string {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
    return `$${value.toLocaleString()}`;
  }
}
