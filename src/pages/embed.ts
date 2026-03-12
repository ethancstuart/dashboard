import '../styles/embed.css';
import { Panel } from '../panels/Panel.ts';
import { createElement } from '../utils/dom.ts';
import { WeatherPanel } from '../panels/WeatherPanel.ts';
import { StocksPanel } from '../panels/StocksPanel.ts';
import { NewsPanel } from '../panels/NewsPanel.ts';
import { SportsPanel } from '../panels/SportsPanel.ts';
import { CryptoPanel } from '../panels/CryptoPanel.ts';

/**
 * Renders a read-only, stripped-down embed of the dashboard
 * suitable for iframe embedding. Skips onboarding, welcome,
 * keyboard shortcuts, command palette, drag-drop, PWA prompts,
 * offline indicator, header, and settings.
 *
 * Bypasses localStorage entirely — all panels forced enabled
 * with default order.
 */
export async function renderEmbed(root: HTMLElement): Promise<void> {
  root.textContent = '';

  // Force dark theme for embed
  document.documentElement.setAttribute('data-theme', 'dark');

  // Embed wrapper — fills the iframe, no chrome
  const wrapper = createElement('div', { className: 'embed-wrapper' });

  // Panel grid reuses the same CSS class as the main dashboard
  const panelGrid = createElement('div', { className: 'panel-grid' });
  panelGrid.setAttribute('role', 'region');
  panelGrid.setAttribute('aria-label', 'Dashboard panels');
  wrapper.appendChild(panelGrid);

  // "Powered by" badge
  const badge = document.createElement('a');
  badge.className = 'embed-powered-by';
  badge.href = 'https://dashpulse.app';
  badge.target = '_blank';
  badge.rel = 'noopener noreferrer';
  badge.textContent = 'Powered by DashPulse';
  wrapper.appendChild(badge);

  root.appendChild(wrapper);

  // Register panels — all forced enabled, no localStorage state
  const panels: Panel[] = [
    new WeatherPanel(),
    new StocksPanel(),
    new NewsPanel(),
    new SportsPanel(),
    new CryptoPanel(),
  ];

  // Attach all panels directly to the grid, forcing enabled + expanded
  for (const panel of panels) {
    panel.enabled = true;
    panel.collapsed = false;
    panel.attachToDOM(panelGrid);
  }

  // Fetch data for all panels in parallel
  await Promise.all(panels.map((p) => p.startDataCycle()));
}
