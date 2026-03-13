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
import { pushModal, popModal } from './modalManager.ts';
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

  pushModal(closeAlertsModal);
}

export function closeAlertsModal(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
    popModal();
  }
}

const CONDITION_OPTIONS: { value: PriceAlert['condition']; label: string }[] = [
  { value: 'above', label: 'Price Above' },
  { value: 'below', label: 'Price Below' },
  { value: 'crosses_above', label: 'Crosses Above' },
  { value: 'crosses_below', label: 'Crosses Below' },
  { value: 'change_above', label: '% Change Up' },
  { value: 'change_below', label: '% Change Down' },
  { value: 'outside_range', label: 'Outside Range' },
];

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
  condSelect.className = 'alerts-select alerts-select-condition';
  for (const c of CONDITION_OPTIONS) {
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

  // Dynamic row for range high value (outside_range)
  const rangeRow = createElement('div', { className: 'alerts-form-row alerts-range-row' });
  rangeRow.style.display = 'none';

  const priceInput2 = document.createElement('input');
  priceInput2.type = 'number';
  priceInput2.placeholder = 'High price';
  priceInput2.className = 'alerts-input';
  priceInput2.step = '0.01';

  rangeRow.appendChild(priceInput2);
  form.appendChild(rangeRow);

  // Info text for context-dependent help
  const infoText = createElement('div', { className: 'alerts-form-info' });
  infoText.style.display = 'none';
  form.appendChild(infoText);

  // Update form fields based on condition selection
  function updateFormForCondition(): void {
    const condition = condSelect.value as PriceAlert['condition'];

    // Reset visibility
    rangeRow.style.display = 'none';
    infoText.style.display = 'none';

    switch (condition) {
      case 'above':
      case 'below':
        priceInput.placeholder = 'Price threshold';
        priceInput.step = '0.01';
        break;
      case 'crosses_above':
        priceInput.placeholder = 'Price threshold';
        priceInput.step = '0.01';
        infoText.textContent = 'Triggers when price crosses above the threshold from below';
        infoText.style.display = 'block';
        break;
      case 'crosses_below':
        priceInput.placeholder = 'Price threshold';
        priceInput.step = '0.01';
        infoText.textContent = 'Triggers when price crosses below the threshold from above';
        infoText.style.display = 'block';
        break;
      case 'change_above':
        priceInput.placeholder = '% Threshold';
        priceInput.step = '0.1';
        infoText.textContent = 'Reference price captured at first check';
        infoText.style.display = 'block';
        break;
      case 'change_below':
        priceInput.placeholder = '% Threshold';
        priceInput.step = '0.1';
        infoText.textContent = 'Reference price captured at first check';
        infoText.style.display = 'block';
        break;
      case 'outside_range':
        priceInput.placeholder = 'Low price';
        priceInput.step = '0.01';
        rangeRow.style.display = 'flex';
        infoText.textContent = 'Triggers when price is below low or above high';
        infoText.style.display = 'block';
        break;
    }
  }

  condSelect.addEventListener('change', updateFormForCondition);

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
    const condition = condSelect.value as PriceAlert['condition'];
    const threshold = parseFloat(priceInput.value);

    if (!symbol || isNaN(threshold) || threshold <= 0) {
      status.textContent = 'Please fill in all fields';
      status.style.color = 'var(--color-negative)';
      return;
    }

    // Validate range second input
    if (condition === 'outside_range') {
      const t2 = parseFloat(priceInput2.value);
      if (isNaN(t2) || t2 <= 0) {
        status.textContent = 'Please enter a valid high price';
        status.style.color = 'var(--color-negative)';
        return;
      }
      if (t2 <= threshold) {
        status.textContent = 'High price must be greater than low price';
        status.style.color = 'var(--color-negative)';
        return;
      }
    }

    // Request notification permission on first alert
    await requestNotificationPermission();

    const alertData: Omit<PriceAlert, 'id' | 'createdAt'> = {
      symbol,
      type,
      condition,
      threshold,
    };

    if (condition === 'outside_range') {
      alertData.threshold2 = parseFloat(priceInput2.value);
    }

    // referencePrice and lastPrice are intentionally omitted —
    // they will be captured on the first check cycle

    const result = addAlert(alertData);
    if (result) {
      status.textContent = `Alert created for ${symbol}`;
      status.style.color = 'var(--color-positive)';
      symbolInput.value = '';
      priceInput.value = '';
      priceInput2.value = '';

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

function getConditionDisplayText(alert: PriceAlert): string {
  switch (alert.condition) {
    case 'above':
      return `above $${alert.threshold.toFixed(2)}`;
    case 'below':
      return `below $${alert.threshold.toFixed(2)}`;
    case 'change_above':
      return alert.referencePrice
        ? `+${alert.threshold}% from $${alert.referencePrice.toFixed(2)}`
        : `+${alert.threshold}% (ref pending)`;
    case 'change_below':
      return alert.referencePrice
        ? `-${alert.threshold}% from $${alert.referencePrice.toFixed(2)}`
        : `-${alert.threshold}% (ref pending)`;
    case 'outside_range':
      return `outside $${alert.threshold.toFixed(2)}-$${(alert.threshold2 || 0).toFixed(2)}`;
    case 'crosses_above':
      return `crosses above $${alert.threshold.toFixed(2)}`;
    case 'crosses_below':
      return `crosses below $${alert.threshold.toFixed(2)}`;
    default:
      return `${alert.condition} $${alert.threshold.toFixed(2)}`;
  }
}

function getConditionBadgeClass(condition: PriceAlert['condition']): string {
  switch (condition) {
    case 'above':
    case 'crosses_above':
    case 'change_above':
      return 'alerts-condition-up';
    case 'below':
    case 'crosses_below':
    case 'change_below':
      return 'alerts-condition-down';
    case 'outside_range':
      return 'alerts-condition-range';
    default:
      return '';
  }
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
    className: `alerts-row-condition ${getConditionBadgeClass(alert.condition)}`,
    textContent: getConditionDisplayText(alert),
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
