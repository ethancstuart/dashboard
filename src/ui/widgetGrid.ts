import { createElement } from '../utils/dom.ts';
import { Panel } from '../panels/Panel.ts';
import { reorderWidgets, getSpaces, saveSpaces } from '../services/spaces.ts';
import type { Space, WidgetSize } from '../types/index.ts';

export function renderSpace(
  container: HTMLElement,
  space: Space,
  panels: Map<string, Panel>,
): void {
  container.textContent = '';

  // Sort widgets by position
  const sorted = [...space.widgets].sort((a, b) => a.position - b.position);

  for (const widget of sorted) {
    const panel = panels.get(widget.panelId);
    if (!panel) continue;

    // Set grid column span
    panel.container.style.gridColumn = `span ${widget.colSpan}`;
    panel.container.classList.remove('widget-compact', 'widget-medium', 'widget-large');
    panel.container.classList.add(`widget-${widget.size}`);

    // Stagger entry animation
    panel.container.style.animationDelay = `${widget.position * 0.04}s`;

    container.appendChild(panel.container);
  }

  // Init drag-to-reorder within this grid
  initWidgetDrag(container, space.id);

  // Init resize handles
  initResizeHandles(container, space.id, panels);
}

function initWidgetDrag(grid: HTMLElement, spaceId: string): void {
  let gripActive = false;
  let dragSrcEl: HTMLElement | null = null;

  const panels = grid.querySelectorAll('.panel-card[data-panel-id]');
  for (const panel of panels) {
    const header = panel.querySelector('.panel-header');
    if (!header) continue;

    // Only add grip if not already present
    if (!header.querySelector('.panel-drag-handle')) {
      const grip = document.createElement('span');
      grip.className = 'panel-drag-handle';
      grip.textContent = '\u2630';
      grip.setAttribute('aria-label', 'Drag to reorder');
      header.insertBefore(grip, header.firstChild);
    }

    const grip = header.querySelector('.panel-drag-handle') as HTMLElement;
    if (!grip) continue;

    grip.addEventListener('mousedown', () => {
      gripActive = true;
      (panel as HTMLElement).draggable = true;
    });

    panel.addEventListener('dragstart', (e) => {
      if (!gripActive) {
        (panel as HTMLElement).draggable = false;
        (e as DragEvent).preventDefault();
        return;
      }
      dragSrcEl = panel as HTMLElement;
      (e as DragEvent).dataTransfer!.effectAllowed = 'move';
      (e as DragEvent).dataTransfer!.setData('text/plain', (panel as HTMLElement).dataset.panelId || '');
      (panel as HTMLElement).classList.add('panel-dragging');
    });

    panel.addEventListener('dragover', (e) => {
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'move';
      const target = e.currentTarget as HTMLElement;
      if (!target.dataset.panelId || target === dragSrcEl) return;
      const rect = target.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      target.classList.remove('panel-drag-above', 'panel-drag-below');
      if ((e as DragEvent).clientX < midX) {
        target.classList.add('panel-drag-above');
      } else {
        target.classList.add('panel-drag-below');
      }
    });

    panel.addEventListener('dragleave', () => {
      (panel as HTMLElement).classList.remove('panel-drag-above', 'panel-drag-below');
    });

    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = panel as HTMLElement;
      target.classList.remove('panel-drag-above', 'panel-drag-below');
      if (!dragSrcEl || dragSrcEl === target) return;
      if (!target.dataset.panelId) return;

      const rect = target.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const insertBefore = (e as DragEvent).clientX < midX;

      if (insertBefore) {
        grid.insertBefore(dragSrcEl, target);
      } else {
        grid.insertBefore(dragSrcEl, target.nextSibling);
      }

      const newOrder = collectOrder(grid);
      reorderWidgets(spaceId, newOrder);
    });

    panel.addEventListener('dragend', () => {
      gripActive = false;
      (panel as HTMLElement).draggable = false;
      (panel as HTMLElement).classList.remove('panel-dragging');
      grid.querySelectorAll('.panel-drag-above, .panel-drag-below').forEach((el) => {
        el.classList.remove('panel-drag-above', 'panel-drag-below');
      });
      dragSrcEl = null;
    });
  }

  document.addEventListener('mouseup', () => { gripActive = false; });
}

function initResizeHandles(grid: HTMLElement, spaceId: string, panels: Map<string, Panel>): void {
  const panelCards = grid.querySelectorAll('.panel-card[data-panel-id]');
  for (const card of panelCards) {
    const el = card as HTMLElement;
    // Add resize handle if not already present
    if (el.querySelector('.widget-resize-handle')) continue;

    const handle = createElement('div', { className: 'widget-resize-handle' });
    handle.textContent = '\u2937';
    handle.title = 'Resize widget';
    el.appendChild(handle);

    handle.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSizeMenu(e, el, spaceId, panels);
    });

    handle.addEventListener('click', (e) => {
      e.stopPropagation();
      showSizeMenu(e, el, spaceId, panels);
    });
  }
}

function showSizeMenu(
  e: MouseEvent | Event,
  card: HTMLElement,
  spaceId: string,
  panels: Map<string, Panel>,
): void {
  document.querySelectorAll('.widget-size-menu').forEach((el) => el.remove());

  const panelId = card.dataset.panelId;
  if (!panelId) return;
  const panel = panels.get(panelId);
  if (!panel) return;

  const menu = createElement('div', { className: 'widget-size-menu' });
  menu.style.position = 'fixed';
  const clientX = e instanceof MouseEvent ? e.clientX : card.getBoundingClientRect().right;
  const clientY = e instanceof MouseEvent ? e.clientY : card.getBoundingClientRect().bottom;
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
  menu.style.zIndex = '9999';

  const sizes: { size: WidgetSize; label: string; colSpan: number }[] = [
    { size: 'compact', label: 'Compact (3 cols)', colSpan: 3 },
    { size: 'medium', label: 'Medium (6 cols)', colSpan: 6 },
    { size: 'large', label: 'Large (12 cols)', colSpan: 12 },
  ];

  for (const s of sizes) {
    if (!panel.supportedSizes.includes(s.size)) continue;
    const btn = createElement('button', { className: 'space-context-item', textContent: s.label });
    btn.addEventListener('click', () => {
      menu.remove();
      card.style.gridColumn = `span ${s.colSpan}`;
      card.classList.remove('widget-compact', 'widget-medium', 'widget-large');
      card.classList.add(`widget-${s.size}`);

      // Persist
      const spaces = getSpaces();
      const space = spaces.find((sp) => sp.id === spaceId);
      if (space) {
        const widget = space.widgets.find((w) => w.panelId === panelId);
        if (widget) {
          widget.size = s.size;
          widget.colSpan = s.colSpan;
          saveSpaces(spaces);
        }
      }

      // Re-render panel at size
      panel.renderAtSize(s.size);
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  const close = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', close);
    }
  };
  requestAnimationFrame(() => {
    document.addEventListener('click', close);
  });
}

function collectOrder(grid: HTMLElement): string[] {
  const order: string[] = [];
  const children = grid.querySelectorAll('.panel-card[data-panel-id]');
  for (const child of children) {
    const id = (child as HTMLElement).dataset.panelId;
    if (id) order.push(id);
  }
  return order;
}
