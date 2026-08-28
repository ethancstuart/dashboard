import { colors, fonts } from '../../src/styles/email-tokens.js';

/**
 * The one server-rendered page shell — masthead, palette, typography, colophon.
 *
 * Extracted from api/ledger.ts the day /call/:id was added, because two SSR
 * pages each carrying their own copy of the masthead and stylesheet is how the
 * dossier identity strands one of them the next time it changes. Same rule as
 * the palette itself (rule 8): the structure lives once, and every non-SPA
 * renderer imports it. The colours all come from src/styles/email-tokens.ts —
 * there are no colour literals below that aren't reads from that module.
 */

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;

export interface ShellOptions {
  title: string;
  description: string;
  /** Path only, e.g. "/ledger" or "/call/1234" — the canonical is built from it. */
  canonicalPath: string;
  /**
   * ABSOLUTE url of the unfurl card, e.g.
   * "https://nexuswatch.dev/api/og?type=call&id=47". Optional, and the card
   * TYPE is derived from it rather than declared: this shell used to emit
   * `twitter:card=summary_large_image` unconditionally while emitting no
   * image at all, which is the one combination that unfurls to nothing —
   * every /ledger and /call/:id link posted anywhere was a bare url. A
   * caller that has no image now gets `summary`, which degrades to a real
   * (small) card instead of none, and a caller that adds an image gets the
   * large one without having to remember to also change the card type.
   */
  ogImage?: string;
}

export function shell(body: string, opts: ShellOptions): string {
  const canonical = `https://nexuswatch.dev${opts.canonicalPath}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="NexusWatch">
<meta name="twitter:card" content="${opts.ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:site" content="@NexusWatchDev">
<meta name="twitter:title" content="${esc(opts.title)}">
<meta name="twitter:description" content="${esc(opts.description)}">${
    opts.ogImage
      ? `
<meta property="og:image" content="${esc(opts.ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(opts.title)}">
<meta name="twitter:image" content="${esc(opts.ogImage)}">`
      : ''
  }
<style>
  :root {
    --ink: ${colors.textPrimary}; --ink2: ${colors.textSecondary}; --ink3: ${colors.textTertiary};
    --page: ${colors.bgPage}; --card: ${colors.bgCard}; --rule: ${colors.border};
    --gold: ${colors.divider}; --accent: ${colors.accent};
    --up: ${colors.up}; --down: ${colors.down};
  }
  body { margin:0; background:var(--page); color:var(--ink); font-family:${fonts.sans}; }
  .wrap { max-width:940px; margin:0 auto; padding:56px 24px 96px; }
  .rule { height:2px; background:var(--gold); margin:64px 0 14px; }
  .rule:first-of-type { margin-top:0; }
  .kicker { font-family:${fonts.mono}; font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--accent); margin-bottom:8px; }
  h1,h2 { font-family:${fonts.serif}; font-weight:600; line-height:1.15; margin:0; }
  h1 { font-size:clamp(30px,4vw,46px); }
  h2 { font-size:clamp(24px,3vw,34px); }
  .lede { font-size:17px; line-height:1.62; color:var(--ink2); max-width:62ch; margin:16px 0 0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:32px; margin:32px 0; }
  .stat .v { font-family:${fonts.mono}; font-variant-numeric:tabular-nums; font-size:clamp(48px,8vw,96px); line-height:1; letter-spacing:-.02em; }
  .stat .l { font-family:${fonts.serif}; font-size:20px; margin-top:10px; }
  .stat .d { font-size:14px; color:var(--ink2); margin-top:4px; }
  .stat .p { font-family:${fonts.mono}; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink3); margin-top:12px; }
  .row { display:flex; align-items:baseline; gap:14px; padding:11px 0; border-bottom:1px solid var(--rule); }
  a.row { text-decoration:none; color:inherit; }
  a.row:hover .det { color:var(--ink); }
  .row .lead { font-family:${fonts.mono}; font-variant-numeric:tabular-nums; font-size:15px; min-width:3.5em; }
  .row .det { font-size:14px; color:var(--ink2); flex:1 1 auto; }
  .row .trail { font-family:${fonts.mono}; font-variant-numeric:tabular-nums; font-size:15px; margin-left:auto; }
  .hit .trail { color:var(--up); } .miss .trail { color:var(--down); } .pending .trail { color:var(--ink3); }
  a { color:var(--accent); }
  .foot { margin-top:64px; font-size:14px; color:var(--ink2); }
  .masthead { display:flex; align-items:baseline; gap:22px; flex-wrap:wrap; padding:18px 0; border-bottom:2px solid var(--gold); margin-bottom:40px; }
  .masthead .wordmark { font-family:${fonts.serif}; font-weight:600; font-size:19px; color:var(--ink); text-decoration:none; }
  .masthead a { font-family:${fonts.mono}; font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--ink2); text-decoration:none; }
  .masthead a:hover { color:var(--accent); }
</style>
</head>
<body><div class="wrap">
<nav class="masthead" aria-label="Primary">
  <a class="wordmark" href="https://nexuswatch.dev/">NexusWatch</a>
  <a href="https://nexuswatch.dev/ledger">The Ledger</a>
  <a href="https://nexuswatch.dev/briefs">Briefs</a>
  <a href="https://nexuswatch.dev/intel">Intel Map</a>
  <a href="https://nexuswatch.dev/methodology">Method</a>
  <a href="https://nexuswatch.dev/about">About</a>
</nav>
${body}
<p class="foot">Daily snapshots of this book are committed to the public repository —
<a href="https://github.com/ethancstuart/nexus-watch/tree/main/ledger-snapshots">ledger-snapshots/</a> —
so the stated probabilities and thresholds carry GitHub's timestamps, not ours. A reader can verify
no call moved between issuance and resolution without trusting us.</p>
</div></body>
</html>`;
}
