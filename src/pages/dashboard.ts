import { App } from '../App.ts';
import { createHeader } from '../ui/header.ts';
import { createTicker } from '../ui/ticker.ts';
import { createLayout } from '../ui/layout.ts';
import { initPredictionBanner } from '../ui/predictionBanner.ts';
import { initKeyboardShortcuts } from '../ui/keyboard.ts';
import { initCommandPalette } from '../ui/commandPalette.ts';
import { initBriefing } from '../ui/briefing.ts';
import { WeatherPanel } from '../panels/WeatherPanel.ts';
import { StocksPanel } from '../panels/StocksPanel.ts';
import { NewsPanel } from '../panels/NewsPanel.ts';
import { SportsPanel } from '../panels/SportsPanel.ts';
import { CryptoPanel } from '../panels/CryptoPanel.ts';
import { ChatPanel } from '../panels/ChatPanel.ts';
import { showWelcome } from '../ui/welcome.ts';
import { isOnboardingComplete, showOnboarding } from '../ui/onboarding.ts';
import { checkSession } from '../services/auth.ts';

export async function renderDashboard(root: HTMLElement): Promise<void> {
  root.textContent = '';

  // Show onboarding for first-time visitors, then welcome animation
  if (!isOnboardingComplete()) {
    await showOnboarding();
  }

  const sessionUser = await checkSession();
  await showWelcome(sessionUser?.name);

  const app = new App();

  const newsPanel = new NewsPanel();
  app.registerPanel(new WeatherPanel());
  app.registerPanel(new StocksPanel());
  app.registerPanel(newsPanel);
  app.registerPanel(new SportsPanel());
  app.registerPanel(new CryptoPanel());
  app.registerPanel(new ChatPanel());

  root.appendChild(createHeader(app));
  root.appendChild(createTicker());

  const layout = createLayout();
  root.appendChild(layout.root);

  newsPanel.setMapContainer(layout.mapHero);

  app.sidebarContainer = layout.sidebar;
  app.contentContainer = layout.content;

  app.init();
  initPredictionBanner(layout.predictionBanner);
  initKeyboardShortcuts(app);
  initCommandPalette(app);
  initBriefing();
}
