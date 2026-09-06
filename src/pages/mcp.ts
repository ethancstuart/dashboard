/**
 * /mcp — Public MCP server landing page.
 *
 * One-line install for Claude Code / Cursor / Windsurf / Continue.
 * Lists the 9 NexusWatch tools and shows example prompts.
 * No auth required — server uses an internal pooled key for upstream.
 */

import '../styles/landing.css';
import { createElement } from '../utils/dom.ts';
import { setPageSeo, PAGE_SEO } from '../utils/seo.ts';
import { pageShell } from '../ui/kit/index.ts';

interface ToolRow {
  name: string;
  oneLine: string;
  glyph: string;
}

const TOOLS: ToolRow[] = [
  {
    name: 'get_call_ledger',
    glyph: '✓',
    oneLine: 'The public call ledger: open and resolved calls, Brier, and skill vs base rate — negative included.',
  },
  {
    name: 'get_country_risk',
    glyph: '⊕',
    oneLine: 'The CII: a structural level plus a separate live deviation, per country. Two numbers, never one sum.',
  },
  {
    name: 'get_brief',
    glyph: '☰',
    oneLine: 'Any daily brief from the archive, ledger line included. Latest by default; pass a date for history.',
  },
];

const EXAMPLE_PROMPTS: string[] = [
  'Pull the CII for Taiwan, Iran, and Ukraine and tell me which trend is worst.',
  'Run the Hormuz closure scenario and summarize the energy-price impact.',
  'My portfolio is 18% TSM, 9% XOM, 7% ASML — what is my geopolitical exposure?',
  'List every country currently above CII 70 with the dominant driver.',
  'Pull the call ledger and tell me which open calls diverge most from their base rates.',
];

export function renderMcpPage(root: HTMLElement): void {
  setPageSeo(PAGE_SEO.mcp);
  const shellMain = pageShell(root, { active: '/mcp' });

  const main = createElement('div', { className: 'marketing-surface nw-landing-surface nw-mcp-page' });

  injectStyles();

  main.innerHTML = `

    <article class="nw-essay">
      <p class="nw-section-eyebrow" style="margin-bottom: 32px;">MCP Server</p>
      <h1>NexusWatch for AI agents.</h1>

      <p>
        NexusWatch is also an MCP server. Connect it to Claude Code, Cursor, Windsurf, or any
        Model Context Protocol client and your agent gets live access to nine geopolitical
        intelligence tools — CII for 85 scored countries, scenario simulation, portfolio exposure,
        and the public call ledger. No account, no API key, no signup.
      </p>

      <h2>Install in one line.</h2>

      <div class="nw-mcp-installs">
        <div class="nw-mcp-install">
          <div class="nw-mcp-install-row">
            <div class="nw-mcp-install-label">Claude Code</div>
            <button class="nw-mcp-copy" data-copy="claude mcp add --transport http nexus-watch https://nexuswatch.dev/api/mcp">Copy</button>
          </div>
          <pre class="nw-mcp-code"><code>claude mcp add --transport http nexus-watch https://nexuswatch.dev/api/mcp</code></pre>
        </div>

        <div class="nw-mcp-install">
          <div class="nw-mcp-install-row">
            <div class="nw-mcp-install-label">Cursor · Windsurf · Continue (mcp.json)</div>
            <button class="nw-mcp-copy" data-copy='{"mcpServers":{"nexus-watch":{"transport":"http","url":"https://nexuswatch.dev/api/mcp"}}}'>Copy</button>
          </div>
          <pre class="nw-mcp-code"><code>{
  "mcpServers": {
    "nexus-watch": {
      "transport": "http",
      "url": "https://nexuswatch.dev/api/mcp"
    }
  }
}</code></pre>
        </div>
      </div>

      <p class="nw-mcp-rate">
        Shared public pool: 100 calls/hour per IP. Need more? Open an issue on GitHub.
      </p>

      <h2>Nine tools.</h2>

      <div class="nw-mcp-tools">
        ${TOOLS.map(
          (t) => `
            <div class="nw-mcp-tool">
              <span class="nw-mcp-tool-glyph" aria-hidden="true">${t.glyph}</span>
              <div class="nw-mcp-tool-text">
                <code class="nw-mcp-tool-name">${t.name}</code>
                <div class="nw-mcp-tool-desc">${t.oneLine}</div>
              </div>
            </div>
          `,
        ).join('')}
      </div>

      <h2>Try these prompts.</h2>

      <ul class="nw-mcp-prompts">
        ${EXAMPLE_PROMPTS.map((p) => `<li>${p}</li>`).join('')}
      </ul>

      <h2>Under the hood.</h2>
      <p>
        Streamable-HTTP transport, MCP protocol version 2024-11-05. JSON-RPC 2.0.
        Every tool call proxies to the public NexusWatch v2 API — the same data that powers
        the globe and the briefs. Data freshness, confidence labels, and evidence chains are
        identical to the web product.
      </p>

      <p>
        Server is open-source at
        <a href="https://github.com/ethancstuart/nexus-watch/blob/main/api/mcp.ts" target="_blank" rel="noopener">api/mcp.ts</a>.
        File an issue if you want a tool that doesn't exist yet.
      </p>

      <p class="nw-essay-closing">
        Questions? <a href="mailto:ethan@nexuswatch.dev">ethan@nexuswatch.dev</a>.
      </p>
    </article>

  `;

  shellMain.appendChild(main);

  // Wire copy buttons
  main.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const txt = btn.dataset.copy ?? '';
      try {
        await navigator.clipboard.writeText(txt);
        const orig = btn.textContent;
        btn.textContent = '✓ Copied';
        btn.classList.add('is-copied');
        setTimeout(() => {
          btn.textContent = orig;
          btn.classList.remove('is-copied');
        }, 1800);
      } catch {
        btn.textContent = 'Press ⌘C';
      }
    });
  });
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .nw-mcp-page .nw-essay h2 { margin-top: 2.5rem; }

    .nw-mcp-installs {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      margin: 1.5rem 0 0.5rem;
    }
    .nw-mcp-install-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.4rem;
      gap: 0.75rem;
    }
    .nw-mcp-install-label {
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 0.7rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--color-text-muted, #888);
    }
    .nw-mcp-copy {
      background: transparent;
      border: 1px solid var(--color-border, #2a2a2a);
      color: var(--color-text-muted, #888);
      padding: 0.25rem 0.65rem;
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 0.65rem;
      letter-spacing: 0.06em;
      border-radius: 2px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .nw-mcp-copy:hover {
      border-color: var(--color-accent, var(--color-tension-high));
      color: var(--color-accent, var(--color-tension-high));
    }
    .nw-mcp-copy.is-copied {
      background: rgba(34, 197, 94, 0.15);
      border-color: var(--color-signal-ok);
      color: var(--color-signal-ok);
    }
    .nw-mcp-code {
      background: var(--color-surface-2, #0f0f0f);
      border: 1px solid var(--color-border, #2a2a2a);
      border-left: 2px solid var(--color-accent, var(--color-tension-high));
      border-radius: 4px;
      padding: 0.9rem 1.1rem;
      overflow-x: auto;
      margin: 0;
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 0.78rem;
      line-height: 1.55;
      color: var(--color-text, #e0e0e0);
      white-space: pre;
    }
    .nw-mcp-code code { font-family: inherit; }

    .nw-mcp-rate {
      font-size: 0.85rem !important;
      color: var(--color-text-muted, #888);
      font-style: italic;
    }

    .nw-mcp-tools {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.6rem;
      margin: 1.25rem 0 0.5rem;
    }
    .nw-mcp-tool {
      background: var(--color-surface-2, #0f0f0f);
      border: 1px solid var(--color-border, #2a2a2a);
      border-radius: 4px;
      padding: 0.85rem 1rem;
      display: grid;
      grid-template-columns: 38px 1fr;
      gap: 0.85rem;
      align-items: start;
      transition: border-color 0.15s, transform 0.15s;
    }
    .nw-mcp-tool:hover {
      border-color: rgba(255, 102, 0, 0.45);
      transform: translateY(-1px);
    }
    .nw-mcp-tool-glyph {
      width: 32px; height: 32px;
      display: grid; place-items: center;
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 1.1rem;
      color: var(--color-accent, var(--color-tension-high));
      background: rgba(255, 102, 0, 0.08);
      border: 1px solid rgba(255, 102, 0, 0.3);
      border-radius: 4px;
    }
    .nw-mcp-tool-text { min-width: 0; }
    .nw-mcp-tool-name {
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 0.8rem;
      color: var(--color-accent, var(--color-tension-high));
      background: transparent;
      padding: 0;
      display: block;
      margin-bottom: 0.2rem;
    }
    .nw-mcp-tool-desc {
      font-size: 0.9rem;
      color: var(--color-text, #ccc);
      line-height: 1.5;
    }
    @media (max-width: 640px) {
      .nw-mcp-install-row { flex-direction: column; align-items: flex-start; }
    }

    .nw-mcp-prompts {
      list-style: none;
      padding: 0;
      margin: 1rem 0 0.5rem;
    }
    .nw-mcp-prompts li {
      padding: 0.55rem 0 0.55rem 1.3rem;
      border-bottom: 1px solid var(--color-border, #2a2a2a);
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 0.85rem;
      color: var(--color-text, #ccc);
      position: relative;
    }
    .nw-mcp-prompts li:before {
      content: '>';
      position: absolute;
      left: 0;
      color: var(--color-accent, var(--color-tension-high));
      font-weight: 600;
    }
    .nw-mcp-prompts li:last-child { border-bottom: none; }
  `;
  document.head.appendChild(style);
}
