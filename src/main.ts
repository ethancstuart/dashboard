import './styles/main.css';
import { applyTheme } from './config/theme.ts';
import { applyDensity } from './config/density.ts';
import { Router } from './router.ts';
import { registerCommandPalette } from './ui/commandPalette.ts';
import { registerPwaInstall } from './ui/pwaInstall.ts';
import { initDataToasts } from './ui/dataToast.ts';
import { initSentry, captureError } from './services/sentry.ts';
import { initWebAnalytics } from './services/webAnalytics.ts';

applyTheme();
applyDensity();
initDataToasts();
// Aggregate traffic for nexuswatch.dev. Reports hash-route changes itself —
// inject() alone has no route support. Inert until Web Analytics is enabled
// for the project in the Vercel dashboard.
initWebAnalytics();

// 2026-05-02: defer Sentry init off the critical path. Saves ~400KB parse cost
// from first paint. We still capture errors that fire before idle via the
// captured-errors queue handled inside services/sentry.ts.
type IdleCb = (cb: () => void) => unknown;
const idle: IdleCb =
  (window as unknown as { requestIdleCallback?: IdleCb }).requestIdleCallback ||
  ((cb: () => void) => setTimeout(cb, 1500));
idle(() => {
  void initSentry();
});
// Cmd+K / Ctrl+K opens the command palette from anywhere
registerCommandPalette();
// PWA install banner (shows on supported browsers after 15s)
registerPwaInstall();

const router = new Router();
const appRoot = document.getElementById('app')!;

/** Crossfade page transition — fade out, swap, fade in. */
function transition(root: HTMLElement): Promise<void> {
  if (!root.firstChild) return Promise.resolve();
  root.style.transition = 'opacity 0.12s ease';
  root.style.opacity = '0';
  return new Promise((r) =>
    setTimeout(() => {
      root.textContent = '';
      root.style.opacity = '1';
      root.style.transition = 'opacity 0.2s ease';
      r();
    }, 120),
  );
}

function showRouteError(root: HTMLElement, err: unknown, retryFn?: (() => void) | null) {
  // Default retry: reload the current route
  if (retryFn === undefined) {
    // The router is path-first now (src/router.ts), so the old
    // clear-the-hash-and-set-it-back trick would navigate to '/' instead of
    // re-rendering the current route. Reload the route we are actually on.
    retryFn = () => {
      window.location.reload();
    };
  }
  root.textContent = '';
  const container = document.createElement('div');
  container.style.cssText =
    'padding:4rem 2rem;text-align:center;font-family:var(--nw-font-body, Inter, sans-serif);max-width:480px;margin:0 auto';

  const title = document.createElement('h2');
  title.textContent = 'Something went wrong';
  title.style.cssText = 'color:var(--nw-text, #ededed);font-size:24px;margin:0 0 12px';

  const desc = document.createElement('p');
  desc.textContent = 'This page failed to load. This could be a network issue or a temporary problem on our end.';
  desc.style.cssText = 'color:var(--nw-text-muted, #757575);font-size:14px;margin:0 0 24px;line-height:1.5';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap';

  if (retryFn) {
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Try again';
    retryBtn.style.cssText =
      'padding:8px 20px;background:var(--nw-accent, #ff6600);color:#000;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:14px';
    retryBtn.addEventListener('click', retryFn);
    actions.appendChild(retryBtn);
  }

  const mapLink = document.createElement('a');
  mapLink.href = '#/intel';
  mapLink.textContent = 'Go to Intel Map';
  mapLink.style.cssText =
    'padding:8px 20px;border:1px solid var(--nw-border, #222);color:var(--nw-text, #ededed);border-radius:6px;text-decoration:none;font-size:14px';
  actions.appendChild(mapLink);

  const footer = document.createElement('p');
  footer.style.cssText = 'color:var(--nw-text-muted, #757575);font-size:12px;margin:24px 0 0';
  footer.innerHTML =
    'If this keeps happening: <a href="#/status" style="color:var(--nw-accent, #ff6600)">Status page</a>';

  container.append(title, desc, actions, footer);
  root.appendChild(container);
  console.error('Route load error:', err);
  captureError(err);
}

function show404(root: HTMLElement) {
  root.textContent = '';
  const container = document.createElement('div');
  container.style.cssText =
    'padding:4rem 2rem;text-align:center;font-family:var(--nw-font-body, Inter, sans-serif);max-width:480px;margin:0 auto';

  const title = document.createElement('h2');
  title.textContent = '404 — Page not found';
  title.style.cssText = 'color:var(--nw-text, #ededed);font-size:24px;margin:0 0 12px';

  const desc = document.createElement('p');
  desc.textContent = "The page you're looking for doesn't exist or has been moved.";
  desc.style.cssText = 'color:var(--nw-text-muted, #757575);font-size:14px;margin:0 0 24px;line-height:1.5';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:0 0 32px';

  const mapLink = document.createElement('a');
  mapLink.href = '#/intel';
  mapLink.textContent = 'Go to Intel Map';
  mapLink.style.cssText =
    'padding:8px 20px;background:var(--nw-accent, #ff6600);color:#000;border:none;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px';
  actions.appendChild(mapLink);

  const homeLink = document.createElement('a');
  homeLink.href = '#/';
  homeLink.textContent = 'Go Home';
  homeLink.style.cssText =
    'padding:8px 20px;border:1px solid var(--nw-border, #222);color:var(--nw-text, #ededed);border-radius:6px;text-decoration:none;font-size:14px';
  actions.appendChild(homeLink);

  const nav = document.createElement('div');
  nav.style.cssText = 'color:var(--nw-text-muted, #757575);font-size:13px';
  const links = [
    ['The Ledger', '#/ledger'],
    ['Briefs', '#/briefs'],
    ['Intel Map', '#/intel'],
    ['Watchlist', '#/watchlist'],
    ['Status', '#/status'],
  ];
  nav.innerHTML =
    'Popular pages: ' +
    links
      .map(([label, href]) => `<a href="${href}" style="color:var(--nw-accent, #ff6600);margin:0 6px">${label}</a>`)
      .join('');

  container.append(title, desc, actions, nav);
  root.appendChild(container);
}

router
  .on('/', () => {
    import('./pages/landing.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderLanding(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/intel', () => {
    import('./pages/nexuswatch.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderNexusWatch(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/app', () => {
    import('./pages/nexuswatch.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderNexusWatch(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/about', () => {
    import('./pages/about.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderAbout(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/why-free', () => {
    import('./pages/whyFree.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderWhyFree(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/case-study', () => {
    // Legacy route — preserve access to the old technical case study.
    import('./pages/casestudy.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderCaseStudy(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/roadmap', () => {
    import('./pages/roadmap.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderRoadmap(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/briefs', () => {
    import('./pages/briefs.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderBriefs(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/methodology', () => {
    import('./pages/methodology.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderMethodology(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  // /accuracy and /ledger both render The Ledger. The old accuracy page scored
  // `assessments` — predictions of our own index, against our own index — and
  // heroed that as a track record.
  //
  // Two measurements of how bad, kept side by side rather than overwritten:
  //   2026-08-22, 10,215 rows:  -37.3% skill (MAE 1.263 vs 0.920)
  //   2026-08-31, 10,895 rows:  -17.0% skill (MAE 2.2108 vs naive 1.8889)
  // Different windows and the second used the model's own recorded error
  // against a no-change baseline on the same rows. The magnitude moved; the
  // sign did not. The loop is worse than assuming nothing changes.
  //
  // The route is kept so existing links and the sitemap keep working; what it
  // serves is now resolved against sources outside NexusWatch. As of
  // 2026-08-31 the page module and /api/accuracy/stats are DELETED, so the
  // 90.3% "accuracy_rate" that endpoint published is no longer served
  // anywhere.
  .on('/ledger', () => {
    import('./pages/ledger.ts')
      .then(async (m) => {
        await transition(appRoot);
        void m.renderLedgerPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/accuracy', () => {
    import('./pages/ledger.ts')
      .then(async (m) => {
        await transition(appRoot);
        void m.renderLedgerPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/portfolio', () => {
    import('./pages/portfolio.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderPortfolioPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/api', () => {
    import('./pages/apidocs.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderApiDocsPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/mcp', () => {
    import('./pages/mcp.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderMcpPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/live-brief/:code', (params) => {
    import('./pages/liveBrief.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderLiveBriefPage(appRoot, params?.code ?? '');
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/what-if', () => {
    import('./pages/whatIf.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderWhatIfPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/what-if/:id', (params) => {
    import('./pages/whatIf.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderWhatIfPage(appRoot, params?.id);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/cinematic', () => {
    import('./pages/cinematic.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderCinematicPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/lab', () => {
    import('./pages/lab.ts')
      .then(async (m) => {
        await transition(appRoot);
        void m.renderLabPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/audio', () => {
    import('./pages/audio.ts')
      .then(async (m) => {
        await transition(appRoot);
        void m.renderAudioPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/globe', () => {
    import('./pages/globe.ts')
      .then(async (m) => {
        await transition(appRoot);
        void m.renderGlobePage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/whats-new', () => {
    import('./pages/releaseNotes.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderReleaseNotes(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/status', () => {
    import('./pages/status.ts')
      .then(async (m) => {
        await transition(appRoot);
        void m.renderStatusPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/audit', () => {
    import('./pages/audit.ts')
      .then(async (m) => {
        await transition(appRoot);
        void m.renderAuditPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/audit/:country', (params) => {
    import('./pages/audit.ts')
      .then(async (m) => {
        await transition(appRoot);
        void m.renderAuditPage(appRoot, params?.country);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/compare', () => {
    import('./pages/compare.ts')
      .then(async (m) => {
        await transition(appRoot);
        void m.renderComparePage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/entities', () => {
    import('./pages/entities.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderEntitiesPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/entities/:id', (params) => {
    import('./pages/entities.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderEntitiesPage(appRoot, params?.id);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/brief-country/:code', (params) => {
    import('./pages/countryBrief.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderCountryBrief(appRoot, params?.code || '');
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/watchlist', () => {
    import('./pages/watchlist.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderWatchlistPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/feed', () => {
    import('./pages/feed.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderFeedPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  // /welcome was the third of three competing onboarding flows, all deleted
  // 2026-08-23. Old links land on /settings, which is where interests live now.
  .on('/welcome', () => {
    router.navigate('/settings');
  })
  .on('/settings', () => {
    import('./pages/settings.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderSettings(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/faq', () => {
    import('./pages/faq.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderFaqPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/terms', () => {
    import('./pages/terms.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderTermsPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/privacy', () => {
    import('./pages/privacy.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderPrivacyPage(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/security', () => {
    import('./pages/security.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderSecurity(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/admin/social-queue', () => {
    import('./pages/socialQueue.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderSocialQueue(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/admin/marketing', () => {
    import('./pages/adminMarketing.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderAdminMarketing(appRoot);
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .on('/brief/:date', (params) => {
    import('./pages/briefs.ts')
      .then(async (m) => {
        await transition(appRoot);
        m.renderBrief(appRoot, params?.date || '');
      })
      .catch((err) => showRouteError(appRoot, err));
  })
  .otherwise(() => show404(appRoot))
  .start();
