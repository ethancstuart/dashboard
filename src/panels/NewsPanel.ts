import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchNews } from '../services/news.ts';
import { fetchSocialFeed } from '../services/social.ts';
import * as storage from '../services/storage.ts';
import type { NewsCategory, NewsData, NewsArticle, SocialPost } from '../types/index.ts';

const CATEGORY_KEY = 'dashview-news-category';
const CATEGORIES: { id: NewsCategory; label: string }[] = [
  { id: 'world', label: 'World' },
  { id: 'tech', label: 'Tech' },
  { id: 'business', label: 'Biz' },
  { id: 'science', label: 'Sci' },
  { id: 'entertainment', label: 'Ent' },
  { id: 'x', label: 'X' },
];

export class NewsPanel extends Panel {
  private category: NewsCategory;
  private data: NewsData | null = null;
  private socialPosts: SocialPost[] = [];
  private map: L.Map | null = null;
  private terminator: L.Polygon | null = null;
  private terminatorInterval: ReturnType<typeof setInterval> | null = null;
  private mapContainer: HTMLElement | null = null;
  private mapboxAvailable: boolean | null = null;

  constructor() {
    super({
      id: 'news',
      title: 'World News',
      enabled: true,
      refreshInterval: 600000,
    });
    this.category = storage.get<NewsCategory>(CATEGORY_KEY, 'world');
    void this.checkMapboxAvailable();
  }

  setMapContainer(el: HTMLElement): void {
    this.mapContainer = el;
  }

  private async checkMapboxAvailable(): Promise<void> {
    try {
      const res = await fetch('/api/mapbox');
      const data = await res.json();
      this.mapboxAvailable = !!data.available;
    } catch {
      this.mapboxAvailable = false;
    }
  }

  async fetchData(): Promise<void> {
    if (this.category === 'x') {
      try {
        this.socialPosts = await fetchSocialFeed();
      } catch {
        this.socialPosts = [];
      }
      this.render(null);
      return;
    }
    this.data = await fetchNews(this.category);
    this.render(this.data);
  }

  render(data: unknown): void {
    // Clean up previous map and terminator interval
    if (this.terminatorInterval) {
      clearInterval(this.terminatorInterval);
      this.terminatorInterval = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.terminator = null;

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

    // X tab: render social posts
    if (this.category === 'x') {
      this.renderSocialFeed();
      this.initHeroMap([]);
      return;
    }

    const d = data as NewsData;
    if (!d) return;

    if (d.articles.length === 0) {
      const empty = createElement('div', { className: 'news-empty', textContent: 'No articles available' });
      this.contentEl.appendChild(empty);
      this.initHeroMap([]);
      return;
    }

    // Article list
    const list = createElement('div', { className: 'news-list news-panel-articles' });
    for (const article of d.articles) {
      list.appendChild(this.createArticleRow(article));
    }
    this.contentEl.appendChild(list);

    // Init hero map
    this.initHeroMap(d.articles);
  }

  private renderSocialFeed(): void {
    if (this.socialPosts.length === 0) {
      const empty = createElement('div', { className: 'news-empty', textContent: 'No posts available' });
      this.contentEl.appendChild(empty);
      return;
    }

    const list = createElement('div', { className: 'news-list news-panel-articles' });
    for (const post of this.socialPosts) {
      list.appendChild(this.createSocialCard(post));
    }
    this.contentEl.appendChild(list);
  }

  private createSocialCard(post: SocialPost): HTMLElement {
    const card = createElement('div', { className: 'social-post' });

    const header = createElement('div', { className: 'social-post-header' });
    const author = createElement('span', {
      className: 'social-post-author',
      textContent: post.author,
    });
    const handle = createElement('span', {
      className: 'social-post-handle',
      textContent: post.handle,
    });
    header.appendChild(author);
    header.appendChild(handle);

    if (post.timestamp) {
      const time = this.relativeTime(post.timestamp);
      if (time) {
        const timeEl = createElement('span', {
          className: 'social-post-time',
          textContent: ` \u00b7 ${time}`,
        });
        header.appendChild(timeEl);
      }
    }

    const text = createElement('div', {
      className: 'social-post-text',
      textContent: post.text,
    });

    const link = document.createElement('a');
    link.href = post.link;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'social-post-link';
    link.textContent = 'View on X';

    card.appendChild(header);
    card.appendChild(text);
    card.appendChild(link);
    return card;
  }

  private initHeroMap(articles: NewsArticle[]): void {
    const container = this.mapContainer;
    if (!container || typeof L === 'undefined') return;

    container.textContent = '';

    const mapWrap = createElement('div', { className: 'news-map-wrap' });
    container.appendChild(mapWrap);

    requestAnimationFrame(() => {
      this.initMap(mapWrap, articles);
      if (this.map) this.map.invalidateSize();
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
      maxZoom: 14,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(this.map);

    // Use Mapbox tiles proxied through our edge function (token stays server-side)
    if (this.mapboxAvailable) {
      L.tileLayer('/api/mapbox?z={z}&x={x}&y={y}', {
        attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a>',
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 19,
      }).addTo(this.map);
    } else {
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(this.map);
    }

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

    // Use marker clustering if available, otherwise standard markers
    const markerTarget: L.Map | L.LayerGroup = this.tryCreateClusterGroup() || this.map;

    for (const [, group] of groups) {
      const { lat, lon } = group[0];
      const count = group.length;

      const icon = L.divIcon({
        className: '',
        html: `<div class="news-marker news-marker-pulse">${count}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([lat, lon], { icon }).addTo(markerTarget);

      // Hover tooltip
      const tooltipText = group[0].source + (count > 1 ? ` +${count - 1}` : '');
      marker.bindTooltip(tooltipText, {
        className: 'news-tooltip',
        direction: 'top',
        offset: [0, -12],
      });

      const popupLines = group.slice(0, 3).map(
        (a) => `<a href="${this.escapeHtml(a.link)}" target="_blank" rel="noopener">${this.escapeHtml(a.title)}</a>`
      );
      const sourceName = group[0].source;
      const popupHtml = `<strong>${this.escapeHtml(sourceName)}</strong>${count > 1 ? ` +${count - 1}` : ''}<br>${popupLines.join('<br>')}`;
      marker.bindPopup(popupHtml, { maxWidth: 250 });
    }

    if (markerTarget !== this.map) {
      (markerTarget as L.LayerGroup).addTo(this.map);
    }

    // Day/night terminator
    this.updateTerminator();
    this.terminatorInterval = setInterval(() => this.updateTerminator(), 60000);
  }

  private tryCreateClusterGroup(): L.LayerGroup | null {
    // Check if Leaflet.markercluster is loaded
    const MC = (L as unknown as Record<string, unknown>).markerClusterGroup;
    if (typeof MC === 'function') {
      return (MC as () => L.LayerGroup)();
    }
    return null;
  }

  private buildTerminatorCoords(): L.LatLngExpression[] {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now.getTime() - start.getTime();
    const dayOfYear = Math.floor(diff / 86400000);

    const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
    const decRad = declination * Math.PI / 180;

    const hours = now.getUTCHours() + now.getUTCMinutes() / 60;
    const sunLon = (12 - hours) * 15;

    const points: L.LatLngExpression[] = [];

    for (let lon = -180; lon <= 180; lon += 1) {
      const lonRad = (lon - sunLon) * Math.PI / 180;
      const lat = Math.atan(-Math.cos(lonRad) / Math.tan(decRad)) * 180 / Math.PI;
      points.push([lat, lon]);
    }

    const nightOnSouth = declination >= 0;

    if (nightOnSouth) {
      points.push([-90, 180]);
      points.push([-90, -180]);
    } else {
      points.push([90, 180]);
      points.push([90, -180]);
    }

    return points;
  }

  private updateTerminator(): void {
    if (!this.map) return;

    const coords = this.buildTerminatorCoords();

    if (this.terminator) {
      this.terminator.setLatLngs(coords);
    } else {
      this.terminator = L.polygon(coords, {
        color: 'transparent',
        fillColor: '#000',
        fillOpacity: 0.3,
        interactive: false,
      }).addTo(this.map);
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
    row.appendChild(link);

    if (article.description) {
      const desc = createElement('div', { className: 'news-article-desc' });
      const truncated = article.description.length > 120
        ? article.description.slice(0, 120) + '\u2026'
        : article.description;
      desc.textContent = truncated;
      row.appendChild(desc);
    }

    const meta = createElement('div', { className: 'news-article-meta' });
    const source = createElement('span', {
      className: 'news-article-source',
      textContent: article.source,
    });
    meta.appendChild(source);

    if (article.sourceCountry) {
      const country = createElement('span', {
        className: 'news-article-country',
        textContent: article.sourceCountry,
      });
      meta.appendChild(document.createTextNode(' \u00B7 '));
      meta.appendChild(country);
    }

    if (article.pubDate) {
      const time = this.relativeTime(article.pubDate);
      if (time) {
        meta.appendChild(document.createTextNode(' \u00B7 '));
        meta.append(time);
      }
    }

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
