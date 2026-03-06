import { App } from '../App.ts';
import { createHeader } from '../ui/header.ts';
import { createTicker } from '../ui/ticker.ts';
import { createLayout } from '../ui/layout.ts';
import { initPredictionBanner } from '../ui/predictionBanner.ts';
import { WeatherPanel } from '../panels/WeatherPanel.ts';
import { StocksPanel } from '../panels/StocksPanel.ts';
import { NewsPanel } from '../panels/NewsPanel.ts';
import { SportsPanel } from '../panels/SportsPanel.ts';
import { showWelcome } from '../ui/welcome.ts';

export async function renderDashboard(root: HTMLElement): Promise<void> {
  root.textContent = '';
  await showWelcome();

  const app = new App();

  const newsPanel = new NewsPanel();
  app.registerPanel(new WeatherPanel());
  app.registerPanel(new StocksPanel());
  app.registerPanel(newsPanel);
  app.registerPanel(new SportsPanel());

  root.appendChild(createHeader(app));
  root.appendChild(createTicker());

  const layout = createLayout();
  root.appendChild(layout.root);

  newsPanel.setMapContainer(layout.mapHero);

  app.sidebarContainer = layout.sidebar;
  app.contentContainer = layout.content;
  app.sportsContainer = layout.sportsRow;

  app.init();
  initPredictionBanner(layout.predictionBanner);
}
