/**
 * FAQ Page (/#/faq)
 *
 * Answers drawn from predicted support tickets — deflects launch-day volume
 * and surfaces NexusWatch's trust + transparency posture.
 *
 * Visual treatment is the dense terminal aesthetic: page H1 is large and
 * tight, eyebrow above the title, mono accents in metadata only. The list
 * uses <details> as the hierarchy element. Tokens come from
 * src/styles/tokens.css — no hardcoded hex or px in this file.
 */

import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'What do the colored dots on the map mean?',
    a: 'Each color represents a different data layer. Red dots are conflict signals derived from GDELT headlines — positions are approximate, country-level, orange dots are wildfires (NASA FIRMS), yellow dots are news events (GDELT), and green markers show chokepoint status. Press <kbd>L</kbd> to open the full layer panel and toggle layers on/off.',
  },
  {
    q: 'What is the CII score?',
    a: 'The Country Instability Index (CII) is a composite 0\u2013100 score measuring geopolitical risk across 6 components: Conflict (20%), Disasters (15%), Sentiment (15%), Infrastructure (15%), Governance (15%), and Market Exposure (20%). Higher scores mean greater instability. Every score links to its full evidence chain.',
  },
  {
    q: 'What does "LOW confidence" mean?',
    a: 'Confidence reflects how many independent data sources agree on a score. HIGH (3+ sources agree), MEDIUM (2 sources), LOW (1 source). Low confidence doesn\u2019t mean the data is wrong \u2014 it means fewer sources are available to cross-validate. We show this so you know exactly how much to trust each number.',
  },
  {
    q: 'How often is the data updated?',
    a: 'It depends on the source. Earthquakes update every 60 seconds (USGS). Wildfires every 10 minutes (NASA FIRMS). The conflict signal refreshes with GDELT (the ACLED feed is currently offline). CII scores recompute on each data refresh cycle. Each layer shows a freshness badge \u2014 green means updated within the last hour.',
  },
  {
    q: 'Is NexusWatch really free?',
    a: 'Yes. The whole thing — full 3D globe with 45+ live layers, CII scores with daily history for 85 countries, intelligence briefs, AI analyst, alerts, evidence chains, scenario simulation, portfolio exposure, API access. Free for everyone. No credit card required.',
  },
  {
    q: 'How do I compare countries?',
    a: 'Go to the <a href="#/compare">Compare page</a> and type country names (e.g., "Ukraine, Russia, Taiwan") or use one of the preset comparisons like Russia\u2013NATO or Taiwan Strait. You can compare up to 6 countries side by side with full CII component breakdowns.',
  },
  {
    q: 'Can I use NexusWatch data in my reporting?',
    a: 'Yes. You can cite NexusWatch CII scores with attribution. Our <a href="#/methodology">methodology page</a> documents exactly how scores are computed, and every score links to its evidence chain showing the source data, confidence level, and rule version. You can also export data as CSV/JSON.',
  },
  {
    q: 'What is the evidence chain?',
    a: 'Every CII score has an <a href="#/audit">evidence chain</a> showing exactly how it was computed: which data sources contributed, when they were last updated, what confidence level each source has, and which scoring rules were applied. This is our "radical transparency" \u2014 no black boxes.',
  },
  {
    q: 'How do I get alerts?',
    a: 'Go to your <a href="#/watchlist">Watchlist</a>, add countries, and set alert thresholds. Delivery via email, Slack, Discord, or Telegram webhooks.',
  },
];

export function renderFaqPage(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.faq);
  root.innerHTML = '';
  root.className = 'nw-faq-page';

  const page = createElement('div', { className: 'nw-faq' });
  page.setAttribute('role', 'main');
  page.id = 'main-content';

  const header = createElement('header', { className: 'nw-faq-header' });
  header.innerHTML = `
    <a href="#/" class="nw-faq-back">\u2190 Home</a>
    <div class="nw-faq-eyebrow">SUPPORT</div>
    <h1 class="nw-faq-title">Frequently Asked Questions</h1>
    <p class="nw-faq-lede">
      Can't find your answer? Email <a class="nw-faq-link" href="mailto:hello@nexuswatch.dev">hello@nexuswatch.dev</a>
    </p>
  `;
  page.appendChild(header);

  const list = createElement('div', { className: 'nw-faq-list' });
  for (const item of FAQ_ITEMS) {
    const details = document.createElement('details');
    details.className = 'nw-faq-item';

    const summary = document.createElement('summary');
    summary.className = 'nw-faq-q';
    summary.innerHTML = `<span>${item.q}</span><span class="nw-faq-icon" aria-hidden="true">+</span>`;

    const answer = createElement('div', { className: 'nw-faq-a' });
    answer.innerHTML = item.a;

    details.appendChild(summary);
    details.appendChild(answer);

    details.addEventListener('toggle', () => {
      const icon = summary.querySelector('.nw-faq-icon') as HTMLElement | null;
      if (icon) icon.textContent = details.open ? '\u2212' : '+';
    });

    list.appendChild(details);
  }
  page.appendChild(list);

  const footer = createElement('div', { className: 'nw-faq-footer' });
  footer.innerHTML = `
    <a href="#/intel" class="nw-faq-cta">Open the Intel Map \u2192</a>
  `;
  page.appendChild(footer);

  root.appendChild(page);
}
