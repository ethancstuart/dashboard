import { createElement } from '../utils/dom.ts';
import type { App } from '../App.ts';

const GEAR_SVG = `<svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatClock(now: Date): string {
  const day = DAYS[now.getDay()];
  const month = MONTHS[now.getMonth()];
  const date = now.getDate();
  const year = now.getFullYear();
  let hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${date}, ${year} \u00b7 ${hours}:${minutes} ${ampm}`;
}

function buildDropdown(dropdown: HTMLElement, app: App): void {
  dropdown.textContent = '';
  const panels = app.getPanels();

  if (panels.length === 0) {
    const msg = createElement('div', {
      className: 'settings-empty',
      textContent: 'No panels registered',
    });
    dropdown.appendChild(msg);
    return;
  }

  for (const panel of panels) {
    const label = createElement('label', { className: 'settings-item' });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = panel.enabled;
    checkbox.addEventListener('change', () => {
      app.togglePanel(panel.id, checkbox.checked);
    });
    const text = createElement('span', { textContent: panel.title });
    label.appendChild(checkbox);
    label.appendChild(text);
    dropdown.appendChild(label);
  }
}

export function createHeader(app: App): HTMLElement {
  const header = createElement('header', { className: 'header' });

  const title = createElement('span', {
    className: 'header-title',
    textContent: 'J.A.R.V.I.S.',
  });

  const right = createElement('div', { className: 'header-right' });

  const clock = createElement('span', { className: 'header-clock' });
  clock.textContent = formatClock(new Date());
  setInterval(() => {
    clock.textContent = formatClock(new Date());
  }, 1000);

  const settingsWrap = createElement('div', { className: 'header-settings' });

  const gearBtn = createElement('button', { className: 'header-gear' });
  gearBtn.innerHTML = GEAR_SVG;

  const dropdown = createElement('div', { className: 'settings-dropdown' });
  dropdown.style.display = 'none';

  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : '';
    if (!isOpen) buildDropdown(dropdown, app);
  });

  document.addEventListener('click', (e) => {
    if (!settingsWrap.contains(e.target as Node)) {
      dropdown.style.display = 'none';
    }
  });

  settingsWrap.appendChild(gearBtn);
  settingsWrap.appendChild(dropdown);

  right.appendChild(clock);
  right.appendChild(settingsWrap);

  header.appendChild(title);
  header.appendChild(right);

  return header;
}
