import type { PanelConfig, UserTier } from '../types/index.ts';
import { createElement, qs } from '../utils/dom.ts';
import { hasAccess } from '../services/tier.ts';

export abstract class Panel {
  readonly id: string;
  readonly title: string;
  enabled: boolean;
  refreshInterval: number;
  readonly requiredTier: UserTier;
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
    this.container = this.createContainer();
    this.contentEl = qs<HTMLElement>('.panel-content', this.container)!;
    this.errorEl = qs<HTMLElement>('.panel-error', this.container)!;
  }

  private createContainer(): HTMLElement {
    const card = createElement('div', { className: 'panel-card' });
    card.dataset.panelId = this.id;

    // Header
    const header = createElement('div', { className: 'panel-header' });
    const titleEl = createElement('span', {
      className: 'panel-title',
      textContent: this.title,
    });
    const toggleBtn = createElement('button', {
      className: 'panel-toggle',
      textContent: '\u2212',
    });
    toggleBtn.addEventListener('click', () => {
      this.toggle(!this.enabled);
    });
    header.appendChild(titleEl);
    header.appendChild(toggleBtn);

    // Content
    const content = createElement('div', { className: 'panel-content' });

    // Error
    const error = createElement('div', { className: 'panel-error' });
    error.style.display = 'none';

    card.appendChild(header);
    card.appendChild(content);
    card.appendChild(error);

    return card;
  }

  abstract fetchData(): Promise<void>;
  abstract render(data: unknown): void;

  async init(parent?: HTMLElement): Promise<void> {
    const root = parent ?? document.getElementById('app');
    if (!root) return;
    root.appendChild(this.container);

    if (!this.enabled) {
      this.container.style.display = 'none';
      return;
    }

    // Check tier access
    if (this.requiredTier !== 'guest' && !hasAccess(this.requiredTier)) {
      this.showLocked();
      return;
    }

    await this.refresh();
    this.startInterval();
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
    this.errorEl.textContent = message;
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

  private async refresh(): Promise<void> {
    try {
      this.showLoading();
      await this.fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load data';
      this.showError(msg);
    }
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
