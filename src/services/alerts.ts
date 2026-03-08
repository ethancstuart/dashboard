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

    const breached =
      (alert.condition === 'above' && match.price >= alert.threshold) ||
      (alert.condition === 'below' && match.price <= alert.threshold);

    if (breached) {
      alert.triggeredAt = Date.now();
      triggered.push(alert);
      changed = true;
      fireNotification(alert, match.price);
    }
  }

  if (changed) {
    storage.set(STORAGE_KEY, alerts);
    dispatchAlertUpdate();
  }

  return triggered;
}

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return Promise.resolve('denied' as NotificationPermission);
  return Notification.requestPermission();
}

function fireNotification(alert: PriceAlert, currentPrice: number): void {
  const title = `${alert.symbol} Alert`;
  const body = `${alert.symbol} is ${alert.condition} $${alert.threshold.toFixed(2)} (now $${currentPrice.toFixed(2)})`;

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
