/**
 * Free Tier Tooltip Tour
 *
 * Lightweight 3-step tooltip for first-time anonymous visitors on the intel map.
 * Shows what they're looking at: globe, CII scores, data layers.
 *
 * NOT the full onboarding wizard (that's onboardingOverlay.ts for logged-in users).
 * This is simpler, faster, and doesn't ask for email.
 */

import { getUser } from '../services/auth.ts';

const STORAGE_KEY = 'nw:free-tour-done';

interface TourStep {
  target: string;
  text: string;
  position: 'bottom' | 'left' | 'right' | 'top';
}

const STEPS: TourStep[] = [
  {
    target: '.maplibregl-canvas-container',
    text: "You're looking at a live 3D globe with real-time geopolitical data. Drag to rotate, scroll to zoom. Every data point is sourced and timestamped.",
    position: 'bottom',
  },
  {
    target: '.nw-country-panel, .nw-cii-panel, [class*="country-panel"], [class*="cii"]',
    text: 'Country Instability Index — a 0-100 risk score for 85 nations. Built from conflict data, disaster feeds, sentiment, infrastructure, governance, and market exposure. Click any country for the full breakdown.',
    position: 'left',
  },
  {
    target: '.nw-layer-panel, [class*="layer-panel"], [class*="LayerPanel"]',
    text: '35+ live data layers: earthquakes, wildfires, ship tracking, conflict zones, sanctions, dark vessels, and more. Toggle them on the right panel.',
    position: 'left',
  },
];

export function showFreeTierTour(container: HTMLElement): void {
  // Skip if user is logged in (they get the full onboarding wizard)
  if (getUser()) return;

  // Skip if already completed
  try {
    if (localStorage.getItem(STORAGE_KEY)) return;
  } catch {
    return;
  }

  // Wait for map to actually render before showing tour
  waitForMapReady(container).then(() => renderTour(container));
}

function waitForMapReady(container: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    // Check if map canvas already exists
    if (container.querySelector('.maplibregl-canvas-container')) {
      // Small delay for layers to populate
      requestAnimationFrame(() => setTimeout(resolve, 500));
      return;
    }

    // Use MutationObserver to wait for map canvas to appear
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) {
            if (
              node.classList?.contains('maplibregl-canvas-container') ||
              node.querySelector?.('.maplibregl-canvas-container')
            ) {
              observer.disconnect();
              requestAnimationFrame(() => setTimeout(resolve, 500));
              return;
            }
          }
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    // Safety timeout — if map never loads, show tour anyway after 10s
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 10_000);
  });
}

function renderTour(container: HTMLElement): void {
  let currentStep = 0;

  const overlay = document.createElement('div');
  overlay.className = 'nw-tour-overlay';
  const tooltip = document.createElement('div');
  tooltip.className = 'nw-tour-tooltip';
  overlay.appendChild(tooltip);
  container.appendChild(overlay);

  function show(index: number): void {
    const step = STEPS[index];
    if (!step) return dismiss();

    // Find target element — try each selector (comma-separated fallbacks)
    const selectors = step.target.split(',').map((s) => s.trim());
    let targetEl: Element | null = null;
    for (const sel of selectors) {
      targetEl = document.querySelector(sel);
      if (targetEl) break;
    }

    // Build tooltip content
    const total = STEPS.length;
    tooltip.innerHTML = `
      <div class="nw-tour-step">${index + 1} of ${total}</div>
      <div class="nw-tour-text">${step.text}</div>
      <div class="nw-tour-actions">
        <button class="nw-tour-skip">Skip</button>
        <button class="nw-tour-next">${index === total - 1 ? 'Got it' : 'Next'}</button>
      </div>
    `;

    // Position tooltip
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const tt = tooltip;
      tt.style.position = 'fixed';

      if (step.position === 'bottom') {
        tt.style.top = `${Math.min(rect.bottom + 12, window.innerHeight - 200)}px`;
        tt.style.left = `${Math.max(16, rect.left + rect.width / 2 - 160)}px`;
      } else if (step.position === 'left') {
        tt.style.top = `${Math.max(16, rect.top + rect.height / 2 - 60)}px`;
        tt.style.left = `${Math.max(16, rect.left - 340)}px`;
      } else if (step.position === 'right') {
        tt.style.top = `${Math.max(16, rect.top + rect.height / 2 - 60)}px`;
        tt.style.left = `${Math.min(rect.right + 12, window.innerWidth - 340)}px`;
      } else {
        tt.style.top = `${Math.max(16, rect.top - 140)}px`;
        tt.style.left = `${Math.max(16, rect.left + rect.width / 2 - 160)}px`;
      }
    } else {
      // Fallback: center
      tooltip.style.position = 'fixed';
      tooltip.style.top = '50%';
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
    }

    // Wire buttons
    tooltip.querySelector('.nw-tour-next')?.addEventListener('click', () => {
      currentStep++;
      if (currentStep >= STEPS.length) dismiss();
      else show(currentStep);
    });
    tooltip.querySelector('.nw-tour-skip')?.addEventListener('click', dismiss);
  }

  function dismiss(): void {
    overlay.remove();
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  // Escape key dismisses
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      dismiss();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  // Inject styles once
  if (!document.getElementById('nw-tour-styles')) {
    const style = document.createElement('style');
    style.id = 'nw-tour-styles';
    style.textContent = `
      .nw-tour-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(0, 0, 0, 0.4);
        pointer-events: none;
      }
      .nw-tour-tooltip {
        pointer-events: auto;
        background: #111;
        border: 1px solid #ff6600;
        border-radius: 6px;
        padding: 16px 20px;
        max-width: 320px;
        font-family: 'JetBrains Mono', monospace;
        color: #e0e0e0;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      }
      .nw-tour-step {
        font-size: 10px;
        letter-spacing: 0.15em;
        color: #ff6600;
        text-transform: uppercase;
        margin-bottom: 8px;
        font-weight: 600;
      }
      .nw-tour-text {
        font-size: 12px;
        line-height: 1.5;
        color: #ccc;
        margin-bottom: 14px;
      }
      .nw-tour-actions {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .nw-tour-skip {
        background: none;
        border: none;
        color: #666;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
        padding: 4px 8px;
      }
      .nw-tour-skip:hover { color: #999; }
      .nw-tour-next {
        background: #ff6600;
        color: #000;
        border: none;
        padding: 6px 16px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        border-radius: 3px;
        cursor: pointer;
        font-family: inherit;
      }
      .nw-tour-next:hover { background: #ff8533; }
      @media (max-width: 768px) {
        .nw-tour-tooltip {
          max-width: calc(100vw - 32px);
          left: 16px !important;
          right: 16px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  show(0);
}
