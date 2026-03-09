import { createElement } from '../utils/dom.ts';

export interface LayoutContainers {
  root: HTMLElement;
  mapHero: HTMLElement;
  panelGrid: HTMLElement;
  predictionBanner: HTMLElement;
}

const DEFAULT_PANEL_ORDER = ['weather', 'stocks', 'news', 'crypto', 'sports', 'chat', 'notes'];
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

  const predictionBanner = createElement('div', { className: 'prediction-banner' });
  root.appendChild(predictionBanner);

  // Panel grid — responsive, all panels are equal citizens
  const panelGrid = createElement('div', { className: 'panel-grid' });
  panelGrid.setAttribute('role', 'region');
  panelGrid.setAttribute('aria-label', 'Dashboard panels');

  // Map card — lives inside the panel grid, spans 2 columns
  const mapHero = createElement('div', { className: 'map-hero' });
  mapHero.setAttribute('aria-label', 'News map');

  const mapToggle = createElement('button', { className: 'map-collapse-toggle' });
  mapToggle.setAttribute('aria-label', 'Collapse map');
  mapToggle.textContent = 'Hide Map';
  mapToggle.addEventListener('click', () => {
    mapHero.classList.add('map-collapsed');
    mapExpand.style.display = '';
    localStorage.setItem('dashview:map-collapsed', '1');
  });
  mapHero.appendChild(mapToggle);

  // Expand button also inside the grid so it takes the map's grid slot
  const mapExpand = createElement('button', { className: 'map-expand-toggle' });
  mapExpand.setAttribute('aria-label', 'Show map');
  mapExpand.textContent = 'Show Map';
  mapExpand.addEventListener('click', () => {
    mapHero.classList.remove('map-collapsed');
    mapExpand.style.display = 'none';
    localStorage.setItem('dashview:map-collapsed', '');
  });

  const isCollapsed = localStorage.getItem('dashview:map-collapsed') === '1';
  if (isCollapsed) {
    mapHero.classList.add('map-collapsed');
  } else {
    mapExpand.style.display = 'none';
  }

  panelGrid.appendChild(mapHero);
  panelGrid.appendChild(mapExpand);
  root.appendChild(panelGrid);

  return { root, mapHero, panelGrid, predictionBanner };
}
