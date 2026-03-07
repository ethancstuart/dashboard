import type { PanelConfig, UserTier } from '../types/index.ts';
import { createElement, qs } from '../utils/dom.ts';
import { hasAccess } from '../services/tier.ts';

export abstract class Panel {
  readonly id: string;
  readonly title: string;
  enabled: boolean;
  refreshInterval: number;
  readonly requiredTier: UserTier;
  readonly priority: number;
  collapsed: boolean;
  lastUpdated: number | null = null;
  container: HTMLElement;
  protected contentEl: HTMLElement;
  protected errorEl: HTMLElement;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: PanelConfig & { requiredTier?: UserTier }) {
    this.id = config.id;
    this.title = config.title;
    this.enabled = config.enabled;
    this.refreshInterval = config.refreshInterval;
    this.requiredTier = config.requiredTier || 'guest';
    this.priority = config.priority ?? 1;
    this.collapsed = false;
    this.container = this.createContainer();
    this.contentEl = qs<HTMLElement>('.panel-content', this.container)!;
    this.errorEl = qs<HTMLElement>('.panel-error', this.container)!;
  }

  private createContainer(): HTMLElement {
    const card = createElement('div', { className: 'panel-card' });
    card.dataset.panelId = this.id;
    card.setAttribute('role', 'region');
    const titleId = `panel-title-${this.id}`;
    card.setAttribute('aria-labelledby', titleId);

    // Header
    const header = createElement('div', { className: 'panel-header' });
    const titleEl = document.createElement('h2');
    titleEl.className = 'panel-title';
    titleEl.textContent = this.title;
    titleEl.id = titleId;
    const collapseBtn = createElement('button', {
      className: 'panel-collapse-btn',
      textContent: '\u25B4',
    });
    collapseBtn.setAttribute('aria-label', 'Collapse panel');
    collapseBtn.setAttribute('aria-expanded', 'true');
    header.addEventListener('click', () => {
      this.setCollapsed(!this.collapsed);
    });
    header.appendChild(titleEl);
    header.appendChild(collapseBtn);

    // Content
    const content = createElement('div', { className: 'panel-content' });

    // Error
    const error = createElement('div', { className: 'panel-error' });
    error.setAttribute('role', 'alert');
    error.style.display = 'none';

    card.appendChild(header);
    card.appendChild(content);
    card.appendChild(error);

    return card;
  }

  abstract fetchData(): Promise<void>;
  abstract render(data: unknown): void;

  attachToDOM(parent?: HTMLElement): void {
    const root = parent ?? document.getElementById('app');
    if (!root) return;
    root.appendChild(this.container);

    if (!this.enabled) {
      this.container.style.display = 'none';
      return;
    }

    if (this.requiredTier !== 'guest' && !hasAccess(this.requiredTier)) {
      this.showLocked();
      return;
    }

    this.showLoading();
  }

  async startDataCycle(): Promise<void> {
    if (!this.enabled) return;
    if (this.requiredTier !== 'guest' && !hasAccess(this.requiredTier)) return;
    await this.refresh();
    this.startInterval();
  }

  async init(parent?: HTMLElement): Promise<void> {
    this.attachToDOM(parent);
    await this.startDataCycle();
  }

  private showLocked(): void {
    this.contentEl.innerHTML = '';
    const overlay = createElement('div', { className: 'panel-locked' });
    const icon = createElement('div', { className: 'panel-locked-icon', textContent: '\uD83D\uDD12' });
    const label = createElement('div', { className: 'panel-locked-label', textContent: 'Premium Feature' });
    const desc = createElement('div', {
      className: 'panel-locked-desc',
      textContent: 'Unlock AI chat, calendar sync, custom layouts, and more with Premium.',
    });
    const btn = createElement('a', {
      className: 'panel-locked-btn',
      textContent: 'Go Premium',
    }) as HTMLAnchorElement;
    btn.href = '#/roadmap';
    overlay.appendChild(icon);
    overlay.appendChild(label);
    overlay.appendChild(desc);
    overlay.appendChild(btn);
    this.contentEl.appendChild(overlay);
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.container.classList.toggle('panel-collapsed', collapsed);
    const btn = this.container.querySelector('.panel-collapse-btn');
    if (btn) {
      btn.textContent = collapsed ? '\u25BE' : '\u25B4';
      btn.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    this.container.dispatchEvent(new CustomEvent('panel:statechange', { bubbles: true }));
  }

  toggle(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.container.style.display = '';
      this.refresh();
      this.startInterval();
    } else {
      this.container.style.display = 'none';
      this.stopInterval();
    }
  }

  showError(message: string): void {
    this.errorEl.textContent = '';
    const msg = createElement('span', { textContent: message });
    const retryBtn = createElement('button', { className: 'panel-retry-btn', textContent: 'Retry' });
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.refresh();
    });
    this.errorEl.appendChild(msg);
    this.errorEl.appendChild(retryBtn);
    this.errorEl.style.display = '';
    this.contentEl.style.display = 'none';
  }

  showLoading(): void {
    this.errorEl.style.display = 'none';
    this.contentEl.style.display = '';
    this.contentEl.innerHTML = '<div class="panel-loading"><div class="panel-loading-dot"></div></div>';
  }

  destroy(): void {
    this.stopInterval();
    this.container.remove();
  }

  async refresh(): Promise<void> {
    try {
      this.showLoading();
      await this.fetchData();
      this.lastUpdated = Date.now();
      this.renderLastUpdated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load data';
      this.showError(msg);
    }
  }

  protected renderLastUpdated(): void {
    if (!this.lastUpdated) return;
    let badge = this.container.querySelector('.panel-last-updated') as HTMLElement;
    if (!badge) {
      badge = createElement('div', { className: 'panel-last-updated' });
      this.contentEl.appendChild(badge);
    }
    const ago = this.formatTimeAgo(this.lastUpdated);
    badge.textContent = `Updated ${ago}`;
  }

  private formatTimeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
  }

  private startInterval(): void {
    this.stopInterval();
    if (this.refreshInterval > 0) {
      this.intervalId = setInterval(() => void this.refresh(), this.refreshInterval);
    }
  }

  private stopInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
