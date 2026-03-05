import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchNews } from '../services/news.ts';
import * as storage from '../services/storage.ts';
import type { NewsCategory, NewsData, NewsArticle } from '../types/index.ts';

const CATEGORY_KEY = 'dashview-news-category';
const CATEGORIES: { id: NewsCategory; label: string }[] = [
  { id: 'world', label: 'World' },
  { id: 'tech', label: 'Tech' },
  { id: 'business', label: 'Biz' },
  { id: 'science', label: 'Sci' },
  { id: 'entertainment', label: 'Ent' },
];

export class NewsPanel extends Panel {
  private category: NewsCategory;
  private data: NewsData | null = null;
  private map: L.Map | null = null;

  constructor() {
    super({
      id: 'news',
      title: 'World News',
      enabled: true,
      refreshInterval: 600000,
    });
    this.container.classList.add('panel-wide');
    this.category = storage.get<NewsCategory>(CATEGORY_KEY, 'world');
  }

  async fetchData(): Promise<void> {
    this.data = await fetchNews(this.category);
    this.render(this.data);
  }

  render(data: unknown): void {
    const d = data as NewsData;
    if (!d) return;

    // Clean up previous map
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.contentEl.textContent = '';

    // Tabs
    const tabs = createElement('div', { className: 'news-tabs' });
    for (const cat of CATEGORIES) {
      const btn = createElement('button', {
        className: `news-tab ${cat.id === this.category ? 'news-tab-active' : ''}`,
        textContent: cat.label,
      });
      btn.addEventListener('click', () => {
        if (cat.id === this.category) return;
        this.category = cat.id;
        storage.set(CATEGORY_KEY, this.category);
        void this.fetchData();
      });
      tabs.appendChild(btn);
    }
    this.contentEl.appendChild(tabs);

    if (d.articles.length === 0) {
      const empty = createElement('div', { className: 'news-empty', textContent: 'No articles available' });
      this.contentEl.appendChild(empty);
      return;
    }

    // Body: map + list
    const body = createElement('div', { className: 'news-body' });

    // Map
    const mapWrap = createElement('div', { className: 'news-map-wrap' });
    body.appendChild(mapWrap);

    // Article list
    const list = createElement('div', { className: 'news-list' });
    for (const article of d.articles) {
      list.appendChild(this.createArticleRow(article));
    }
    body.appendChild(list);

    this.contentEl.appendChild(body);

    // Init map after DOM attachment
    requestAnimationFrame(() => {
      this.initMap(mapWrap, d.articles);
    });
  }

  private initMap(container: HTMLElement, articles: NewsArticle[]): void {
    if (typeof L === 'undefined') return;

    this.map = L.map(container, {
      center: [20, 0],
      zoom: 2,
      zoomControl: false,
      attributionControl: false,
      minZoom: 1,
      maxZoom: 6,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(this.map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(this.map);

    // Group articles by location
    const groups = new Map<string, NewsArticle[]>();
    for (const a of articles) {
      const key = `${a.lat},${a.lon}`;
      const group = groups.get(key);
      if (group) {
        group.push(a);
      } else {
        groups.set(key, [a]);
      }
    }

    for (const [, group] of groups) {
      const { lat, lon } = group[0];
      const count = group.length;

      const icon = L.divIcon({
        className: '',
        html: `<div class="news-marker">${count}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([lat, lon], { icon }).addTo(this.map);

      const popupLines = group.slice(0, 3).map(
        (a) => `<a href="${this.escapeHtml(a.link)}" target="_blank" rel="noopener">${this.escapeHtml(a.title)}</a>`
      );
      const sourceName = group[0].source;
      const popupHtml = `<strong>${this.escapeHtml(sourceName)}</strong>${count > 1 ? ` +${count - 1}` : ''}<br>${popupLines.join('<br>')}`;
      marker.bindPopup(popupHtml, { maxWidth: 250 });
    }
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  private createArticleRow(article: NewsArticle): HTMLElement {
    const row = createElement('div', { className: 'news-article' });

    const link = document.createElement('a');
    link.href = article.link;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'news-article-title';
    link.textContent = article.title;

    const meta = createElement('span', { className: 'news-article-meta' });
    const source = createElement('span', {
      className: 'news-article-source',
      textContent: article.source,
    });
    const timeText = article.pubDate ? ` \u00B7 ${this.relativeTime(article.pubDate)}` : '';
    meta.appendChild(source);
    meta.append(timeText);

    row.appendChild(link);
    row.appendChild(meta);
    return row;
  }

  private relativeTime(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    if (isNaN(then)) return '';
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
