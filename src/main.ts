import { applyTheme } from './config/theme.ts';
import { App } from './App.ts';
import { createHeader } from './ui/header.ts';
import { createLayout } from './ui/layout.ts';
import { qs } from './utils/dom.ts';
import { WeatherPanel } from './panels/WeatherPanel.ts';
import { SettingsPanel } from './panels/SettingsPanel.ts';

applyTheme();

const app = new App();

app.registerPanel(new WeatherPanel());
app.registerPanel(new SettingsPanel(app));

document.body.appendChild(createHeader(app));

const layout = createLayout();
document.body.appendChild(layout);

app.gridContainer = qs<HTMLElement>('.panel-grid', layout)!;

app.init();
