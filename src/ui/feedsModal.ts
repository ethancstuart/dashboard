import { createElement } from '../utils/dom.ts';
import { getCustomFeeds, saveCustomFeeds } from '../services/news.ts';
import { getCurrentTier } from '../services/tier.ts';
import type { CustomFeed } from '../types/index.ts';

let overlay: HTMLElement | null = null;

const CURATED_FEEDS = [
  // Tech
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'Tech', lat: 37.77, lon: -122.42 },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'Tech', lat: 40.74, lon: -73.99 },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'Tech', lat: 37.77, lon: -122.42 },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', category: 'Tech', lat: 37.77, lon: -122.42 },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage', category: 'Tech', lat: 37.77, lon: -122.42 },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/', category: 'Tech', lat: 42.36, lon: -71.09 },
  // Business
  { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', category: 'Business', lat: 40.72, lon: -74.0 },
  { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss', category: 'Business', lat: 40.76, lon: -73.98 },
  { name: 'Financial Times', url: 'https://www.ft.com/?format=rss', category: 'Business', lat: 51.51, lon: -0.13 },
  { name: 'Forbes', url: 'https://www.forbes.com/innovation/feed/', category: 'Business', lat: 40.74, lon: -73.99 },
  { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', category: 'Business', lat: 40.71, lon: -74.01 },
  // World News
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'World', lat: 51.51, lon: -0.13 },
  { name: 'Reuters', url: 'https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best', category: 'World', lat: 51.51, lon: -0.13 },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'World', lat: 25.29, lon: 51.53 },
  { name: 'France24', url: 'https://www.france24.com/en/rss', category: 'World', lat: 48.86, lon: 2.35 },
  { name: 'DW News', url: 'https://rss.dw.com/xml/rss-en-all', category: 'World', lat: 50.72, lon: 7.09 },
  { name: 'NHK World', url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/', category: 'World', lat: 35.68, lon: 139.69 },
  // Science
  { name: 'Nature', url: 'https://www.nature.com/nature.rss', category: 'Science', lat: 51.53, lon: -0.13 },
  { name: 'Scientific American', url: 'https://rss.sciam.com/ScientificAmerican-Global', category: 'Science', lat: 40.74, lon: -73.99 },
  { name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', category: 'Science', lat: 38.88, lon: -77.02 },
  { name: 'Space.com', url: 'https://www.space.com/feeds/all', category: 'Science', lat: 40.74, lon: -73.99 },
  { name: 'Phys.org', url: 'https://phys.org/rss-feed/', category: 'Science', lat: 51.51, lon: -0.13 },
  // Entertainment
  { name: 'Variety', url: 'https://variety.com/feed/', category: 'Entertainment', lat: 34.06, lon: -118.36 },
  { name: 'Hollywood Reporter', url: 'https://www.hollywoodreporter.com/feed/', category: 'Entertainment', lat: 34.09, lon: -118.38 },
  { name: 'Rolling Stone', url: 'https://www.rollingstone.com/feed/', category: 'Entertainment', lat: 40.73, lon: -73.99 },
  { name: 'Pitchfork', url: 'https://pitchfork.com/feed/feed-news/rss', category: 'Entertainment', lat: 40.72, lon: -73.99 },
  // Sports
  { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news', category: 'Sports', lat: 41.36, lon: -73.2 },
  { name: 'The Athletic', url: 'https://theathletic.com/feeds/rss/news/', category: 'Sports', lat: 37.77, lon: -122.42 },
  { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', category: 'Sports', lat: 51.51, lon: -0.13 },
  // US News
  { name: 'AP News', url: 'https://rsshub.app/apnews/topics/apf-topnews', category: 'US', lat: 40.76, lon: -73.98 },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', category: 'US', lat: 38.89, lon: -77.01 },
];

function getFeedLimit(): number {
  return getCurrentTier() === 'premium' ? Infinity : 3;
}

export function openFeedsModal(): void {
  closeFeedsModal();

  overlay = createElement('div', { className: 'feeds-modal-overlay' });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeFeedsModal();
  });

  const dialog = createElement('div', { className: 'feeds-modal' });
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Manage News Feeds');

  // Header
  const header = createElement('div', { className: 'feeds-modal-header' });
  const title = createElement('div', { className: 'feeds-modal-title', textContent: 'Manage News Feeds' });
  const closeBtn = createElement('button', { className: 'briefing-close', textContent: '\u00D7' });
  closeBtn.addEventListener('click', closeFeedsModal);
  header.appendChild(title);
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  // Body
  const body = createElement('div', { className: 'feeds-modal-body' });

  let feeds = getCustomFeeds();

  // --- Curated Catalog Section ---
  const catalogTitle = createElement('div', { className: 'feeds-section-title', textContent: 'Curated Catalog' });
  body.appendChild(catalogTitle);

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'feeds-search';
  searchInput.placeholder = 'Search feeds...';
  searchInput.setAttribute('autocomplete', 'off');
  body.appendChild(searchInput);

  const catalogContainer = createElement('div', { className: 'feeds-catalog' });

  function renderCatalog(filter: string) {
    catalogContainer.textContent = '';
    const lowerFilter = filter.toLowerCase();
    let currentCategory = '';

    for (const entry of CURATED_FEEDS) {
      if (lowerFilter && !entry.name.toLowerCase().includes(lowerFilter) && !entry.category.toLowerCase().includes(lowerFilter)) {
        continue;
      }

      if (entry.category !== currentCategory) {
        currentCategory = entry.category;
        const catHeader = createElement('div', { className: 'feeds-catalog-category', textContent: currentCategory });
        catalogContainer.appendChild(catHeader);
      }

      const item = createElement('div', { className: 'feeds-catalog-item' });
      const nameEl = createElement('span', { className: 'feeds-catalog-name', textContent: entry.name });

      const toggle = createElement('button', { className: 'feeds-toggle' });
      const isEnabled = feeds.some(f => f.url === entry.url && f.enabled);
      if (isEnabled) toggle.classList.add('feeds-toggle-on');

      toggle.addEventListener('click', () => {
        const existing = feeds.find(f => f.url === entry.url);
        if (existing) {
          existing.enabled = !existing.enabled;
          toggle.classList.toggle('feeds-toggle-on', existing.enabled);
        } else {
          const limit = getFeedLimit();
          const enabledCount = feeds.filter(f => f.enabled).length;
          if (enabledCount >= limit) {
            statusEl.textContent = `Feed limit reached (${limit}). Upgrade for unlimited.`;
            return;
          }
          const newFeed: CustomFeed = {
            id: crypto.randomUUID(),
            url: entry.url,
            name: entry.name,
            lat: entry.lat,
            lon: entry.lon,
            enabled: true,
          };
          feeds.push(newFeed);
          toggle.classList.add('feeds-toggle-on');
        }
        saveCustomFeeds(feeds);
        renderActiveList();
      });

      item.appendChild(nameEl);
      item.appendChild(toggle);
      catalogContainer.appendChild(item);
    }
  }

  renderCatalog('');
  searchInput.addEventListener('input', () => renderCatalog(searchInput.value.trim()));
  body.appendChild(catalogContainer);

  // --- Custom URL Section ---
  const customTitle = createElement('div', { className: 'feeds-section-title', textContent: 'Add Custom Feed' });
  body.appendChild(customTitle);

  const customRow = createElement('div', { className: 'feeds-custom-row' });
  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.className = 'feeds-custom-input';
  urlInput.placeholder = 'https://example.com/feed.xml';
  urlInput.setAttribute('autocomplete', 'off');

  const validateBtn = createElement('button', { className: 'feeds-validate-btn', textContent: 'Validate' });
  customRow.appendChild(urlInput);
  customRow.appendChild(validateBtn);
  body.appendChild(customRow);

  const validationResult = createElement('div', { className: 'feeds-validation-result' });
  body.appendChild(validationResult);

  let validatedFeed: { title: string; url: string } | null = null;

  const addRow = createElement('div', { className: 'feeds-custom-row' });
  const addBtn = createElement('button', { className: 'feeds-add-btn', textContent: 'Add Feed' });
  addBtn.style.display = 'none';
  addRow.appendChild(addBtn);
  body.appendChild(addRow);

  validateBtn.addEventListener('click', async () => {
    const feedUrl = urlInput.value.trim();
    if (!feedUrl) return;

    validateBtn.setAttribute('disabled', '');
    validateBtn.textContent = 'Checking...';
    validationResult.textContent = '';
    validationResult.className = 'feeds-validation-result';
    validatedFeed = null;
    addBtn.style.display = 'none';

    try {
      const res = await fetch('/api/news-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: feedUrl }),
      });
      const data = await res.json();

      if (res.ok && data.valid) {
        validationResult.textContent = `Valid feed: "${data.title}" (${data.itemCount} items)`;
        validationResult.className = 'feeds-validation-result feeds-validation-success';
        validatedFeed = { title: data.title, url: feedUrl };
        addBtn.style.display = '';
      } else {
        validationResult.textContent = data.error || 'Could not validate feed';
        validationResult.className = 'feeds-validation-result feeds-validation-error';
      }
    } catch {
      validationResult.textContent = 'Network error. Please try again.';
      validationResult.className = 'feeds-validation-result feeds-validation-error';
    } finally {
      validateBtn.removeAttribute('disabled');
      validateBtn.textContent = 'Validate';
    }
  });

  addBtn.addEventListener('click', () => {
    if (!validatedFeed) return;

    const limit = getFeedLimit();
    const enabledCount = feeds.filter(f => f.enabled).length;
    if (enabledCount >= limit) {
      statusEl.textContent = `Feed limit reached (${limit}). Upgrade for unlimited.`;
      return;
    }

    // Check for duplicate
    if (feeds.some(f => f.url === validatedFeed!.url)) {
      statusEl.textContent = 'This feed is already added.';
      return;
    }

    const newFeed: CustomFeed = {
      id: crypto.randomUUID(),
      url: validatedFeed.url,
      name: validatedFeed.title,
      enabled: true,
    };
    feeds.push(newFeed);
    saveCustomFeeds(feeds);

    urlInput.value = '';
    validationResult.textContent = '';
    validatedFeed = null;
    addBtn.style.display = 'none';

    renderActiveList();
    renderCatalog(searchInput.value.trim());
  });

  // --- Active Feeds Section ---
  const activeTitle = createElement('div', { className: 'feeds-section-title', textContent: 'Active Feeds' });
  body.appendChild(activeTitle);

  const activeList = createElement('div', { className: 'feeds-active-list' });
  body.appendChild(activeList);

  const statusEl = createElement('div', { className: 'feeds-status' });
  body.appendChild(statusEl);

  function renderActiveList() {
    activeList.textContent = '';
    const enabledFeeds = feeds.filter(f => f.enabled);

    if (enabledFeeds.length === 0) {
      const empty = createElement('div', { className: 'feeds-validation-result', textContent: 'No feeds enabled yet.' });
      activeList.appendChild(empty);
      return;
    }

    for (const feed of enabledFeeds) {
      const item = createElement('div', { className: 'feeds-active-item' });
      const nameEl = createElement('span', { className: 'feeds-active-name', textContent: feed.name });
      const urlEl = createElement('span', { className: 'feeds-active-url', textContent: feed.url });
      const deleteBtn = createElement('button', { className: 'feeds-delete-btn', textContent: '\u00D7' });

      deleteBtn.addEventListener('click', () => {
        feeds = feeds.filter(f => f.id !== feed.id);
        saveCustomFeeds(feeds);
        renderActiveList();
        renderCatalog(searchInput.value.trim());
      });

      item.appendChild(nameEl);
      item.appendChild(urlEl);
      item.appendChild(deleteBtn);
      activeList.appendChild(item);
    }

    const limit = getFeedLimit();
    const countText = limit === Infinity
      ? `${enabledFeeds.length} feeds enabled`
      : `${enabledFeeds.length}/${limit} feeds enabled`;
    statusEl.textContent = countText;
  }

  renderActiveList();

  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeFeedsModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

export function closeFeedsModal(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}
