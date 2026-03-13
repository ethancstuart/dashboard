import { createElement } from '../utils/dom.ts';

let overlayEl: HTMLElement | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export function showAIOverlay(message: string, action?: string): void {
  hideAIOverlay();

  overlayEl = createElement('div', { className: 'ai-overlay' });

  const textEl = createElement('div', { className: 'ai-overlay-text', textContent: message });
  overlayEl.appendChild(textEl);

  if (action) {
    const actionEl = createElement('div', { className: 'ai-overlay-action', textContent: action });
    overlayEl.appendChild(actionEl);
  }

  const dismissBtn = createElement('button', { className: 'ai-overlay-dismiss', textContent: '\u00D7' });
  dismissBtn.addEventListener('click', () => hideAIOverlay());
  overlayEl.appendChild(dismissBtn);

  // Progress bar for auto-dismiss
  const progress = createElement('div', { className: 'ai-overlay-progress' });
  progress.style.width = '100%';
  overlayEl.appendChild(progress);

  // Click to pin (cancel auto-dismiss)
  overlayEl.addEventListener('click', (e) => {
    if (e.target === dismissBtn) return;
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
      progress.style.display = 'none';
    }
  });

  document.body.appendChild(overlayEl);

  // Animate progress bar
  requestAnimationFrame(() => {
    progress.style.width = '0%';
    progress.style.transition = 'width 8s linear';
  });

  // Auto-dismiss after 8s
  dismissTimer = setTimeout(() => {
    hideAIOverlay();
  }, 8000);
}

export function hideAIOverlay(): void {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (overlayEl) {
    overlayEl.classList.add('ai-overlay-exit');
    const el = overlayEl;
    setTimeout(() => el.remove(), 200);
    overlayEl = null;
  }
}
