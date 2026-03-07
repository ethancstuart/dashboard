import { createElement } from '../utils/dom.ts';
import { applyTheme, getTheme } from '../config/theme.ts';
import { setPreference, getPreferences } from '../config/preferences.ts';
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

export function showOnboarding(): Promise<void> {
  return new Promise((resolve) => {
    const state = getState();
    let currentStep = state.step;

    const overlay = createElement('div', { className: 'onboarding-overlay' });
    const container = createElement('div', { className: 'onboarding-container' });

    const steps = [
      buildWelcomeStep,
      buildStocksStep,
      buildSportsStep,
      buildPreferencesStep,
      buildReadyStep,
    ];

    const dots = createElement('div', { className: 'onboarding-dots' });

    function renderStep() {
      container.textContent = '';
      const stepEl = steps[currentStep]();
      container.appendChild(stepEl);

      // Update dots
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
        textContent: 'Your real-time intelligence dashboard. Weather, markets, news, sports, and more — all in one tab.',
      });

      const detectBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-primary', textContent: 'Detect My Location' });
      detectBtn.addEventListener('click', () => {
        if (!navigator.geolocation) { next(); return; }
        detectBtn.textContent = 'Detecting...';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = Math.round(pos.coords.latitude * 100) / 100;
            const lon = Math.round(pos.coords.longitude * 100) / 100;
            localStorage.setItem('dashview-location', JSON.stringify({ lat, lon }));
            next();
          },
          () => next(),
          { timeout: 5000 },
        );
      });

      const skipBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-ghost', textContent: 'Skip' });
      skipBtn.addEventListener('click', next);

      const btns = createElement('div', { className: 'onboarding-btns' });
      btns.appendChild(detectBtn);
      btns.appendChild(skipBtn);

      step.appendChild(title);
      step.appendChild(desc);
      step.appendChild(btns);
      return step;
    }

    function buildStocksStep(): HTMLElement {
      const step = createElement('div', { className: 'onboarding-step' });
      const title = createElement('div', { className: 'onboarding-title', textContent: 'Pick Your Stocks' });
      const desc = createElement('div', {
        className: 'onboarding-desc',
        textContent: 'Your watchlist starts with top tech stocks. You can customize it anytime from the Markets panel.',
      });

      const preview = createElement('div', { className: 'onboarding-preview' });
      const defaults = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
      for (const sym of defaults) {
        const tag = createElement('span', { className: 'onboarding-tag', textContent: sym });
        preview.appendChild(tag);
      }

      const nextBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-primary', textContent: 'Looks Good' });
      nextBtn.addEventListener('click', next);

      step.appendChild(title);
      step.appendChild(desc);
      step.appendChild(preview);
      step.appendChild(nextBtn);
      return step;
    }

    function buildSportsStep(): HTMLElement {
      const step = createElement('div', { className: 'onboarding-step' });
      const title = createElement('div', { className: 'onboarding-title', textContent: 'Follow Sports' });
      const desc = createElement('div', {
        className: 'onboarding-desc',
        textContent: 'Live scores from NBA, NFL, MLB, and EPL. Star your favorite teams in the Sports panel to see them first.',
      });

      const nextBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-primary', textContent: 'Got It' });
      nextBtn.addEventListener('click', next);

      step.appendChild(title);
      step.appendChild(desc);
      step.appendChild(nextBtn);
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
      for (const opt of [{ id: 'F' as const, label: '°F' }, { id: 'C' as const, label: '°C' }]) {
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

      // Time format picker
      const timeLabel = createElement('div', { className: 'onboarding-label', textContent: 'Time Format' });
      const timeRow = createElement('div', { className: 'onboarding-option-row' });
      for (const opt of [{ id: '12h' as const, label: '12-hour' }, { id: '24h' as const, label: '24-hour' }]) {
        const btn = createElement('button', {
          className: `onboarding-option ${prefs.timeFormat === opt.id ? 'onboarding-option-active' : ''}`,
          textContent: opt.label,
        });
        btn.addEventListener('click', () => {
          setPreference('timeFormat', opt.id);
          timeRow.querySelectorAll('.onboarding-option').forEach((b) => b.classList.remove('onboarding-option-active'));
          btn.classList.add('onboarding-option-active');
        });
        timeRow.appendChild(btn);
      }

      const nextBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-primary', textContent: 'Continue' });
      nextBtn.addEventListener('click', next);

      step.appendChild(title);
      step.appendChild(themeLabel);
      step.appendChild(themeRow);
      step.appendChild(tempLabel);
      step.appendChild(tempRow);
      step.appendChild(timeLabel);
      step.appendChild(timeRow);
      step.appendChild(nextBtn);
      return step;
    }

    function buildReadyStep(): HTMLElement {
      const step = createElement('div', { className: 'onboarding-step' });
      const title = createElement('div', { className: 'onboarding-title', textContent: "You're All Set!" });
      const desc = createElement('div', {
        className: 'onboarding-desc',
        textContent: 'Your dashboard is ready. Use the gear icon to adjust settings anytime, or press ? for keyboard shortcuts.',
      });

      const launchBtn = createElement('button', { className: 'onboarding-btn onboarding-btn-primary', textContent: 'Launch Dashboard' });
      launchBtn.addEventListener('click', finish);

      step.appendChild(title);
      step.appendChild(desc);
      step.appendChild(launchBtn);
      return step;
    }

    overlay.appendChild(container);
    overlay.appendChild(dots);
    document.body.appendChild(overlay);
    renderStep();
  });
}
