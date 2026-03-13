import { createElement } from '../utils/dom.ts';
import { applyTheme, getTheme } from '../config/theme.ts';
import { setPreference, getPreferences } from '../config/preferences.ts';
import { createSpace, getSpaces, saveSpaces } from '../services/spaces.ts';
import { interpretQuery } from '../services/aiShell.ts';
import type { ThemeName } from '../config/themes.ts';

const STORAGE_KEY = 'dashview:onboarding';

interface OnboardingState {
  completed: boolean;
  step: number;
}

function getState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { completed: false, step: 0 };
}

function setState(state: OnboardingState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function isOnboardingComplete(): boolean {
  return getState().completed;
}

export function resetOnboarding(): void {
  localStorage.removeItem(STORAGE_KEY);
}

const INTEREST_OPTIONS = [
  { id: 'markets', label: 'Markets & Stocks', icon: '\u{1F4C8}' },
  { id: 'crypto', label: 'Crypto', icon: '\u{1FA99}' },
  { id: 'news', label: 'World News', icon: '\u{1F30D}' },
  { id: 'sports', label: 'Sports', icon: '\u{26BD}' },
  { id: 'entertainment', label: 'Entertainment', icon: '\u{1F3AC}' },
  { id: 'weather', label: 'Weather', icon: '\u{2600}\u{FE0F}' },
  { id: 'productivity', label: 'Productivity', icon: '\u{1F4DD}' },
];

function configureSpacesFromInterests(selected: Set<string>): void {
  // Build personalized default spaces based on selected interests
  const spaces = getSpaces();

  // Always keep Overview — customize its widgets based on interests
  const overview = spaces.find((s) => s.id === 'overview');
  if (overview) {
    const widgets: { panelId: string; size: 'compact' | 'medium' | 'large'; colSpan: number; position: number }[] = [];
    let pos = 0;

    // Always include weather
    widgets.push({ panelId: 'weather', size: 'medium', colSpan: 4, position: pos++ });

    if (selected.has('markets')) {
      widgets.push({ panelId: 'stocks', size: 'medium', colSpan: 4, position: pos++ });
    }
    if (selected.has('crypto')) {
      widgets.push({ panelId: 'crypto', size: 'medium', colSpan: 4, position: pos++ });
    }
    if (selected.has('news')) {
      widgets.push({ panelId: 'news', size: 'medium', colSpan: 6, position: pos++ });
    }
    if (selected.has('sports')) {
      widgets.push({ panelId: 'sports', size: 'compact', colSpan: 3, position: pos++ });
    }
    if (selected.has('entertainment')) {
      widgets.push({ panelId: 'entertainment', size: 'compact', colSpan: 3, position: pos++ });
    }
    if (selected.has('productivity')) {
      widgets.push({ panelId: 'notes', size: 'medium', colSpan: 6, position: pos++ });
    }

    // If nothing selected, give them a sensible default
    if (widgets.length === 1) {
      widgets.push({ panelId: 'stocks', size: 'medium', colSpan: 4, position: pos++ });
      widgets.push({ panelId: 'crypto', size: 'medium', colSpan: 4, position: pos++ });
      widgets.push({ panelId: 'news', size: 'medium', colSpan: 6, position: pos++ });
      widgets.push({ panelId: 'sports', size: 'compact', colSpan: 3, position: pos++ });
      widgets.push({ panelId: 'entertainment', size: 'compact', colSpan: 3, position: pos++ });
    }

    overview.widgets = widgets;
  }

  // Create a focused space if markets + crypto both selected
  if (selected.has('markets') && selected.has('crypto')) {
    const hasMarkets = spaces.some((s) => s.id === 'markets');
    if (!hasMarkets) {
      createSpace('Markets', '\u{1F4C8}', [
        { panelId: 'stocks', size: 'large', colSpan: 6, position: 0 },
        { panelId: 'crypto', size: 'large', colSpan: 6, position: 1 },
        { panelId: 'news', size: 'large', colSpan: 12, position: 2 },
      ]);
    }
  }

  // Create sports+entertainment space if both selected
  if (selected.has('sports') && selected.has('entertainment')) {
    const hasWorld = spaces.some((s) => s.id === 'world');
    if (!hasWorld) {
      createSpace('World', '\u{1F30D}', [
        { panelId: 'news', size: 'large', colSpan: 8, position: 0 },
        { panelId: 'weather', size: 'medium', colSpan: 4, position: 1 },
        { panelId: 'sports', size: 'medium', colSpan: 6, position: 2 },
        { panelId: 'entertainment', size: 'medium', colSpan: 6, position: 3 },
      ]);
    }
  }

  saveSpaces(spaces);
}

export function showOnboarding(): Promise<void> {
  return new Promise((resolve) => {
    const state = getState();
    let currentStep = state.step;
    const selectedInterests = new Set<string>();

    const overlay = createElement('div', { className: 'onboarding-overlay' });
    const container = createElement('div', { className: 'onboarding-container' });

    const steps = [
      buildWelcomeStep,
      buildInterestsStep,
      buildPreferencesStep,
      buildReadyStep,
    ];

    const dots = createElement('div', { className: 'onboarding-dots' });

    function renderStep() {
      container.textContent = '';
      const stepEl = steps[currentStep]();
      container.appendChild(stepEl);

      dots.textContent = '';
      for (let i = 0; i < steps.length; i++) {
        const dot = createElement('div', {
          className: `onboarding-dot ${i === currentStep ? 'onboarding-dot-active' : ''}`,
        });
        dots.appendChild(dot);
      }

      setState({ completed: false, step: currentStep });
    }

    function next() {
      if (currentStep < steps.length - 1) {
        currentStep++;
        renderStep();
      }
    }

    function finish() {
      // Configure spaces based on selected interests
      configureSpacesFromInterests(selectedInterests);

      setState({ completed: true, step: steps.length - 1 });
      overlay.classList.add('onboarding-exit');
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 400);
    }

    function buildWelcomeStep(): HTMLElement {
      const step = createElement('div', { className: 'onboarding-step' });
      const title = createElement('div', { className: 'onboarding-title', textContent: 'Welcome to DashPulse' });
      const desc = createElement('div', {
        className: 'onboarding-desc',
        textContent: 'Your personal intelligence terminal. Let\u2019s set things up.',
      });

      // AI prompt area
      const aiPrompt = createElement('div', { className: 'onboarding-ai-prompt' });
      const aiLabel = createElement('div', {
        className: 'onboarding-ai-label',
        textContent: '> What do you care about most?',
      });
      const aiHint = createElement('div', {
        className: 'onboarding-ai-hint',
        textContent: 'Tell us in your own words, or pick from the next screen.',
      });
      aiPrompt.appendChild(aiLabel);
      aiPrompt.appendChild(aiHint);

      const aiInput = createElement('input', { className: 'onboarding-ai-input' }) as HTMLInputElement;
      aiInput.type = 'text';
      aiInput.placeholder = 'e.g. "markets and crypto" or "sports and weather"';
      aiInput.spellcheck = false;

      const aiResult = createElement('div', { className: 'onboarding-ai-result' });

      const btns = createElement('div', { className: 'onboarding-btns' });
      const askBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-primary', textContent: 'Ask AI' });
      const skipBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-ghost', textContent: 'Pick Manually' });

      askBtn.addEventListener('click', async () => {
        const query = aiInput.value.trim();
        if (!query) { next(); return; }

        askBtn.textContent = 'Thinking...';
        askBtn.setAttribute('disabled', '');

        try {
          const result = await interpretQuery(
            `The user just signed up for DashPulse. They said their interests are: "${query}". Based on this, suggest which panels to prioritize. Respond with an answer action describing what you set up.`,
          );

          // Parse interests from input
          const lower = query.toLowerCase();
          if (lower.includes('market') || lower.includes('stock')) selectedInterests.add('markets');
          if (lower.includes('crypto') || lower.includes('bitcoin')) selectedInterests.add('crypto');
          if (lower.includes('news') || lower.includes('world')) selectedInterests.add('news');
          if (lower.includes('sport')) selectedInterests.add('sports');
          if (lower.includes('entertain') || lower.includes('movie') || lower.includes('tv')) selectedInterests.add('entertainment');
          if (lower.includes('weather')) selectedInterests.add('weather');
          if (lower.includes('product') || lower.includes('note') || lower.includes('focus')) selectedInterests.add('productivity');

          // Show AI response
          aiResult.textContent = result.message;
          aiResult.style.display = 'block';

          askBtn.textContent = 'Continue';
          askBtn.removeAttribute('disabled');
          askBtn.onclick = () => {
            // Skip interests step since AI handled it
            currentStep = 2;
            renderStep();
          };
        } catch {
          askBtn.textContent = 'Ask AI';
          askBtn.removeAttribute('disabled');
          next();
        }
      });

      skipBtn.addEventListener('click', next);

      btns.appendChild(askBtn);
      btns.appendChild(skipBtn);

      step.appendChild(title);
      step.appendChild(desc);
      step.appendChild(aiPrompt);
      step.appendChild(aiInput);
      step.appendChild(aiResult);
      step.appendChild(btns);
      return step;
    }

    function buildInterestsStep(): HTMLElement {
      const step = createElement('div', { className: 'onboarding-step' });
      const title = createElement('div', { className: 'onboarding-title', textContent: 'Pick Your Interests' });
      const desc = createElement('div', {
        className: 'onboarding-desc',
        textContent: 'We\u2019ll customize your spaces and widgets based on what you care about.',
      });

      const grid = createElement('div', { className: 'onboarding-interests-grid' });
      for (const opt of INTEREST_OPTIONS) {
        const pill = createElement('button', {
          className: `onboarding-interest-pill ${selectedInterests.has(opt.id) ? 'active' : ''}`,
        });
        const icon = createElement('span', { textContent: opt.icon });
        const label = createElement('span', { textContent: opt.label });
        pill.appendChild(icon);
        pill.appendChild(label);

        pill.addEventListener('click', () => {
          if (selectedInterests.has(opt.id)) {
            selectedInterests.delete(opt.id);
            pill.classList.remove('active');
          } else {
            selectedInterests.add(opt.id);
            pill.classList.add('active');
          }
        });

        grid.appendChild(pill);
      }

      const nextBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-primary', textContent: 'Continue' });
      nextBtn.addEventListener('click', next);

      // Location detect
      const detectBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-ghost', textContent: 'Detect Location' });
      detectBtn.addEventListener('click', () => {
        if (!navigator.geolocation) return;
        detectBtn.textContent = 'Detecting...';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = Math.round(pos.coords.latitude * 100) / 100;
            const lon = Math.round(pos.coords.longitude * 100) / 100;
            localStorage.setItem('dashview-location', JSON.stringify({ lat, lon }));
            document.dispatchEvent(new CustomEvent('dashview:storage-changed', { detail: { key: 'dashview-location', action: 'set' } }));
            detectBtn.textContent = 'Location Set';
            selectedInterests.add('weather');
            const weatherPill = grid.querySelector('.onboarding-interest-pill:nth-child(6)');
            if (weatherPill) weatherPill.classList.add('active');
          },
          () => { detectBtn.textContent = 'Detect Location'; },
          { timeout: 5000 },
        );
      });

      const btns = createElement('div', { className: 'onboarding-btns' });
      btns.appendChild(nextBtn);
      btns.appendChild(detectBtn);

      step.appendChild(title);
      step.appendChild(desc);
      step.appendChild(grid);
      step.appendChild(btns);
      return step;
    }

    function buildPreferencesStep(): HTMLElement {
      const step = createElement('div', { className: 'onboarding-step' });
      const title = createElement('div', { className: 'onboarding-title', textContent: 'Quick Preferences' });

      // Theme picker
      const themeLabel = createElement('div', { className: 'onboarding-label', textContent: 'Theme' });
      const themeRow = createElement('div', { className: 'onboarding-option-row' });
      const themeOpts: { id: ThemeName; label: string }[] = [
        { id: 'dark', label: 'Dark' },
        { id: 'light', label: 'Light' },
        { id: 'oled', label: 'OLED' },
      ];
      for (const opt of themeOpts) {
        const btn = createElement('button', {
          className: `onboarding-option ${getTheme() === opt.id ? 'onboarding-option-active' : ''}`,
          textContent: opt.label,
        });
        btn.addEventListener('click', () => {
          applyTheme(opt.id);
          themeRow.querySelectorAll('.onboarding-option').forEach((b) => b.classList.remove('onboarding-option-active'));
          btn.classList.add('onboarding-option-active');
        });
        themeRow.appendChild(btn);
      }

      // Temp unit picker
      const tempLabel = createElement('div', { className: 'onboarding-label', textContent: 'Temperature' });
      const tempRow = createElement('div', { className: 'onboarding-option-row' });
      const prefs = getPreferences();
      for (const opt of [{ id: 'F' as const, label: '\u00B0F' }, { id: 'C' as const, label: '\u00B0C' }]) {
        const btn = createElement('button', {
          className: `onboarding-option ${prefs.tempUnit === opt.id ? 'onboarding-option-active' : ''}`,
          textContent: opt.label,
        });
        btn.addEventListener('click', () => {
          setPreference('tempUnit', opt.id);
          tempRow.querySelectorAll('.onboarding-option').forEach((b) => b.classList.remove('onboarding-option-active'));
          btn.classList.add('onboarding-option-active');
        });
        tempRow.appendChild(btn);
      }

      const nextBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-primary', textContent: 'Continue' });
      nextBtn.addEventListener('click', next);

      step.appendChild(title);
      step.appendChild(themeLabel);
      step.appendChild(themeRow);
      step.appendChild(tempLabel);
      step.appendChild(tempRow);
      step.appendChild(nextBtn);
      return step;
    }

    function buildReadyStep(): HTMLElement {
      const step = createElement('div', { className: 'onboarding-step' });
      const title = createElement('div', { className: 'onboarding-title', textContent: 'You\u2019re All Set' });

      const summary = createElement('div', { className: 'onboarding-desc' });
      const count = selectedInterests.size;
      summary.textContent = count > 0
        ? `Your dashboard is configured with ${count} interest${count > 1 ? 's' : ''}. Use the AI bar to adjust anything \u2014 just type what you want.`
        : 'Your dashboard is ready with default spaces. Use the AI bar or press Cmd+K to customize.';

      const hint = createElement('div', { className: 'onboarding-ai-hint' });
      hint.textContent = 'Tip: Press ? for keyboard shortcuts';

      const launchBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-primary', textContent: 'Launch Terminal' });
      launchBtn.addEventListener('click', finish);

      step.appendChild(title);
      step.appendChild(summary);
      step.appendChild(hint);
      step.appendChild(launchBtn);
      return step;
    }

    overlay.appendChild(container);
    overlay.appendChild(dots);
    document.body.appendChild(overlay);
    renderStep();
  });
}
