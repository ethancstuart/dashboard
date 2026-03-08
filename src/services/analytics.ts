import * as storage from './storage.ts';

const STORAGE_KEY = 'dashview-analytics';
const MAX_DAYS = 30;

type EventCategory = 'panel_view' | 'feature_use' | 'error' | 'session';

interface DayEvents {
  date: string;
  events: Record<string, number>;
}

interface AnalyticsData {
  days: DayEvents[];
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getData(): AnalyticsData {
  return storage.get<AnalyticsData>(STORAGE_KEY, { days: [] });
}

function save(data: AnalyticsData): void {
  // Prune to MAX_DAYS
  if (data.days.length > MAX_DAYS) {
    data.days = data.days.slice(-MAX_DAYS);
  }
  storage.set(STORAGE_KEY, data);
}

function getTodayEntry(data: AnalyticsData): DayEvents {
  const today = getToday();
  let entry = data.days.find((d) => d.date === today);
  if (!entry) {
    entry = { date: today, events: {} };
    data.days.push(entry);
  }
  return entry;
}

export function trackEvent(category: EventCategory, action: string, label?: string): void {
  const data = getData();
  const entry = getTodayEntry(data);
  const key = label ? `${category}:${action}:${label}` : `${category}:${action}`;
  entry.events[key] = (entry.events[key] || 0) + 1;
  save(data);
}

export function trackPanelView(panelId: string): void {
  trackEvent('panel_view', panelId);
}

export function trackFeatureUse(feature: string): void {
  trackEvent('feature_use', feature);
}

export function trackError(context: string): void {
  trackEvent('error', context);
}

export interface AnalyticsSummary {
  daysActive: number;
  totalPanelViews: number;
  topPanels: { id: string; count: number }[];
  totalFeatureUses: number;
  totalErrors: number;
  alertsCreated: number;
  notesAdded: number;
  briefingsGenerated: number;
  commandPaletteUses: number;
}

export function getAnalyticsSummary(): AnalyticsSummary {
  const data = getData();
  const summary: AnalyticsSummary = {
    daysActive: data.days.length,
    totalPanelViews: 0,
    topPanels: [],
    totalFeatureUses: 0,
    totalErrors: 0,
    alertsCreated: 0,
    notesAdded: 0,
    briefingsGenerated: 0,
    commandPaletteUses: 0,
  };

  const panelCounts: Record<string, number> = {};

  for (const day of data.days) {
    for (const [key, count] of Object.entries(day.events)) {
      if (key.startsWith('panel_view:')) {
        const panelId = key.replace('panel_view:', '');
        panelCounts[panelId] = (panelCounts[panelId] || 0) + count;
        summary.totalPanelViews += count;
      } else if (key.startsWith('feature_use:')) {
        summary.totalFeatureUses += count;
        if (key.includes('alert_create')) summary.alertsCreated += count;
        if (key.includes('note_add')) summary.notesAdded += count;
        if (key.includes('briefing')) summary.briefingsGenerated += count;
        if (key.includes('command_palette')) summary.commandPaletteUses += count;
      } else if (key.startsWith('error:')) {
        summary.totalErrors += count;
      }
    }
  }

  summary.topPanels = Object.entries(panelCounts)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return summary;
}

// Auto-track session start
trackEvent('session', 'start');
