import { onAuthChange, getUser } from './auth.ts';
import { gatherSyncablePrefs } from './configSync.ts';

const DEBOUNCE_MS = 5000;
const PULL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

interface PrefsBlob {
  version: number;
  updatedAt: number;
  data: Record<string, unknown>;
}

let serverUpdatedAt = 0;
let lastPulledAt = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const dirtyKeys = new Set<string>();
let active = false;

export function initPrefsSync(): void {
  onAuthChange((user) => {
    if (user && user.tier !== 'guest') {
      startSync();
    } else {
      stopSync();
    }
  });

  // If already logged in, start immediately
  const user = getUser();
  if (user && user.tier !== 'guest') {
    startSync();
  }
}

function startSync(): void {
  if (active) return;
  active = true;

  // Pull on startup
  pullPrefs();

  // Listen for local changes
  document.addEventListener('dashview:storage-changed', onStorageChanged as EventListener);

  // Pull when tab regains focus
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Flush pending changes on tab close
  window.addEventListener('beforeunload', flushBeforeUnload);
}

function stopSync(): void {
  active = false;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  dirtyKeys.clear();
  document.removeEventListener('dashview:storage-changed', onStorageChanged as EventListener);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('beforeunload', flushBeforeUnload);
}

function onStorageChanged(e: CustomEvent<{ key: string }>): void {
  const key = e.detail.key;
  if (!key.startsWith('dashview')) return;
  dirtyKeys.add(key);

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => pushPrefs(), DEBOUNCE_MS);
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return;
  if (!active) return;
  if (Date.now() - lastPulledAt < PULL_COOLDOWN_MS) return;
  pullPrefs();
}

function flushBeforeUnload(): void {
  if (dirtyKeys.size === 0) return;
  const data = gatherSyncablePrefs();
  const payload = JSON.stringify({
    data,
    updatedAt: Date.now(),
    baseUpdatedAt: serverUpdatedAt || undefined,
  });
  navigator.sendBeacon('/api/prefs', payload);
}

export async function pullPrefs(): Promise<void> {
  try {
    const res = await fetch('/api/prefs');
    if (!res.ok) return;

    const body = (await res.json()) as PrefsBlob | { data: null };
    lastPulledAt = Date.now();

    if (!body.data) return; // No server prefs yet — first sync will push

    const server = body as PrefsBlob;
    if (server.updatedAt <= serverUpdatedAt) return; // Already up to date

    // Merge: apply server values for keys not dirty locally
    let merged = false;
    for (const [key, value] of Object.entries(server.data)) {
      if (dirtyKeys.has(key)) continue; // Local change takes priority
      const current = readLocalKey(key);
      const serverVal = typeof value === 'string' ? value : JSON.stringify(value);
      if (current !== serverVal) {
        localStorage.setItem(key, serverVal);
        merged = true;
      }
    }

    serverUpdatedAt = server.updatedAt;

    if (merged) {
      document.dispatchEvent(new CustomEvent('dashview:prefs-synced'));
    }

    // If we have dirty keys, push merged state back
    if (dirtyKeys.size > 0) {
      pushPrefs();
    }
  } catch {
    // Sync failure is non-blocking
  }
}

export async function pushPrefs(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (dirtyKeys.size === 0) return;

  const data = gatherSyncablePrefs();

  try {
    const res = await fetch('/api/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data,
        updatedAt: Date.now(),
        baseUpdatedAt: serverUpdatedAt || undefined,
      }),
    });

    if (res.status === 409) {
      // Conflict — server changed since last pull. Re-pull to merge.
      const body = (await res.json()) as { conflict: true; server: PrefsBlob };
      serverUpdatedAt = body.server.updatedAt;

      // Apply non-dirty server keys, then retry push
      for (const [key, value] of Object.entries(body.server.data)) {
        if (dirtyKeys.has(key)) continue;
        const serverVal = typeof value === 'string' ? value : JSON.stringify(value);
        localStorage.setItem(key, serverVal);
      }
      document.dispatchEvent(new CustomEvent('dashview:prefs-synced'));

      // Retry with fresh data
      const mergedData = gatherSyncablePrefs();
      const retryRes = await fetch('/api/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: mergedData,
          updatedAt: Date.now(),
          baseUpdatedAt: serverUpdatedAt,
        }),
      });
      if (retryRes.ok) {
        const retryBody = (await retryRes.json()) as { updatedAt: number };
        serverUpdatedAt = retryBody.updatedAt;
      }
    } else if (res.ok) {
      const body = (await res.json()) as { updatedAt: number };
      serverUpdatedAt = body.updatedAt;
    }

    dirtyKeys.clear();
  } catch {
    // Push failure is non-blocking — will retry on next change
  }
}

function readLocalKey(key: string): string | null {
  return localStorage.getItem(key);
}
