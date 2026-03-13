import { createElement } from '../utils/dom.ts';
import {
  getSpaces,
  getActiveSpace,
  setActiveSpace,
  createSpace,
  deleteSpace,
  updateSpace,
} from '../services/spaces.ts';
import type { Space } from '../types/index.ts';

export interface SpaceBarCallbacks {
  onSpaceChange: (spaceId: string) => void;
}

export function createSpaceBar(callbacks: SpaceBarCallbacks): HTMLElement {
  const bar = createElement('nav', { className: 'space-bar' });
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Spaces');

  function render() {
    bar.textContent = '';
    const spaces = getSpaces();
    const activeId = getActiveSpace();

    const tabsWrap = createElement('div', { className: 'space-bar-tabs' });

    for (const space of spaces) {
      const tab = createElement('button', { className: 'space-tab' });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', space.id === activeId ? 'true' : 'false');
      if (space.id === activeId) tab.classList.add('space-tab-active');

      const icon = createElement('span', { className: 'space-tab-icon', textContent: space.icon });
      const name = createElement('span', { className: 'space-tab-name', textContent: space.name });
      tab.appendChild(icon);
      tab.appendChild(name);

      tab.addEventListener('click', () => {
        if (space.id === getActiveSpace()) return;
        setActiveSpace(space.id);
        callbacks.onSpaceChange(space.id);
        render();
      });

      // Right-click context menu for rename/delete
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, space, render, callbacks);
      });

      tabsWrap.appendChild(tab);
    }

    bar.appendChild(tabsWrap);

    // Add space button
    const addBtn = createElement('button', { className: 'space-tab space-tab-add', textContent: '+' });
    addBtn.setAttribute('aria-label', 'Create new space');
    addBtn.addEventListener('click', () => {
      const name = prompt('Space name:');
      if (!name) return;
      const icon = prompt('Space icon (emoji):', '\uD83D\uDCCB') || '\uD83D\uDCCB';
      const space = createSpace(name.trim(), icon.trim());
      setActiveSpace(space.id);
      callbacks.onSpaceChange(space.id);
      render();
    });
    bar.appendChild(addBtn);
  }

  render();

  // Re-render when spaces change externally
  document.addEventListener('dashview:spaces-changed', () => render());

  return bar;
}

function showContextMenu(
  e: MouseEvent,
  space: Space,
  rerender: () => void,
  callbacks: SpaceBarCallbacks,
): void {
  // Remove any existing context menu
  document.querySelectorAll('.space-context-menu').forEach((el) => el.remove());

  const menu = createElement('div', { className: 'space-context-menu' });
  menu.style.position = 'fixed';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.zIndex = '9999';

  const renameBtn = createElement('button', { className: 'space-context-item', textContent: 'Rename' });
  renameBtn.addEventListener('click', () => {
    menu.remove();
    const newName = prompt('New name:', space.name);
    if (newName && newName.trim()) {
      updateSpace(space.id, { name: newName.trim() });
      rerender();
    }
  });

  const iconBtn = createElement('button', { className: 'space-context-item', textContent: 'Change icon' });
  iconBtn.addEventListener('click', () => {
    menu.remove();
    const newIcon = prompt('New icon (emoji):', space.icon);
    if (newIcon && newIcon.trim()) {
      updateSpace(space.id, { icon: newIcon.trim() });
      rerender();
    }
  });

  const deleteBtn = createElement('button', { className: 'space-context-item space-context-danger', textContent: 'Delete' });
  deleteBtn.addEventListener('click', () => {
    menu.remove();
    const spaces = getSpaces();
    if (spaces.length <= 1) return; // Can't delete last space
    deleteSpace(space.id);
    const remaining = getSpaces();
    if (remaining.length > 0) {
      setActiveSpace(remaining[0].id);
      callbacks.onSpaceChange(remaining[0].id);
    }
    rerender();
  });

  menu.appendChild(renameBtn);
  menu.appendChild(iconBtn);
  menu.appendChild(deleteBtn);
  document.body.appendChild(menu);

  const close = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', close);
    }
  };
  // Delay to prevent immediate close
  requestAnimationFrame(() => {
    document.addEventListener('click', close);
  });
}
