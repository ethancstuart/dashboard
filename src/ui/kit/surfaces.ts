import { themeTokens, type NewThemeName } from '../../styles/tokens.ts';

/**
 * Class-scoped surfaces — the one structural change the design direction needs.
 *
 * THE PROBLEM. `applyTheme()` writes the active theme's tokens onto
 * `document.documentElement` as inline custom properties. That makes the theme
 * global: the whole page is terminal, or the whole page is dossier. So a light
 * typeset dossier panel cannot sit inside the dark tactical map — which is
 * precisely the signature this product needs, because a dark globe with mono
 * type and an orange accent is the shared costume of every OSINT project in the
 * category. Polyglobe looks like that. World Monitor looks like that. It is not
 * a look you can win.
 *
 * THE FIX. Emit `.surface-dossier` and `.surface-terminal` rules that re-declare
 * the same token names at class scope. A descendant of either class resolves
 * tokens from it rather than from the root, so surfaces can nest: dossier
 * reading surfaces, terminal instrument surfaces, and a dossier card floating on
 * a terminal map.
 *
 * GENERATED FROM `themeTokens`, NOT HAND-WRITTEN. A hand-written stylesheet
 * would be a second copy of the palette, drifting from tokens.ts the moment
 * either changed — the private-copy failure that stranded the retired identity
 * on every non-CSS renderer in the first place. There is one palette; this reads
 * it.
 */

const STYLE_ID = 'nw-kit-surfaces';

/** `--color-bg: var(--color-bg);` for every token in a theme. */
function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([prop, value]) => `  ${prop}: ${value};`)
    .join('\n');
}

function ruleFor(name: NewThemeName): string {
  return `.surface-${name} {\n${declarations(themeTokens[name])}\n  color: var(--color-text);\n  background: var(--color-bg);\n}`;
}

/**
 * Install the surface rules once. Idempotent — safe to call from any page.
 *
 * Injected as a stylesheet rather than inline styles so a surface class can be
 * applied to any element without the caller knowing the palette.
 */
export function installSurfaces(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = (Object.keys(themeTokens) as NewThemeName[]).map(ruleFor).join('\n\n');
  document.head.appendChild(style);
}

/** The generated CSS, exposed so a test can assert both surfaces carry the same token names. */
export function surfaceCss(): string {
  return (Object.keys(themeTokens) as NewThemeName[]).map(ruleFor).join('\n\n');
}
