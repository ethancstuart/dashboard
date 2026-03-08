import { createElement } from '../utils/dom.ts';

let banner: HTMLElement | null = null;

export function initOfflineIndicator(): void {
  window.addEventListener('offline', showBanner);
  window.addEventListener('online', hideBanner);

  if (!navigator.onLine) {
    showBanner();
  }
}

function showBanner(): void {
  if (banner) return;
  banner = createElement('div', { className: 'offline-banner' });
  banner.setAttribute('role', 'alert');
  banner.textContent = 'Offline \u2014 showing cached data';
  document.body.prepend(banner);
}

function hideBanner(): void {
  if (banner) {
    banner.remove();
    banner = null;
  }
}
