import { createElement } from '../utils/dom.ts';
import {
  getAlerts,
  addAlert,
  removeAlert,
  acknowledgeAlert,
  canAddAlert,
  getAlertLimit,
  requestNotificationPermission,
} from '../services/alerts.ts';
import type { PriceAlert } from '../types/index.ts';

let overlay: HTMLElement | null = null;

export function openAlertsModal(prefill?: { symbol: string; type: 'stock' | 'crypto' }): void {
  closeAlertsModal();

  overlay = createElement('div', { className: 'alerts-modal-overlay' });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeAlertsModal();
  });

  const dialog = createElement('div', { className: 'alerts-modal' });
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Price Alerts');

  const header = createElement('div', { className: 'alerts-modal-header' });
  const title = createElement('div', { className: 'alerts-modal-title', textContent: 'Price Alerts' });
  const closeBtn = createElement('button', { className: 'briefing-close', textContent: '\u00D7' });
  closeBtn.addEventListener('click', closeAlertsModal);
  header.appendChild(title);
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const body = createElement('div', { className: 'alerts-modal-body' });

  // Add alert form
  body.appendChild(createAlertForm(prefill));

  // Existing alerts
  const alerts = getAlerts();
  if (alerts.length > 0) {
    const listTitle = createElement('div', {
      className: 'alerts-list-title',
      textContent: 'Active Alerts',
    });
    body.appendChild(listTitle);

    for (const alert of alerts) {
      body.appendChild(createAlertRow(alert, body));
    }
  }

  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeAlertsModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

export function closeAlertsModal(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function createAlertForm(
  prefill: { symbol: string; type: 'stock' | 'crypto' } | undefined,
): HTMLElement {
  const form = createElement('div', { className: 'alerts-form' });

  const row1 = createElement('div', { className: 'alerts-form-row' });

  const symbolInput = document.createElement('input');
  symbolInput.type = 'text';
  symbolInput.placeholder = 'Symbol (e.g. AAPL)';
  symbolInput.className = 'alerts-input';
  symbolInput.value = prefill?.symbol || '';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'alerts-select';
  for (const t of ['stock', 'crypto']) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    if (t === prefill?.type) opt.selected = true;
    typeSelect.appendChild(opt);
  }

  row1.appendChild(symbolInput);
  row1.appendChild(typeSelect);
  form.appendChild(row1);

  const row2 = createElement('div', { className: 'alerts-form-row' });

  const condSelect = document.createElement('select');
  condSelect.className = 'alerts-select';
  for (const c of [
    { value: 'above', label: 'Above' },
    { value: 'below', label: 'Below' },
  ]) {
    const opt = document.createElement('option');
    opt.value = c.value;
    opt.textContent = c.label;
    condSelect.appendChild(opt);
  }

  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.placeholder = 'Price threshold';
  priceInput.className = 'alerts-input';
  priceInput.step = '0.01';

  row2.appendChild(condSelect);
  row2.appendChild(priceInput);
  form.appendChild(row2);

  const addBtn = createElement('button', {
    className: 'alerts-add-btn',
    textContent: 'Add Alert',
  });

  const status = createElement('div', { className: 'alerts-form-status' });

  if (!canAddAlert()) {
    addBtn.setAttribute('disabled', '');
    const limit = getAlertLimit();
    status.textContent = `Limit reached (${limit} alerts). Upgrade for unlimited alerts.`;
    status.style.color = 'var(--color-negative)';
  }

  addBtn.addEventListener('click', async () => {
    const symbol = symbolInput.value.trim().toUpperCase();
    const type = typeSelect.value as 'stock' | 'crypto';
    const condition = condSelect.value as 'above' | 'below';
    const threshold = parseFloat(priceInput.value);

    if (!symbol || isNaN(threshold) || threshold <= 0) {
      status.textContent = 'Please fill in all fields';
      status.style.color = 'var(--color-negative)';
      return;
    }

    // Request notification permission on first alert
    await requestNotificationPermission();

    const result = addAlert({ symbol, type, condition, threshold });
    if (result) {
      status.textContent = `Alert created for ${symbol}`;
      status.style.color = 'var(--color-positive)';
      symbolInput.value = '';
      priceInput.value = '';

      // Refresh the list
      setTimeout(() => openAlertsModal(), 500);
    } else {
      status.textContent = 'Alert limit reached. Upgrade for unlimited alerts.';
      status.style.color = 'var(--color-negative)';
    }
  });

  form.appendChild(addBtn);
  form.appendChild(status);
  return form;
}

function createAlertRow(alert: PriceAlert, _body: HTMLElement): HTMLElement {
  const row = createElement('div', {
    className: `alerts-row ${alert.triggeredAt ? 'alerts-row-triggered' : ''}`,
  });

  const info = createElement('div', { className: 'alerts-row-info' });
  const symbol = createElement('span', {
    className: 'alerts-row-symbol',
    textContent: alert.symbol,
  });
  const condition = createElement('span', {
    className: 'alerts-row-condition',
    textContent: `${alert.condition} $${alert.threshold.toFixed(2)}`,
  });
  const typeBadge = createElement('span', {
    className: 'alerts-row-type',
    textContent: alert.type,
  });
  info.appendChild(symbol);
  info.appendChild(condition);
  info.appendChild(typeBadge);

  const actions = createElement('div', { className: 'alerts-row-actions' });

  if (alert.triggeredAt && !alert.acknowledged) {
    const ackBtn = createElement('button', {
      className: 'alerts-ack-btn',
      textContent: 'Dismiss',
    });
    ackBtn.addEventListener('click', () => {
      acknowledgeAlert(alert.id);
      openAlertsModal();
    });
    actions.appendChild(ackBtn);
  }

  if (alert.triggeredAt) {
    const badge = createElement('span', {
      className: 'alerts-triggered-badge',
      textContent: 'Triggered',
    });
    actions.appendChild(badge);
  }

  const deleteBtn = createElement('button', {
    className: 'notes-delete-btn',
    textContent: '\u00D7',
  });
  deleteBtn.addEventListener('click', () => {
    removeAlert(alert.id);
    openAlertsModal();
  });
  actions.appendChild(deleteBtn);

  row.appendChild(info);
  row.appendChild(actions);
  return row;
}
