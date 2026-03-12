import { fetchWithRetry } from '../utils/fetch.ts';
import type { CalendarEvent } from '../types/index.ts';

export async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const res = await fetchWithRetry('/api/calendar');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.events || []) as CalendarEvent[];
}

export async function isCalendarConnected(): Promise<boolean> {
  try {
    const res = await fetch('/api/keys');
    if (!res.ok) return false;
    const data = await res.json();
    return (data.keys || []).includes('google-calendar');
  } catch {
    return false;
  }
}

export function connectCalendar(): void {
  window.location.href = '/api/auth/calendar-connect';
}

export async function disconnectCalendar(): Promise<void> {
  await fetch('/api/keys?name=google-calendar', { method: 'DELETE' });
}
