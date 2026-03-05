import { createElement } from '../utils/dom.ts';

export interface LayoutContainers {
  root: HTMLElement;
  mapHero: HTMLElement;
  sidebar: HTMLElement;
  content: HTMLElement;
}

export function createLayout(): LayoutContainers {
  const root = createElement('div', { className: 'layout' });
  const grid = createElement('div', { className: 'panel-grid' });

  const mapHero = createElement('div', { className: 'map-hero' });
  const sidebar = createElement('div', { className: 'sidebar-stack' });
  const content = createElement('div', { className: 'content-row' });

  grid.appendChild(mapHero);
  grid.appendChild(sidebar);
  grid.appendChild(content);

  root.appendChild(grid);

  return { root, mapHero, sidebar, content };
}
