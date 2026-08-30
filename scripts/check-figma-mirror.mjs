// Guard: NexusWatch repo tokens vs the Figma mirror snapshot
// (docs/figma-mirror.snapshot.json ← Figma file thtVyfiahjKyrJjPyZyfli).
// RED = code moved since the last mirror: re-mirror Figma, refresh the snapshot.
// tokens.ts can't be imported extensionless under plain node, so the canonical
// values are extracted by parsing the source token objects (literal pairs +
// emailColors/emailFonts references resolved from email-tokens.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const snap = JSON.parse(S('docs/figma-mirror.snapshot.json'));
const tokensTs = S('src/styles/tokens.ts');
const emailTs = S('src/styles/email-tokens.ts');
const css = S('src/styles/tokens.css');

const failures = [];
let checked = 0;
const eq = (label, want, got) => {
  checked++;
  const same =
    typeof want === 'number' && typeof got === 'number'
      ? Math.abs(want - got) < 0.005
      : JSON.stringify(want) === JSON.stringify(got);
  if (!same) failures.push(`${label}: source=${JSON.stringify(want)} snapshot=${JSON.stringify(got)}`);
};
// email-tokens: colors block then fonts block, simple `key: 'value',` pairs
const emailColors = {},
  emailFonts = {};
{
  const colorsBlock = emailTs.match(/export const colors = \{([\s\S]*?)\n\}(?: as const)?;/)[1];
  for (const m of colorsBlock.matchAll(/(\w+):\s*'([^']*)'/g)) emailColors[m[1]] = m[2];
  const fontsBlock = emailTs.match(/export const fonts = \{([\s\S]*?)\n\}(?: as const)?;/)[1];
  for (const m of fontsBlock.matchAll(/(\w+):\s*\n?\s*'([^']*)'/g)) emailFonts[m[1]] = m[2];
}
// theme token objects: '--x': 'literal'  OR  '--x': emailColors.y / emailFonts.y
const parseTheme = (name) => {
  const block = tokensTs.match(new RegExp(`export const ${name}[\\s\\S]*?= \\{([\\s\\S]*?)\\n\\};`))[1];
  const out = {};
  for (const m of block.matchAll(/'(--[\w-]+)':\s*(?:'([^']*)'|"([^"]*)"|email(Colors|Fonts)\.(\w+))/g)) {
    out[m[1]] = m[2] ?? m[3] ?? (m[4] === 'Colors' ? emailColors[m[5]] : emailFonts[m[5]]);
  }
  return out;
};
const term = parseTheme('terminalTokens'),
  dos = parseTheme('dossierTokens');
const parseProps = (b) =>
  Object.fromEntries([...b.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const rootCss = parseProps(css.match(/^:root \{([\s\S]*?)^\}/m)[1]);
const termCss = parseProps(css.match(/:root\[data-theme='terminal'\][^{]*\{([\s\S]*?)\n\}/)[1]);
const dosCss = parseProps(css.match(/:root\[data-theme='dossier'\][^{]*\{([\s\S]*?)\n\}/)[1]);
const cssColor = (v) => {
  let m = v && v.match(/^#([0-9A-Fa-f]{6})$/);
  if (m) return ['#' + m[1].toUpperCase(), 1];
  m = v && v.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (m) return ['#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0').toUpperCase()).join(''), +m[4]];
  return null;
};
const CSS_ONLY = new Set(['bg-2', 'text-2', 'border-2', 'accent-hover']);
const INVARIANT = new Set([
  'signal/critical',
  'signal/warning',
  'signal/ok',
  'signal/info',
  'tension/low',
  'tension/med',
  'tension/high',
  'tension/critical',
]);
for (const [name, modes] of Object.entries(snap.color)) {
  if (INVARIANT.has(name)) {
    const w = cssColor(rootCss['color-' + name.replace('/', '-')]);
    eq(`color.${name}/terminal`, w, modes.terminal);
    eq(`color.${name}/dossier`, w, modes.dossier);
  } else if (CSS_ONLY.has(name)) {
    eq(`color.${name}/terminal`, cssColor(termCss['color-' + name]), modes.terminal);
    eq(`color.${name}/dossier`, cssColor(dosCss['color-' + name]), modes.dossier);
  } else {
    eq(`color.${name}/terminal`, cssColor(term['--color-' + name]), modes.terminal);
    eq(`color.${name}/dossier`, cssColor(dos['--color-' + name]), modes.dossier);
  }
}
const typeMap = (k) => (k.startsWith('size/') ? 'text-' + k.slice(5) : k.replace('/', '-'));
for (const [k, got] of Object.entries(snap.type)) eq(`type.${k}`, parseFloat(rootCss[typeMap(k)]), got);
for (const [k, got] of Object.entries(snap.spacing)) {
  const raw = rootCss[k];
  if (got.alias) {
    const m = raw.match(/^var\(--([\w-]+)\)$/);
    eq(`spacing.${k} (alias)`, m ? m[1] : 'NOT-ALIAS:' + raw, got.alias);
  } else eq(`spacing.${k}`, parseFloat(raw), got);
}
for (const [k, got] of Object.entries(snap.radius)) eq(`radius.${k}`, parseFloat(rootCss['radius-' + k]), got);
const firstFam = (stack) => stack.replace(/^["']/, '').split(',')[0].replace(/["']/g, '').trim();
for (const [k, modes] of Object.entries(snap.fonts)) {
  eq(`fonts.${k}/terminal`, firstFam(term['--font-' + k]), modes.terminal);
  eq(`fonts.${k}/dossier`, firstFam(dos['--font-' + k]), modes.dossier);
}
const parseShadowList = (raw) =>
  raw.split(/,(?![^(]*\))/).map((l) => {
    const p = l.trim().match(/^(-?\d+)(?:px)? (-?\d+)(?:px)? (\d+)px rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
    return p ? [+p[1], +p[2], +p[3], +p[4], +p[5], +p[6], +p[7]] : ['UNPARSED', l.trim()];
  });
for (const st of snap.effectStyles) eq(`effect.${st.name}`, parseShadowList(rootCss[st.name]), st.effects);
const eb = snap.textStyles.find((s) => s.name === 'eyebrow');
eq('eyebrow.size', parseFloat(rootCss['text-xs']), eb.fontSize);
eq('eyebrow.lsPct', parseFloat(rootCss['tracking-eyebrow']) * 100, eb.lsPct);

console.log(`figma-mirror guard: checked ${checked} values against snapshot`);
if (failures.length) {
  console.error(`STALE MIRROR (${failures.length}):\n` + failures.join('\n'));
  console.error(
    '\nCode has moved since the last Figma mirror. Re-mirror Figma file thtVyfiahjKyrJjPyZyfli and refresh docs/figma-mirror.snapshot.json.',
  );
  process.exit(1);
}
console.log('OK — repo tokens match the Figma mirror snapshot.');
