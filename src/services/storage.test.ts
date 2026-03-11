import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node 25+ built-in localStorage is non-functional without --localstorage-file.
// Stub it with a simple Map-based implementation.
const store = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, String(value)),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
};
vi.stubGlobal('localStorage', fakeLocalStorage);

import { get, set, remove } from './storage.ts';

beforeEach(() => {
  store.clear();
});

describe('get', () => {
  it('returns parsed JSON', () => {
    store.set('test-key', JSON.stringify({ a: 1 }));
    expect(get('test-key', null)).toEqual({ a: 1 });
  });

  it('returns default on missing key', () => {
    expect(get('missing-key', 'fallback')).toBe('fallback');
  });

  it('returns default on bad JSON', () => {
    store.set('bad-json', '{broken');
    expect(get('bad-json', 42)).toBe(42);
  });
});

describe('set', () => {
  it('writes JSON and dispatches dashview:storage-changed event', () => {
    const handler = vi.fn();
    document.addEventListener('dashview:storage-changed', handler);

    set('my-key', { x: 10 });

    expect(store.get('my-key')).toBe(JSON.stringify({ x: 10 }));
    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ key: 'my-key', action: 'set' });

    document.removeEventListener('dashview:storage-changed', handler);
  });
});

describe('remove', () => {
  it('deletes key and dispatches event', () => {
    store.set('del-key', '"value"');
    const handler = vi.fn();
    document.addEventListener('dashview:storage-changed', handler);

    remove('del-key');

    expect(store.has('del-key')).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ key: 'del-key', action: 'remove' });

    document.removeEventListener('dashview:storage-changed', handler);
  });
});
