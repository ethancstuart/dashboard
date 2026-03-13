import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchEntertainment } from '../services/entertainment.ts';
import * as storage from '../services/storage.ts';
import type { EntertainmentTab, EntertainmentData, EntertainmentItem } from '../types/index.ts';

const TAB_KEY = 'dashview-entertainment-tab';

const TABS: { id: EntertainmentTab; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'movies', label: 'Movies' },
  { id: 'tv', label: 'TV' },
  { id: 'upcoming', label: 'Upcoming' },
];

export class EntertainmentPanel extends Panel {
  private tab: EntertainmentTab;
  private data: EntertainmentData | null = null;

  getLastData(): EntertainmentData | null {
    return this.data;
  }

  constructor() {
    super({
      id: 'entertainment',
      title: 'Entertainment',
      enabled: true,
      refreshInterval: 300000,
      priority: 2,
    });
    this.tab = storage.get<EntertainmentTab>(TAB_KEY, 'trending');
  }

  async fetchData(): Promise<void> {
    this.data = await fetchEntertainment(this.tab);
    this.render(this.data);
  }

  render(_data: unknown): void {
    this.contentEl.textContent = '';

    // Tab bar
    const tabs = createElement('div', { className: 'news-tabs' });
    for (const t of TABS) {
      const btn = createElement('button', {
        className: `news-tab ${t.id === this.tab ? 'news-tab-active' : ''}`,
        textContent: t.label,
      });
      btn.addEventListener('click', () => {
        if (t.id === this.tab) return;
        this.tab = t.id;
        storage.set(TAB_KEY, this.tab);
        void this.fetchData();
      });
      tabs.appendChild(btn);
    }
    this.contentEl.appendChild(tabs);

    if (!this.data || this.data.items.length === 0) {
      const empty = createElement('div', {
        className: 'panel-empty-state',
        textContent: 'No entertainment data available.',
      });
      this.contentEl.appendChild(empty);
      return;
    }

    // Content list
    const list = createElement('div', { className: 'entertainment-list' });
    for (const item of this.data.items) {
      list.appendChild(this.createContentCard(item));
    }
    this.contentEl.appendChild(list);
  }

  private createContentCard(item: EntertainmentItem): HTMLElement {
    const card = createElement('div', { className: 'entertainment-card' });

    // Poster
    if (item.posterPath) {
      const img = document.createElement('img');
      img.src = `https://image.tmdb.org/t/p/w154${item.posterPath}`;
      img.alt = item.title;
      img.className = 'entertainment-poster';
      img.width = 77;
      img.height = 115;
      img.loading = 'lazy';
      card.appendChild(img);
    } else {
      const placeholder = createElement('div', {
        className: 'entertainment-poster-placeholder',
        textContent: '\uD83C\uDFAC',
      });
      card.appendChild(placeholder);
    }

    // Info
    const info = createElement('div', { className: 'entertainment-card-info' });

    const title = createElement('div', {
      className: 'entertainment-card-title',
      textContent: item.title,
    });
    info.appendChild(title);

    // Meta row
    const meta = createElement('div', { className: 'entertainment-meta' });

    if (item.year) {
      const year = createElement('span', { textContent: item.year });
      meta.appendChild(year);
    }

    const badge = createElement('span', {
      className: 'entertainment-media-badge',
      textContent: item.mediaType === 'movie' ? 'MOVIE' : 'TV',
    });
    meta.appendChild(badge);

    const ratingClass = item.rating >= 7 ? 'entertainment-rating-high'
      : item.rating >= 5 ? 'entertainment-rating-mid'
      : 'entertainment-rating-low';
    const rating = createElement('span', {
      className: `entertainment-rating ${ratingClass}`,
      textContent: item.rating.toFixed(1),
    });
    meta.appendChild(rating);

    info.appendChild(meta);

    // Overview
    if (item.overview) {
      const overview = createElement('div', {
        className: 'entertainment-overview',
        textContent: item.overview,
      });
      info.appendChild(overview);
    }

    card.appendChild(info);
    return card;
  }
}
