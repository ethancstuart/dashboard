/**
 * Privacy Policy page (/#/privacy)
 */

import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';
import { pageShell } from '../ui/kit/index.ts';

export function renderPrivacyPage(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.privacy);
  const main = pageShell(root, { active: '/privacy' });

  const page = createElement('div', {});
  page.setAttribute('role', 'main');
  page.id = 'main-content';
  page.style.cssText =
    'max-width:700px;margin:0 auto;padding:48px 24px;font-family:var(--nw-font-body, Inter, sans-serif)';

  page.innerHTML = `    <h1 style="font-size:28px;font-weight:700;color:var(--nw-text);margin:16px 0 8px">Privacy Policy</h1>
    <p style="font-size:12px;color:var(--nw-text-muted);margin:0 0 32px">Last updated: April 19, 2026</p>

    <div style="font-size:14px;color:var(--nw-text-secondary);line-height:1.7">
      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">The Short Version</h2>
      <p>We collect your email and name from Google/GitHub login. We don't track you with third-party analytics. Your portfolio holdings never leave your browser. We use cookies only for authentication sessions. That's it.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">1. What We Collect</h2>
      <p><strong>When you sign in:</strong> Your name, email address, and profile picture from your Google or GitHub account. This is used to identify your account and deliver briefs.</p>
      <p><strong>When you subscribe to briefs:</strong> Your email address and delivery preferences (frequency, regions of interest).</p>
      <p><strong>NexusWatch is free for everyone.</strong> No payment processing. No card data ever touches our servers.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">2. What We Don't Collect</h2>
      <p><strong>No third-party tracking.</strong> No Google Analytics, no Facebook Pixel, no ad trackers. We have a lightweight, first-party event counter stored in your browser's localStorage for conversion analytics \u2014 this data never leaves your device.</p>
      <p><strong>Portfolio data stays in your browser.</strong> The Portfolio Geopolitical Exposure feature computes everything client-side. Your holdings are stored in localStorage on your device. We cannot see, access, or store your portfolio.</p>
      <p><strong>No selling of data.</strong> We do not sell, rent, or share your personal information with anyone.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">3. Cookies & Local Storage</h2>
      <p><strong>Session cookie:</strong> A single authentication cookie (<code>__Host-session</code>) to keep you logged in. Expires when you sign out.</p>
      <p><strong>localStorage:</strong> We store your preferences (theme, layer selections, watchlist, interests, saved views) in your browser's localStorage. This data stays on your device and syncs to our server only when you're logged in, so your settings follow you across devices.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">4. How We Use Your Data</h2>
      <p>Your email: to send intelligence briefs at your chosen frequency, and to send transactional emails (welcome, subscription confirmation, alert notifications). Your name: to personalize your experience. Your interests: to filter brief content to what matters to you.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">5. Data Storage</h2>
      <p>Account data is stored in Neon (PostgreSQL) and Upstash (Redis) hosted in the US. Session data is stored in Upstash Redis with automatic expiration. All data is encrypted in transit (TLS) and at rest.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">6. Your Rights</h2>
      <p>You can: view your data (settings page), update your preferences, unsubscribe from emails (one-click in every email), delete your account (email us), export your watchlist (CSV export on watchlist page). To request account deletion: <a href="mailto:hello@nexuswatch.dev" style="color:var(--nw-accent)">hello@nexuswatch.dev</a></p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">7. Changes</h2>
      <p>We may update this policy. Material changes will be communicated via email to subscribers.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">8. Contact</h2>
      <p>Privacy questions: <a href="mailto:hello@nexuswatch.dev" style="color:var(--nw-accent)">hello@nexuswatch.dev</a></p>
    </div>
  `;

  main.appendChild(page);
}
