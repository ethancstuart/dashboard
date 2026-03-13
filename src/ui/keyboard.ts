import { createElement } from '../utils/dom.ts';
import { cycleTheme } from '../config/theme.ts';
import { openAlertsModal } from '../ui/alertsModal.ts';
import type { App } from '../App.ts';

let helpModal: HTMLElement | null = null;

const SHORTCUTS: { key: string; description: string }[] = [
  { key: '\u2318K / Ctrl+K', description: 'Open command palette' },
  { key: '?', description: 'Show this help' },
  { key: '/', description: 'Focus location search' },
  { key: 't', description: 'Cycle theme (dark / light / OLED)' },
  { key: 'm', description: 'Toggle globe' },
  { key: '1-6', description: 'Jump to panel (weather, stocks, news, sports, chat, notes)' },
  { key: 'a', description: 'Open price alerts' },
  { key: 'Esc', description: 'Close modals / dropdowns' },
];

const PANEL_ORDER = ['weather', 'stocks', 'news', 'sports', 'chat', 'notes'];

export function initKeyboardShortcuts(app: App): void {
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;

    switch (e.key) {
      case '?':
        e.preventDefault();
        toggleHelpModal();
        break;
      case '/':
        e.preventDefault();
        focusLocationSearch();
        break;
      case 't':
        e.preventDefault();
        cycleTheme();
        break;
      case 'm':
        e.preventDefault();
        toggleMap();
        break;
      case 'Escape':
        closeOverlays();
        break;
      case 'a':
        e.preventDefault();
        openAlertsModal();
        break;
      default:
        if (e.key >= '1' && e.key <= '6') {
          e.preventDefault();
          jumpToPanel(app, parseInt(e.key) - 1);
        }
    }
  });
}

function jumpToPanel(app: App, index: number): void {
  const id = PANEL_ORDER[index];
  if (!id) return;
  const panel = app.getPanel(id);
  if (!panel || !panel.enabled) return;
  panel.container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  panel.container.focus();
}

function focusLocationSearch(): void {
  const input = document.querySelector('.settings-text-input') as HTMLInputElement;
  if (input) {
    input.focus();
    return;
  }
  // Open settings dropdown first
  const gearBtn = document.querySelector('.header-gear') as HTMLButtonElement;
  if (gearBtn) {
    gearBtn.click();
    requestAnimationFrame(() => {
      const searchInput = document.querySelector('.settings-text-input') as HTMLInputElement;
      if (searchInput) searchInput.focus();
    });
  }
}

function toggleMap(): void {
  // Globe panel visibility is controlled by space widgets — 'm' is a no-op now
  const globe = document.querySelector('.panel-card[data-panel-id="globe"]') as HTMLElement;
  if (globe) {
    globe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function closeOverlays(): void {
  if (helpModal) {
    helpModal.remove();
    helpModal = null;
    return;
  }
  // Close settings dropdown
  const dropdown = document.querySelector('.settings-dropdown') as HTMLElement;
  if (dropdown && dropdown.style.display !== 'none') {
    dropdown.style.display = 'none';
    const gearBtn = document.querySelector('.header-gear');
    if (gearBtn) gearBtn.setAttribute('aria-expanded', 'false');
  }
}

function toggleHelpModal(): void {
  if (helpModal) {
    helpModal.remove();
    helpModal = null;
    return;
  }

  helpModal = createElement('div', { className: 'help-modal-overlay' });
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal!.remove();
      helpModal = null;
    }
  });

  const dialog = createElement('div', { className: 'help-modal' });
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Keyboard shortcuts');

  const title = createElement('div', { className: 'help-modal-title', textContent: 'Keyboard Shortcuts' });
  dialog.appendChild(title);

  for (const s of SHORTCUTS) {
    const row = createElement('div', { className: 'help-modal-row' });
    const key = createElement('kbd', { className: 'help-modal-key', textContent: s.key });
    const desc = createElement('span', { textContent: s.description });
    row.appendChild(key);
    row.appendChild(desc);
    dialog.appendChild(row);
  }

  const hint = createElement('div', { className: 'help-modal-hint', textContent: 'Press ? or Esc to close' });
  dialog.appendChild(hint);

  helpModal.appendChild(dialog);
  document.body.appendChild(helpModal);
}
