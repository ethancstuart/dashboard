import { createElement } from '../utils/dom.ts';
import { shareConfig, importSharedConfig, applySharedConfig } from '../services/configSync.ts';
import { pushModal, popModal } from './modalManager.ts';

let overlay: HTMLElement | null = null;

export function openShareModal(): void {
  closeShareModal();

  overlay = createElement('div', { className: 'share-modal-overlay' });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeShareModal();
  });

  const dialog = createElement('div', { className: 'feeds-modal' });
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Share Dashboard');

  // Header
  const header = createElement('div', { className: 'feeds-modal-header' });
  const title = createElement('div', { className: 'feeds-modal-title', textContent: 'Share Dashboard' });
  const closeBtn = createElement('button', { className: 'briefing-close', textContent: '\u00D7' });
  closeBtn.addEventListener('click', closeShareModal);
  header.appendChild(title);
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  // Body
  const body = createElement('div', { className: 'feeds-modal-body' });

  const description = createElement('div', {
    className: 'feeds-validation-result',
    textContent: 'Generate a shareable link for your dashboard configuration. Recipients can import your theme, panel settings, and custom feeds.',
  });
  body.appendChild(description);

  const statusEl = createElement('div', { className: 'feeds-status' });
  body.appendChild(statusEl);

  const shareBtn = createElement('button', { className: 'feeds-validate-btn', textContent: 'Generate Share Link' });
  body.appendChild(shareBtn);

  const resultContainer = createElement('div', { className: 'feeds-active-list' });
  resultContainer.style.marginTop = '12px';
  body.appendChild(resultContainer);

  shareBtn.addEventListener('click', async () => {
    shareBtn.setAttribute('disabled', '');
    shareBtn.textContent = 'Generating...';
    statusEl.textContent = '';
    resultContainer.textContent = '';

    try {
      const result = await shareConfig();
      const shareUrl = `${window.location.origin}/#/import/${result.code}`;
      const expiryDate = new Date(result.expiresAt).toLocaleDateString();

      const urlRow = createElement('div', { className: 'feeds-custom-row' });
      const urlDisplay = document.createElement('input');
      urlDisplay.type = 'text';
      urlDisplay.className = 'feeds-custom-input';
      urlDisplay.value = shareUrl;
      urlDisplay.readOnly = true;

      const copyBtn = createElement('button', { className: 'feeds-add-btn', textContent: 'Copy Link' });
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(shareUrl);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
        } catch {
          urlDisplay.select();
        }
      });

      urlRow.appendChild(urlDisplay);
      urlRow.appendChild(copyBtn);
      resultContainer.appendChild(urlRow);

      const codeRow = createElement('div', { className: 'feeds-active-item' });
      const codeLabel = createElement('span', { className: 'feeds-active-name', textContent: `Code: ${result.code}` });
      const expiryLabel = createElement('span', { className: 'feeds-active-url', textContent: `Expires: ${expiryDate}` });
      codeRow.appendChild(codeLabel);
      codeRow.appendChild(expiryLabel);
      resultContainer.appendChild(codeRow);

      statusEl.textContent = 'Share link generated successfully.';
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : 'Failed to generate share link';
    } finally {
      shareBtn.removeAttribute('disabled');
      shareBtn.textContent = 'Generate Share Link';
    }
  });

  // Import section
  const importTitle = createElement('div', { className: 'feeds-section-title', textContent: 'Import from Code' });
  body.appendChild(importTitle);

  const importRow = createElement('div', { className: 'feeds-custom-row' });
  const codeInput = document.createElement('input');
  codeInput.type = 'text';
  codeInput.className = 'feeds-custom-input';
  codeInput.placeholder = 'Enter 8-character code';
  codeInput.maxLength = 8;
  codeInput.style.textTransform = 'uppercase';
  codeInput.setAttribute('autocomplete', 'off');

  const importBtn = createElement('button', { className: 'feeds-validate-btn', textContent: 'Import' });
  importRow.appendChild(codeInput);
  importRow.appendChild(importBtn);
  body.appendChild(importRow);

  const importStatus = createElement('div', { className: 'feeds-status' });
  body.appendChild(importStatus);

  const previewContainer = createElement('div', { className: 'feeds-active-list' });
  previewContainer.style.marginTop = '8px';
  body.appendChild(previewContainer);

  importBtn.addEventListener('click', async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code || code.length !== 8) {
      importStatus.textContent = 'Please enter a valid 8-character code.';
      return;
    }

    importBtn.setAttribute('disabled', '');
    importBtn.textContent = 'Loading...';
    importStatus.textContent = '';
    previewContainer.textContent = '';

    try {
      const result = await importSharedConfig(code);
      if (!result.success || !result.preview) {
        importStatus.textContent = result.message;
        return;
      }

      // Show preview
      const previewData = result.preview;
      const keys = Object.keys(previewData).filter(k => k.startsWith('dashview'));
      const themeKey = previewData['dashview:theme'];
      const customFeeds = previewData['dashview-custom-feeds'];
      const feedCount = Array.isArray(customFeeds) ? customFeeds.length : 0;

      const previewTitle = createElement('div', { className: 'feeds-section-title', textContent: 'Preview' });
      previewContainer.appendChild(previewTitle);

      const summaryItems = [
        `${keys.length} settings`,
        themeKey ? `Theme: ${themeKey}` : null,
        feedCount > 0 ? `${feedCount} custom feeds` : null,
      ].filter(Boolean);

      for (const item of summaryItems) {
        const row = createElement('div', { className: 'feeds-active-item' });
        const label = createElement('span', { className: 'feeds-active-name', textContent: item as string });
        row.appendChild(label);
        previewContainer.appendChild(row);
      }

      const applyRow = createElement('div', { className: 'feeds-custom-row' });
      applyRow.style.marginTop = '8px';

      const applyBtn = createElement('button', { className: 'feeds-add-btn', textContent: 'Apply Configuration' });
      const cancelBtn = createElement('button', { className: 'feeds-validate-btn', textContent: 'Cancel' });
      cancelBtn.style.background = 'rgba(255, 255, 255, 0.1)';

      applyBtn.addEventListener('click', () => {
        const applyResult = applySharedConfig(previewData);
        importStatus.textContent = applyResult.message;
        previewContainer.textContent = '';
      });

      cancelBtn.addEventListener('click', () => {
        previewContainer.textContent = '';
        importStatus.textContent = 'Import cancelled.';
      });

      applyRow.appendChild(applyBtn);
      applyRow.appendChild(cancelBtn);
      previewContainer.appendChild(applyRow);
    } catch (err) {
      importStatus.textContent = err instanceof Error ? err.message : 'Failed to import';
    } finally {
      importBtn.removeAttribute('disabled');
      importBtn.textContent = 'Import';
    }
  });

  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  pushModal(closeShareModal);
}

export function openImportModal(code: string): void {
  openShareModal();

  // Auto-fill the code and trigger import
  requestAnimationFrame(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>('.feeds-custom-input');
    // The import code input is the one with maxLength 8
    for (const input of inputs) {
      if (input.maxLength === 8) {
        input.value = code;
        // Find the adjacent import button and click it
        const row = input.parentElement;
        if (row) {
          const btn = row.querySelector<HTMLButtonElement>('.feeds-validate-btn');
          if (btn) btn.click();
        }
        break;
      }
    }
  });
}

function closeShareModal(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
    popModal();
  }
}
