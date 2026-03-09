export interface UserPreferences {
  tempUnit: 'F' | 'C';
  timeFormat: '12h' | '24h';
}

const STORAGE_KEY = 'dashview:preferences';

const defaults: UserPreferences = {
  tempUnit: 'F',
  timeFormat: '12h',
};

export function getPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaults };
}

export function setPreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]): void {
  const prefs = getPreferences();
  prefs[key] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  document.dispatchEvent(new CustomEvent('dashview:storage-changed', { detail: { key: STORAGE_KEY, action: 'set' } }));
}
