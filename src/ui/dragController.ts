export function initPanelDrag(grid: HTMLElement, onReorder: (newOrder: string[]) => void): void {
  let gripActive = false;
  let dragSrcEl: HTMLElement | null = null;

  // Add grip handles to all panel headers
  const panels = grid.querySelectorAll('.panel-card');
  for (const panel of panels) {
    const header = panel.querySelector('.panel-header');
    if (!header) continue;

    // Skip non-panel children (map-hero, map-expand-toggle)
    const panelId = (panel as HTMLElement).dataset.panelId;
    if (!panelId) continue;

    const grip = document.createElement('span');
    grip.className = 'panel-drag-handle';
    grip.textContent = '\u2630'; // hamburger icon
    grip.setAttribute('aria-label', 'Drag to reorder');

    grip.addEventListener('mousedown', () => { gripActive = true; });
    grip.addEventListener('touchstart', (e) => { handleTouchStart(e, panel as HTMLElement); }, { passive: false });

    header.insertBefore(grip, header.firstChild);

    // Only make panel draggable when grip is held — prevents conflict
    // with internal drag handlers (e.g. StocksPanel watchlist reorder)
    grip.addEventListener('mousedown', () => {
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
      (e as DragEvent).dataTransfer!.setData('text/plain', panelId);
      (panel as HTMLElement).classList.add('panel-dragging');
    });

    panel.addEventListener('dragover', (e) => {
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'move';
      const target = (e.currentTarget as HTMLElement);
      if (!target.dataset.panelId || target === dragSrcEl) return;

      // Determine if above or below midpoint
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      target.classList.remove('panel-drag-above', 'panel-drag-below');
      if ((e as DragEvent).clientY < midY) {
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

      // Determine insertion position
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const insertBefore = (e as DragEvent).clientY < midY;

      // Reorder DOM
      if (insertBefore) {
        grid.insertBefore(dragSrcEl, target);
      } else {
        grid.insertBefore(dragSrcEl, target.nextSibling);
      }

      // Collect new order
      const newOrder = collectPanelOrder(grid);
      onReorder(newOrder);
    });

    panel.addEventListener('dragend', () => {
      gripActive = false;
      (panel as HTMLElement).draggable = false;
      (panel as HTMLElement).classList.remove('panel-dragging');
      // Clean up all drag indicators
      grid.querySelectorAll('.panel-drag-above, .panel-drag-below').forEach(el => {
        el.classList.remove('panel-drag-above', 'panel-drag-below');
      });
      dragSrcEl = null;
    });
  }

  // Global mouseup to reset grip
  document.addEventListener('mouseup', () => { gripActive = false; });

  // Touch support
  let touchClone: HTMLElement | null = null;
  let touchSrcEl: HTMLElement | null = null;
  let touchStartY = 0;
  let touchStartX = 0;

  function handleTouchStart(e: TouchEvent, panel: HTMLElement) {
    if (!panel.dataset.panelId) return;
    e.preventDefault();

    touchSrcEl = panel;
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;

    // Create floating clone
    touchClone = panel.cloneNode(true) as HTMLElement;
    touchClone.className = 'panel-card panel-dragging panel-drag-clone';
    touchClone.style.cssText = `
      position: fixed;
      z-index: 10000;
      width: ${panel.offsetWidth}px;
      pointer-events: none;
      opacity: 0.8;
      left: ${panel.getBoundingClientRect().left}px;
      top: ${panel.getBoundingClientRect().top}px;
    `;
    document.body.appendChild(touchClone);
    panel.classList.add('panel-dragging');

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  }

  function handleTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (!touchClone || !touchSrcEl) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;

    touchClone.style.transform = `translate(${dx}px, ${dy}px)`;

    // Find drop target
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!elemBelow) return;

    const targetPanel = elemBelow.closest('.panel-card') as HTMLElement | null;
    // Clear all indicators
    grid.querySelectorAll('.panel-drag-above, .panel-drag-below').forEach(el => {
      el.classList.remove('panel-drag-above', 'panel-drag-below');
    });

    if (targetPanel && targetPanel !== touchSrcEl && targetPanel.dataset.panelId) {
      const rect = targetPanel.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (touch.clientY < midY) {
        targetPanel.classList.add('panel-drag-above');
      } else {
        targetPanel.classList.add('panel-drag-below');
      }
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);

    if (!touchSrcEl) return;
    touchSrcEl.classList.remove('panel-dragging');

    if (touchClone) {
      touchClone.remove();
      touchClone = null;
    }

    // Find the drop target
    const touch = e.changedTouches[0];
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetPanel = elemBelow?.closest('.panel-card') as HTMLElement | null;

    grid.querySelectorAll('.panel-drag-above, .panel-drag-below').forEach(el => {
      el.classList.remove('panel-drag-above', 'panel-drag-below');
    });

    if (targetPanel && targetPanel !== touchSrcEl && targetPanel.dataset.panelId) {
      const rect = targetPanel.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (touch.clientY < midY) {
        grid.insertBefore(touchSrcEl, targetPanel);
      } else {
        grid.insertBefore(touchSrcEl, targetPanel.nextSibling);
      }
      const newOrder = collectPanelOrder(grid);
      onReorder(newOrder);
    }

    touchSrcEl = null;
  }
}

function collectPanelOrder(grid: HTMLElement): string[] {
  const order: string[] = [];
  const children = grid.querySelectorAll('.panel-card[data-panel-id]');
  for (const child of children) {
    const id = (child as HTMLElement).dataset.panelId;
    if (id) order.push(id);
  }
  return order;
}
