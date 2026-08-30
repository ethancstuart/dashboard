# Figma design system — NexusWatch

**File:** `NexusWatch — Design System` · key `thtVyfiahjKyrJjPyZyfli`
https://www.figma.com/design/thtVyfiahjKyrJjPyZyfli

## Contract

The Figma file **mirrors shipped code**. Sources of truth:
`src/styles/tokens.ts` (canonical palette — verified by executing the module)
and `src/styles/tokens.css` (scales, shadows, CSS-only tokens). Last agreed
state: **2026-08-23**, recorded in `docs/figma-mirror.snapshot.json`.

Designing in Figma with the tokens conflicts with nothing. Editing a token
VALUE in Figma is a **proposal, not a fork** — a reconcile pass (any Claude
session with the Figma bridge) diffs Figma against the snapshot and presents
the edit as a proposed code change; nothing is silently overwritten either
way. Code-side guard: `node scripts/check-figma-mirror.mjs` (139 values,
plant-tested) goes RED when code moves ahead of the mirror → re-mirror,
refresh the snapshot.

## What's in the file

- `color` (39, **terminal/dossier modes**): the full semantic set from
  `tokens.ts`, plus the four CSS-only tokens (`bg-2`, `text-2`, `border-2`,
  `accent-hover`), plus `signal/*` and `tension/*` recorded theme-invariant
  because the shipped cascade never forks them.
- `type` (20): px sizes, leading ratios, em trackings — including the marquee
  leading/tracking whose clamp-based sizes cannot be variables.
- `spacing` (17, section aliases as true aliases), `radius` (7).
- `fonts` (4, terminal/dossier modes).
- Effect styles: `shadow-sm/md/lg` + `glow-cyan/amber/accent/critical`
  (theme-invariant in shipped CSS).
- Text style: `eyebrow`.
- Page "Foundations": README + swatches (terminal) + glow chips on black.

## Flags (do not "fix" silently)

- **`fonts/serif` records the TRUE shipped names** — Georgia (terminal) /
  "Tiempos Headline" (dossier). **Neither loads in Figma.** Designers must
  consciously pick a stand-in for serif surfaces; the token stays truthful.
- `eyebrow` uses JetBrains Mono **Bold** for shipped weight 600 (Figma lacks
  SemiBold; CSS font-matching fallback).
- Fluid marketing type (`--text-marquee`, editorial headline/body) is
  clamp-based — not expressible as variables; no marketing serif text styles
  exist for the same reason as the serif flag above.

## Deliberate exclusions

Legacy `design-tokens.css` layer (being absorbed per its own header), z-index
scale, motion tokens, the email-dark palette in `email-tokens.ts` (an email
variant, not a product theme).
