import { createElement } from '../utils/dom.ts';
import { sendMessage } from '../services/chat.ts';
import { trackFeatureUse } from '../services/analytics.ts';
import * as storage from '../services/storage.ts';

const CACHE_KEY = 'dashview-briefing-cache';

interface BriefingCache {
  content: string;
  date: string;
  generatedAt: number;
}

let overlay: HTMLElement | null = null;

export function initBriefing(): void {
  document.addEventListener('dashview:briefing', () => {
    void showBriefing();
  });
}

function gatherDashboardContext(): string {
  const parts: string[] = [];

  // Weather
  const weatherCache = storage.get<{ temp: number; condition: string } | null>('dashview-weather-cache', null);
  const locationCache = storage.get<{ lat: number; lon: number; name?: string } | null>('dashview-location', null);
  if (weatherCache && locationCache) {
    parts.push(`Weather in ${locationCache.name || 'your location'}: ${weatherCache.temp}\u00B0, ${weatherCache.condition}`);
  }

  // Stocks — read from last rendered data in DOM
  const stockRows = document.querySelectorAll('.stocks-row .stocks-row-symbol');
  const stockChanges = document.querySelectorAll('.stocks-row .stocks-row-change-pct');
  if (stockRows.length > 0) {
    const stocks: string[] = [];
    for (let i = 0; i < Math.min(stockRows.length, 10); i++) {
      const symbol = stockRows[i]?.textContent || '';
      const change = stockChanges[i]?.textContent || '';
      if (symbol) stocks.push(`${symbol} ${change}`);
    }
    if (stocks.length > 0) parts.push(`Watchlist: ${stocks.join(', ')}`);
  }

  // Crypto — read from DOM
  const cryptoRows = document.querySelectorAll('.crypto-rank');
  if (cryptoRows.length > 0) {
    const row = cryptoRows[0]?.closest('.stocks-row');
    if (row) {
      const symbols = document.querySelectorAll('[data-panel-id="crypto"] .stocks-row-symbol');
      const changes = document.querySelectorAll('[data-panel-id="crypto"] .stocks-row-change-pct');
      const cryptos: string[] = [];
      for (let i = 0; i < Math.min(symbols.length, 5); i++) {
        cryptos.push(`${symbols[i]?.textContent} ${changes[i]?.textContent}`);
      }
      if (cryptos.length > 0) parts.push(`Top crypto: ${cryptos.join(', ')}`);
    }
  }

  // News headlines — read from DOM
  const newsLinks = document.querySelectorAll('.news-article-title');
  if (newsLinks.length > 0) {
    const headlines: string[] = [];
    for (let i = 0; i < Math.min(newsLinks.length, 5); i++) {
      headlines.push(newsLinks[i]?.textContent || '');
    }
    if (headlines.length > 0) parts.push(`Top headlines: ${headlines.join(' | ')}`);
  }

  // Sports
  const sportsGames = document.querySelectorAll('.sports-game');
  if (sportsGames.length > 0) {
    parts.push(`${sportsGames.length} sports games on the scoreboard today`);
  }

  // Predictions
  const predictions = document.querySelectorAll('.prediction-card-question');
  if (predictions.length > 0) {
    const preds: string[] = [];
    for (let i = 0; i < Math.min(predictions.length, 3); i++) {
      const q = predictions[i]?.textContent || '';
      const prob = predictions[i]?.closest('.prediction-card')?.querySelector('.prediction-card-prob')?.textContent || '';
      if (q) preds.push(`${q} (${prob})`);
    }
    if (preds.length > 0) parts.push(`Prediction markets: ${preds.join('; ')}`);
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

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeBriefing();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeBriefing(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}
