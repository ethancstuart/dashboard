import { createElement } from '../utils/dom.ts';
import { getUser, login, logout, onAuthChange } from '../services/auth.ts';
import type { App } from '../App.ts';

export interface AIBarCallbacks {
  onCommand: (command: string) => void;
  onAIQuery: (query: string) => void;
}

interface CommandEntry {
  id: string;
  title: string;
  keywords: string;
  action: () => void;
}

let commandRegistry: CommandEntry[] = [];

export function registerCommands(commands: CommandEntry[]): void {
  commandRegistry = commands;
}

export function createAIBar(_app: App, callbacks: AIBarCallbacks): HTMLElement {
  const bar = createElement('header', { className: 'ai-bar' });
  bar.setAttribute('role', 'banner');

  // Input wrapper
  const inputWrap = createElement('div', { className: 'ai-bar-input-wrap' });
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ai-bar-input';
  input.placeholder = 'Ask anything or type / for commands...';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  const kbd = createElement('span', { className: 'ai-bar-kbd', textContent: '\u2318K' });
  inputWrap.appendChild(input);
  inputWrap.appendChild(kbd);

  // Autocomplete dropdown
  let autocompleteEl: HTMLElement | null = null;
  let selectedIdx = 0;
  let filteredCommands: CommandEntry[] = [];

  function showAutocomplete(commands: CommandEntry[]) {
    hideAutocomplete();
    if (commands.length === 0) return;
    filteredCommands = commands;
    selectedIdx = 0;
    autocompleteEl = createElement('div', { className: 'ai-bar-autocomplete' });
    for (let i = 0; i < commands.length; i++) {
      const item = createElement('div', {
        className: `ai-bar-autocomplete-item${i === 0 ? ' ai-bar-autocomplete-item-active' : ''}`,
        textContent: commands[i].title,
      });
      item.addEventListener('click', () => {
        hideAutocomplete();
        input.value = '';
        commands[i].action();
      });
      item.addEventListener('mouseenter', () => {
        selectedIdx = i;
        updateAutocompleteSelection();
      });
      autocompleteEl.appendChild(item);
    }
    inputWrap.appendChild(autocompleteEl);
  }

  function hideAutocomplete() {
    if (autocompleteEl) {
      autocompleteEl.remove();
      autocompleteEl = null;
    }
    filteredCommands = [];
  }

  function updateAutocompleteSelection() {
    if (!autocompleteEl) return;
    const items = autocompleteEl.querySelectorAll('.ai-bar-autocomplete-item');
    items.forEach((el, i) => {
      el.classList.toggle('ai-bar-autocomplete-item-active', i === selectedIdx);
    });
  }

  input.addEventListener('input', () => {
    const val = input.value;
    if (val.startsWith('/')) {
      const query = val.slice(1).toLowerCase().trim();
      const matches = commandRegistry.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.keywords.toLowerCase().includes(query),
      );
      showAutocomplete(matches.slice(0, 10));
    } else {
      hideAutocomplete();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideAutocomplete();
      input.blur();
      input.value = '';
      return;
    }

    if (autocompleteEl) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIdx = Math.min(selectedIdx + 1, filteredCommands.length - 1);
        updateAutocompleteSelection();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIdx = Math.max(selectedIdx - 1, 0);
        updateAutocompleteSelection();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIdx]) {
          hideAutocomplete();
          const cmd = filteredCommands[selectedIdx];
          input.value = '';
          cmd.action();
        }
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;

      if (val.startsWith('/')) {
        callbacks.onCommand(val);
      } else {
        callbacks.onAIQuery(val);
      }
      input.value = '';
      hideAutocomplete();
    }
  });

  // Cmd+K focus
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      input.focus();
      if (!input.value) {
        input.value = '/';
        input.dispatchEvent(new Event('input'));
      }
    }
  });

  bar.appendChild(inputWrap);

  // Status pills
  const pills = createElement('div', { className: 'ai-bar-pills' });
  const weatherPill = createElement('span', { className: 'ai-bar-pill' });
  weatherPill.id = 'ai-bar-weather';
  pills.appendChild(weatherPill);
  bar.appendChild(pills);

  // Update pills from panel data
  document.addEventListener('dashview:panel-data', (e) => {
    const detail = (e as CustomEvent).detail;
    if (detail.panelId === 'weather' && detail.data?.current) {
      const w = detail.data.current;
      weatherPill.textContent = `${w.icon || '\u2600\uFE0F'} ${Math.round(w.temp)}\u00B0`;
    }
  });

  // Controls (settings + auth)
  const controls = createElement('div', { className: 'ai-bar-controls' });

  // Settings gear
  const gearBtn = createElement('button', { className: 'ai-bar-btn', textContent: '\u2699\uFE0F' });
  gearBtn.setAttribute('aria-label', 'Settings');
  gearBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('dashview:open-settings'));
  });
  controls.appendChild(gearBtn);

  // Auth
  const authWrap = createElement('div', { className: 'ai-bar-auth' });
  function updateAuth() {
    authWrap.textContent = '';
    const user = getUser();
    if (user) {
      if (user.avatar && /^https:\/\/(lh3\.googleusercontent\.com|avatars\.githubusercontent\.com)\//i.test(user.avatar)) {
        const img = document.createElement('img');
        img.src = user.avatar;
        img.alt = user.name;
        img.className = 'ai-bar-avatar';
        img.width = 24;
        img.height = 24;
        img.onerror = () => { img.style.display = 'none'; };
        img.addEventListener('click', () => logout());
        img.title = `${user.name} — click to sign out`;
        authWrap.appendChild(img);
      }
    } else {
      const signIn = createElement('button', { className: 'ai-bar-btn', textContent: 'Sign In' });
      signIn.style.fontSize = '11px';
      signIn.addEventListener('click', () => login('google'));
      authWrap.appendChild(signIn);
    }
  }
  updateAuth();
  onAuthChange(() => updateAuth());
  controls.appendChild(authWrap);

  bar.appendChild(controls);

  return bar;
}
