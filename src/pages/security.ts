import { createElement } from '../utils/dom.ts';
import { setPageSeo } from '../utils/seo.ts';
import { pageShell } from '../ui/kit/index.ts';

/**
 * Security & Trust page (/#/security).
 *
 * Public posture statement. Sophisticated users (procurement, security
 * teams, journalists who do due-diligence) want a single page that
 * answers: how do you treat my data, what protects this site, and what
 * happens if something goes wrong.
 */

export function renderSecurity(root: HTMLElement): void {
  setPageSeo({
    title: 'Security & Trust',
    description:
      'How NexusWatch handles your data, what protects this site, and how we respond to incidents. Public posture.',
    canonicalPath: '/security',
  });
  const main = pageShell(root, { active: '/security' });
  const page = createElement('div', { className: 'nw-doc-page' });
  page.innerHTML = `
    <article class="nw-doc">
      <h1>Security &amp; Trust</h1>
      <p class="nw-doc-meta">Last reviewed: May 2, 2026</p>

      <section>
        <h2>Data we collect</h2>
        <ul>
          <li><strong>If you don't sign in:</strong> nothing personal. Only standard
            web logs (IP for rate-limiting, user-agent for browser-compat
            decisions). No cookies set.</li>
          <li><strong>If you sign in:</strong> your OAuth provider (Google or GitHub)
            email, profile id, and display name. We never receive your password.</li>
          <li><strong>If you watchlist countries or save alerts:</strong> the country
            codes you chose, the alert thresholds you set. Stored in our
            Postgres DB, scoped to your account.</li>
          <li><strong>If you subscribe to the brief:</strong> your email goes to
            beehiiv (our newsletter provider). You can unsubscribe at any
            time from any brief.</li>
        </ul>
      </section>

      <section>
        <h2>What protects this site</h2>
        <ul>
          <li><strong>HTTPS everywhere</strong> — HSTS preload-eligible header
            (<code>max-age=31536000; includeSubDomains</code>). All API responses
            served from Vercel's edge network with TLS 1.3.</li>
          <li><strong>Strict Content Security Policy</strong> — script, style, font,
            image, frame, and connect sources are all explicitly allowlisted.
            No <code>unsafe-eval</code>. No inline scripts (single hashed inline allowed
            for the SPA boot).</li>
          <li><strong>Rate limiting</strong> — every public API endpoint is rate-limited
            per-IP via Upstash KV. 30–60 req/minute thresholds.</li>
          <li><strong>SSRF prevention</strong> — endpoints that proxy to external
            URLs use a strict domain allowlist and block private IP ranges.</li>
          <li><strong>Sandboxed iframes</strong> — embedded webcams use
            <code>sandbox="allow-scripts allow-same-origin allow-presentation"</code>
            with <code>referrerpolicy="no-referrer"</code>. No top-navigation, no forms.</li>
          <li><strong>Permissions Policy</strong> — camera and microphone are denied
            globally. Geolocation is requested only with explicit user
            consent.</li>
        </ul>
      </section>

      <section>
        <h2>Secrets handling</h2>
        <ul>
          <li>API keys for upstream providers (Anthropic, Windy, EIA, Stripe,
            etc.) live only in Vercel environment variables and a local
            <code>.env.local</code> that is gitignored.</li>
          <li>The codebase has an ESLint rule that forbids reading secret-shaped
            env vars from client code, preventing accidental inlining into the
            JavaScript bundle.</li>
          <li>A pre-commit secret scanner blocks anything matching common key
            patterns (Anthropic, Stripe, JWT, GitHub PAT, Slack, AISStream,
            Windy, EIA) from being committed.</li>
          <li>Keys are rotated on a 90-day cadence or immediately on any
            suspected compromise. See <code>docs/runbooks/key-rotation.md</code>.</li>
        </ul>
      </section>

      <section>
        <h2>Open source</h2>
        <p>
          The platform code is MIT-licensed and public at
          <a href="https://github.com/ethancstuart/nexus-watch" target="_blank" rel="noopener">github.com/ethancstuart/nexus-watch</a>.
          Reviewing what runs on the server is something you can do yourself.
        </p>
      </section>

      <section>
        <h2>Incident response</h2>
        <ul>
          <li><strong>Detection:</strong> Sentry tracks runtime errors. A health-check
            cron pings every public endpoint every 30 minutes and posts to a
            Discord channel if anything degrades.</li>
          <li><strong>Live status:</strong> <a href="#/status">/#/status</a> reports
            real-time data-feed health for the public to see. We don't hide
            outages.</li>
          <li><strong>Disclosure:</strong> If you find a security issue, please email
            <a href="mailto:security@nexuswatch.dev">security@nexuswatch.dev</a>
            (or <code>hello@nexuswatch.dev</code> if that's bouncing). We'll
            acknowledge within 48 hours.</li>
        </ul>
      </section>

      <section>
        <h2>What we don't do</h2>
        <ul>
          <li>We do not sell your data. The platform is free; the model is
            radical transparency on signal sources, not selling user
            attention.</li>
          <li>We do not run third-party analytics tracking SDKs (no Google
            Analytics, no Hotjar, no Segment). Vercel Web Analytics is the
            only aggregator and it does not use cookies or share data.</li>
          <li>We do not retain identifiable IPs longer than 24 hours (rate-limit
            counters use IP and auto-expire).</li>
        </ul>
      </section>

      <p class="nw-doc-footer">
        Questions? <a href="mailto:hello@nexuswatch.dev">hello@nexuswatch.dev</a>.
        For our processing of personal data see <a href="#/privacy">Privacy</a>;
        for usage terms see <a href="#/terms">Terms</a>.
      </p>
    </article>
  `;
  main.appendChild(page);
}
