const themeProperties: Record<string, string> = {
  '--color-bg': '#0a0a0a',
  '--color-surface': '#141414',
  '--color-border': '#262626',
  '--color-text': '#fafafa',
  '--color-text-muted': '#a1a1aa',
  '--color-accent': '#3b82f6',
  '--color-positive': '#22c55e',
  '--color-negative': '#ef4444',
};

export function applyTheme(): void {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(themeProperties)) {
    root.style.setProperty(property, value);
  }
}
