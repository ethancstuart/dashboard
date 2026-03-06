import type { User } from '../types/index.ts';

type AuthCallback = (user: User | null) => void;

let cachedUser: User | null = null;
let checked = false;
const listeners: AuthCallback[] = [];

export async function checkSession(): Promise<User | null> {
  try {
    const res = await fetch('/api/auth/session');
    const data = await res.json();
    cachedUser = data.user || null;
    if (cachedUser) {
      localStorage.setItem('dashview-user', JSON.stringify(cachedUser));
    } else {
      localStorage.removeItem('dashview-user');
    }
  } catch {
    cachedUser = null;
  }
  checked = true;
  for (const cb of listeners) cb(cachedUser);
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
