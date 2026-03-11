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

import { gatherSyncablePrefs, importConfig } from './configSync.ts';

beforeEach(() => {
  store.clear();
});

describe('gatherSyncablePrefs', () => {
  it('excludes sensitive keys (user, session, auth)', () => {
    store.set('dashview-user', JSON.stringify({ name: 'Alice' }));
    store.set('dashview-session', JSON.stringify({ token: 'xyz' }));
    store.set('dashview-theme', JSON.stringify('dark'));

    const prefs = gatherSyncablePrefs();
    expect(prefs).not.toHaveProperty('dashview-user');
    expect(prefs).not.toHaveProperty('dashview-session');
    expect(prefs).toHaveProperty('dashview-theme', 'dark');
  });

  it('skips analytics and chat message keys', () => {
    store.set('dashview-analytics', JSON.stringify({ days: [] }));
    store.set('dashview-chat-messages', JSON.stringify([]));
    store.set('dashview-density', JSON.stringify('compact'));

    const prefs = gatherSyncablePrefs();
    expect(prefs).not.toHaveProperty('dashview-analytics');
    expect(prefs).not.toHaveProperty('dashview-chat-messages');
    expect(prefs).toHaveProperty('dashview-density', 'compact');
  });
});

describe('sanitizeValue (tested via importConfig)', () => {
  function makeConfigFile(data: Record<string, unknown>): File {
    const config = { version: 1, timestamp: Date.now(), data };
    return new File([JSON.stringify(config)], 'config.json', { type: 'application/json' });
  }

  it('strips HTML tags from strings', async () => {
    const file = makeConfigFile({ 'dashview-theme': '<script>alert("xss")</script>dark' });
    await importConfig(file);

    const stored = store.get('dashview-theme');
    expect(stored).not.toContain('<script>');
    expect(stored).toContain('dark');
  });

  it('removes javascript: URIs', async () => {
    const file = makeConfigFile({ 'dashview-notes': 'javascript:alert(1)' });
    await importConfig(file);

    const stored = store.get('dashview-notes');
    expect(stored).not.toContain('javascript:');
  });

  it('removes event handler attributes (onclick, onerror)', async () => {
    const file = makeConfigFile({ 'dashview-label': 'onclick=alert(1) label' });
    await importConfig(file);

    const stored = store.get('dashview-label');
    expect(stored).not.toContain('onclick=');
  });

  it('recursively sanitizes nested objects and arrays', async () => {
    const file = makeConfigFile({
      'dashview-config': {
        nested: { value: '<b>bold</b>' },
        list: ['<i>item</i>', 'clean'],
      },
    });
    await importConfig(file);

    const stored = JSON.parse(store.get('dashview-config')!);
    expect(stored.nested.value).toBe('bold');
    expect(stored.list[0]).toBe('item');
    expect(stored.list[1]).toBe('clean');
  });

  it('passes through numbers, booleans, and clean strings unchanged', async () => {
    const file = makeConfigFile({
      'dashview-prefs': { count: 42, active: true, name: 'hello' },
    });
    await importConfig(file);

    const stored = JSON.parse(store.get('dashview-prefs')!);
    expect(stored.count).toBe(42);
    expect(stored.active).toBe(true);
    expect(stored.name).toBe('hello');
  });
});

describe('importConfig', () => {
  it('rejects files with missing version or data fields', async () => {
    const badFile = new File([JSON.stringify({ timestamp: 123 })], 'bad.json', {
      type: 'application/json',
    });

    const result = await importConfig(badFile);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid');
  });
});
