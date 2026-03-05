const LAST_VISIT_KEY = 'dashview-last-visit';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning, Sir';
  if (hour < 17) return 'Good Afternoon, Sir';
  return 'Good Evening, Sir';
}

function getSubtitle(): string {
  const lastVisit = localStorage.getItem(LAST_VISIT_KEY);
  localStorage.setItem(LAST_VISIT_KEY, Date.now().toString());
  return lastVisit ? 'Welcome Back' : 'Welcome';
}

export function showWelcome(): Promise<void> {
  return new Promise((resolve) => {
    const greeting = getGreeting();
    const subtitle = getSubtitle();

    const overlay = document.createElement('div');
    overlay.className = 'welcome-overlay';

    const container = document.createElement('div');
    container.className = 'welcome-container';

    const brand = document.createElement('div');
    brand.className = 'welcome-brand';
    brand.textContent = 'J.A.R.V.I.S.';

    const greetingEl = document.createElement('div');
    greetingEl.className = 'welcome-greeting';
    greetingEl.textContent = greeting;

    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'welcome-subtitle';
    subtitleEl.textContent = subtitle;

    container.appendChild(brand);
    container.appendChild(greetingEl);
    container.appendChild(subtitleEl);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    // Stagger animations
    setTimeout(() => brand.classList.add('welcome-visible'), 200);
    setTimeout(() => greetingEl.classList.add('welcome-visible'), 600);
    setTimeout(() => subtitleEl.classList.add('welcome-visible'), 1000);

    // Fade out overlay
    setTimeout(() => overlay.classList.add('welcome-overlay-exit'), 3500);

    // Remove from DOM
    setTimeout(() => {
      overlay.remove();
      resolve();
    }, 4300);
  });
}
