import { applyTheme } from './config/theme.ts';
import { App } from './App.ts';
import { createHeader } from './ui/header.ts';
import { createTicker } from './ui/ticker.ts';
import { createLayout } from './ui/layout.ts';
import { WeatherPanel } from './panels/WeatherPanel.ts';
import { StocksPanel } from './panels/StocksPanel.ts';
import { NewsPanel } from './panels/NewsPanel.ts';
import { SettingsPanel } from './panels/SettingsPanel.ts';
import { showWelcome } from './ui/welcome.ts';

applyTheme();
showWelcome();

const app = new App();

const newsPanel = new NewsPanel();
app.registerPanel(new WeatherPanel());
app.registerPanel(new StocksPanel());
app.registerPanel(newsPanel);
app.registerPanel(new SettingsPanel(app));

document.body.appendChild(createHeader(app));
document.body.appendChild(createTicker());

const layout = createLayout();
document.body.appendChild(layout.root);

// Give NewsPanel access to the hero map container
newsPanel.setMapContainer(layout.mapHero);

// Route panels to correct layout areas:
// - Sidebar: weather, stocks, settings
// - Content: news (article list)
app.sidebarContainer = layout.sidebar;
app.contentContainer = layout.content;

app.init();
