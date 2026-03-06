import type { User } from '../types/index.ts';

type AuthCallback = (user: User | null) => void;

let cachedUser: User | null = null;
let checked = false;
const listeners: AuthCallback[] = [];

export async function checkSession(): Promise<User | null> {
  try {
    const res = await fetch('/api/auth/session');
    const data = await res.json();
    console.log('[auth] session response:', JSON.stringify(data));
    cachedUser = data.user || null;
    if (cachedUser) {
      localStorage.setItem('dashview-user', JSON.stringify(cachedUser));
    } else {
      localStorage.removeItem('dashview-user');
    }
  } catch (err) {
    console.error('[auth] checkSession failed:', err);
    cachedUser = null;
  }
  // Fallback to localStorage if API returned null
  if (!cachedUser) {
    try {
      const stored = localStorage.getItem('dashview-user');
      if (stored) cachedUser = JSON.parse(stored) as User;
    } catch { /* ignore */ }
  }
  checked = true;
  for (const cb of listeners) cb(cachedUser);
  console.log('[auth] resolved user:', cachedUser?.name ?? 'null');
  return cachedUser;
}

export function getUser(): User | null {
  if (cachedUser) return cachedUser;
  try {
    const stored = localStorage.getItem('dashview-user');
    if (stored) return JSON.parse(stored) as User;
  } catch { /* ignore */ }
  return null;
}

export function isChecked(): boolean {
  return checked;
}

export function login(provider: 'google' | 'github'): void {
  window.location.href = `/api/auth/login?provider=${provider}`;
}

export function logout(): void {
  window.location.href = '/api/auth/logout';
}

export function onAuthChange(cb: AuthCallback): void {
  listeners.push(cb);
}
