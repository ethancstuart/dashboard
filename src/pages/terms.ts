/**
 * Terms of Service page (/#/terms)
 */

import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';
import { pageShell } from '../ui/kit/index.ts';

export function renderTermsPage(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.terms);
  const main = pageShell(root, { active: '/terms' });

  const page = createElement('div', {});
  page.setAttribute('role', 'main');
  page.id = 'main-content';
  page.style.cssText =
    'max-width:700px;margin:0 auto;padding:48px 24px;font-family:var(--nw-font-body, Inter, sans-serif)';

  page.innerHTML = `    <h1 style="font-size:28px;font-weight:700;color:var(--nw-text);margin:16px 0 8px">Terms of Service</h1>
    <p style="font-size:12px;color:var(--nw-text-muted);margin:0 0 32px">Last updated: April 19, 2026</p>

    <div style="font-size:14px;color:var(--nw-text-secondary);line-height:1.7">
      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">1. What NexusWatch Is</h2>
      <p>NexusWatch is a geopolitical intelligence platform that aggregates publicly available data from sources like ACLED, USGS, NASA FIRMS, GDELT, and others to compute Country Instability Index (CII) scores and generate intelligence briefs.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">2. Not Advice</h2>
      <p><strong>NexusWatch does not provide investment advice, policy recommendations, military guidance, or any professional counsel.</strong> CII scores, briefs, scenario simulations, and all other outputs are for informational and analytical purposes only. Do not make financial, security, travel, or policy decisions based solely on NexusWatch data. Always consult qualified professionals for decisions that affect people, money, or safety.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">3. Data Accuracy</h2>
      <p>NexusWatch aggregates data from third-party sources. We do not guarantee the accuracy, completeness, or timeliness of any data. CII scores are computed algorithmically and may contain errors. Evidence chains show our sources and methodology transparently so you can evaluate the data yourself. Data freshness is indicated by badges on each layer.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">4. Accounts</h2>
      <p>NexusWatch is free for everyone. Accounts require Google or GitHub authentication and are used to sync watchlists, alerts, and briefs across devices. There is no paid plan and no payment processing.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">5. What You Can Do</h2>
      <p>You may use NexusWatch data in your own analysis, reports, and articles with attribution ("Source: NexusWatch"). You may share briefs and screenshots. You may not resell NexusWatch data as a competing product, use automated scraping to extract data at scale, or misrepresent NexusWatch outputs as your own original analysis without attribution.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">6. API Usage</h2>
      <p>API access is subject to rate limits. API data must include attribution. API keys are personal and non-transferable. We reserve the right to revoke API access for abuse.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">7. Availability</h2>
      <p>We aim for high availability but do not guarantee uptime. Data sources may become unavailable, APIs may change, and the service may have downtime for maintenance. Check the <a href="#/status" style="color:var(--nw-accent)">status page</a> for current system state.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">8. Changes</h2>
      <p>We may update these terms. Continued use after changes constitutes acceptance. Material changes will be communicated via email to subscribers.</p>

      <h2 style="font-size:18px;color:var(--nw-text);margin:24px 0 8px">9. Contact</h2>
      <p>Questions about these terms: <a href="mailto:hello@nexuswatch.dev" style="color:var(--nw-accent)">hello@nexuswatch.dev</a></p>
    </div>
  `;

  main.appendChild(page);
}
