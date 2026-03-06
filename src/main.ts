import { applyTheme } from './config/theme.ts';
import { Router } from './router.ts';

applyTheme();

const router = new Router();
const appRoot = document.getElementById('app')!;

router
  .on('/', () => {
    import('./pages/landing.ts').then((m) => {
      appRoot.textContent = '';
      m.renderLanding(appRoot);
    });
  })
  .on('/app', () => {
    import('./pages/dashboard.ts').then((m) => {
      appRoot.textContent = '';
      m.renderDashboard(appRoot);
    });
  })
  .on('/roadmap', () => {
    import('./pages/roadmap.ts').then((m) => {
      appRoot.textContent = '';
      m.renderRoadmap(appRoot);
    });
  })
  .otherwise(() => router.navigate('/'))
  .start();
