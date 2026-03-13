import { createElement } from '../utils/dom.ts';

export interface LayoutContainers {
  root: HTMLElement;
  aiBarSlot: HTMLElement;
  spaceBarSlot: HTMLElement;
  spaceContent: HTMLElement;
  pulseBarSlot: HTMLElement;
  mapHero: HTMLElement;
  panelGrid: HTMLElement;
  predictionBanner: HTMLElement;
}

const DEFAULT_PANEL_ORDER = ['weather', 'stocks', 'news', 'crypto', 'sports', 'chat', 'calendar', 'notes'];
const PANEL_ORDER_KEY = 'dashview:panel-order';

export function getPanelOrder(): string[] {
  try {
    const saved = localStorage.getItem(PANEL_ORDER_KEY);
    if (saved) {
      const order = JSON.parse(saved) as string[];
      if (Array.isArray(order) && order.length > 0) return order;
    }
  } catch { /* ignore */ }
  return DEFAULT_PANEL_ORDER;
}

export function savePanelOrder(order: string[]): void {
  localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(order));
}

export function createLayout(): LayoutContainers {
  const root = createElement('div', { className: 'layout' });
  root.setAttribute('role', 'main');
  root.id = 'main-content';

  // AI Bar slot (filled by aiBar.ts)
  const aiBarSlot = createElement('div', { className: 'ai-bar-slot' });

  // Space Bar slot
  const spaceBarSlot = createElement('div', { className: 'space-bar-slot' });

  // Prediction banner
  const predictionBanner = createElement('div', { className: 'prediction-banner' });

  // Space content — 12-column grid for widgets
  const spaceContent = createElement('div', { className: 'space-grid' });
  spaceContent.setAttribute('role', 'region');
  spaceContent.setAttribute('aria-label', 'Dashboard widgets');

  // Pulse bar slot
  const pulseBarSlot = createElement('div', { className: 'pulse-bar-slot' });

  // Map hero (used by news panel, sits inside space content when needed)
  const mapHero = createElement('div', { className: 'map-hero' });
  mapHero.setAttribute('aria-label', 'News map');

  const mapToggle = createElement('button', { className: 'map-collapse-toggle' });
  mapToggle.setAttribute('aria-label', 'Collapse map');
  mapToggle.textContent = 'Hide Map';
  mapToggle.addEventListener('click', () => {
    mapHero.classList.add('map-collapsed');
    mapExpand.style.display = '';
    localStorage.setItem('dashview:map-collapsed', '1');
    document.dispatchEvent(new CustomEvent('dashview:storage-changed', { detail: { key: 'dashview:map-collapsed', action: 'set' } }));
  });
  mapHero.appendChild(mapToggle);

  const mapExpand = createElement('button', { className: 'map-expand-toggle' });
  mapExpand.setAttribute('aria-label', 'Show map');
  mapExpand.textContent = 'Show Map';
  mapExpand.addEventListener('click', () => {
    mapHero.classList.remove('map-collapsed');
    mapExpand.style.display = 'none';
    localStorage.setItem('dashview:map-collapsed', '');
    document.dispatchEvent(new CustomEvent('dashview:storage-changed', { detail: { key: 'dashview:map-collapsed', action: 'set' } }));
  });

  const isCollapsed = localStorage.getItem('dashview:map-collapsed') === '1';
  if (isCollapsed) {
    mapHero.classList.add('map-collapsed');
  } else {
    mapExpand.style.display = 'none';
  }

  // Legacy panel grid (for backwards-compat with embed mode)
  const panelGrid = createElement('div', { className: 'panel-grid' });
  panelGrid.setAttribute('role', 'region');
  panelGrid.setAttribute('aria-label', 'Dashboard panels');

  // Assemble layout
  root.appendChild(predictionBanner);
  root.appendChild(spaceContent);
  root.appendChild(pulseBarSlot);

  return { root, aiBarSlot, spaceBarSlot, spaceContent, pulseBarSlot, mapHero, panelGrid, predictionBanner };
}

export function enablePanelDrag(_grid: HTMLElement): void {
  // Drag is now handled by widgetGrid.ts within the space system
  // This function is kept for backwards compatibility (embed page)
  import('./dragController.ts').then((m) => {
    m.initPanelDrag(_grid, (newOrder) => {
      savePanelOrder(newOrder);
      document.dispatchEvent(new CustomEvent('dashview:storage-changed', { detail: { key: 'dashview:panel-order', action: 'set' } }));
    });
  });
}
