import * as storage from './storage.ts';
import { getCurrentTier } from './tier.ts';
import type { PriceAlert } from '../types/index.ts';

const STORAGE_KEY = 'dashview-alerts';

export function getAlerts(): PriceAlert[] {
  return storage.get<PriceAlert[]>(STORAGE_KEY, []);
}

export function getActiveAlerts(): PriceAlert[] {
  return getAlerts().filter((a) => !a.triggeredAt);
}

export function getAlertLimit(): number {
  const tier = getCurrentTier();
  return tier === 'premium' ? Infinity : 3;
}

export function canAddAlert(): boolean {
  return getActiveAlerts().length < getAlertLimit();
}

export function addAlert(alert: Omit<PriceAlert, 'id' | 'createdAt'>): PriceAlert | null {
  if (!canAddAlert()) return null;

  const newAlert: PriceAlert = {
    ...alert,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };

  const alerts = getAlerts();
  alerts.push(newAlert);
  storage.set(STORAGE_KEY, alerts);
  dispatchAlertUpdate();
  return newAlert;
}

export function removeAlert(id: string): void {
  const alerts = getAlerts().filter((a) => a.id !== id);
  storage.set(STORAGE_KEY, alerts);
  dispatchAlertUpdate();
}

export function acknowledgeAlert(id: string): void {
  const alerts = getAlerts();
  const alert = alerts.find((a) => a.id === id);
  if (alert) {
    alert.acknowledged = true;
    storage.set(STORAGE_KEY, alerts);
    dispatchAlertUpdate();
  }
}

export function checkAlerts(
  prices: { symbol: string; price: number; type: 'stock' | 'crypto' }[],
): PriceAlert[] {
  const alerts = getAlerts();
  const triggered: PriceAlert[] = [];
  let changed = false;

  for (const alert of alerts) {
    if (alert.triggeredAt) continue;

    const match = prices.find(
      (p) => p.symbol.toUpperCase() === alert.symbol.toUpperCase() && p.type === alert.type,
    );
    if (!match) continue;

    let breached = false;

    switch (alert.condition) {
      case 'above':
        breached = match.price >= alert.threshold;
        break;
      case 'below':
        breached = match.price <= alert.threshold;
        break;
      case 'change_above': {
        if (!alert.referencePrice) {
          alert.referencePrice = match.price;
          changed = true;
          break; // Don't trigger on first check, just capture reference
        }
        const pctChange = ((match.price - alert.referencePrice) / alert.referencePrice) * 100;
        breached = pctChange >= alert.threshold;
        break;
      }
      case 'change_below': {
        if (!alert.referencePrice) {
          alert.referencePrice = match.price;
          changed = true;
          break; // Don't trigger on first check, just capture reference
        }
        const pctChange = ((alert.referencePrice - match.price) / alert.referencePrice) * 100;
        breached = pctChange >= alert.threshold;
        break;
      }
      case 'outside_range': {
        if (alert.threshold2 !== undefined) {
          breached = match.price < alert.threshold || match.price > alert.threshold2;
        }
        break;
      }
      case 'crosses_above': {
        if (alert.lastPrice === undefined) {
          alert.lastPrice = match.price;
          changed = true;
          break; // Don't trigger on first check, just capture lastPrice
        }
        breached = alert.lastPrice < alert.threshold && match.price >= alert.threshold;
        break;
      }
      case 'crosses_below': {
        if (alert.lastPrice === undefined) {
          alert.lastPrice = match.price;
          changed = true;
          break; // Don't trigger on first check, just capture lastPrice
        }
        breached = alert.lastPrice > alert.threshold && match.price <= alert.threshold;
        break;
      }
    }

    if (breached) {
      alert.triggeredAt = Date.now();
      triggered.push(alert);
      changed = true;
      fireNotification(alert, match.price);
    }
  }

  // Update lastPrice for crossing alerts (even non-triggered ones)
  let lastPriceUpdated = false;
  for (const alert of alerts) {
    if (alert.condition === 'crosses_above' || alert.condition === 'crosses_below') {
      const match = prices.find(
        (p) => p.symbol.toUpperCase() === alert.symbol.toUpperCase() && p.type === alert.type,
      );
      if (match && alert.lastPrice !== match.price) {
        alert.lastPrice = match.price;
        lastPriceUpdated = true;
      }
    }
  }

  if (changed || lastPriceUpdated) {
    storage.set(STORAGE_KEY, alerts);
    if (changed) {
      dispatchAlertUpdate();
    }
  }

  return triggered;
}

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return Promise.resolve('denied' as NotificationPermission);
  return Notification.requestPermission();
}

function getNotificationBody(alert: PriceAlert, currentPrice: number): string {
  switch (alert.condition) {
    case 'above':
      return `${alert.symbol} is above $${alert.threshold.toFixed(2)} (now $${currentPrice.toFixed(2)})`;
    case 'below':
      return `${alert.symbol} is below $${alert.threshold.toFixed(2)} (now $${currentPrice.toFixed(2)})`;
    case 'change_above': {
      const pct = alert.referencePrice
        ? (((currentPrice - alert.referencePrice) / alert.referencePrice) * 100).toFixed(1)
        : '?';
      return `${alert.symbol} up ${pct}% from $${(alert.referencePrice || 0).toFixed(2)} (now $${currentPrice.toFixed(2)})`;
    }
    case 'change_below': {
      const pct = alert.referencePrice
        ? (((alert.referencePrice - currentPrice) / alert.referencePrice) * 100).toFixed(1)
        : '?';
      return `${alert.symbol} down ${pct}% from $${(alert.referencePrice || 0).toFixed(2)} (now $${currentPrice.toFixed(2)})`;
    }
    case 'outside_range':
      return `${alert.symbol} is outside $${alert.threshold.toFixed(2)}-$${(alert.threshold2 || 0).toFixed(2)} range (now $${currentPrice.toFixed(2)})`;
    case 'crosses_above':
      return `${alert.symbol} crossed above $${alert.threshold.toFixed(2)} (now $${currentPrice.toFixed(2)})`;
    case 'crosses_below':
      return `${alert.symbol} crossed below $${alert.threshold.toFixed(2)} (now $${currentPrice.toFixed(2)})`;
    default:
      return `${alert.symbol} alert triggered (now $${currentPrice.toFixed(2)})`;
  }
}

function fireNotification(alert: PriceAlert, currentPrice: number): void {
  const title = `${alert.symbol} Alert`;
  const body = getNotificationBody(alert, currentPrice);

  // Try SW notification for background support
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SHOW_NOTIFICATION',
      title,
      body,
      tag: `alert-${alert.id}`,
    });
    return;
  }

  // Fallback to regular notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, tag: `alert-${alert.id}` });
  }
}

function dispatchAlertUpdate(): void {
  document.dispatchEvent(new CustomEvent('dashview:alerts-updated'));
}

export function getUntriggeredCount(): number {
  return getActiveAlerts().length;
}
