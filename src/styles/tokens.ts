/**
 * NexusWatch Product Design Tokens — Track B.1
 *
 * Canonical source of truth for the PRODUCT UI palette, typography,
 * spacing, and motion values. Exports two theme variants:
 *
 *   - `terminal` — the existing dark map/command-center aesthetic
 *                  (what the product has always been)
 *   - `dossier`  — the Light Intel Dossier reading surface, extended
 *                  from src/styles/email-tokens.ts so the product
 *                  reading surfaces and the email are visually
 *                  coherent
 *
 * Each theme is a flat Record<string, string> mapping CSS custom
 * property names to values. The `applyTheme()` function in
 * src/config/theme.ts reads these and sets them on documentElement
 * at runtime.
 *
 * Track B roadmap: per-component surfaces migrate off hardcoded
 * colors and onto these vars over time. B.1 ships the token system
 * + the two themes + a working theme switcher. B.2-B.8 migrate
 * individual surfaces.
 *
 * IMPORTANT: the `dossier` palette MUST stay in aesthetic lockstep
 * with src/styles/email-tokens.ts and src/styles/briefs-dossier.css.
 * When you change an accent color or font stack, update all three
 * in the same commit.
 */

import { colors as emailColors, fonts as emailFonts } from './email-tokens';

// ---------------------------------------------------------------------------
// Theme identifier
// ---------------------------------------------------------------------------

/**
 * The canonical theme names. Legacy storage values `dark`, `light`,
 * `oled` are migrated on read (see src/config/theme.ts `getTheme`).
 * New code should use these names only.
 */
export type NewThemeName = 'dossier';

/**
 * Legacy theme names preserved in localStorage for backward compat.
 * `dark` + `oled` → `terminal`, `light` → `dossier`.
 */
export type LegacyThemeName = 'dark' | 'light' | 'oled';

export type AnyThemeName = NewThemeName | LegacyThemeName;

// ---------------------------------------------------------------------------
// Terminal theme (dark, map/command-center aesthetic)
// ---------------------------------------------------------------------------
//
// Preserves the long-standing NexusWatch terminal look: pure black
// background, JetBrains Mono typography, orange `#ff6600` accent,
// bright semantic greens/reds for data change indicators. This is
// the theme the product was built in and the one the live map
// (`/#/intel`) expects. B.1 does NOT change any of this — it just
// moves the values into a token object so B.2+ can swap them.

// terminalTokens DELETED 2026-09-06 with the Intel Map — the product has one
// identity. The dossier is not a 'theme' any more; it is the ground truth the
// root stylesheet states directly.

// ---------------------------------------------------------------------------
// Dossier theme (light, reading-surface aesthetic)
// ---------------------------------------------------------------------------
//
// Derived from the email-tokens `colors` and `fonts` exports so the
// product reading surfaces match the email template visually. When
// the email palette moves, this theme moves with it — single source
// of truth via the import below.
//
// Surfaces that benefit from this theme: /#/briefs (archive), brief
// reader, methodology page, roadmap page, subscribe forms. The live
// map intentionally does NOT adopt this theme — maps are terminal.

export const dossierTokens: Record<string, string> = {
  // Surfaces — ivory page, white card, warm muted alt
  '--color-bg': emailColors.bgPage,
  '--color-bg-page': emailColors.bgPage,
  '--color-surface': emailColors.bgCard,
  '--color-surface-elevated': emailColors.bgCard,
  '--color-surface-sunken': emailColors.bgMuted,
  '--color-surface-muted': emailColors.bgMuted,

  // Borders — parchment hairlines
  '--color-border': emailColors.border,
  '--color-border-subtle': emailColors.border,
  '--color-border-strong': emailColors.borderStrong,

  // Text — graphite primary, warmer slate secondary/tertiary
  '--color-text': emailColors.textPrimary,
  '--color-text-primary': emailColors.textPrimary,
  '--color-text-secondary': emailColors.textSecondary,
  '--color-text-muted': emailColors.textTertiary,
  '--color-text-tertiary': emailColors.textTertiary,
  '--color-text-inverse': emailColors.textInverse,

  // Accents — OXBLOOD, not orange. Orange stays on the map.
  '--color-accent': emailColors.accent,
  '--color-accent-soft': emailColors.accentSoft,
  '--color-accent-dim': 'rgba(154, 27, 27, 0.15)',
  '--color-accent-border': 'rgba(154, 27, 27, 0.35)',
  '--color-accent-bg-soft': emailColors.accentBgSoft,

  // Semantic (deliberately muted — dossier surfaces rarely show
  // live price ticks, but CII movers and Market Pulse do)
  '--color-positive': emailColors.up,
  '--color-negative': emailColors.down,
  '--color-up': emailColors.up,
  '--color-down': emailColors.down,
  '--color-flat': emailColors.flat,

  // Dividers — parchment gold anchor rule
  '--color-divider': emailColors.divider,
  '--color-divider-soft': emailColors.dividerSoft,

  // Typography — full dossier stack (serif headlines + Inter body +
  // mono data). --font-mono stays JetBrains Mono so data runs read
  // consistent across themes.
  '--font-sans': emailFonts.sans,
  '--font-serif': emailFonts.serif,
  '--font-mono': emailFonts.mono,
  '--font-body': emailFonts.sans,
};

// ---------------------------------------------------------------------------
// Theme registry — the public shape consumed by src/config/themes.ts
// ---------------------------------------------------------------------------

export const themeTokens: Record<NewThemeName, Record<string, string>> = {
  dossier: dossierTokens,
};
