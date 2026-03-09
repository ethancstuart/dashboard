export function get<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function set(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
  document.dispatchEvent(new CustomEvent('dashview:storage-changed', { detail: { key, action: 'set' } }));
}

export function remove(key: string): void {
  localStorage.removeItem(key);
  document.dispatchEvent(new CustomEvent('dashview:storage-changed', { detail: { key, action: 'remove' } }));
}
