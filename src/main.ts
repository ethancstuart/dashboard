import { applyTheme } from './config/theme.ts';
import { App } from './App.ts';

applyTheme();

const app = new App();
app.init();
