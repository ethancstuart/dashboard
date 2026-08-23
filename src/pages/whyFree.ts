/**
 * /why-free — editorial essay page (Track C).
 *
 * 400–600 word essay, marketing surface, one column of Source Serif body.
 * No globe, no widgets — just type. Apply .marketing-surface for the
 * editorial treatment + .nw-essay for the column layout.
 */

import '../styles/landing.css';
import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';

export function renderWhyFree(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.whyFree);
  root.textContent = '';

  const main = createElement('main', { className: 'marketing-surface nw-landing-surface' });
  main.id = 'main-content';
  main.setAttribute('role', 'main');

  main.innerHTML = `
    <nav class="nw-nav" aria-label="Primary">
      <a href="#/" class="nw-nav-brand"><span class="nw-nav-mark">●</span>&nbsp;NexusWatch</a>
      <div class="nw-nav-links">
        <a href="#/intel">Intel Map</a>
        <a href="#/briefs">Briefs</a>
        <a href="#/why-free">Why Free</a>
        <a href="#/about">About</a>
      </div>
    </nav>

    <article class="nw-essay">
      <p class="nw-section-eyebrow" style="margin-bottom: 32px;">On Free</p>
      <h1>Why this is free.</h1>

      <p>
        The existing geopolitical intelligence platforms cost five thousand to fifty thousand dollars
        a year and read like government reports written for nobody. The data underneath them is
        mostly open — USGS, ACLED, GDELT, NASA, IMF, World Bank, the wires. The interpretation is
        the actual product. I'd rather charge zero, build the audience, and figure out funding from
        somewhere that isn't a per-seat license.
      </p>

      <h2>The honest part.</h2>
      <p>
        This may not stay free forever. If costs outpace what I can absorb, I'll add a paid tier
        later — but the core (globe, briefs, RSS, Cinema) stays free indefinitely. If you ever see
        a paywall on those four things, you can yell at me about this paragraph.
      </p>

      <h2>The trade you're making.</h2>
      <p>
        What you get in exchange for paying nothing: less polish than a fifty-thousand-dollar
        product, more transparency than any paywalled vendor, and a single operator you can email
        when something is wrong. What you don't get: a dedicated success manager, a quarterly
        roadmap call, or a team of analysts on retainer. If that's what you need, you should pay
        somebody for it. NexusWatch is the version of this category for everyone else.
      </p>

      <h2>The receipts.</h2>
      <p>
        The repo is open: <a href="https://github.com/ethancstuart/nexus-watch" target="_blank" rel="noopener">github.com/ethancstuart/nexus-watch</a>.
        Every brief that's ever been published is archived at <a href="#/briefs">/briefs</a>. The
        call ledger — including calls we get wrong — is at <a href="#/ledger">/ledger</a>.
        Methodology is at <a href="#/methodology">/methodology</a>. The operator is me.
      </p>

      <p>
        That's the deal. Open source, open data, open method. The world is hard enough to read
        without a paywall in front of it.
      </p>

      <p class="nw-essay-closing">
        If you find a bug, email me — <a href="mailto:ethan@nexuswatch.dev">ethan@nexuswatch.dev</a>.
      </p>
    </article>

    <footer class="nw-footer">
      <div class="nw-footer-top">
        <div class="nw-footer-brand"><span>●</span> NexusWatch</div>
        <div class="nw-footer-links">
          <a href="#/intel">Intel Map</a>
          <a href="#/briefs">Briefs</a>
          <a href="#/why-free">Why Free</a>
          <a href="#/about">About</a>
          <a href="#/api">API</a>
          <a href="https://github.com/ethancstuart/nexus-watch" target="_blank" rel="noopener">GitHub</a>
          <a href="/api/feed" rel="alternate" type="application/rss+xml">RSS</a>
        </div>
      </div>
      <div class="nw-footer-meta">
        © ${new Date().getFullYear()} NexusWatch · MIT License · Built in the open.
      </div>
    </footer>
  `;

  root.appendChild(main);
}
