import { createElement } from '../utils/dom.ts';
import { getPulseItems } from '../services/intelligence.ts';
import type { PulseItem } from '../types/index.ts';

export function createPulseBar(): HTMLElement {
  const bar = createElement('div', { className: 'pulse-bar' });
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-label', 'Intelligence pulse');

  function render(items: PulseItem[]) {
    bar.textContent = '';

    if (items.length === 0) {
      const empty = createElement('span', { className: 'pulse-bar-empty', textContent: 'Pulse — monitoring...' });
      bar.appendChild(empty);
      return;
    }

    // Show up to 8 items
    for (const item of items.slice(0, 8)) {
      const pill = createElement('div', { className: 'pulse-item' });
      pill.dataset.type = item.type;

      const icon = createElement('span', { className: 'pulse-item-icon', textContent: item.icon });
      const text = createElement('span', { className: 'pulse-item-text', textContent: item.text });

      pill.appendChild(icon);
      pill.appendChild(text);

      // Click to navigate to relevant panel
      if (item.panelId) {
        pill.addEventListener('click', () => {
          const panel = document.querySelector(`.panel-card[data-panel-id="${item.panelId}"]`);
          if (panel) {
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            // Flash highlight
            panel.classList.add('pulse-highlight');
            setTimeout(() => panel.classList.remove('pulse-highlight'), 1500);
          }
        });
      }

      bar.appendChild(pill);
    }
  }

  // Initial render
  render(getPulseItems());

  // Listen for updates
  document.addEventListener('dashview:pulse-update', (e) => {
    const items = (e as CustomEvent).detail?.items || [];
    render(items);
  });

  return bar;
}
