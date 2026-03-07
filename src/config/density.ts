export type DensityMode = 'compact' | 'comfortable' | 'spacious';

const STORAGE_KEY = 'dashview:density';

export function getDensity(): DensityMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'compact' || stored === 'comfortable' || stored === 'spacious') return stored;
  } catch { /* ignore */ }
  return 'comfortable';
}

export function applyDensity(mode?: DensityMode): void {
  const density = mode ?? getDensity();
  document.documentElement.dataset.density = density;
  try {
    localStorage.setItem(STORAGE_KEY, density);
  } catch { /* ignore */ }
}
