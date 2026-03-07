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

  // Sign In button with provider dropdown
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

  // Check if already logged in — show avatar instead
  void checkSession().then((user) => {
    if (user) {
      signInWrap.textContent = '';
      const avatar = document.createElement('a');
      avatar.href = '#/app';
      avatar.className = 'landing-user-avatar';
      if (user.avatar) {
        const img = document.createElement('img');
        img.src = user.avatar;
        img.alt = user.name;
        img.width = 32;
        img.height = 32;
        img.style.borderRadius = '50%';
        avatar.appendChild(img);
      }
      const name = createElement('span', { className: 'landing-nav-link', textContent: user.name });
      avatar.appendChild(name);
      signInWrap.appendChild(avatar);
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
    textContent: 'Your real-time intelligence dashboard. Weather, markets, news, sports \u2014 all in one futuristic command center.',
  });

  const heroCtas = createElement('div', { className: 'landing-hero-ctas' });
  const tryBtn = document.createElement('a');
  tryBtn.href = '#/app';
  tryBtn.className = 'landing-btn landing-btn-primary';
  tryBtn.textContent = 'Try Dashboard';

  const waitlistBtn = createElement('button', { className: 'landing-btn landing-btn-outline', textContent: 'Join Waitlist' });
  waitlistBtn.addEventListener('click', () => {
    const waitlistSection = page.querySelector('.landing-waitlist');
    waitlistSection?.scrollIntoView({ behavior: 'smooth' });
  });

  heroCtas.appendChild(tryBtn);
  heroCtas.appendChild(waitlistBtn);

  hero.appendChild(heroTitle);
  hero.appendChild(heroTagline);
  hero.appendChild(heroCtas);
  page.appendChild(hero);

  // Features grid
  const features = createElement('section', { className: 'landing-features' });
  const featuresTitle = createElement('h2', { className: 'landing-section-title', textContent: 'Built for the Information Age' });
  features.appendChild(featuresTitle);

  const featureGrid = createElement('div', { className: 'landing-feature-grid' });
  const featureItems = [
    { icon: '\u2601', title: 'Weather', desc: 'Hyperlocal forecasts, hourly sparklines, and live conditions on a world map.' },
    { icon: '\uD83D\uDCC8', title: 'Markets', desc: 'Real-time stock quotes, watchlists, sparklines, and financial news.' },
    { icon: '\uD83C\uDF10', title: 'News', desc: 'Global headlines from 20+ sources, mapped to their origin with live feeds.' },
    { icon: '\u26BD', title: 'Sports', desc: 'Live scores from NBA, NFL, MLB, and EPL with game status and headlines.' },
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

  // Waitlist section
  const waitlist = createElement('section', { className: 'landing-waitlist' });
  const waitlistTitle = createElement('h2', { className: 'landing-section-title', textContent: 'Get Early Access' });
  const waitlistDesc = createElement('p', {
    className: 'landing-waitlist-desc',
    textContent: 'Join the waitlist for premium features: AI chat, calendar integration, drag-and-drop layout, and more.',
  });

  const form = createElement('div', { className: 'landing-waitlist-form' });
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Your name';
  nameInput.className = 'landing-input';

  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.placeholder = 'Your email';
  emailInput.className = 'landing-input';

  const submitBtn = createElement('button', { className: 'landing-btn landing-btn-primary', textContent: 'Join Waitlist' });
  const formMessage = createElement('div', { className: 'landing-waitlist-message' });

  submitBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    if (!name || !email) {
      formMessage.textContent = 'Please fill in both fields.';
      formMessage.className = 'landing-waitlist-message landing-waitlist-error';
      return;
    }
    submitBtn.textContent = 'Joining...';
    (submitBtn as HTMLButtonElement).disabled = true;
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (res.ok) {
        formMessage.textContent = data.message || "You're on the list! We'll be in touch.";
        formMessage.className = 'landing-waitlist-message landing-waitlist-success';
        nameInput.value = '';
        emailInput.value = '';
      } else {
        formMessage.textContent = data.error || 'Something went wrong.';
        formMessage.className = 'landing-waitlist-message landing-waitlist-error';
      }
    } catch {
      formMessage.textContent = 'Network error. Please try again.';
      formMessage.className = 'landing-waitlist-message landing-waitlist-error';
    }
    submitBtn.textContent = 'Join Waitlist';
    (submitBtn as HTMLButtonElement).disabled = false;
  });

  form.appendChild(nameInput);
  form.appendChild(emailInput);
  form.appendChild(submitBtn);

  waitlist.appendChild(waitlistTitle);
  waitlist.appendChild(waitlistDesc);
  waitlist.appendChild(form);
  waitlist.appendChild(formMessage);
  page.appendChild(waitlist);

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

  const footerCopy = createElement('span', {
    className: 'landing-footer-copy',
    textContent: '\u00A9 2026 DashPulse \u2014 Built entirely with Claude Code by Ethan Stuart',
  });

  footerLinks.appendChild(footerRoadmap);
  footerLinks.appendChild(footerGithub);
  footer.appendChild(footerLinks);
  footer.appendChild(footerCopy);
  page.appendChild(footer);

  root.appendChild(page);
}
