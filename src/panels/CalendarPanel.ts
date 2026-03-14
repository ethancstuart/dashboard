import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { fetchCalendarEvents, isCalendarConnected, connectCalendar, disconnectCalendar } from '../services/calendar.ts';
import type { CalendarEvent } from '../types/index.ts';

export class CalendarPanel extends Panel {
  private events: CalendarEvent[] = [];
  private connected = false;

  constructor() {
    super({
      id: 'calendar',
      title: 'Calendar',
      enabled: true,
      refreshInterval: 600000,
      priority: 1,
      requiredTier: 'free',
      category: 'personal',
    });
  }

  getLastData(): { events: CalendarEvent[] } | null {
    if (this.events.length === 0) return null;
    return { events: this.events };
  }

  async fetchData(): Promise<void> {
    this.connected = await isCalendarConnected();
    if (!this.connected) {
      this.render(null);
      return;
    }
    try {
      this.events = await fetchCalendarEvents();
    } catch {
      this.events = [];
    }
    this.render(this.events);
  }

  render(data: unknown): void {
    this.contentEl.textContent = '';

    if (!this.connected) {
      this.renderConnectState();
      return;
    }

    const events = (data as CalendarEvent[]) || [];
    if (events.length === 0) {
      const empty = createElement('div', { className: 'calendar-empty', textContent: 'No upcoming events' });
      this.contentEl.appendChild(empty);
      this.renderDisconnectBar();
      return;
    }

    // Separate all-day and timed events
    const allDay = events.filter(e => e.allDay);
    const timed = events.filter(e => !e.allDay);

    // Group by day
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    // All-day events at top
    if (allDay.length > 0) {
      for (const event of allDay) {
        this.contentEl.appendChild(this.createAllDayBanner(event));
      }
    }

    // Today's timed events
    const todayEvents = timed.filter(e => {
      const d = new Date(e.start);
      return d >= today && d < tomorrow;
    });
    const tomorrowEvents = timed.filter(e => {
      const d = new Date(e.start);
      return d >= tomorrow && d < dayAfter;
    });

    if (todayEvents.length > 0) {
      this.contentEl.appendChild(createElement('div', { className: 'calendar-section-header', textContent: 'Today' }));
      for (const event of todayEvents) {
        this.contentEl.appendChild(this.createEventCard(event));
      }
    }

    if (tomorrowEvents.length > 0) {
      this.contentEl.appendChild(createElement('div', { className: 'calendar-section-header', textContent: 'Tomorrow' }));
      for (const event of tomorrowEvents) {
        this.contentEl.appendChild(this.createEventCard(event));
      }
    }

    this.renderDisconnectBar();
  }

  private renderConnectState(): void {
    const wrap = createElement('div', { className: 'calendar-connect' });

    const icon = createElement('div', { className: 'calendar-connect-icon', textContent: '\uD83D\uDCC5' });
    wrap.appendChild(icon);

    const text = createElement('div', { className: 'calendar-connect-text', textContent: 'Connect your Google Calendar to see your upcoming events right on your dashboard.' });
    wrap.appendChild(text);

    const btn = createElement('button', { className: 'calendar-connect-btn', textContent: 'Connect Google Calendar' });
    btn.addEventListener('click', () => connectCalendar());
    wrap.appendChild(btn);

    this.contentEl.appendChild(wrap);
  }

  private renderDisconnectBar(): void {
    const bar = createElement('div', { className: 'calendar-disconnect-bar' });
    const btn = createElement('button', { className: 'calendar-disconnect-btn', textContent: 'Disconnect Calendar' });
    btn.addEventListener('click', async () => {
      await disconnectCalendar();
      this.connected = false;
      this.events = [];
      this.render(null);
    });
    bar.appendChild(btn);
    this.contentEl.appendChild(bar);
  }

  private createEventCard(event: CalendarEvent): HTMLElement {
    const card = createElement('div', { className: 'calendar-event' });
    card.style.borderLeftColor = event.calendarColor || '#3b82f6';

    const timeRange = createElement('div', { className: 'calendar-event-time' });
    timeRange.textContent = this.formatTimeRange(event.start, event.end);
    card.appendChild(timeRange);

    const title = createElement('div', { className: 'calendar-event-title', textContent: event.title });
    card.appendChild(title);

    if (event.location) {
      const loc = createElement('div', { className: 'calendar-event-location', textContent: event.location });
      card.appendChild(loc);
    }

    return card;
  }

  private createAllDayBanner(event: CalendarEvent): HTMLElement {
    const banner = createElement('div', { className: 'calendar-allday' });
    banner.style.borderLeftColor = event.calendarColor || '#3b82f6';
    const badge = createElement('span', { className: 'calendar-allday-badge', textContent: 'All Day' });
    const title = createElement('span', { className: 'calendar-allday-title', textContent: event.title });
    banner.appendChild(badge);
    banner.appendChild(title);
    return banner;
  }

  private formatTimeRange(start: string, end: string): string {
    const s = new Date(start);
    const e = new Date(end);
    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${fmt(s)} \u2013 ${fmt(e)}`;
  }
}
