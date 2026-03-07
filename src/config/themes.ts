export type ThemeName = 'dark' | 'light' | 'oled';

export const themes: Record<ThemeName, Record<string, string>> = {
  dark: {
    '--color-bg': '#0a0a0a',
    '--color-surface': '#141414',
    '--color-border': '#262626',
    '--color-text': '#fafafa',
    '--color-text-muted': '#a1a1aa',
    '--color-accent': '#3b82f6',
    '--color-positive': '#22c55e',
    '--color-negative': '#ef4444',
  },
  light: {
    '--color-bg': '#f5f5f5',
    '--color-surface': '#ffffff',
    '--color-border': '#e5e5e5',
    '--color-text': '#171717',
    '--color-text-muted': '#737373',
    '--color-accent': '#2563eb',
    '--color-positive': '#16a34a',
    '--color-negative': '#dc2626',
  },
  oled: {
    '--color-bg': '#000000',
    '--color-surface': '#0a0a0a',
    '--color-border': '#1a1a1a',
    '--color-text': '#fafafa',
    '--color-text-muted': '#a1a1aa',
    '--color-accent': '#3b82f6',
    '--color-positive': '#22c55e',
    '--color-negative': '#ef4444',
  },
};
