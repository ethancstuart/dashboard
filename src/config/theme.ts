import { themes, type ThemeName } from './themes.ts';

const STORAGE_KEY = 'dashview:theme';
const listeners: Array<(theme: ThemeName) => void> = [];

export function getTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in themes) return stored as ThemeName;
  } catch { /* ignore */ }
  return 'dark';
}

export function applyTheme(name?: ThemeName): void {
  const theme = name ?? getTheme();
  const root = document.documentElement;
  const props = themes[theme];
  for (const [property, value] of Object.entries(props)) {
    root.style.setProperty(property, value);
  }
  root.dataset.theme = theme;
  document.body.style.background = props['--color-bg'];
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch { /* ignore */ }
  for (const cb of listeners) cb(theme);
}

export function onThemeChange(cb: (theme: ThemeName) => void): void {
  listeners.push(cb);
}

export function cycleTheme(): void {
  const order: ThemeName[] = ['dark', 'light', 'oled'];
  const current = getTheme();
  const next = order[(order.indexOf(current) + 1) % order.length];
  applyTheme(next);
}
