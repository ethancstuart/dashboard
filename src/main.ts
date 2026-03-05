import { applyTheme } from './config/theme.ts';
import { App } from './App.ts';
import { createHeader } from './ui/header.ts';
import { createTicker } from './ui/ticker.ts';
import { createLayout } from './ui/layout.ts';
import { qs } from './utils/dom.ts';
import { WeatherPanel } from './panels/WeatherPanel.ts';
import { StocksPanel } from './panels/StocksPanel.ts';
import { NewsPanel } from './panels/NewsPanel.ts';
import { SettingsPanel } from './panels/SettingsPanel.ts';
import { showWelcome } from './ui/welcome.ts';

applyTheme();
showWelcome();

const app = new App();

app.registerPanel(new WeatherPanel());
app.registerPanel(new StocksPanel());
app.registerPanel(new NewsPanel());
app.registerPanel(new SettingsPanel(app));

document.body.appendChild(createHeader(app));
document.body.appendChild(createTicker());

const layout = createLayout();
document.body.appendChild(layout);

app.gridContainer = qs<HTMLElement>('.panel-grid', layout)!;

app.init();
