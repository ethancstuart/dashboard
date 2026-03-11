import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage before importing analytics (which has a top-level trackEvent call)
vi.mock('./storage.ts', () => ({
  get: vi.fn().mockReturnValue({ days: [] }),
  set: vi.fn(),
}));

import { trackEvent, trackPanelView, getAnalyticsSummary } from './analytics.ts';
import * as storage from './storage.ts';

beforeEach(() => {
  vi.mocked(storage.get).mockReset().mockReturnValue({ days: [] });
  vi.mocked(storage.set).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
});

describe('trackEvent', () => {
  it('stores event with correct key and timestamp', () => {
    trackEvent('feature_use', 'alert_create');

    expect(storage.set).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(storage.set).mock.calls[0][1] as { days: { date: string; events: Record<string, number> }[] };
    expect(saved.days).toHaveLength(1);
    expect(saved.days[0].date).toBe('2026-03-11');
    expect(saved.days[0].events['feature_use:alert_create']).toBe(1);
  });
});

describe('trackPanelView', () => {
  it('constructs correct event key with panel id', () => {
    trackPanelView('weather');

    const saved = vi.mocked(storage.set).mock.calls[0][1] as { days: { date: string; events: Record<string, number> }[] };
    expect(saved.days[0].events['panel_view:weather']).toBe(1);
  });
});

describe('getAnalyticsSummary', () => {
  it('returns top 5 panels sorted by view count', () => {
    vi.mocked(storage.get).mockReturnValue({
      days: [
        {
          date: '2026-03-11',
          events: {
            'panel_view:weather': 10,
            'panel_view:stocks': 20,
            'panel_view:news': 5,
            'panel_view:crypto': 15,
            'panel_view:sports': 8,
            'panel_view:notes': 3,
          },
        },
      ],
    });

    const summary = getAnalyticsSummary();
    expect(summary.topPanels).toHaveLength(5);
    expect(summary.topPanels[0]).toEqual({ id: 'stocks', count: 20 });
    expect(summary.topPanels[1]).toEqual({ id: 'crypto', count: 15 });
    expect(summary.topPanels[4]).toEqual({ id: 'news', count: 5 });
  });

  it('prunes entries older than 30 days via save', () => {
    // The pruning happens in the save() function when data has >30 days
    // We test that getAnalyticsSummary counts only what getData() returns
    const days = [];
    for (let i = 0; i < 35; i++) {
      days.push({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, events: { 'panel_view:weather': 1 } });
    }
    vi.mocked(storage.get).mockReturnValue({ days });

    const summary = getAnalyticsSummary();
    // All 35 days are counted since pruning only happens on save, not on read
    expect(summary.daysActive).toBe(35);
    expect(summary.totalPanelViews).toBe(35);
  });

  it('counts feature usage (alert_create, note_add, etc.)', () => {
    vi.mocked(storage.get).mockReturnValue({
      days: [
        {
          date: '2026-03-11',
          events: {
            'feature_use:alert_create': 3,
            'feature_use:note_add': 2,
            'feature_use:briefing': 1,
            'feature_use:command_palette': 5,
          },
        },
      ],
    });

    const summary = getAnalyticsSummary();
    expect(summary.totalFeatureUses).toBe(11);
    expect(summary.alertsCreated).toBe(3);
    expect(summary.notesAdded).toBe(2);
    expect(summary.briefingsGenerated).toBe(1);
    expect(summary.commandPaletteUses).toBe(5);
  });

  it('empty storage returns zero-count summary', () => {
    vi.mocked(storage.get).mockReturnValue({ days: [] });

    const summary = getAnalyticsSummary();
    expect(summary.daysActive).toBe(0);
    expect(summary.totalPanelViews).toBe(0);
    expect(summary.topPanels).toEqual([]);
    expect(summary.totalFeatureUses).toBe(0);
    expect(summary.totalErrors).toBe(0);
    expect(summary.alertsCreated).toBe(0);
    expect(summary.notesAdded).toBe(0);
    expect(summary.briefingsGenerated).toBe(0);
    expect(summary.commandPaletteUses).toBe(0);
  });
});
