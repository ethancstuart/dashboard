import { createElement } from '../utils/dom.ts';

export interface LayoutContainers {
  root: HTMLElement;
  mapHero: HTMLElement;
  sidebar: HTMLElement;
  content: HTMLElement;
  predictionBanner: HTMLElement;
}

export function createLayout(): LayoutContainers {
  const root = createElement('div', { className: 'layout' });
  root.setAttribute('role', 'main');
  root.id = 'main-content';

  const predictionBanner = createElement('div', { className: 'prediction-banner' });
  root.appendChild(predictionBanner);

  const grid = createElement('div', { className: 'panel-grid' });

  const mapHero = createElement('div', { className: 'map-hero' });
  mapHero.setAttribute('aria-label', 'News map');

  // Map collapse toggle button
  const mapToggle = createElement('button', { className: 'map-collapse-toggle' });
  mapToggle.setAttribute('aria-label', 'Toggle map');
  mapToggle.textContent = '\u25B2';
  mapToggle.addEventListener('click', () => {
    const collapsing = !mapHero.classList.contains('map-collapsed');
    mapHero.classList.toggle('map-collapsed', collapsing);
    mapToggle.textContent = collapsing ? '\u25BC' : '\u25B2';
    localStorage.setItem('dashview:map-collapsed', collapsing ? '1' : '');
  });
  mapHero.appendChild(mapToggle);

  // Restore saved map collapse state
  if (localStorage.getItem('dashview:map-collapsed') === '1') {
    mapHero.classList.add('map-collapsed');
    mapToggle.textContent = '\u25BC';
  }
  const sidebar = createElement('div', { className: 'sidebar-stack' });
  sidebar.setAttribute('role', 'complementary');
  sidebar.setAttribute('aria-label', 'Sidebar panels');
  const content = createElement('div', { className: 'content-row' });

  grid.appendChild(mapHero);
  grid.appendChild(sidebar);
  grid.appendChild(content);

  root.appendChild(grid);

  return { root, mapHero, sidebar, content, predictionBanner };
}
