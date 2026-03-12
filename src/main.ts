import './styles/main.css';
import { applyTheme } from './config/theme.ts';
import { applyDensity } from './config/density.ts';
import { Router } from './router.ts';

applyTheme();
applyDensity();

const router = new Router();
const appRoot = document.getElementById('app')!;

function showRouteError(root: HTMLElement, err: unknown) {
  root.textContent = '';
  const msg = document.createElement('div');
  msg.style.cssText = 'padding:2rem;text-align:center;color:#999';
  msg.textContent = 'Failed to load page. Please refresh.';
  root.appendChild(msg);
  console.error('Route load error:', err);
}

router
  .on('/', () => {
    import('./pages/landing.ts').then((m) => {
      appRoot.textContent = '';
      m.renderLanding(appRoot);
    }).catch((err) => showRouteError(appRoot, err));
  })
  .on('/app', () => {
    import('./pages/dashboard.ts').then((m) => {
      appRoot.textContent = '';
      m.renderDashboard(appRoot);
    }).catch((err) => showRouteError(appRoot, err));
  })
  .on('/roadmap', () => {
    import('./pages/roadmap.ts').then((m) => {
      appRoot.textContent = '';
      m.renderRoadmap(appRoot);
    }).catch((err) => showRouteError(appRoot, err));
  })
  .on('/embed', () => {
    import('./pages/embed.ts').then((m) => {
      appRoot.textContent = '';
      m.renderEmbed(appRoot);
    }).catch((err) => showRouteError(appRoot, err));
  })
  .on('/import/:code', (params) => {
    import('./pages/dashboard.ts').then((m) => {
      appRoot.textContent = '';
      m.renderDashboard(appRoot);
      // After dashboard renders, open import modal
      setTimeout(() => {
        import('./ui/shareModal.ts').then((sm) => {
          sm.openImportModal(params?.code || '');
        });
      }, 1000);
    }).catch((err) => showRouteError(appRoot, err));
  })
  .otherwise(() => router.navigate('/'))
  .start();
