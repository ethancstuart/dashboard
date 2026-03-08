import { createElement } from '../utils/dom.ts';

const DISMISSED_KEY = 'dashview:install-dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export function initInstallPrompt(header: HTMLElement): void {
  // Don't show if already dismissed or already installed
  if (localStorage.getItem(DISMISSED_KEY) === '1') return;
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    showInstallButton(header);
  });
}

function showInstallButton(header: HTMLElement): void {
  const rightSection = header.querySelector('.header-right');
  if (!rightSection) return;

  const btn = createElement('button', {
    className: 'install-btn',
    textContent: 'Install',
  });
  btn.setAttribute('aria-label', 'Install DashPulse as app');

  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      btn.remove();
    } else {
      localStorage.setItem(DISMISSED_KEY, '1');
      btn.remove();
    }
    deferredPrompt = null;
  });

  // Insert before the first child of right section
  rightSection.insertBefore(btn, rightSection.firstChild);
}
