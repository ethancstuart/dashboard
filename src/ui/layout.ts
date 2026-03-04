import { createElement } from '../utils/dom.ts';

export function createLayout(): HTMLElement {
  const main = createElement('div', { className: 'layout' });
  const grid = createElement('div', { className: 'panel-grid' });
  main.appendChild(grid);
  return main;
}
