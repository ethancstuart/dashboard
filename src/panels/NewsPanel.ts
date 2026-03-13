import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchNews, getCustomFeeds } from '../services/news.ts';
import { fetchSocialFeed } from '../services/social.ts';
import * as storage from '../services/storage.ts';
import type { NewsCategory, NewsData, NewsArticle, SocialPost } from '../types/index.ts';

// Detect non-Latin scripts (CJK, Arabic, Cyrillic, etc.)
const NON_LATIN_RE = /[\u3000-\u9FFF\uAC00-\uD7AF\u0600-\u06FF\u0400-\u04FF\u1100-\u11FF\uFE30-\uFE4F]/;

const CATEGORY_KEY = 'dashview-news-category';
const CATEGORIES: { id: NewsCategory; label: string }[] = [
  { id: 'us', label: 'US' },
  { id: 'world', label: 'World' },
  { id: 'markets', label: 'Markets' },
  { id: 'tech', label: 'Tech' },
  { id: 'science', label: 'Sci' },
  { id: 'entertainment', label: 'Ent' },
  { id: 'x', label: 'X' },
];

export class NewsPanel extends Panel {
  private newsCategory: NewsCategory;
  private data: NewsData | null = null;
  private socialPosts: SocialPost[] = [];

  constructor() {
    super({
      id: 'news',
      title: 'World News',
      enabled: true,
      refreshInterval: 600000,
      priority: 1,
      category: 'world',
    });
    this.newsCategory = storage.get<NewsCategory>(CATEGORY_KEY, 'us');
    // Migrate old 'business' category to 'markets'
    if ((this.newsCategory as string) === 'business') {
      this.newsCategory = 'markets';
      storage.set(CATEGORY_KEY, this.newsCategory);
    }
  }

  getLastData(): NewsData | null {
    return this.data;
  }

  async fetchData(): Promise<void> {
    if (this.newsCategory === 'x') {
      try {
        this.socialPosts = await fetchSocialFeed();
      } catch {
        this.socialPosts = [];
      }
      this.render(null);
      return;
    }
    this.data = await fetchNews(this.newsCategory);
    this.render(this.data);
  }

  render(data: unknown): void {
    this.contentEl.textContent = '';

    // Build category list, conditionally including 'custom' tab
    const hasCustomFeeds = getCustomFeeds().filter(f => f.enabled).length > 0;
    const allCategories = [...CATEGORIES];
    if (hasCustomFeeds) {
      allCategories.push({ id: 'custom', label: 'Custom' });
    }

    // Tabs row with gear button
    const tabsRow = createElement('div', { className: 'news-tabs' });
    for (const cat of allCategories) {
      const btn = createElement('button', {
        className: `news-tab ${cat.id === this.newsCategory ? 'news-tab-active' : ''}`,
        textContent: cat.label,
      });
      btn.addEventListener('click', () => {
        if (cat.id === this.newsCategory) return;
        this.newsCategory = cat.id;
        storage.set(CATEGORY_KEY, this.newsCategory);
        void this.fetchData();
      });
      tabsRow.appendChild(btn);
    }

    // Gear button to open feeds modal
    const gearBtn = createElement('button', { className: 'news-gear-btn', textContent: '\u2699' });
    gearBtn.title = 'Manage feeds';
    gearBtn.addEventListener('click', () => {
      import('../ui/feedsModal.ts').then(m => m.openFeedsModal());
    });
    tabsRow.appendChild(gearBtn);

    this.contentEl.appendChild(tabsRow);

    // X tab: render social posts
    if (this.newsCategory === 'x') {
      this.renderSocialFeed();
      return;
    }

    const d = data as NewsData;
    if (!d) return;

    // Filter to English-only articles
    const englishArticles = d.articles.filter((a) => !NON_LATIN_RE.test(a.title));

    if (englishArticles.length === 0) {
      const empty = createElement('div', { className: 'news-empty', textContent: 'No articles available' });
      this.contentEl.appendChild(empty);
      return;
    }

    // Article list
    const list = createElement('div', { className: 'news-list news-panel-articles' });
    for (const article of englishArticles) {
      list.appendChild(this.createArticleRow(article));
    }
    this.contentEl.appendChild(list);
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
