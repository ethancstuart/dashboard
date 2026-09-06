# NexusWatch Design System

The single document that explains why the visual surface is what it is, where
the tokens live, and which surfaces consume which vocabulary.

This is a manifesto, not a component library. We don't ship Figma kits or
React libraries — we ship CSS variables, a couple of utility classes, and a
strict idea of where each one applies.

---

## Hybrid philosophy: terminal + editorial

NexusWatch's product has always been a Bloomberg-terminal-ish command center
— JetBrains Mono everywhere, dark theme dominant, dense data UI. That's the
right surface for the dashboard, Cinema mode, the live globe, and any page
where users come to *operate*.

It is the wrong surface for marketing pages. Landing, `/why-free`, and
`/about` aren't operations surfaces — they're editorial. Their job is to set
tone, frame the product, and earn five seconds of attention. Mono everywhere
on those pages reads cold and developer-y. We need craft, not chrome.

So the system is split:

| Surface                          | Treatment                                | Class on `<main>` |
| -------------------------------- | ---------------------------------------- | ----------------- |
| Dashboard, Cinema, Intel map     | Full terminal — mono, dense, dark        | _none_            |
| Landing, `/why-free`, `/about`   | Editorial — Source Serif 4, breathable   | `.marketing-surface` |
| Email (Light Intel Dossier)      | Out of scope here — see `email-tokens.ts` | _N/A_             |
| Brief reader (`/briefs/...`)     | Dossier theme via runtime token swap     | _none_            |

The marketing surface keeps the dark palette; only typography and rhythm
change. That preserves brand recognition across the boundary while letting
the editorial pages breathe.

**Anti-references** — what we will not ship:

- SaaS-generic Tailwind-template pastel gradient hero with a centered button.
- Gimmicky 3D (e.g. bruno-simon.com) — clever, not appropriate for a
  geopolitical intelligence platform.
- Neon "AI" gradients — purple-to-pink corporate-AI cosplay. We are not
  another LLM wrapper; we should not look like one.
- Animated particle backgrounds, logo-spinners, or any motion that exists
  only to fill silence.

**Taste references** — what we are aiming at on marketing surfaces:

- phantom.land — restrained editorial-meets-studio, real hierarchy.
- jasminegunarto.com — confident type, judicious motion.
- Awwwards: obys-2, pixel-melbourne, shader-development-studio,
  studio-namma, alt-2 — kinetic typography without showing off.

The terminal surfaces don't need taste references. They reference Bloomberg,
SitDeck, and World Monitor — they already know what they want to be.

---

## Where tokens live

Three layers, in order from "runtime, theme-aware" to "static, compile-time":

1. **`src/styles/tokens.ts`** — runtime token objects (`terminalTokens`,
   `dossierTokens`). Applied via `applyTheme()` in `src/config/theme.ts`,
   which writes inline custom properties onto `document.documentElement`.
   Owns the *palette*. When the user toggles theme, this is what flips.

2. **`src/styles/tokens.css`** — the canonical static CSS-variable surface.
   Type scale, spacing scale, radius scale, shadows/glows, motion tokens,
   z-index scale, and per-theme color blocks (`:root[data-theme='terminal']`,
   `:root[data-theme='dossier']`, plus legacy `dark`/`light`/`oled` aliases).
   Hand-written CSS reads from here.

3. **`src/styles/design-tokens.css`** — legacy `--nw-*` color/type variables
   from the pre-Track-B-1 era. Still consumed by un-migrated stylesheets
   (`nexuswatch.css`, `roadmap.css`, `auth.css`, `help.css`, `timeline.css`,
   `briefs.css`, `brief.css`, `user-menu.css`, `tier-gating.css`). Will be
   absorbed into the canonical names over time. Don't add to it.

Plus two motion files:

- **`src/styles/motion.css`** — easing/duration tokens (in `tokens.css`),
  reusable utility classes (`.fade-in-up`, `.fade-in`, `.slow-rotate`,
  `.word-stagger`), and the `prefers-reduced-motion` neutralization block.

- **`src/styles/email-tokens.ts`** — out of scope for the product UI; see
  the file's own header for the Light Intel Dossier email rules.

---

## Token catalogue

### Color (semantic, not literal)

| Token                       | Use                                                  |
| --------------------------- | ---------------------------------------------------- |
| `--color-bg`                | Page canvas (deepest)                                |
| `--color-bg-2`              | Secondary page surface (slightly raised)             |
| `--color-surface`           | Card / panel background                              |
| `--color-surface-elevated`  | Hover / active panel state                           |
| `--color-surface-sunken`    | Inset wells, code blocks, grouped data               |
| `--color-surface-muted`     | Zebra rows, alt-stripes                              |
| `--color-text`              | Default body color                                   |
| `--color-text-2`            | Secondary copy, captions                             |
| `--color-text-primary`      | Headings, max emphasis                               |
| `--color-text-secondary`    | Body copy below headings                             |
| `--color-text-tertiary`     | Meta, tertiary labels                                |
| `--color-muted`             | Lowest-emphasis text (synonym for `--color-text-muted`) |
| `--color-border`            | Hairlines between surfaces                           |
| `--color-border-2`          | Stronger separation (above `--color-border`)         |
| `--color-accent`            | Primary brand accent (orange terminal / oxblood dossier) |
| `--color-accent-hover`      | Hover state for accent                               |
| `--color-signal-critical`   | P0 alerts, red severity                              |
| `--color-signal-warning`    | Amber / elevated severity                            |
| `--color-signal-ok`         | Green / nominal severity                             |
| `--color-signal-info`       | Blue informational signal                            |
| `--color-tension-low`       | CII / Tension Index 0–25 — cyan/teal                 |
| `--color-tension-med`       | CII / Tension Index 26–50 — amber                    |
| `--color-tension-high`      | CII / Tension Index 51–75 — orange                   |
| `--color-tension-critical`  | CII / Tension Index 76–100 — red                     |
| `--color-up` / `--color-down` / `--color-flat` | Market data change indicators       |

### Type scale

Pixel-based dashboard scale:

| Token             | Value | Use                                              |
| ----------------- | ----- | ------------------------------------------------ |
| `--text-xs`       | 11px  | Captions, eyebrow labels                         |
| `--text-sm`       | 12px  | Small UI text, mono meta                         |
| `--text-base`     | 14px  | Body copy in dashboard                           |
| `--text-md`       | 15px  | Slightly larger body                             |
| `--text-lg`       | 18px  | Sub-headings                                     |
| `--text-xl`       | 24px  | H2 / panel titles                                |
| `--text-2xl`      | 36px  | H1 / page titles                                 |
| `--text-3xl`      | 48px  | Display headings (dashboard side)                |
| `--text-display`  | 64px  | Hero numbers, marquee data values                |

Marketing-surface fluid scale (clamp-based, marketing pages only):

| Token                       | Value                          | Use                              |
| --------------------------- | ------------------------------ | -------------------------------- |
| `--text-marquee`            | `clamp(48px, 8vw, 96px)`       | Hero headlines on `.marketing-surface` |
| `--text-editorial-headline` | `clamp(28px, 4vw, 48px)`       | Section headings (h2) on marketing |
| `--text-editorial-body`     | `clamp(17px, 1.4vw, 20px)`     | Editorial body copy              |
| `--leading-marquee`         | `0.95`                         | Tight leading for hero           |
| `--tracking-marquee`        | `-0.03em`                      | Tight tracking for hero          |

### Spacing — 4px-based scale

`--space-0` through `--space-32`. Numbers map to multiples of 4px:
`--space-1` is 4px, `--space-2` is 8px, `--space-4` is 16px, `--space-8` is
32px, `--space-16` is 64px, `--space-32` is 128px.

Editorial helpers wrap the larger values:

- `--space-section-tight` = `--space-12` (48px)
- `--space-section`       = `--space-20` (80px)
- `--space-section-loose` = `--space-32` (128px)

### Border radius

`--radius-sm` (2px) → `--radius-md` (4px) → `--radius-lg` (8px) →
`--radius-xl` (12px) → `--radius-2xl` (16px) → `--radius-full` (9999px).

### Shadow + glow

| Token              | Use                                            |
| ------------------ | ---------------------------------------------- |
| `--shadow-sm`      | Subtle elevation, hovered cards                |
| `--shadow-md`      | Floating panels, popovers                      |
| `--shadow-lg`      | Modals                                         |
| `--glow-cyan`      | Cyan signal pulses (low tension, OK signal)    |
| `--glow-amber`     | Amber signal pulses (warning)                  |
| `--glow-accent`    | Orange accent glow (selected, alive)           |
| `--glow-critical`  | Red signal pulses (critical alert)             |

Glows are colored shadows with low alpha — terminal "alive" signaling, not
drama.

### Z-index scale

Replaces the chaotic `9999/310/300/260/250/220/200/190` values currently
scattered across `cinema.css` and elsewhere. Track B1 will swap the literals
in `cinema.css` for these tokens.

| Token              | Layer                                              |
| ------------------ | -------------------------------------------------- |
| `--z-base`         | Page content baseline                              |
| `--z-map`          | MapLibre canvas + map overlays                     |
| `--z-hud`          | Cinema HUD pills, intel bar, profile bar           |
| `--z-panel`        | Floating panels, layer controls, country panel    |
| `--z-modal`        | Modal dialogs, settings, upgrade prompts          |
| `--z-toast`        | Transient toasts / notifications                   |
| `--z-cinema-intro` | Cinema mode intro overlay (top of stack, momentary) |

### Motion

Easing:

- `--ease-out` — `cubic-bezier(0.16, 1, 0.3, 1)` — default for entrance.
- `--ease-in-out` — `cubic-bezier(0.4, 0, 0.2, 1)` — symmetric transitions.
- `--ease-snap` — `cubic-bezier(0.34, 1.56, 0.64, 1)` — slight overshoot for
  emphatic snaps. Use sparingly; it can feel toy-like if overused.

Duration:

- `--dur-fast` — 150ms — micro feedback (button press, hover).
- `--dur-base` — 250ms — standard UI transition.
- `--dur-slow` — 400ms — panel reveal, modal enter.
- `--dur-marquee` — 600ms — editorial reveal on marketing surfaces.

Utilities (in `motion.css`):

- `.fade-in-up` — opacity 0 → 1 + translateY(12px → 0). Use on enter.
- `.fade-in` — opacity only.
- `.slow-rotate` — 60s linear rotation. Marketing-surface ornaments only.
- `.word-stagger` — kinetic typography. Each direct child `<span>` opacity
  0 → 1 + translateY(12px → 0), 50ms stagger between siblings (16-child
  ladder, then plateau).

All motion is gated on `@media (prefers-reduced-motion: reduce)`. Users who
opted out get static layouts — no exceptions.

---

## Fonts

| Family                | Use                                                        | Source       |
| --------------------- | ---------------------------------------------------------- | ------------ |
| **JetBrains Mono**    | Dashboard everything, data values, terminal aesthetic      | Google Fonts |
| **Source Serif 4**    | Marketing-surface headlines + body                         | Google Fonts |
| **Inter**             | Pre-Track-B-1 dashboard sans (legacy, being absorbed)      | Google Fonts |

Variables:

- `--font-mono` — `'JetBrains Mono', ui-monospace, 'SF Mono', monospace`
- `--font-serif` — `'Source Serif 4', ui-serif, Georgia, serif`
- `--font-sans` — `'Inter', -apple-system, system-ui, sans-serif`

All three load via a single Google Fonts request in `index.html`. Zero cost,
no paid licenses.

---

## `.marketing-surface` — opt-in editorial mode

```html
<main class="marketing-surface">
  <section>
    <p class="eyebrow">Real-time intelligence</p>
    <h1 class="word-stagger">
      <span>The</span> <span>world</span> <span>is</span> <span>moving.</span>
    </h1>
    <p>Forty-five live data layers, eighty-six countries scored…</p>
  </section>
</main>
```

What the class does:

- Sets `font-family: var(--font-serif)` for the surface and all headings.
- `<h1>` gets `--text-marquee` clamp + tight leading + tight tracking.
- `<h2>` gets `--text-editorial-headline` clamp.
- `<p>` constrained to `max-width: 68ch` for readability.
- `.eyebrow`, `.meta`, `time`, `code`, `kbd`, `[data-meta]` keep mono and
  uppercase eyebrow tracking — the only mono surfaces in marketing.
- `> section` and `.editorial-section` get `--space-section` block margin.
- Padding-block on the surface gives a generous outer rhythm.

What it does **not** do:

- Change the palette. Background and text colors stay terminal-dark.
- Force any layout. Width and grid are still up to the consumer.
- Affect any other surface. Dashboard / Cinema / data pages don't add this
  class and stay full terminal.

---

## Theme variants

Two canonical themes:

- **`terminal`** — pure black background, JetBrains Mono everywhere, orange
  `#ff6600` accent. The product's native skin. Live map, Cinema mode,
  command center, dashboard.
- **`dossier`** — ivory page on graphite ink, oxblood `#9A1B1B` accent.
  Reading surfaces. Brief archive, methodology page, roadmap.

Legacy values `dark`/`oled` map to `terminal`; `light` maps to `dossier`.
This is canonicalized in `src/styles/tokens.ts → canonicalizeThemeName()`
before write. The static `tokens.css` `:root[data-theme='...']` selectors
include the legacy aliases as a defensive measure.

---

## What this lane does NOT do

This lane writes the design system. It does NOT:

- Refactor existing pages to consume the new tokens (Tracks B1/B2/B3/C).
- Touch Cinema HUD CSS or layout (Track B1).
- Rewrite landing.ts (Track C).
- Swap the literal z-index numbers in `cinema.css` (Track B1) — just
  publishes the canonical scale.
- Touch Stripe/tier code, OG image generation, sitemap, mobile reflow,
  performance optimizations.

Downstream lanes consume from these tokens. If a downstream PR adds a new
hex value where one of these tokens would do, send it back.

---

## Adding to the system

Three rules:

1. **New color → tokens.ts** (theme-flippable). New static value (spacing,
   radius, motion, type) → `tokens.css`.
2. **No new hex literals in component CSS.** If you reach for one, the
   palette is missing a semantic name — add it here first, then use it.
3. **Marketing-only stuff goes inside `.marketing-surface`.** Don't bleed
   serif typography into the dashboard. The hybrid line is the system.

Rule 2 has an exit code as of 2026-09-06: `npm run check:hex-literals` scans
every `.ts` and `.css` under `src/` and `api/`, plus `index.html` and
`public/site.webmanifest` — the two surfaces that stranded a retired palette
precisely because no `src/` scan reaches them. `src/styles/email-tokens.ts`
and `src/styles/tokens.css` are the two places allowed to state a colour.

The literals that predate the guard are pinned file by file in
`scripts/check-hex-literals.ts`; a file with no pin is pinned at zero, so a
new file fails by default. Moving a pin in either direction means editing
that block in the same commit, which is how the pins get to zero instead of
becoming a ceiling nobody lowers.
