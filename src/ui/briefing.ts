import { createElement } from '../utils/dom.ts';
import { sendMessage } from '../services/chat.ts';
import { trackFeatureUse } from '../services/analytics.ts';
import * as storage from '../services/storage.ts';
import { pushModal, popModal } from './modalManager.ts';
import type { App } from '../App.ts';
import type { StocksData, CryptoData, NewsData, SportsData } from '../types/index.ts';

const CACHE_KEY = 'dashview-briefing-cache';

interface BriefingCache {
  content: string;
  date: string;
  generatedAt: number;
}

let overlay: HTMLElement | null = null;
let appRef: App | null = null;

export function initBriefing(app: App): void {
  appRef = app;
  document.addEventListener('dashview:briefing', () => {
    void showBriefing();
  });
}

function gatherDashboardContext(): string {
  const parts: string[] = [];

  // Weather — from storage cache
  const weatherCache = storage.get<{ temp: number; condition: string } | null>('dashview-weather-cache', null);
  const locationCache = storage.get<{ lat: number; lon: number; name?: string } | null>('dashview-location', null);
  if (weatherCache && locationCache) {
    parts.push(`Weather in ${locationCache.name || 'your location'}: ${weatherCache.temp}\u00B0, ${weatherCache.condition}`);
  }

  // Stocks — from panel data
  if (appRef) {
    const stocksPanel = appRef.getPanel('stocks');
    const stocksData = stocksPanel?.getLastData() as StocksData | null;
    if (stocksData?.watchlist?.length) {
      const stocks = stocksData.watchlist.slice(0, 10).map(
        (q) => `${q.symbol} ${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`,
      );
      parts.push(`Watchlist: ${stocks.join(', ')}`);
    }

    // Crypto — from panel data
    const cryptoPanel = appRef.getPanel('crypto');
    const cryptoData = cryptoPanel?.getLastData() as CryptoData | null;
    if (cryptoData?.coins?.length) {
      const cryptos = cryptoData.coins.slice(0, 5).map(
        (c) => `${c.symbol.toUpperCase()} ${c.change24h >= 0 ? '+' : ''}${c.change24h.toFixed(1)}%`,
      );
      parts.push(`Top crypto: ${cryptos.join(', ')}`);
    }

    // News — from panel data
    const newsPanel = appRef.getPanel('news');
    const newsData = newsPanel?.getLastData() as NewsData | null;
    if (newsData?.articles?.length) {
      const headlines = newsData.articles.slice(0, 5).map((a) => a.title);
      parts.push(`Top headlines: ${headlines.join(' | ')}`);
    }

    // Sports — from panel data
    const sportsPanel = appRef.getPanel('sports');
    const sportsData = sportsPanel?.getLastData() as SportsData | null;
    if (sportsData?.games?.length) {
      parts.push(`${sportsData.games.length} sports games on the scoreboard today`);
    }
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return `Today is ${dateStr}.\n\n${parts.join('\n')}`;
}

async function showBriefing(): Promise<void> {
  if (overlay) {
    overlay.remove();
    overlay = null;
    return;
  }
  trackFeatureUse('briefing');

  // Check cache — only regenerate once per day
  const today = new Date().toDateString();
  const cached = storage.get<BriefingCache | null>(CACHE_KEY, null);
  if (cached && cached.date === today && cached.content) {
    renderBriefing(cached.content);
    return;
  }

  // Show loading state
  overlay = createElement('div', { className: 'briefing-overlay' });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeBriefing();
  });

  const dialog = createElement('div', { className: 'briefing-dialog' });
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Daily Briefing');

  const title = createElement('div', { className: 'briefing-title', textContent: 'Daily Briefing' });
  const loading = createElement('div', { className: 'briefing-loading', textContent: 'Generating your briefing...' });
  const loadingDot = createElement('div', { className: 'panel-loading-dot' });
  loading.prepend(loadingDot);

  dialog.appendChild(title);
  dialog.appendChild(loading);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  pushModal(closeBriefing);

  try {
    const context = gatherDashboardContext();
    const prompt = `Generate a concise daily intelligence briefing based on the following real-time dashboard data. Format it with clear sections (Weather, Markets, News, etc.). Be brief and punchy — no fluff. Use bullet points. Start with a one-line summary of the day. Only include sections for data that's available.\n\n${context}`;

    const messages = [{ role: 'user' as const, content: prompt, timestamp: Date.now() }];
    const response = await sendMessage(messages, context);

    // Cache it
    const cacheEntry: BriefingCache = { content: response, date: today, generatedAt: Date.now() };
    storage.set(CACHE_KEY, cacheEntry);

    // Re-render with content
    closeBriefing();
    renderBriefing(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate briefing';
    loading.textContent = '';
    const errorEl = createElement('div', {
      className: 'briefing-error',
      textContent: msg.includes('API key') ? 'Set up an AI provider in the Chat panel first.' : msg,
    });
    dialog.appendChild(errorEl);
  }
}

function renderBriefing(content: string): void {
  closeBriefing();

  overlay = createElement('div', { className: 'briefing-overlay' });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeBriefing();
  });

  const dialog = createElement('div', { className: 'briefing-dialog' });

  const header = createElement('div', { className: 'briefing-header' });
  const title = createElement('div', { className: 'briefing-title', textContent: 'Daily Briefing' });
  const date = createElement('div', {
    className: 'briefing-date',
    textContent: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  });
  const closeBtn = createElement('button', { className: 'briefing-close', textContent: '\u00D7' });
  closeBtn.addEventListener('click', closeBriefing);
  header.appendChild(title);
  header.appendChild(date);
  header.appendChild(closeBtn);

  const body = createElement('div', { className: 'briefing-body' });
  // Render markdown-lite: convert **bold**, bullet points, and sections
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.trim()) {
      body.appendChild(createElement('div', { className: 'briefing-spacer' }));
      continue;
    }
    const el = document.createElement('div');
    el.className = 'briefing-line';
    if (line.startsWith('##') || line.startsWith('**') && line.endsWith('**')) {
      el.className = 'briefing-section-title';
      el.textContent = line.replace(/^#+\s*/, '').replace(/\*\*/g, '');
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      el.className = 'briefing-bullet';
      el.textContent = line.slice(2);
    } else {
      el.textContent = line.replace(/\*\*/g, '');
    }
    body.appendChild(el);
  }

  const footer = createElement('div', { className: 'briefing-footer' });
  const regen = createElement('button', { className: 'briefing-regen', textContent: 'Regenerate' });
  regen.addEventListener('click', () => {
    storage.set(CACHE_KEY, null);
    closeBriefing();
    void showBriefing();
  });
  footer.appendChild(regen);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  pushModal(closeBriefing);
}

function closeBriefing(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
    popModal();
  }
}
