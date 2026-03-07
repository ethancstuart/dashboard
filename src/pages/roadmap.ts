import { createElement } from '../utils/dom.ts';

export function renderRoadmap(root: HTMLElement): void {
  root.textContent = '';

  const page = createElement('div', { className: 'roadmap-page' });

  // Nav
  const nav = createElement('nav', { className: 'landing-nav' });
  const navBrand = document.createElement('a');
  navBrand.href = '#/';
  navBrand.className = 'landing-nav-brand';
  navBrand.textContent = 'DashPulse';
  navBrand.style.textDecoration = 'none';
  navBrand.style.color = 'inherit';

  const navLinks = createElement('div', { className: 'landing-nav-links' });
  const dashLink = document.createElement('a');
  dashLink.href = '#/app';
  dashLink.className = 'landing-nav-link';
  dashLink.textContent = 'Dashboard';
  navLinks.appendChild(dashLink);
  nav.appendChild(navBrand);
  nav.appendChild(navLinks);
  page.appendChild(nav);

  // Title
  const header = createElement('div', { className: 'roadmap-header' });
  const title = createElement('h1', { className: 'roadmap-title', textContent: 'Roadmap' });
  const subtitle = createElement('p', {
    className: 'roadmap-subtitle',
    textContent: 'Everything you check, in one place. Here\'s what\'s shipped and what\'s next.',
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
    { num: '1', title: 'Visit', desc: 'Open the dashboard \u2014 no account needed. All core panels load instantly with live data.' },
    { num: '2', title: 'Explore', desc: 'Browse weather, markets, news, sports, predictions, and AI chat from one command center.' },
    { num: '3', title: 'Customize', desc: 'Sign in to save preferences, sync across devices, and unlock premium features.' },
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

  // Tier comparison
  const tierSection = createElement('section', { className: 'roadmap-section' });
  const tierTitle = createElement('h2', { className: 'landing-section-title', textContent: 'Tier Comparison' });
  tierSection.appendChild(tierTitle);

  const table = document.createElement('table');
  table.className = 'roadmap-tier-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of ['Feature', 'Guest', 'Free (Login)', 'Premium ($5/mo)']) {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const rows = [
    ['Weather, Markets, News, Sports', '\u2713', '\u2713', '\u2713'],
    ['Predictions, Map & Ticker', '\u2713', '\u2713', '\u2713'],
    ['AI Chat (BYO Key)', '\u2713', '\u2713', '\u2713'],
    ['Saved Preferences & Sync', '\u2014', '\u2713', '\u2713'],
    ['Cross-Device Sync', '\u2014', '\u2713', '\u2713'],
    ['Custom News Sources', '\u2014', '\u2713', '\u2713'],
    ['Up to 3 Weather Locations', '\u2014', '\u2713', '\u2713'],
    ['Theme Presets (Dark/Light/OLED)', '\u2014', '\u2713', '\u2713'],
    ['Dashboard Sharing', '\u2014', '\u2713', '\u2713'],
    ['Hosted AI Chat (No Key Needed)', '\u2014', '\u2014', '\u2713'],
    ['Daily AI Briefing', '\u2014', '\u2014', '\u2713'],
    ['Custom Alerts', '\u2014', '\u2014', '\u2713'],
    ['Faster Refresh Rates', '\u2014', '\u2014', '\u2713'],
    ['Drag-and-Drop Layout', '\u2014', '\u2014', '\u2713'],
    ['Calendar Integration', '\u2014', '\u2014', '\u2713'],
    ['Notes & To-Do Panel', '\u2014', '\u2014', '\u2713'],
    ['25-Stock Watchlist', '\u2014', '\u2014', '\u2713'],
    ['Unlimited Weather Locations', '\u2014', '\u2014', '\u2713'],
    ['Multiple Dashboards', '\u2014', '\u2014', '\u2713'],
  ];
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (let i = 0; i < r.length; i++) {
      const td = document.createElement('td');
      td.textContent = r[i];
      if (i > 0) td.style.textAlign = 'center';
      if (r[i] === '\u2713') td.style.color = 'var(--color-positive)';
      if (r[i] === '\u2014') td.style.opacity = '0.3';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tierSection.appendChild(table);

  // Premium CTA
  const premiumCta = createElement('div', { className: 'roadmap-premium-cta' });
  const ctaText = createElement('p', {
    className: 'roadmap-cta-text',
    textContent: 'Premium coming soon \u2014 everything stays free until then. Founding members lock in $3/mo for life.',
  });
  const ctaBtn = document.createElement('a');
  ctaBtn.href = '#/app';
  ctaBtn.className = 'landing-btn landing-btn-primary';
  ctaBtn.textContent = 'Try the Dashboard';
  premiumCta.appendChild(ctaText);
  premiumCta.appendChild(ctaBtn);
  tierSection.appendChild(premiumCta);
  page.appendChild(tierSection);

  // Timeline
  const timelineSection = createElement('section', { className: 'roadmap-section' });
  const timelineTitle = createElement('h2', { className: 'landing-section-title', textContent: 'Timeline' });
  timelineSection.appendChild(timelineTitle);

  const timeline = createElement('div', { className: 'roadmap-timeline' });
  const milestones: Array<{ status: string; label: string; title: string; desc: string }> = [
    { status: 'shipped', label: 'Shipped', title: 'Core Dashboard', desc: 'Weather, markets (10-stock watchlist with detail views), news (7 categories), interactive map with day/night terminator, market ticker' },
    { status: 'shipped', label: 'Shipped', title: 'Sports Panel', desc: 'NBA, NFL, MLB, EPL live scores, team favorites, and game status' },
    { status: 'shipped', label: 'Shipped', title: 'AI Chat', desc: 'Multi-provider chat (Anthropic, OpenAI, Google, xAI) with BYO key support' },
    { status: 'shipped', label: 'Shipped', title: 'Prediction Markets', desc: 'Live odds from Polymarket and Kalshi' },
    { status: 'shipped', label: 'Shipped', title: 'Auth & Tiers', desc: 'Google/GitHub OAuth, 3-tier system (guest/free/premium)' },
    { status: 'shipped', label: 'Shipped', title: 'Landing & Waitlist', desc: 'Product page, waitlist signup, roadmap, feature comparison' },
    { status: 'active', label: 'Phase 1', title: 'Foundation Hardening', desc: 'Onboarding flow, hero panel, themes (dark/light/OLED), mobile layout, keyboard shortcuts, accessibility, performance' },
    { status: 'planned', label: 'Phase 2', title: 'Sign-In Value', desc: 'Cross-device sync, custom news sources, multiple weather locations, notes panel, dashboard sharing' },
    { status: 'planned', label: 'Phase 3', title: 'Premium Features', desc: 'Hosted AI chat, daily briefing, custom alerts, drag-and-drop layout, calendar, integrations' },
    { status: 'planned', label: 'Phase 4', title: 'Platform Expansion', desc: 'Stripe payments, crypto panel, PWA, command palette, plugin SDK' },
    { status: 'planned', label: 'Phase 5', title: 'AI-Native Intelligence', desc: 'AI co-pilot, natural language config, trend detection, smart defaults' },
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
  const footerBack = document.createElement('a');
  footerBack.href = '#/';
  footerBack.className = 'landing-footer-link';
  footerBack.textContent = '\u2190 Back to Home';
  footer.appendChild(footerBack);
  page.appendChild(footer);

  root.appendChild(page);
}
