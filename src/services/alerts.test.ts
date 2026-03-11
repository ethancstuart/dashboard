import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./storage.ts', () => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('./tier.ts', () => ({
  getCurrentTier: vi.fn(),
}));

import {
  getActiveAlerts,
  canAddAlert,
  addAlert,
  checkAlerts,
  acknowledgeAlert,
} from './alerts.ts';
import * as storage from './storage.ts';
import { getCurrentTier } from './tier.ts';

beforeEach(() => {
  vi.mocked(storage.get).mockReset();
  vi.mocked(storage.set).mockReset();
  vi.mocked(getCurrentTier).mockReset();
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });
});

function makeAlert(overrides: Partial<import('../types/index.ts').PriceAlert> = {}): import('../types/index.ts').PriceAlert {
  return {
    id: 'a1',
    symbol: 'AAPL',
    type: 'stock',
    condition: 'above',
    threshold: 200,
    createdAt: 1000,
    ...overrides,
  };
}

describe('canAddAlert', () => {
  it('returns true when under limit (free tier: 3 max)', () => {
    vi.mocked(getCurrentTier).mockReturnValue('free');
    vi.mocked(storage.get).mockReturnValue([makeAlert(), makeAlert({ id: 'a2' })]);

    expect(canAddAlert()).toBe(true);
  });

  it('returns false when at limit for free tier', () => {
    vi.mocked(getCurrentTier).mockReturnValue('free');
    vi.mocked(storage.get).mockReturnValue([
      makeAlert({ id: 'a1' }),
      makeAlert({ id: 'a2' }),
      makeAlert({ id: 'a3' }),
    ]);

    expect(canAddAlert()).toBe(false);
  });

  it('returns true for premium tier regardless of count', () => {
    vi.mocked(getCurrentTier).mockReturnValue('premium');
    vi.mocked(storage.get).mockReturnValue([
      makeAlert({ id: 'a1' }),
      makeAlert({ id: 'a2' }),
      makeAlert({ id: 'a3' }),
      makeAlert({ id: 'a4' }),
      makeAlert({ id: 'a5' }),
    ]);

    expect(canAddAlert()).toBe(true);
  });
});

describe('addAlert', () => {
  it('persists alert to storage and returns it', () => {
    vi.mocked(getCurrentTier).mockReturnValue('free');
    vi.mocked(storage.get).mockReturnValue([]);

    const result = addAlert({
      symbol: 'TSLA',
      type: 'stock',
      condition: 'above',
      threshold: 300,
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('test-uuid-1234');
    expect(result!.symbol).toBe('TSLA');
    expect(storage.set).toHaveBeenCalled();
  });

  it('returns null when limit reached', () => {
    vi.mocked(getCurrentTier).mockReturnValue('free');
    vi.mocked(storage.get).mockReturnValue([
      makeAlert({ id: 'a1' }),
      makeAlert({ id: 'a2' }),
      makeAlert({ id: 'a3' }),
    ]);

    const result = addAlert({
      symbol: 'GOOG',
      type: 'stock',
      condition: 'below',
      threshold: 100,
    });

    expect(result).toBeNull();
  });
});

describe('checkAlerts', () => {
  it('triggers alert when price crosses above threshold', () => {
    const alert = makeAlert({ condition: 'above', threshold: 200, symbol: 'AAPL', type: 'stock' });
    vi.mocked(storage.get).mockReturnValue([alert]);

    const triggered = checkAlerts([{ symbol: 'AAPL', price: 210, type: 'stock' }]);

    expect(triggered).toHaveLength(1);
    expect(triggered[0].triggeredAt).toBeDefined();
    expect(storage.set).toHaveBeenCalled();
  });

  it('triggers alert when price crosses below threshold', () => {
    const alert = makeAlert({ condition: 'below', threshold: 150, symbol: 'BTC', type: 'crypto' });
    vi.mocked(storage.get).mockReturnValue([alert]);

    const triggered = checkAlerts([{ symbol: 'BTC', price: 140, type: 'crypto' }]);

    expect(triggered).toHaveLength(1);
  });

  it('does not re-trigger already-triggered alerts', () => {
    const alert = makeAlert({ triggeredAt: 9999 });
    vi.mocked(storage.get).mockReturnValue([alert]);

    const triggered = checkAlerts([{ symbol: 'AAPL', price: 210, type: 'stock' }]);

    expect(triggered).toHaveLength(0);
    expect(storage.set).not.toHaveBeenCalled();
  });
});

describe('acknowledgeAlert', () => {
  it('sets acknowledged flag', () => {
    const alert = makeAlert({ id: 'ack-me', triggeredAt: 5000 });
    vi.mocked(storage.get).mockReturnValue([alert]);

    acknowledgeAlert('ack-me');

    expect(storage.set).toHaveBeenCalled();
    const savedAlerts = vi.mocked(storage.set).mock.calls[0][1] as import('../types/index.ts').PriceAlert[];
    expect(savedAlerts[0].acknowledged).toBe(true);
  });
});

describe('getActiveAlerts', () => {
  it('filters to only enabled, untriggered alerts', () => {
    vi.mocked(storage.get).mockReturnValue([
      makeAlert({ id: 'active1' }),
      makeAlert({ id: 'triggered1', triggeredAt: 1000 }),
      makeAlert({ id: 'active2' }),
    ]);

    const active = getActiveAlerts();
    expect(active).toHaveLength(2);
    expect(active.map((a) => a.id)).toEqual(['active1', 'active2']);
  });
});
