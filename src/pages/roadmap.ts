import { createElement } from '../utils/dom.ts';
import { pageShell } from '../ui/kit/index.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';

export function renderRoadmap(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.roadmap);
  const main = pageShell(root, { active: '/roadmap' });

  const page = createElement('div', { className: 'roadmap-page' });

  // Title
  const header = createElement('div', { className: 'roadmap-header' });
  const title = createElement('h1', { className: 'roadmap-title', textContent: 'Roadmap' });
  const subtitle = createElement('p', {
    className: 'roadmap-subtitle',
    textContent: "Everything you check, in one place. Here's what's shipped and what's next.",
  });
  header.appendChild(title);
  header.appendChild(subtitle);
  page.appendChild(header);

  // How it works
  const howSection = createElement('section', { className: 'roadmap-section' });
  const howTitle = createElement('h2', { className: 'landing-section-title', textContent: 'How It Works' });
  howSection.appendChild(howTitle);

  const steps = createElement('div', { className: 'roadmap-steps' });
  const stepItems = [
    {
      num: '1',
      title: 'Visit',
      desc: 'Open the dashboard \u2014 no account needed. All core panels load instantly with live data.',
    },
    {
      num: '2',
      title: 'Explore',
      desc: 'Browse weather, markets, news, sports, predictions, and AI chat from one command center.',
    },
    {
      num: '3',
      title: 'Customize',
      desc: 'Sign in to save preferences and sync across devices.',
    },
  ];
  for (const s of stepItems) {
    const step = createElement('div', { className: 'roadmap-step' });
    const num = createElement('div', { className: 'roadmap-step-num', textContent: s.num });
    const stepTitle = createElement('h3', { className: 'roadmap-step-title', textContent: s.title });
    const desc = createElement('p', { className: 'roadmap-step-desc', textContent: s.desc });
    step.appendChild(num);
    step.appendChild(stepTitle);
    step.appendChild(desc);
    steps.appendChild(step);
  }
  howSection.appendChild(steps);
  page.appendChild(howSection);

  // Timeline
  const timelineSection = createElement('section', { className: 'roadmap-section' });
  const timelineTitle = createElement('h2', { className: 'landing-section-title', textContent: 'Timeline' });
  timelineSection.appendChild(timelineTitle);

  const timeline = createElement('div', { className: 'roadmap-timeline' });
  const milestones: Array<{ status: string; label: string; title: string; desc: string }> = [
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Core Dashboard',
      desc: 'Weather, markets (10-stock watchlist with detail views), news (7 categories), interactive map with day/night terminator, market ticker',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Sports Panel',
      desc: 'NBA, NFL, MLB, EPL live scores, team favorites, and game status',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'AI Chat',
      desc: 'Multi-provider chat (Anthropic, OpenAI, Google, xAI) with BYO key support',
    },
    { status: 'shipped', label: 'Shipped', title: 'Prediction Markets', desc: 'Live odds from Polymarket and Kalshi' },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Auth',
      desc: 'Google/GitHub OAuth, free for everyone',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Landing & Waitlist',
      desc: 'Product page, waitlist signup, roadmap, feature comparison',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Foundation Hardening',
      desc: 'Onboarding flow, themes (dark/light/OLED), panel collapse & density modes, keyboard shortcuts, accessibility, priority loading, unit preferences',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Power Features',
      desc: 'Crypto panel (top 10 coins with sparklines), command palette (Cmd+K), daily AI briefing with dashboard context',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'PWA + Offline',
      desc: 'Installable as native app, service worker with offline caching, install prompt, offline indicator',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Notes & Alerts',
      desc: 'Quick-capture notes panel with to-dos, price alerts with browser notifications',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Config & Analytics',
      desc: 'Export/import dashboard config, lightweight usage analytics with 30-day rolling window',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Layout Rethink',
      desc: 'Space-based widget system with 12-column responsive grid, drag-to-reorder, resize handles, compact/medium/large sizes',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Entertainment & AI Bar',
      desc: 'TMDB entertainment panel, AI Bar with natural language queries, Pulse Bar cross-panel intelligence',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Sign-In Value',
      desc: 'Cross-device sync via Vercel KV, custom news sources, multiple weather locations, dashboard sharing',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Quality & Reliability',
      desc: 'ESLint + Prettier, full CI pipeline, listener leak cleanup, reactive settings (panels refresh immediately on preference changes)',
    },
    {
      status: 'shipped',
      label: 'Shipped',
      title: 'Launch',
      desc: 'Google Calendar integration, advanced alert conditions, OG image generation',
    },
    {
      status: 'active',
      label: 'Phase 4',
      title: 'Platform Expansion',
      desc: 'Plugin SDK, custom dashboards, API access',
    },
    {
      status: 'planned',
      label: 'Phase 5',
      title: 'AI-Native Intelligence',
      desc: 'AI co-pilot, natural language config, trend detection, smart defaults',
    },
  ];

  for (const m of milestones) {
    const item = createElement('div', { className: `roadmap-milestone roadmap-milestone-${m.status}` });
    const dot = createElement('div', { className: `roadmap-dot roadmap-dot-${m.status}` });
    const content = createElement('div', { className: 'roadmap-milestone-content' });
    const badge = createElement('span', { className: `roadmap-badge roadmap-badge-${m.status}`, textContent: m.label });
    const mTitle = createElement('h3', { className: 'roadmap-milestone-title', textContent: m.title });
    const mDesc = createElement('p', { className: 'roadmap-milestone-desc', textContent: m.desc });
    content.appendChild(badge);
    content.appendChild(mTitle);
    content.appendChild(mDesc);
    item.appendChild(dot);
    item.appendChild(content);
    timeline.appendChild(item);
  }
  timelineSection.appendChild(timeline);
  page.appendChild(timelineSection);

  // Footer
  const footer = createElement('footer', { className: 'landing-footer' });
  const footerLinks = createElement('div', { className: 'landing-footer-links' });
  const footerBack = document.createElement('a');
  footerBack.href = '#/';
  footerBack.className = 'landing-footer-link';
  footerBack.textContent = '\u2190 Back to Home';
  const footerSubstack = document.createElement('a');
  footerSubstack.href = 'https://thedataproductagent.substack.com';
  footerSubstack.target = '_blank';
  footerSubstack.rel = 'noopener';
  footerSubstack.className = 'landing-footer-link';
  footerSubstack.textContent = 'The Data Product Agent';
  footerLinks.appendChild(footerBack);
  footerLinks.appendChild(footerSubstack);
  footer.appendChild(footerLinks);
  page.appendChild(footer);

  main.appendChild(page);
}
