/**
 * Keyboard Shortcuts Cheatsheet Overlay
 *
 * Press ? to show all keyboard shortcuts and terminal commands.
 */

import { createElement } from '../utils/dom.ts';

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{ key: string; description: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Map & View',
    shortcuts: [
      { key: 'D', description: 'Toggle layer drawer (presets + saved views)' },
      { key: '/', description: 'Focus country search' },
      { key: 'N', description: 'Toggle notification bell' },
      { key: 'T', description: 'Toggle time-travel scrubber' },
      { key: 'S', description: 'Generate sitrep' },
      { key: 'A', description: 'Open alert builder' },
      { key: 'C', description: 'Cinema mode' },
      { key: 'F', description: 'Fullscreen' },
      { key: '1\u20137', description: 'Toggle data layers' },
      { key: 'Esc', description: 'Close overlays / exit cinema' },
    ],
  },
  {
    title: 'Terminal Commands',
    shortcuts: [
      { key: 'analyst <q>', description: 'AI analyst with citations' },
      { key: 'deep-dive <country>', description: 'Comprehensive country analysis' },
      { key: 'scenario <preset>', description: 'Run what-if simulation' },
      { key: 'scenario list', description: 'List all scenario presets' },
      { key: 'sitrep', description: 'Generate situation report' },
      { key: 'enable <layer>', description: 'Turn on data layer' },
      { key: 'disable <layer>', description: 'Turn off data layer' },
      { key: '<location>', description: 'Fly to country/city' },
    ],
  },
  {
    title: 'Pages',
    shortcuts: [
      { key: '#/intel', description: 'Main intel map' },
      { key: '#/briefs', description: 'Daily brief archive' },
      { key: '#/accuracy', description: 'Prediction accuracy ledger' },
      { key: '#/methodology', description: 'How NexusWatch works' },
      { key: '#/roadmap', description: 'Upcoming features' },
    ],
  },
  {
    title: 'Global',
    shortcuts: [
      { key: '?', description: 'Show this cheatsheet' },
      { key: 'Cmd/Ctrl+K', description: 'Focus AI bar (if present)' },
    ],
  },
];

let overlayEl: HTMLElement | null = null;

export function showShortcutsOverlay(): void {
  if (overlayEl) {
    hideShortcutsOverlay();
    return;
  }

  overlayEl = createElement('div', { className: 'nw-shortcuts-overlay' });

  const panel = createElement('div', { className: 'nw-shortcuts-panel' });

  const header = createElement('div', { className: 'nw-shortcuts-header' });
  header.innerHTML = `
    <h2>Keyboard Shortcuts & Commands</h2>
    <button class="nw-shortcuts-close" aria-label="Close">✕</button>
  `;
  (header.querySelector('.nw-shortcuts-close') as HTMLButtonElement).addEventListener('click', hideShortcutsOverlay);
  panel.appendChild(header);

  const body = createElement('div', { className: 'nw-shortcuts-body' });

  for (const group of SHORTCUT_GROUPS) {
    const section = createElement('div', { className: 'nw-shortcuts-group' });
    section.innerHTML = `
      <div class="nw-shortcuts-group-title">${group.title}</div>
      <div class="nw-shortcuts-list">
        ${group.shortcuts
          .map(
            (s) =>
              `<div class="nw-shortcut-row">
                <kbd>${s.key}</kbd>
                <span>${s.description}</span>
              </div>`,
          )
          .join('')}
      </div>
    `;
    body.appendChild(section);
  }

  panel.appendChild(body);

  const footer = createElement('div', { className: 'nw-shortcuts-footer' });
  footer.textContent = 'Press ? or Esc to close';
  panel.appendChild(footer);

  overlayEl.appendChild(panel);

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) hideShortcutsOverlay();
  });

  document.body.appendChild(overlayEl);
  document.addEventListener('keydown', escClose);
}

function escClose(e: KeyboardEvent): void {
  if (e.key === 'Escape') hideShortcutsOverlay();
}

export function hideShortcutsOverlay(): void {
  overlayEl?.remove();
  overlayEl = null;
  document.removeEventListener('keydown', escClose);
}

/** Register the ? keyboard shortcut globally. */
export function registerShortcutsKey(): void {
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    if (e.key === '?') {
      e.preventDefault();
      showShortcutsOverlay();
    }
  });
}
