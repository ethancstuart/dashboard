import '../styles/briefs-dossier.css';
import { createElement } from '../utils/dom.ts';
import { pageShell } from '../ui/kit/index.ts';
import {
  loadInterests,
  saveInterests,
  summarizeInterests,
  REGIONS,
  THREATS,
  SECTORS,
  type RegionId,
  type ThreatId,
  type SectorId,
  type Frequency,
  type Interests,
} from '../services/interests.ts';
import { colors as dossierColors, fonts as dossierFonts } from '../styles/email-tokens.ts';

/**
 * Account Settings page — /#/settings (Track F.3).
 *
 * Where onboarded users go to edit their interests after the Track F.2
 * wizard. Second consumer of the Track F.1 interests service —
 * validates that the schema + load/save pipeline handle both
 * first-time and editing flows.
 *
 * Sections rendered top to bottom:
 *   1. Account header (avatar/name/tier/email)
 *   2. Interests editor (regions, threats, sectors) with pill-chip
 *      selectors matching the onboarding wizard visual language
 *   3. Delivery preferences (frequency, subscribed-email display)
 *   4. Current summary line + save button
 *   5. Sign out
 *
 * Light Intel Dossier aesthetic scoped via .briefs-dossier — reuses
 * the existing dossier CSS rather than introducing a new stylesheet.
 * Inline style overrides for interactive elements (chips, save
 * button, frequency picker) match the F.2 onboarding wizard so users
 * who went through onboarding land on a settings page that feels
 * familiar.
 */

interface DraftState {
  regions: Set<RegionId>;
  threats: Set<ThreatId>;
  sectors: Set<SectorId>;
  frequency: Frequency;
  dirty: boolean;
}

export function renderSettings(root: HTMLElement): void {
  const shellMain = pageShell(root, { active: '/settings' });

  document.title = 'Account Settings — NexusWatch';
  const descMeta = document.querySelector('meta[name="description"]');
  if (descMeta) {
    descMeta.setAttribute('content', 'Manage your NexusWatch interests, delivery preferences, and account.');
  }

  const current = loadInterests();
  const draft: DraftState = {
    regions: new Set(current.regions),
    threats: new Set(current.threats),
    sectors: new Set(current.sectors),
    frequency: current.frequency,
    dirty: false,
  };

  const page = createElement('div', { className: 'briefs-dossier' });
  page.innerHTML = `

    <main class="dossier-article" id="nw-settings-main" style="max-width: 680px;"></main>
  `;

  shellMain.appendChild(page);

  const main = page.querySelector<HTMLElement>('#nw-settings-main');
  if (main) {
    main.appendChild(renderAccountHeader());
    main.appendChild(renderDivider());
    main.appendChild(renderInterestsEditor(draft));
    main.appendChild(renderDivider());
    main.appendChild(renderDeliveryEditor(draft));
    main.appendChild(renderDivider());
    main.appendChild(renderFooterActions(draft, main));
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderAccountHeader(): HTMLElement {
  // No account concept. Sign-in was removed 2026-08-23: it gated nothing, and
  // its modal promised syncing that never existed. Preferences are honest about
  // where they live — this browser.
  const wrap = createElement('section', {});
  wrap.style.marginBottom = '24px';
  wrap.innerHTML = `
    <div class="dossier-kicker" style="text-align: left; margin-bottom: 8px;">SETTINGS</div>
    <h1 class="dossier-title" style="text-align: left; font-size: 32px; margin-bottom: 12px;">Preferences</h1>
    <p style="${leadStyle()}">Saved in this browser. The daily brief is a separate subscription — your email address, nothing else.</p>
  `;
  return wrap;
}

function renderInterestsEditor(draft: DraftState): HTMLElement {
  const wrap = createElement('section', {});
  wrap.style.marginBottom = '24px';

  wrap.innerHTML = `
    <div class="dossier-kicker" style="text-align: left; margin-bottom: 8px;">INTERESTS</div>
    <h2 style="font-family: ${dossierFonts.serif}; font-size: 22px; font-weight: 600; color: ${dossierColors.textPrimary}; margin: 0 0 8px 0;">What are you watching?</h2>
    <p style="${leadStyle()}">These drive your personalized Watchlist in the daily brief and filter which alerts we surface. You can change them any time.</p>

    <div style="margin: 20px 0;">
      <span style="${legendStyle()}">Regions</span>
      <div class="nw-settings-chips" data-group="region" style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${REGIONS.map((r) => chipButtonHtml('region', r.id, r.label, draft.regions.has(r.id))).join('')}
      </div>
    </div>

    <div style="margin: 20px 0;">
      <span style="${legendStyle()}">Threat categories</span>
      <div class="nw-settings-chips" data-group="threat" style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${THREATS.map((t) => chipButtonHtml('threat', t.id, t.label, draft.threats.has(t.id))).join('')}
      </div>
    </div>

    <div style="margin: 20px 0;">
      <span style="${legendStyle()}">Sectors (optional)</span>
      <div class="nw-settings-chips" data-group="sector" style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${SECTORS.map((s) => chipButtonHtml('sector', s.id, s.label, draft.sectors.has(s.id))).join('')}
      </div>
    </div>
  `;

  // Wire chip toggles.
  wrap.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      const id = btn.dataset.id;
      if (!group || !id) return;
      const target =
        group === 'region'
          ? (draft.regions as Set<string>)
          : group === 'threat'
            ? (draft.threats as Set<string>)
            : (draft.sectors as Set<string>);
      if (target.has(id)) {
        target.delete(id);
        btn.setAttribute('aria-pressed', 'false');
      } else {
        target.add(id);
        btn.setAttribute('aria-pressed', 'true');
      }
      btn.setAttribute('style', chipStyle(target.has(id)));
      draft.dirty = true;
      updateSaveButton(draft);
    });
  });

  return wrap;
}

function renderDeliveryEditor(draft: DraftState): HTMLElement {
  const wrap = createElement('section', {});
  wrap.style.marginBottom = '24px';

  const freqOption = (id: Frequency, label: string, description: string) => {
    const selected = draft.frequency === id;
    return `
      <button type="button" class="nw-settings-freq" data-freq="${id}" aria-pressed="${selected}" style="${freqOptionStyle(selected)}">
        <div style="font-family: ${dossierFonts.serif}; font-size: 18px; font-weight: 600; color: ${dossierColors.textPrimary}; margin-bottom: 4px;">${label}</div>
        <div style="font-family: ${dossierFonts.sans}; font-size: 13px; color: ${dossierColors.textSecondary};">${description}</div>
      </button>
    `;
  };

  wrap.innerHTML = `
    <div class="dossier-kicker" style="text-align: left; margin-bottom: 8px;">DELIVERY</div>
    <h2 style="font-family: ${dossierFonts.serif}; font-size: 22px; font-weight: 600; color: ${dossierColors.textPrimary}; margin: 0 0 8px 0;">How often should we send it?</h2>
    <p style="${leadStyle()}">Change the cadence any time. Takes effect with the next brief cycle.</p>
    <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 16px;">
      ${freqOption('daily', 'Daily', 'Every morning at 5 AM ET. Best for active watchers.')}
      ${freqOption('mwf', 'Monday / Wednesday / Friday', 'Three per week. A lighter cadence.')}
      ${freqOption('weekly', 'Weekly (Sunday)', 'Sunday Week-in-Review only. Maximum signal, minimum inbox.')}
    </div>
  `;

  wrap.querySelectorAll<HTMLButtonElement>('.nw-settings-freq').forEach((btn) => {
    btn.addEventListener('click', () => {
      const freq = btn.dataset.freq as Frequency | undefined;
      if (!freq) return;
      draft.frequency = freq;
      wrap.querySelectorAll<HTMLButtonElement>('.nw-settings-freq').forEach((b) => {
        const isSelected = b.dataset.freq === freq;
        b.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        b.setAttribute('style', freqOptionStyle(isSelected));
      });
      draft.dirty = true;
      updateSaveButton(draft);
    });
  });

  return wrap;
}

function renderFooterActions(draft: DraftState, scrollContainer: HTMLElement): HTMLElement {
  const wrap = createElement('section', {});
  wrap.style.marginBottom = '32px';

  wrap.innerHTML = `
    <div id="nw-settings-summary" style="${summaryStyle()}"></div>
    <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
      <button type="button" id="nw-settings-save" disabled style="${primaryButtonStyle(false)}">Saved</button>
      <div id="nw-settings-status" style="${statusStyle()}" role="status" aria-live="polite"></div>
      <div style="flex: 1;"></div>
    </div>
  `;

  // Initial summary render.
  refreshSummary(wrap);

  // Save button wiring.
  const saveBtn = wrap.querySelector<HTMLButtonElement>('#nw-settings-save');
  const statusEl = wrap.querySelector<HTMLElement>('#nw-settings-status');
  saveBtn?.addEventListener('click', () => {
    try {
      saveInterests({
        regions: Array.from(draft.regions),
        threats: Array.from(draft.threats),
        sectors: Array.from(draft.sectors),
        frequency: draft.frequency,
        onboarded: true,
      });
      draft.dirty = false;
      updateSaveButton(draft);
      refreshSummary(wrap);
      if (statusEl) {
        const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        statusEl.textContent = `\u2713 Saved at ${now}`;
        statusEl.style.color = dossierColors.up;
      }
      // Scroll to top so the confirmation is visible even if the user
      // was deep in the chip grid when they clicked save.
      scrollContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('[settings] save failed:', err);
      if (statusEl) {
        statusEl.textContent = 'Save failed — your preferences are still in this browser.';
        statusEl.style.color = dossierColors.down;
      }
    }
  });

  return wrap;
}

function renderDivider(): HTMLElement {
  const div = createElement('div', {});
  div.setAttribute('style', `height: 1px; background: ${dossierColors.border}; margin: 24px 0;`);
  return div;
}

// ---------------------------------------------------------------------------
// Dynamic updates
// ---------------------------------------------------------------------------

function updateSaveButton(draft: DraftState): void {
  const btn = document.querySelector<HTMLButtonElement>('#nw-settings-save');
  if (!btn) return;
  btn.disabled = !draft.dirty;
  btn.textContent = draft.dirty ? 'Save changes' : 'Saved';
  btn.setAttribute('style', primaryButtonStyle(draft.dirty));
}

function refreshSummary(scope: HTMLElement): void {
  const el = scope.querySelector<HTMLElement>('#nw-settings-summary');
  if (!el) return;
  const current = loadInterests();
  const summary = summarizeInterests(current);
  el.innerHTML = `
    <span style="font-family: ${dossierFonts.mono}; font-size: 10px; font-weight: 700; letter-spacing: 0.16em; color: ${dossierColors.accent}; text-transform: uppercase; margin-right: 8px;">Current</span>
    <span>${escapeHtml(summary)}</span>
  `;
}

// ---------------------------------------------------------------------------
// HTML + style helpers
// ---------------------------------------------------------------------------

function chipButtonHtml(group: 'region' | 'threat' | 'sector', id: string, label: string, selected: boolean): string {
  return `<button type="button" data-group="${group}" data-id="${id}" aria-pressed="${selected}" style="${chipStyle(selected)}">${escapeHtml(label)}</button>`;
}

function chipStyle(selected: boolean): string {
  return [
    `padding: 8px 14px`,
    `font-family: ${dossierFonts.sans}`,
    `font-size: 13px`,
    `font-weight: ${selected ? '600' : '400'}`,
    `color: ${selected ? dossierColors.textInverse : dossierColors.textPrimary}`,
    `background: ${selected ? dossierColors.accent : 'transparent'}`,
    `border: 1px solid ${selected ? dossierColors.accent : dossierColors.borderStrong}`,
    `border-radius: 2px`,
    `cursor: pointer`,
    `transition: background 0.15s, color 0.15s, border-color 0.15s`,
  ].join(';');
}

function freqOptionStyle(selected: boolean): string {
  return [
    `display: block`,
    `width: 100%`,
    `padding: 14px 18px`,
    `background: ${selected ? dossierColors.accentBgSoft : dossierColors.bgCard}`,
    `border: 1px solid ${selected ? dossierColors.accent : dossierColors.border}`,
    `border-left: ${selected ? `4px solid ${dossierColors.accent}` : `1px solid ${dossierColors.border}`}`,
    `border-radius: 2px`,
    `text-align: left`,
    `cursor: pointer`,
    `transition: all 0.15s`,
  ].join(';');
}

function primaryButtonStyle(enabled: boolean): string {
  return [
    `padding: 12px 24px`,
    `background: ${enabled ? dossierColors.accent : dossierColors.border}`,
    `color: ${enabled ? dossierColors.textInverse : dossierColors.textTertiary}`,
    `border: 1px solid ${enabled ? dossierColors.accent : dossierColors.border}`,
    `border-radius: 2px`,
    `font-family: ${dossierFonts.mono}`,
    `font-size: 11px`,
    `font-weight: 700`,
    `letter-spacing: 0.12em`,
    `text-transform: uppercase`,
    `cursor: ${enabled ? 'pointer' : 'default'}`,
  ].join(';');
}

function summaryStyle(): string {
  return [
    `margin-bottom: 16px`,
    `padding: 14px 18px`,
    `background: ${dossierColors.bgMuted}`,
    `border-left: 3px solid ${dossierColors.divider}`,
    `border-radius: 2px`,
    `font-family: ${dossierFonts.sans}`,
    `font-size: 14px`,
    `color: ${dossierColors.textPrimary}`,
    `line-height: 1.5`,
  ].join(';');
}

function statusStyle(): string {
  return [
    `font-family: ${dossierFonts.sans}`,
    `font-size: 13px`,
    `color: ${dossierColors.textSecondary}`,
    `min-height: 18px`,
  ].join(';');
}

function legendStyle(): string {
  return [
    `display: block`,
    `font-family: ${dossierFonts.mono}`,
    `font-size: 10px`,
    `font-weight: 700`,
    `letter-spacing: 0.16em`,
    `color: ${dossierColors.textTertiary}`,
    `text-transform: uppercase`,
    `margin-bottom: 10px`,
  ].join(';');
}

function leadStyle(): string {
  return [
    `font-family: ${dossierFonts.sans}`,
    `font-size: 16px`,
    `line-height: 1.55`,
    `color: ${dossierColors.textSecondary}`,
    `margin: 0 0 8px 0`,
  ].join(';');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] || c;
  });
}

// Silence unused-import warnings for types we need purely for intellisense
// in the wired draftstate. Not referenced at runtime.
export type { Interests };
