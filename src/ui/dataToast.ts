/**
 * Data failure toast notifications.
 *
 * Shows a dismissible toast when a data source fails 3+ times consecutively.
 * Uses the existing toast.css styles. Auto-dismisses after 10 seconds.
 */

const TOAST_CONTAINER_ID = 'nw-data-toast-container';
const activeToasts = new Set<string>();

function getContainer(): HTMLElement {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:400px;';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Show a data failure toast. Deduplicates by layerId — won't show
 * the same layer's failure twice simultaneously.
 */
export function showDataToast(layerId: string, message: string, severity: 'warn' | 'error' = 'warn'): void {
  if (activeToasts.has(layerId)) return;
  activeToasts.add(layerId);

  const container = getContainer();
  const toast = document.createElement('div');
  toast.className = `nw-data-toast nw-data-toast-${severity}`;
  toast.style.cssText = `
    background: ${severity === 'error' ? '#1a0a0a' : '#1a1400'};
    border: 1px solid ${severity === 'error' ? 'var(--color-signal-critical)' : 'var(--color-signal-warning)'};
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--nw-font-body, Inter, sans-serif);
    font-size: 13px;
    color: var(--nw-text, #ededed);
    animation: nw-toast-in 0.3s ease;
  `;

  const icon = severity === 'error' ? '🔴' : '⚠️';
  toast.innerHTML = `
    <span style="flex-shrink:0;font-size:16px;">${icon}</span>
    <span style="flex:1;line-height:1.4;">${escapeHtml(message)}</span>
    <button style="background:none;border:none;color:#666;cursor:pointer;font-size:16px;padding:0 4px;" title="Dismiss">✕</button>
  `;

  toast.querySelector('button')?.addEventListener('click', () => {
    toast.remove();
    activeToasts.delete(layerId);
  });

  container.appendChild(toast);

  // Auto-dismiss after 10 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => {
        toast.remove();
        activeToasts.delete(layerId);
      }, 300);
    }
  }, 10000);
}

/**
 * Track consecutive failures per layer. Show toast after 3 consecutive failures.
 */
const failureCounts = new Map<string, number>();

export function trackLayerFailure(layerId: string, layerName: string): void {
  const count = (failureCounts.get(layerId) || 0) + 1;
  failureCounts.set(layerId, count);

  if (count === 3) {
    showDataToast(layerId, `${layerName} data unavailable — showing cached data`, 'warn');
  } else if (count === 10) {
    showDataToast(layerId, `${layerName} has been offline for an extended period`, 'error');
  }
}

export function resetLayerFailure(layerId: string): void {
  failureCounts.delete(layerId);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Auto-register: listen for provenance updates and track failures.
 * Import this module once in the app entry point to enable toast notifications.
 */
export function initDataToasts(): void {
  document.addEventListener('dashview:provenance-update', ((e: CustomEvent<{ layerId: string }>) => {
    // Dynamic import to avoid circular deps
    import('../services/dataProvenance.ts').then(({ getProvenance }) => {
      const prov = getProvenance(e.detail.layerId);
      if (!prov) return;
      if (!prov.lastFetchOk) {
        trackLayerFailure(e.detail.layerId, prov.source || e.detail.layerId);
      } else {
        resetLayerFailure(e.detail.layerId);
      }
    });
  }) as EventListener);
}
