/**
 * /about — editorial rebuild (Track C).
 *
 * Tight (~300–400 word) essay describing the platform and the operator.
 * No globe, no widgets, no marketing chrome — just type. Anti-reference:
 * the prior /about (casestudy.ts) which leaned heavy SaaS-y.
 */

import '../styles/landing.css';
import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';
import { pageShell } from '../ui/kit/index.ts';

export function renderAbout(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.about);
  const shellMain = pageShell(root, { active: '/about' });

  const main = createElement('div', { className: 'marketing-surface nw-landing-surface' });

  main.innerHTML = `

    <article class="nw-essay">
      <p class="nw-section-eyebrow" style="margin-bottom: 32px;">Operator</p>
      <h1>About</h1>

      <h2>Why I built this.</h2>
      <p>
        I wanted a single place to read the world — conflict, disasters, shipping, sentiment, the
        signals that move markets and the signals that don't — without paying a five-figure
        license or squinting at a wire desk. The tools that do this well are locked up. The tools
        that are open are mostly raw feeds. There was a thing missing in between, so I built it.
      </p>

      <h2>What it is, and isn't.</h2>
      <p>
        NexusWatch is a live globe with forty-five-plus data layers, a country-by-country
        instability index, an AI-composed daily brief, an open API, and a Cinema mode for wall
        displays. It is <em>not</em> a replacement for Bloomberg, Dataminr, or your government
        intelligence service. It's an opinionated reading surface for the open data those services
        already touch — built for the analyst, the journalist, and the curious.
      </p>

      <h2>How it's built.</h2>
      <ul class="nw-essay-stack-list">
        <li><strong>Frontend</strong> Vite · TypeScript · MapLibre GL</li>
        <li><strong>AI</strong> Anthropic Claude (briefs, sitreps)</li>
        <li><strong>Hosting</strong> Vercel Edge Functions</li>
        <li><strong>Data</strong> Neon Postgres · 12+ public sources</li>
        <li><strong>License</strong> MIT, source on GitHub</li>
        <li><strong>Stack</strong> Zero frameworks. Vanilla DOM.</li>
      </ul>
      <p>
        The economics of all of this are addressed in <a href="#/why-free">why this is free</a>.
        The full source is at <a href="https://github.com/ethancstuart/nexus-watch" target="_blank" rel="noopener">github.com/ethancstuart/nexus-watch</a>.
      </p>

      <h2>Who.</h2>
      <p>
        Built by Ethan Stuart, a product manager who codes. NexusWatch is part of a small portfolio
        of independent projects I run on the side — built deliberately solo, for now. The product
        is the protagonist; I'm the person who answers the email.
      </p>

      <h2>Contact.</h2>
      <p>
        Email <a href="mailto:ethan@nexuswatch.dev">ethan@nexuswatch.dev</a>. Bugs, feature
        requests, and corrections especially welcome — every wrong call I post lives in the
        prediction ledger, and I'd rather hear about a bad number from you than from a chart
        somebody else made.
      </p>

      <p class="nw-essay-closing">
        Thanks for reading. Now go <a href="#/intel">open the dashboard</a>.
      </p>
    </article>

  `;

  shellMain.appendChild(main);
}
