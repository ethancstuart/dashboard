/**
 * NexusWatch Email Design Tokens — "Light Intel Dossier"
 *
 * Locked 2026-04-11. See project_nexuswatch_decisions_apr11.md, Decision 2
 * ("Email aesthetic") and Decision 5 ("Email rendering ownership — we own
 * the HTML, beehiiv handles delivery + referrals only").
 *
 * Design principle: serious typography carrying an accessible voice. Think
 * Stratfor-meets-Rundown. The product UI uses a dark terminal aesthetic;
 * the email is a LIGHT dossier that feels like a briefing on a desk at 6 AM.
 * Different medium, different rules.
 *
 * Why a TypeScript file instead of CSS variables: email clients (especially
 * Outlook and Gmail) strip <style> tags, mangle CSS variables, and in some
 * cases rewrite class names. Inline styles generated from this token module
 * are the only reliable path. The template composes styles at render time
 * from these constants via a small `style({...})` helper, so every change
 * flows from one source.
 *
 * Track B (product UI overhaul) will derive its own `src/styles/tokens.ts`
 * from or align with this file. Any color here that's also used in the
 * product should be kept in sync — divergence between the email dossier
 * and the product terminal is deliberate, but both should come from a
 * single documented palette, not drift independently.
 */

// -----------------------------------------------------------------------------
// Color palette
// -----------------------------------------------------------------------------

/**
 * Core dossier palette — ivory page on graphite ink, with oxblood as the
 * only chromatic accent. Deliberately restrained: the visual signal of
 * seriousness comes from typographic hierarchy, not from color.
 */
export const colors = {
  // Page canvas. Ivory, not pure white — pure white reads clinical under
  // Gmail's default off-white body background, while ivory holds its own.
  bgPage: '#FAF8F3',
  bgCard: '#FFFFFF',
  // Subtle alt row for zebra tables, Market Pulse strips, etc.
  bgMuted: '#F2EFE6',

  // Text — graphite primary, warmer slate secondary, cool slate tertiary.
  // The graphite primary is NOT pure black: #12161C reads sharper than
  // #000000 against ivory without being fatiguing.
  textPrimary: '#12161C',
  textSecondary: '#3B4252',
  textTertiary: '#6B7280',
  textInverse: '#FAF8F3',

  // Oxblood — the single chromatic accent. Used for "Why it matters"
  // callouts, severity markers, CTAs. Orange (#FF6600) is explicitly
  // OUT of the email: it stays on the product UI only.
  accent: '#9A1B1B',
  accentSoft: '#C7453F', // hover / light emphasis
  accentBgSoft: '#F6E4E2', // callout panel background

  // Parchment gold for section dividers and masthead rule.
  divider: '#C9A86B',
  dividerSoft: '#E5D8B6',

  // Semantic colors for Market Pulse ONLY. Never decorative.
  up: '#1F7A4C',
  down: '#B8341C',
  flat: '#6B7280',

  // Hairline borders. Use sparingly — most separation comes from spacing,
  // not from lines.
  border: '#E5E0D4',
  borderStrong: '#C9C3B4',
} as const;

/**
 * Dark-mode fallback palette. Shipped inside an Apple Mail
 * `@media (prefers-color-scheme: dark)` block so recipients on dark-mode
 * Apple Mail get a readable charcoal version instead of the ivory one
 * being inverted into a blown-out mess.
 *
 * Gmail and most other clients do NOT honor `prefers-color-scheme` on
 * HTML emails, so they'll always render the light version. That's fine —
 * light is canonical.
 */
export const colorsDark = {
  bgPage: '#0E1116',
  bgCard: '#161B22',
  bgMuted: '#1C2129',
  textPrimary: '#E8E6DE',
  textSecondary: '#C2BCAB',
  textTertiary: '#8B8478',
  textInverse: '#0E1116',
  accent: '#D66A64',
  accentSoft: '#EA8A85',
  accentBgSoft: '#2A1717',
  divider: '#C9A86B',
  dividerSoft: '#6B5B3A',
  up: '#4DAB7A',
  down: '#D66A64',
  flat: '#8B8478',
  border: '#2A2F38',
  borderStrong: '#3B4048',
} as const;

// -----------------------------------------------------------------------------
// Typography
// -----------------------------------------------------------------------------

/**
 * Font stacks — serif headline, sans body, mono data. Every stack lists a
 * real self-hostable font first, then a progression of system fallbacks
 * that cover every major email client.
 *
 * We don't ship web fonts in the email (too many clients strip @font-face,
 * and Outlook mangles them), so the fallbacks are the fonts that actually
 * render for most recipients. Tiempos, Inter, and JetBrains Mono are
 * documented as the INTENT — visible on web mirrors of the brief where
 * we can self-host via `/brief/:date`.
 */
export const fonts = {
  // Headlines. Serif gravitas — "dossier", not "SaaS".
  serif:
    '"Tiempos Headline", "GT Alpina", Charter, "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", Times, serif',
  // Body copy. Inter is the universal email-safe sans-serif.
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  // Data, tickers, timestamps, issue number. JetBrains Mono keeps the
  // terminal DNA in ONE place only — never in body copy, never in headlines.
  mono: '"JetBrains Mono", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
} as const;

/**
 * Type scale. Pixel values (not rem/em) because email clients handle
 * relative units inconsistently. Line heights are unitless so they scale
 * with the container font size.
 */
export const type = {
  masthead: { size: '28px', lineHeight: '1.15', weight: 700, font: fonts.serif },
  kicker: { size: '10px', lineHeight: '1.4', weight: 700, font: fonts.mono, letterSpacing: '0.12em' },
  issueMeta: { size: '11px', lineHeight: '1.4', weight: 500, font: fonts.mono, letterSpacing: '0.08em' },
  sectionLabel: { size: '11px', lineHeight: '1.5', weight: 700, font: fonts.mono, letterSpacing: '0.16em' },
  storyHeadline: { size: '22px', lineHeight: '1.25', weight: 600, font: fonts.serif },
  bodyLarge: { size: '17px', lineHeight: '1.55', weight: 400, font: fonts.sans },
  body: { size: '16px', lineHeight: '1.55', weight: 400, font: fonts.sans },
  bodySmall: { size: '14px', lineHeight: '1.55', weight: 400, font: fonts.sans },
  caption: { size: '12px', lineHeight: '1.5', weight: 400, font: fonts.sans },
  data: { size: '13px', lineHeight: '1.4', weight: 500, font: fonts.mono },
  dataStrong: { size: '13px', lineHeight: '1.4', weight: 700, font: fonts.mono },
} as const;

// -----------------------------------------------------------------------------
// Spacing
// -----------------------------------------------------------------------------

/** 4px-based spacing scale. Emails should breathe; use generous values. */
export const space = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
  xxxl: '48px',
  xxxxl: '64px',
} as const;

/**
 * Canonical content width. 600px is the safe max for email clients — wider
 * breaks on iPhone portrait and some Outlook configurations. Inside the
 * 600px container we use generous 32px gutters.
 */
export const layout = {
  contentWidth: '600px',
  gutter: '32px',
  radiusCard: '4px',
  radiusCallout: '2px',
} as const;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Compose an inline style string from an object. Only defined values are
 * included, so callers can pass `undefined` for optional properties.
 *
 * Example:
 *   style({ color: colors.textPrimary, fontFamily: fonts.serif })
 *     → "color:#12161C;font-family:\"Tiempos Headline\",...;"
 *
 * We don't use a library because every byte counts in HTML emails and
 * the logic is trivial.
 */
export function style(declarations: Record<string, string | number | undefined>): string {
  return Object.entries(declarations)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([prop, value]) => {
      // camelCase → kebab-case for CSS property names.
      const kebab = prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      return `${kebab}:${value}`;
    })
    .join(';');
}

/**
 * Build a typography style block from a token in `type`. Convenience wrapper
 * so modules don't have to repeat the font-size/line-height/family triplet
 * at every call site.
 */
export function typeStyle(
  token: (typeof type)[keyof typeof type],
  overrides: Record<string, string | number | undefined> = {},
): string {
  const letterSpacing = 'letterSpacing' in token ? token.letterSpacing : undefined;
  return style({
    fontFamily: token.font,
    fontSize: token.size,
    lineHeight: token.lineHeight,
    fontWeight: token.weight,
    letterSpacing,
    ...overrides,
  });
}

// -----------------------------------------------------------------------------
// HTML attribute emission — the ONE place a style="..." attribute is built
// -----------------------------------------------------------------------------

/**
 * Escape HTML-significant characters for safe rendering inside element bodies
 * and quoted attribute values.
 *
 * This lived in api/cron/daily-brief.ts and was moved here so the email
 * renderers (the brief, the alert email, the welcome email) share ONE
 * implementation rather than each growing a private copy.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] || c;
  });
}

/**
 * Wrap a CSS declaration string in a `style="..."` HTML attribute — ESCAPED.
 *
 * This is the only function in the codebase allowed to build a `style="`
 * attribute. It exists because the three email renderers each carried a
 * private, UNESCAPED copy of this one line:
 *
 *     return `style="${inline}"`;          // ← the bug
 *
 * Every font stack in `fonts` opens with a double-quoted family name
 * (`"Tiempos Headline"`, `"Inter"`, `"JetBrains Mono"`), and `typeStyle()`
 * emits `font-family` FIRST. So an unescaped attribute TERMINATES at that
 * first embedded quote: the parser sees `style="font-family:"` and discards
 * the colour, size, weight and letter-spacing that followed it. Measured on a
 * real render, 38 of the brief's 75 style attributes were truncated this way.
 *
 * WHAT IS ESCAPED, AND WHY
 *   `"` — REQUIRED. A double-quoted attribute value ends at the first `"`.
 *         This is the entire bug.
 *   `&` — REQUIRED. Inside an attribute value `&` begins a character
 *         reference, so leaving it raw makes the encoding ambiguous and
 *         non-idempotent: a literal `&quot;` in a value would decode back to
 *         `"` and re-open the same hole. Escaping keeps the mapping injective.
 *   `<`, `>`, `'` — NOT required by the HTML spec inside a double-quoted
 *         value, but they arrive with the shared `escapeHtml` and are
 *         harmless (see below). Reusing one escaper beats maintaining a
 *         second, narrower one.
 *
 * WHY THIS CANNOT CHANGE THE MEANING OF THE CSS: character references are
 * resolved by the HTML TOKENIZER, before the attribute value is ever handed
 * to the CSS parser. `font-family:&quot;Inter&quot;,sans-serif` reaches CSS
 * as `font-family:"Inter",sans-serif` — byte-identical. Escaping can only
 * restore declarations that were being dropped; it cannot alter one that was
 * already surviving.
 */
export function styleAttr(inline: string): string {
  return `style="${escapeHtml(inline)}"`;
}

/** `styleAttr` over a declaration object — `style()` composed with escaping. */
export function styleAttrOf(declarations: Parameters<typeof style>[0]): string {
  return styleAttr(style(declarations));
}

/** `styleAttr` over a typography token — `typeStyle()` composed with escaping. */
export function typeStyleAttr(
  token: Parameters<typeof typeStyle>[0],
  overrides?: Parameters<typeof typeStyle>[1],
): string {
  return styleAttr(typeStyle(token, overrides));
}
