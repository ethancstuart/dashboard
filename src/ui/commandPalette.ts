/**
 * Command Palette (Cmd+K / Ctrl+K).
 *
 * Universal keyboard-first search + jump. Opens anywhere. Searches
 * countries, entities, scenarios, pages, commands, verified signals.
 * Enter to jump, arrow keys to navigate, Esc to close.
 */

import { createElement } from '../utils/dom.ts';
import { search, groupResults, kindLabel, type SearchResult } from '../services/globalSearch.ts';

let overlayEl: HTMLElement | null = null;
let selectedIdx = 0;
let currentResults: SearchResult[] = [];

export function openCommandPalette(): void {
  if (overlayEl) {
    closeCommandPalette();
    return;
  }

  selectedIdx = 0;
  currentResults = [];

  overlayEl = createElement('div', { className: 'nw-cmdk-overlay' });

  const panel = createElement('div', { className: 'nw-cmdk-panel' });

  const header = createElement('div', { className: 'nw-cmdk-header' });
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'nw-cmdk-input';
  input.placeholder = 'Search countries, entities, scenarios, pages...';
  input.autocomplete = 'off';
  input.spellcheck = false;
  header.appendChild(input);
  panel.appendChild(header);

  const resultsEl = createElement('div', { className: 'nw-cmdk-results' });
  panel.appendChild(resultsEl);

  const footer = createElement('div', { className: 'nw-cmdk-footer' });
  footer.innerHTML = `
    <span><kbd>↑↓</kbd> navigate</span>
    <span><kbd>↵</kbd> select</span>
    <span><kbd>esc</kbd> close</span>
    <span class="nw-cmdk-footer-brand">NexusWatch Search</span>
  `;
  panel.appendChild(footer);

  overlayEl.appendChild(panel);

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeCommandPalette();
  });

  // Render a default "start typing" hint + recent searches / top countries
  renderEmptyState(resultsEl);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) {
      renderEmptyState(resultsEl);
      currentResults = [];
      selectedIdx = 0;
      return;
    }
    currentResults = search(q, 40);
    selectedIdx = 0;
    renderResults(resultsEl, currentResults);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, currentResults.length - 1);
      updateSelection(resultsEl);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      updateSelection(resultsEl);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = currentResults[selectedIdx];
      if (result) {
        navigate(result.href);
      }
    } else if (e.key === 'Escape') {
      closeCommandPalette();
    }
  });

  document.body.appendChild(overlayEl);
  setTimeout(() => input.focus(), 10);
}

export function closeCommandPalette(): void {
  overlayEl?.remove();
  overlayEl = null;
  currentResults = [];
  selectedIdx = 0;
}

function navigate(href: string): void {
  closeCommandPalette();
  if (href.startsWith('#')) {
    window.location.hash = href.slice(1);
  } else if (href.startsWith('http')) {
    window.open(href, '_blank');
  } else {
    window.location.href = href;
  }
}

function renderEmptyState(container: HTMLElement): void {
  container.innerHTML = `
    <div class="nw-cmdk-empty">
      <div class="nw-cmdk-empty-title">Start typing to search</div>
      <div class="nw-cmdk-empty-sections">
        <div>
          <div class="nw-cmdk-section-label">Jump to</div>
          <div class="nw-cmdk-quick-links">
            <a href="#/ledger">✓ The Ledger</a>
            <a href="#/ledger">🧾 The Ledger</a>
            <a href="#/briefs">☕ Briefs</a>
            <a href="#/status">📡 Status</a>
          </div>
        </div>
        <div>
          <div class="nw-cmdk-section-label">Tips</div>
          <div class="nw-cmdk-tips">
            <div>Try: <code>UA</code>, <code>hormuz</code>, <code>wagner</code>, <code>taiwan</code></div>
            <div>Commands: <code>sitrep</code>, <code>alert</code>, <code>shortcuts</code></div>
          </div>
        </div>
      </div>
    </div>
  `;
  container.querySelectorAll('.nw-cmdk-quick-links a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigate((a as HTMLAnchorElement).getAttribute('href') || '#/ledger');
    });
  });
}

function renderResults(container: HTMLElement, results: SearchResult[]): void {
  if (results.length === 0) {
    container.innerHTML = '<div class="nw-cmdk-empty"><div class="nw-cmdk-empty-title">No matches.</div></div>';
    return;
  }

  container.innerHTML = '';
  const groups = groupResults(results);
  let globalIdx = 0;

  for (const group of groups) {
    const groupEl = createElement('div', { className: 'nw-cmdk-group' });
    const label = createElement('div', { className: 'nw-cmdk-group-label' });
    label.textContent = kindLabel(group.kind);
    groupEl.appendChild(label);

    for (const r of group.items) {
      const item = createElement('div', { className: 'nw-cmdk-item' });
      item.dataset.idx = String(globalIdx);
      item.innerHTML = `
        <span class="nw-cmdk-item-icon">${r.icon || '•'}</span>
        <div class="nw-cmdk-item-text">
          <div class="nw-cmdk-item-title">${escapeHtml(r.title)}</div>
          ${r.subtitle ? `<div class="nw-cmdk-item-subtitle">${escapeHtml(r.subtitle)}</div>` : ''}
        </div>
        ${r.shortcut ? `<kbd class="nw-cmdk-item-shortcut">${escapeHtml(r.shortcut)}</kbd>` : ''}
      `;
      item.addEventListener('click', () => navigate(r.href));
      item.addEventListener('mousemove', () => {
        selectedIdx = parseInt(item.dataset.idx || '0', 10);
        updateSelection(container);
      });
      groupEl.appendChild(item);
      globalIdx++;
    }
    container.appendChild(groupEl);
  }

  updateSelection(container);
}

function updateSelection(container: HTMLElement): void {
  container.querySelectorAll('.nw-cmdk-item').forEach((el) => {
    el.classList.toggle('selected', parseInt((el as HTMLElement).dataset.idx || '0', 10) === selectedIdx);
  });
  // Scroll selected into view
  const selected = container.querySelector('.nw-cmdk-item.selected') as HTMLElement;
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] || c;
  });
}

/** Register Cmd+K / Ctrl+K globally. */
export function registerCommandPalette(): void {
  document.addEventListener('keydown', (e) => {
    // Cmd+K on Mac, Ctrl+K elsewhere
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
  });
}
