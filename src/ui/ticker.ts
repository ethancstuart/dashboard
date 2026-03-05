import { createElement } from '../utils/dom.ts';
import { fetchTickerData } from '../services/ticker.ts';
import type { TickerItem, TickerData } from '../types/index.ts';

const REFRESH_INTERVAL = 60000;

export function createTicker(): HTMLElement {
  const bar = createElement('div', { className: 'ticker-bar' });

  const statusBadge = createElement('div', { className: 'ticker-status' });
  const delayNote = createElement('span', { className: 'ticker-delay' });
  const trackWrapper = createElement('div', { className: 'ticker-track-wrapper' });
  const track1 = createElement('div', { className: 'ticker-track' });
  const track2 = createElement('div', { className: 'ticker-track' });

  trackWrapper.appendChild(track1);
  trackWrapper.appendChild(track2);

  bar.appendChild(statusBadge);
  bar.appendChild(delayNote);
  bar.appendChild(trackWrapper);

  async function update() {
    try {
      const data = await fetchTickerData();
      renderTicker(data, statusBadge, delayNote, track1, track2);
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
  statusBadge: HTMLElement,
  delayNote: HTMLElement,
  track1: HTMLElement,
  track2: HTMLElement,
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

  // Build ticker items
  const itemsHtml = buildTickerItems(data.items);
  track1.innerHTML = itemsHtml;
  track2.innerHTML = itemsHtml;

  // Fill tracks to cover viewport width (seamless scroll)
  requestAnimationFrame(() => {
    const wrapperWidth = track1.parentElement?.offsetWidth ?? 0;
    const singleCopyWidth = track1.scrollWidth;

    if (wrapperWidth > 0 && singleCopyWidth > 0) {
      const copies = Math.ceil(wrapperWidth / singleCopyWidth) + 1;
      if (copies > 1) {
        const repeated = itemsHtml.repeat(copies);
        track1.innerHTML = repeated;
        track2.innerHTML = repeated;

        const totalWidth = track1.scrollWidth;
        const speed = (totalWidth / wrapperWidth) * 30;
        const wrapper = track1.parentElement!;
        wrapper.style.setProperty('--ticker-speed', `${speed}s`);
        track1.style.animationDuration = `${speed}s`;
        track2.style.animationDuration = `${speed}s`;
      }
    }
  });
}

function buildTickerItems(items: TickerItem[]): string {
  return items.map((item) => {
    const changeClass = item.changePercent >= 0 ? 'ticker-positive' : 'ticker-negative';
    const sign = item.changePercent >= 0 ? '+' : '';

    let priceStr: string;
    if (item.type === 'forex') {
      priceStr = item.price.toFixed(item.symbol.includes('JPY') ? 2 : 4);
    } else if (item.type === 'crypto') {
      priceStr = `$${item.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    } else {
      priceStr = `$${item.price.toFixed(2)}`;
    }

    const changeStr = item.change !== 0 || item.changePercent !== 0
      ? `<span class="${changeClass}">${sign}${item.changePercent.toFixed(2)}%</span>`
      : '';

    return `<span class="ticker-item"><span class="ticker-label">${item.label}</span> <span class="ticker-price">${priceStr}</span> ${changeStr}</span>`;
  }).join('<span class="ticker-sep">\u00b7</span>');
}
