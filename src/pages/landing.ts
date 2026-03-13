import { createElement } from '../utils/dom.ts';
import { login, checkSession } from '../services/auth.ts';

export function renderLanding(root: HTMLElement): void {
  root.textContent = '';

  const page = createElement('div', { className: 'landing-page' });

  // Nav
  const nav = createElement('nav', { className: 'landing-nav' });
  const navBrand = createElement('span', { className: 'landing-nav-brand', textContent: 'DashPulse' });
  const navLinks = createElement('div', { className: 'landing-nav-links' });

  const roadmapLink = document.createElement('a');
  roadmapLink.href = '#/roadmap';
  roadmapLink.className = 'landing-nav-link';
  roadmapLink.textContent = 'Roadmap';

  const githubLink = document.createElement('a');
  githubLink.href = 'https://github.com/ethancstuart/dashboard';
  githubLink.target = '_blank';
  githubLink.rel = 'noopener';
  githubLink.className = 'landing-nav-link';
  githubLink.textContent = 'GitHub';

  // Sign In buttons
  const signInWrap = createElement('div', { className: 'landing-sign-in-wrap' });
  const signInBtn = createElement('button', { className: 'landing-btn landing-btn-outline landing-sign-in-btn', textContent: 'Sign In' });
  const dropdown = createElement('div', { className: 'landing-sign-in-dropdown' });
  const googleBtn = createElement('button', { className: 'landing-sign-in-option', textContent: 'Google' });
  const githubBtn = createElement('button', { className: 'landing-sign-in-option', textContent: 'GitHub' });
  googleBtn.addEventListener('click', () => login('google'));
  githubBtn.addEventListener('click', () => login('github'));
  dropdown.appendChild(googleBtn);
  dropdown.appendChild(githubBtn);
  signInWrap.appendChild(signInBtn);
  signInWrap.appendChild(dropdown);
  signInBtn.addEventListener('click', () => dropdown.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (!signInWrap.contains(e.target as Node)) dropdown.classList.remove('open');
  });

  // Check if already logged in — redirect to dashboard
  void checkSession().then((user) => {
    if (user) {
      window.location.hash = '#/app';
    }
  });

  navLinks.appendChild(roadmapLink);
  navLinks.appendChild(githubLink);
  navLinks.appendChild(signInWrap);
  nav.appendChild(navBrand);
  nav.appendChild(navLinks);
  page.appendChild(nav);

  // Hero
  const hero = createElement('section', { className: 'landing-hero' });
  const heroGlow = createElement('div', { className: 'landing-hero-glow' });
  hero.appendChild(heroGlow);

  const heroTitle = createElement('h1', { className: 'landing-hero-title', textContent: 'DashPulse' });
  const heroTagline = createElement('p', {
    className: 'landing-hero-tagline',
    textContent: 'Your personal intelligence terminal.',
  });
  const heroSub = createElement('p', {
    className: 'landing-hero-sub',
    textContent: 'Weather, markets, news, sports, and AI \u2014 organized into customizable spaces with a keyboard-driven interface.',
  });

  const heroCtas = createElement('div', { className: 'landing-hero-ctas' });

  // Google login button (primary CTA)
  const googleLoginBtn = createElement('button', {
    className: 'landing-btn landing-btn-primary',
    textContent: 'Sign in with Google',
  });
  googleLoginBtn.addEventListener('click', () => login('google'));

  const githubLoginBtn = createElement('button', {
    className: 'landing-btn landing-btn-outline',
    textContent: 'Sign in with GitHub',
  });
  githubLoginBtn.addEventListener('click', () => login('github'));

  heroCtas.appendChild(googleLoginBtn);
  heroCtas.appendChild(githubLoginBtn);

  hero.appendChild(heroTitle);
  hero.appendChild(heroTagline);
  hero.appendChild(heroSub);
  hero.appendChild(heroCtas);
  page.appendChild(hero);

  // Features grid
  const features = createElement('section', { className: 'landing-features' });
  const featuresTitle = createElement('h2', { className: 'landing-section-title', textContent: 'Built for the Information Age' });
  features.appendChild(featuresTitle);

  const featureGrid = createElement('div', { className: 'landing-feature-grid' });
  const featureItems = [
    { icon: '\u26A1', title: 'Spaces', desc: 'Organize your data into customizable spaces \u2014 Markets, World, Personal, or create your own.' },
    { icon: '\uD83E\uDD16', title: 'AI Bar', desc: 'Natural language commands and AI-powered dashboard control. Ask anything or type / for commands.' },
    { icon: '\uD83D\uDCC8', title: 'Real-Time Data', desc: 'Stocks, crypto, weather, news, sports, entertainment \u2014 all updating live in your terminal.' },
    { icon: '\u2328\uFE0F', title: 'Keyboard-Driven', desc: 'Cmd+K command palette, keyboard shortcuts, and slash commands for power users.' },
    { icon: '\uD83D\uDCA1', title: 'Pulse Bar', desc: 'Cross-panel intelligence strip shows what matters NOW \u2014 market moves, weather alerts, live games.' },
    { icon: '\uD83D\uDCF2', title: 'PWA', desc: 'Install as a native app. Works offline with automatic data syncing across devices.' },
  ];
  for (const f of featureItems) {
    const card = createElement('div', { className: 'landing-feature-card' });
    const icon = createElement('div', { className: 'landing-feature-icon', textContent: f.icon });
    const title = createElement('h3', { className: 'landing-feature-title', textContent: f.title });
    const desc = createElement('p', { className: 'landing-feature-desc', textContent: f.desc });
    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(desc);
    featureGrid.appendChild(card);
  }
  features.appendChild(featureGrid);
  page.appendChild(features);

  // Pricing hint
  const pricing = createElement('section', { className: 'landing-pricing' });
  const pricingText = createElement('p', {
    className: 'landing-pricing-text',
    textContent: 'Free to use. Premium unlocks unlimited spaces, AI queries, and more.',
  });
  pricing.appendChild(pricingText);
  page.appendChild(pricing);

  // Footer
  const footer = createElement('footer', { className: 'landing-footer' });
  const footerLinks = createElement('div', { className: 'landing-footer-links' });

  const footerRoadmap = document.createElement('a');
  footerRoadmap.href = '#/roadmap';
  footerRoadmap.className = 'landing-footer-link';
  footerRoadmap.textContent = 'Roadmap';

  const footerGithub = document.createElement('a');
  footerGithub.href = 'https://github.com/ethancstuart/dashboard';
  footerGithub.target = '_blank';
  footerGithub.rel = 'noopener';
  footerGithub.className = 'landing-footer-link';
  footerGithub.textContent = 'GitHub';

  const footerSubstack = document.createElement('a');
  footerSubstack.href = 'https://thedataproductagent.substack.com';
  footerSubstack.target = '_blank';
  footerSubstack.rel = 'noopener';
  footerSubstack.className = 'landing-footer-link';
  footerSubstack.textContent = 'The Data Product Agent';

  const footerCopy = createElement('span', {
    className: 'landing-footer-copy',
    textContent: '\u00A9 2026 DashPulse \u2014 Built entirely with Claude Code by Ethan Stuart',
  });

  footerLinks.appendChild(footerRoadmap);
  footerLinks.appendChild(footerGithub);
  footerLinks.appendChild(footerSubstack);
  footer.appendChild(footerLinks);
  footer.appendChild(footerCopy);
  page.appendChild(footer);

  root.appendChild(page);
}
