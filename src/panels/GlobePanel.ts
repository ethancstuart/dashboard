import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { buildTerminatorPolygon } from '../utils/terminator.ts';
import type { NewsArticle, NewsData, WidgetSize, GlobeMarker, GlobeWeatherPin } from '../types/index.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GlobeInstance = Record<string, (...args: any[]) => any> & ((el: HTMLElement) => GlobeInstance);

const NIGHT_IMAGE_URL = '//unpkg.com/three-globe/example/img/earth-night.jpg';
const AUTO_ROTATE_SPEED = 0.3; // degrees per frame (~0.3 RPM at 60fps)
const IDLE_RESUME_MS = 3000;

export class GlobePanel extends Panel {
  private globe: unknown = null;
  private globeModule: unknown = null;
  private newsMarkers: GlobeMarker[] = [];
  private weatherPins: GlobeWeatherPin[] = [];
  private animFrameId: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private isUserInteracting = false;
  private currentSize: WidgetSize = 'medium';
  private popupEl: HTMLElement | null = null;
  private sidebarEl: HTMLElement | null = null;
  private terminatorInterval: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private panelDataHandler: ((e: Event) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    super({
      id: 'globe',
      title: 'World Monitor',
      enabled: true,
      refreshInterval: 0, // No own data fetching
      priority: 1,
      category: 'world',
      supportedSizes: ['compact', 'medium', 'large'],
    });
    this.listenForPanelData();
    this.setupVisibilityHandler();
  }

  getLastData(): null {
    return null;
  }

  async fetchData(): Promise<void> {
    // GlobePanel doesn't fetch — it consumes data from other panels
    this.render(null);
  }

  render(_data: unknown): void {
    this.renderAtSize(this.currentSize);
  }

  renderAtSize(size: WidgetSize): void {
    this.currentSize = size;
    this.cleanup();
    this.contentEl.textContent = '';

    // Show loading state while globe.gl loads
    const loading = createElement('div', { className: 'globe-loading' });
    loading.textContent = 'Loading globe\u2026';
    this.contentEl.appendChild(loading);

    void this.loadAndInit(size);
  }

  private async loadAndInit(size: WidgetSize): Promise<void> {
    try {
      if (!this.globeModule) {
        this.globeModule = await import('globe.gl');
      }

      this.contentEl.textContent = '';

      if (size === 'large') {
        this.renderLarge();
      } else if (size === 'compact') {
        this.renderCompact();
      } else {
        this.renderMedium();
      }
    } catch (err) {
      this.contentEl.textContent = '';
      const errMsg = createElement('div', { className: 'globe-loading' });
      errMsg.textContent = 'Failed to load globe';
      this.contentEl.appendChild(errMsg);
      console.error('Globe.gl load error:', err);
    }
  }

  private renderCompact(): void {
    const container = createElement('div', { className: 'globe-container globe-compact' });
    this.contentEl.appendChild(container);
    this.initGlobe(container, false);
  }

  private renderMedium(): void {
    const container = createElement('div', { className: 'globe-container globe-medium' });
    this.contentEl.appendChild(container);
    this.initGlobe(container, true);
  }

  private renderLarge(): void {
    const wrap = createElement('div', { className: 'globe-large-wrap' });

    const container = createElement('div', { className: 'globe-container globe-large' });
    wrap.appendChild(container);

    const sidebar = createElement('div', { className: 'globe-sidebar' });
    sidebar.innerHTML = '';
    this.sidebarEl = sidebar;
    wrap.appendChild(sidebar);

    this.contentEl.appendChild(wrap);
    this.initGlobe(container, true);
    this.updateSidebar();
  }

  private initGlobe(container: HTMLElement, interactive: boolean): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = this.globeModule as any;
    const GlobeFactory = (mod.default || mod) as (...args: any[]) => GlobeInstance;
    const g: GlobeInstance = GlobeFactory();

    // Configure globe
    g.globeImageUrl(NIGHT_IMAGE_URL)
     .backgroundColor('rgba(0,0,0,0)')
     .atmosphereColor('#3b82f6')
     .atmosphereAltitude(0.15)
     .showAtmosphere(true);

    // Points (news markers)
    g.pointsData(this.newsMarkers)
     .pointLat((d: GlobeMarker) => d.lat)
     .pointLng((d: GlobeMarker) => d.lng)
     .pointAltitude(0.01)
     .pointRadius((d: GlobeMarker) => d.size)
     .pointColor((d: GlobeMarker) => d.color);

    // Day/night terminator polygon
    const terminatorData = this.buildTerminatorData();
    g.polygonsData(terminatorData)
     .polygonCapColor(() => 'rgba(0, 0, 0, 0.3)')
     .polygonSideColor(() => 'rgba(0, 0, 0, 0)')
     .polygonStrokeColor(() => 'rgba(59, 130, 246, 0.15)');

    // Weather pins as HTML markers
    if (interactive && this.weatherPins.length > 0) {
      g.htmlElementsData(this.weatherPins)
       .htmlLat((d: GlobeWeatherPin) => d.lat)
       .htmlLng((d: GlobeWeatherPin) => d.lng)
       .htmlElement((d: GlobeWeatherPin) => this.createWeatherPinEl(d));
    }

    // Click handler for interactive modes
    if (interactive) {
      g.onPointClick((point: GlobeMarker, event: MouseEvent) => {
        this.showArticlePopup(point.articles, event.clientX, event.clientY);
      });
    }

    // Mount to container
    g(container);

    this.globe = g;

    // Auto-rotation
    const controls = g.controls?.() as Record<string, unknown> | null;
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
      controls.enableZoom = interactive;
      controls.enablePan = interactive;
      controls.enableRotate = interactive;

      if (interactive) {
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
    }

    // Resize observer for container
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

  private showArticlePopup(articles: NewsArticle[], x: number, y: number): void {
    this.hidePopup();

    const popup = createElement('div', { className: 'globe-popup' });
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;

    for (let i = 0; i < Math.min(articles.length, 5); i++) {
      const a = articles[i];
      if (i > 0) {
        const hr = document.createElement('hr');
        hr.className = 'globe-popup-divider';
        popup.appendChild(hr);
      }
      const link = document.createElement('a');
      link.href = a.link;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'globe-popup-link';
      link.textContent = a.title;
      popup.appendChild(link);

      const meta = createElement('div', { className: 'globe-popup-meta' });
      meta.textContent = a.source;
      popup.appendChild(meta);
    }

    document.body.appendChild(popup);
    this.popupEl = popup;

    // Close on click outside
    const closeHandler = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node)) {
        this.hidePopup();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  private hidePopup(): void {
    if (this.popupEl) {
      this.popupEl.remove();
      this.popupEl = null;
    }
  }

  private updateSidebar(): void {
    if (!this.sidebarEl) return;
    this.sidebarEl.textContent = '';

    const title = createElement('div', { className: 'globe-sidebar-title' });
    title.textContent = 'REGIONS';
    this.sidebarEl.appendChild(title);

    // Group markers by region label
    const regions = new Map<string, GlobeMarker[]>();
    for (const marker of this.newsMarkers) {
      const existing = regions.get(marker.label);
      if (existing) {
        existing.push(marker);
      } else {
        regions.set(marker.label, [marker]);
      }
    }

    if (regions.size === 0) {
      const empty = createElement('div', { className: 'globe-sidebar-empty' });
      empty.textContent = 'Waiting for news data\u2026';
      this.sidebarEl.appendChild(empty);
      return;
    }

    for (const [label, markers] of regions) {
      const row = createElement('div', { className: 'globe-sidebar-row' });
      const name = createElement('span', { className: 'globe-sidebar-name' });
      name.textContent = label;
      const count = createElement('span', { className: 'globe-sidebar-count' });
      const totalArticles = markers.reduce((sum, m) => sum + m.articles.length, 0);
      count.textContent = `${totalArticles}`;
      row.appendChild(name);
      row.appendChild(count);

      // Click to fly to region
      row.addEventListener('click', () => {
        if (this.globe) {
          const g = this.globe as GlobeInstance;
          const target = markers[0];
          if (g.pointOfView) {
            g.pointOfView({ lat: target.lat, lng: target.lng, altitude: 1.5 }, 1000);
          }
        }
      });

      this.sidebarEl.appendChild(row);
    }
  }

  private listenForPanelData(): void {
    this.panelDataHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { panelId: string; data: unknown };
      if (detail.panelId === 'news') {
        this.updateMarkers(detail.data as NewsData);
      } else if (detail.panelId === 'weather') {
        this.updateWeatherPins(detail.data);
      }
    };
    document.addEventListener('dashview:panel-data', this.panelDataHandler);
  }

  private updateMarkers(newsData: NewsData): void {
    if (!newsData?.articles) return;

    const groups = new Map<string, NewsArticle[]>();
    for (const article of newsData.articles) {
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
    for (const [, articles] of groups) {
      const first = articles[0];
      this.newsMarkers.push({
        lat: first.lat,
        lng: first.lon,
        size: Math.min(0.4, 0.15 + articles.length * 0.05),
        color: '#3b82f6',
        articles,
        label: first.sourceCountry || first.source,
      });
    }

    // Update globe if initialized
    if (this.globe && this.currentSize !== 'compact') {
      const g = this.globe as GlobeInstance;
      g.pointsData(this.newsMarkers);
    }

    if (this.sidebarEl) {
      this.updateSidebar();
    }
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

      if (this.globe && this.currentSize !== 'compact') {
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

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Dispose Three.js renderer
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

    this.sidebarEl = null;
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
