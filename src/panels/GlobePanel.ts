import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { buildTerminatorPolygon } from '../utils/terminator.ts';
import { fetchAllNews } from '../services/news.ts';
import type { GlobeNewsArticle, GlobeNewsCategory, GlobeMarker, GlobeWeatherPin, WidgetSize } from '../types/index.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GlobeInstance = Record<string, (...args: any[]) => any> & ((el: HTMLElement) => GlobeInstance);

const GLOBE_IMAGE_URL = '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const AUTO_ROTATE_SPEED = 0.3;
const IDLE_RESUME_MS = 3000;

const CATEGORY_COLORS: Record<GlobeNewsCategory, string> = {
  world: '#3b82f6',
  us: '#f59e0b',
  tech: '#8b5cf6',
  science: '#10b981',
  markets: '#ef4444',
};

const CATEGORY_TABS: { id: GlobeNewsCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'world', label: 'World' },
  { id: 'us', label: 'US' },
  { id: 'tech', label: 'Tech' },
  { id: 'science', label: 'Sci' },
  { id: 'markets', label: 'Markets' },
];

export class GlobePanel extends Panel {
  private globe: unknown = null;
  private globeModule: unknown = null;
  private allArticles: GlobeNewsArticle[] = [];
  private newsMarkers: GlobeMarker[] = [];
  private weatherPins: GlobeWeatherPin[] = [];
  private activeCategory: GlobeNewsCategory | 'all' = 'all';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private isUserInteracting = false;
  private popupEl: HTMLElement | null = null;
  private feedListEl: HTMLElement | null = null;
  private feedCountEl: HTMLElement | null = null;
  private terminatorInterval: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private panelDataHandler: ((e: Event) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    super({
      id: 'globe',
      title: 'World Monitor',
      enabled: true,
      refreshInterval: 600000,
      priority: 1,
      category: 'world',
      supportedSizes: ['large'],
    });
    this.listenForPanelData();
    this.setupVisibilityHandler();
  }

  getLastData(): GlobeNewsArticle[] | null {
    return this.allArticles.length > 0 ? this.allArticles : null;
  }

  async fetchData(): Promise<void> {
    try {
      this.allArticles = await fetchAllNews();
    } catch {
      // Keep existing articles if fetch fails
      if (this.allArticles.length === 0) {
        this.allArticles = [];
      }
    }
    this.updateMarkers();
    this.render(null);

    // Dispatch panel-data for Pulse Bar
    if (this.allArticles.length > 0) {
      document.dispatchEvent(new CustomEvent('dashview:panel-data', {
        detail: { panelId: 'globe', data: { articles: this.allArticles, fetchedAt: Date.now() } },
      }));
    }
  }

  render(_data: unknown): void {
    this.renderAtSize('large');
  }

  renderAtSize(_size: WidgetSize): void {
    this.cleanup();
    this.contentEl.textContent = '';

    const loading = createElement('div', { className: 'globe-loading' });
    loading.textContent = 'Loading globe\u2026';
    this.contentEl.appendChild(loading);

    void this.loadAndInit();
  }

  private async loadAndInit(): Promise<void> {
    try {
      if (!this.globeModule) {
        this.globeModule = await import('globe.gl');
      }

      this.contentEl.textContent = '';
      this.renderLarge();
    } catch (err) {
      this.contentEl.textContent = '';
      const errMsg = createElement('div', { className: 'globe-loading' });
      errMsg.textContent = 'Failed to load globe';
      this.contentEl.appendChild(errMsg);
      console.error('Globe.gl load error:', err);
    }
  }

  private renderLarge(): void {
    const wrap = createElement('div', { className: 'globe-monitor-wrap' });

    // Globe container (left pane)
    const container = createElement('div', { className: 'globe-container' });
    wrap.appendChild(container);

    // Feed panel (right pane)
    const feed = createElement('div', { className: 'globe-feed' });

    // Feed header
    const header = createElement('div', { className: 'globe-feed-header' });
    const liveDot = createElement('span', { className: 'globe-live-dot' });
    const headerText = createElement('span', { textContent: 'LIVE FEED' });
    const countEl = createElement('span', { className: 'globe-feed-header-count' });
    this.feedCountEl = countEl;
    header.appendChild(liveDot);
    header.appendChild(headerText);
    header.appendChild(countEl);
    feed.appendChild(header);

    // Category tabs
    const tabs = createElement('div', { className: 'globe-feed-tabs' });
    for (const cat of CATEGORY_TABS) {
      const btn = createElement('button', {
        className: `globe-feed-tab ${cat.id === this.activeCategory ? 'globe-feed-tab-active' : ''}`,
      });
      if (cat.id !== 'all') {
        const dot = createElement('span', { className: 'globe-feed-tab-dot' });
        dot.style.background = CATEGORY_COLORS[cat.id as GlobeNewsCategory];
        btn.appendChild(dot);
      }
      btn.appendChild(document.createTextNode(cat.label));
      btn.addEventListener('click', () => {
        this.activeCategory = cat.id as GlobeNewsCategory | 'all';
        this.updateMarkers();
        this.updateFeedList();
        // Update tab active states
        tabs.querySelectorAll('.globe-feed-tab').forEach((t, i) => {
          t.classList.toggle('globe-feed-tab-active', CATEGORY_TABS[i].id === this.activeCategory);
        });
        // Update globe markers, labels, and rings
        if (this.globe) {
          const g = this.globe as GlobeInstance;
          g.pointsData(this.newsMarkers);
          g.ringsData(this.newsMarkers);
          this.updateLabels(g);
        }
      });
      tabs.appendChild(btn);
    }
    feed.appendChild(tabs);

    // Feed list
    const feedList = createElement('div', { className: 'globe-feed-list' });
    this.feedListEl = feedList;
    feed.appendChild(feedList);

    wrap.appendChild(feed);
    this.contentEl.appendChild(wrap);

    this.initGlobe(container);
    this.updateFeedList();
  }

  private getFilteredArticles(): GlobeNewsArticle[] {
    if (this.activeCategory === 'all') return this.allArticles;
    return this.allArticles.filter(a => a.category === this.activeCategory);
  }

  private updateFeedList(): void {
    if (!this.feedListEl) return;
    this.feedListEl.textContent = '';

    const articles = this.getFilteredArticles();

    if (this.feedCountEl) {
      this.feedCountEl.textContent = `${articles.length} articles`;
    }

    if (articles.length === 0) {
      const empty = createElement('div', { className: 'globe-feed-empty' });
      empty.textContent = 'No articles available';
      this.feedListEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const item = createElement('div', { className: 'globe-feed-item' });
      item.dataset.index = String(i);

      // Category dot
      const dot = createElement('div', { className: 'globe-feed-item-dot' });
      dot.style.background = CATEGORY_COLORS[article.category] || '#3b82f6';
      item.appendChild(dot);

      // Content
      const content = createElement('div', { className: 'globe-feed-item-content' });

      const title = createElement('div', { className: 'globe-feed-item-title' });
      title.textContent = article.title;
      content.appendChild(title);

      const meta = createElement('div', { className: 'globe-feed-item-meta' });
      const source = createElement('span', {
        className: 'globe-feed-item-source',
        textContent: article.source,
      });
      meta.appendChild(source);

      if (article.pubDate) {
        const time = this.relativeTime(article.pubDate);
        if (time) {
          meta.appendChild(document.createTextNode(` \u00B7 ${time}`));
        }
      }
      content.appendChild(meta);
      item.appendChild(content);

      // Click to fly to location
      item.addEventListener('click', () => {
        if (this.globe && article.lat && article.lon) {
          const g = this.globe as GlobeInstance;
          if (g.pointOfView) {
            g.pointOfView({ lat: article.lat, lng: article.lon, altitude: 1.5 }, 1000);
          }
        }

        // Highlight this item
        this.feedListEl?.querySelectorAll('.globe-feed-item-active').forEach(el => {
          el.classList.remove('globe-feed-item-active');
        });
        item.classList.add('globe-feed-item-active');

        // Open article link
        if (article.link) {
          window.open(article.link, '_blank', 'noopener');
        }
      });

      this.feedListEl.appendChild(item);
    }
  }

  private initGlobe(container: HTMLElement): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = this.globeModule as any;
    const GlobeFactory = (mod.default || mod) as (...args: any[]) => GlobeInstance;
    const g: GlobeInstance = GlobeFactory();

    g.globeImageUrl(GLOBE_IMAGE_URL)
     .backgroundColor('rgba(0,0,0,0)')
     .atmosphereColor('#60a5fa')
     .atmosphereAltitude(0.25)
     .showAtmosphere(true);

    // Points (news markers)
    g.pointsData(this.newsMarkers)
     .pointLat((d: GlobeMarker) => d.lat)
     .pointLng((d: GlobeMarker) => d.lng)
     .pointAltitude(0.01)
     .pointRadius((d: GlobeMarker) => d.size)
     .pointColor((d: GlobeMarker) => d.color);

    // Labels — top markers by article count
    this.updateLabels(g);

    // Pulsing rings at marker locations
    g.ringsData(this.newsMarkers)
     .ringLat((d: GlobeMarker) => d.lat)
     .ringLng((d: GlobeMarker) => d.lng)
     .ringColor(() => (t: number) => `rgba(59, 130, 246, ${1 - t})`)
     .ringMaxRadius(3)
     .ringPropagationSpeed(1)
     .ringRepeatPeriod(2000);

    // Day/night terminator polygon
    const terminatorData = this.buildTerminatorData();
    g.polygonsData(terminatorData)
     .polygonCapColor(() => 'rgba(0, 0, 0, 0.15)')
     .polygonSideColor(() => 'rgba(0, 0, 0, 0)')
     .polygonStrokeColor(() => 'rgba(59, 130, 246, 0.15)');

    // Weather pins as HTML markers
    if (this.weatherPins.length > 0) {
      g.htmlElementsData(this.weatherPins)
       .htmlLat((d: GlobeWeatherPin) => d.lat)
       .htmlLng((d: GlobeWeatherPin) => d.lng)
       .htmlElement((d: GlobeWeatherPin) => this.createWeatherPinEl(d));
    }

    // Click marker → scroll feed to matching articles
    g.onPointClick((point: GlobeMarker) => {
      this.highlightFeedForMarker(point);
    });

    g(container);
    this.globe = g;

    // Auto-rotation
    const controls = g.controls?.() as Record<string, unknown> | null;
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.enableRotate = true;

      const el = container.querySelector('canvas');
      if (el) {
        el.addEventListener('pointerdown', () => {
          this.isUserInteracting = true;
          if (controls) controls.autoRotate = false;
          if (this.idleTimer) clearTimeout(this.idleTimer);
        });
        el.addEventListener('pointerup', () => {
          this.isUserInteracting = false;
          this.idleTimer = setTimeout(() => {
            if (controls) controls.autoRotate = true;
          }, IDLE_RESUME_MS);
        });
      }
    }

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width > 0 && height > 0) {
        g.width(width).height(height);
      }
    });
    this.resizeObserver.observe(container);

    // Terminator update interval
    this.terminatorInterval = setInterval(() => {
      const data = this.buildTerminatorData();
      g.polygonsData(data);
    }, 60000);
  }

  private updateLabels(g: GlobeInstance): void {
    const topMarkers = [...this.newsMarkers]
      .sort((a, b) => b.articles.length - a.articles.length)
      .slice(0, 12);

    const labelData = topMarkers.map(m => ({
      lat: m.lat,
      lng: m.lng,
      text: m.articles[0].title.length > 40
        ? m.articles[0].title.slice(0, 40) + '\u2026'
        : m.articles[0].title,
      color: m.color,
      size: 0.4,
    }));

    g.labelsData(labelData)
     .labelLat((d: { lat: number }) => d.lat)
     .labelLng((d: { lng: number }) => d.lng)
     .labelText((d: { text: string }) => d.text)
     .labelSize((d: { size: number }) => d.size)
     .labelColor((d: { color: string }) => d.color)
     .labelResolution(2)
     .labelAltitude(0.01);
  }

  private highlightFeedForMarker(marker: GlobeMarker): void {
    if (!this.feedListEl) return;

    const articles = this.getFilteredArticles();
    // Find articles matching this marker's location
    const matchIndices: number[] = [];
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      if (Math.abs(a.lat - marker.lat) < 1 && Math.abs(a.lon - marker.lng) < 1) {
        matchIndices.push(i);
      }
    }

    // Clear existing highlights
    this.feedListEl.querySelectorAll('.globe-feed-item-active').forEach(el => {
      el.classList.remove('globe-feed-item-active');
    });

    if (matchIndices.length > 0) {
      const firstIdx = matchIndices[0];
      const items = this.feedListEl.querySelectorAll('.globe-feed-item');
      for (const idx of matchIndices) {
        if (items[idx]) {
          items[idx].classList.add('globe-feed-item-active');
        }
      }
      // Scroll to first match
      if (items[firstIdx]) {
        items[firstIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  private buildTerminatorData(): object[] {
    const points = buildTerminatorPolygon();
    return [{
      type: 'night',
      coords: [points.map(p => [p.lng, p.lat])],
    }];
  }

  private createWeatherPinEl(pin: GlobeWeatherPin): HTMLElement {
    const el = document.createElement('div');
    el.className = 'globe-weather-pin';
    const temp = document.createElement('span');
    temp.className = 'globe-weather-temp';
    temp.textContent = `${Math.round(pin.temp)}\u00B0`;
    const cond = document.createElement('span');
    cond.className = 'globe-weather-cond';
    cond.textContent = pin.condition;
    el.appendChild(temp);
    el.appendChild(cond);
    return el;
  }

  private updateMarkers(): void {
    const articles = this.getFilteredArticles();

    const groups = new Map<string, GlobeNewsArticle[]>();
    for (const article of articles) {
      if (!article.lat || !article.lon) continue;
      const key = `${Math.round(article.lat)},${Math.round(article.lon)}`;
      const group = groups.get(key);
      if (group) {
        group.push(article);
      } else {
        groups.set(key, [article]);
      }
    }

    this.newsMarkers = [];
    for (const [, groupArticles] of groups) {
      const first = groupArticles[0];
      // Use the most common category color in the group
      const categoryCounts = new Map<GlobeNewsCategory, number>();
      for (const a of groupArticles) {
        categoryCounts.set(a.category, (categoryCounts.get(a.category) || 0) + 1);
      }
      let topCategory: GlobeNewsCategory = first.category;
      let topCount = 0;
      for (const [cat, count] of categoryCounts) {
        if (count > topCount) {
          topCategory = cat;
          topCount = count;
        }
      }

      this.newsMarkers.push({
        lat: first.lat,
        lng: first.lon,
        size: Math.min(0.8, 0.3 + groupArticles.length * 0.1),
        color: CATEGORY_COLORS[topCategory] || '#3b82f6',
        articles: groupArticles,
        label: first.sourceCountry || first.source,
      });
    }

    // Update globe if initialized
    if (this.globe) {
      const g = this.globe as GlobeInstance;
      g.pointsData(this.newsMarkers);
      g.ringsData(this.newsMarkers);
      this.updateLabels(g);
    }
  }

  private listenForPanelData(): void {
    this.panelDataHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { panelId: string; data: unknown };
      if (detail.panelId === 'weather') {
        this.updateWeatherPins(detail.data);
      }
    };
    document.addEventListener('dashview:panel-data', this.panelDataHandler);
  }

  private updateWeatherPins(data: unknown): void {
    try {
      const locStr = localStorage.getItem('dashview-location');
      if (!locStr) return;
      const loc = JSON.parse(locStr) as { lat: number; lon: number; name?: string };
      if (!loc.lat || !loc.lon) return;

      const w = data as { current?: { temp: number; condition: string }; name?: string };
      if (!w?.current) return;

      this.weatherPins = [{
        lat: loc.lat,
        lng: loc.lon,
        temp: w.current.temp,
        condition: w.current.condition,
        name: w.name || loc.name || 'Location',
      }];

      if (this.globe) {
        const g = this.globe as GlobeInstance;
        g.htmlElementsData(this.weatherPins);
      }
    } catch {
      // Weather data not available yet
    }
  }

  private setupVisibilityHandler(): void {
    this.visibilityHandler = () => {
      if (!this.globe) return;
      const controls = (this.globe as GlobeInstance).controls?.() as Record<string, unknown> | null;
      if (!controls) return;

      if (document.hidden) {
        controls.autoRotate = false;
      } else if (!this.isUserInteracting) {
        controls.autoRotate = true;
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
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

  private cleanup(): void {
    this.hidePopup();

    if (this.terminatorInterval) {
      clearInterval(this.terminatorInterval);
      this.terminatorInterval = null;
    }

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.globe) {
      try {
        const g = this.globe as GlobeInstance;
        const renderer = g.renderer?.() as { dispose?: () => void; forceContextLoss?: () => void; domElement?: HTMLElement } | null;
        if (renderer) {
          renderer.dispose?.();
          renderer.forceContextLoss?.();
          renderer.domElement?.remove();
        }
        const scene = g.scene?.() as { clear?: () => void } | null;
        scene?.clear?.();
      } catch {
        // Best-effort cleanup
      }
      this.globe = null;
    }

    this.feedListEl = null;
    this.feedCountEl = null;
  }

  private hidePopup(): void {
    if (this.popupEl) {
      this.popupEl.remove();
      this.popupEl = null;
    }
  }

  destroy(): void {
    this.cleanup();

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    if (this.panelDataHandler) {
      document.removeEventListener('dashview:panel-data', this.panelDataHandler);
      this.panelDataHandler = null;
    }

    super.destroy();
  }
}
