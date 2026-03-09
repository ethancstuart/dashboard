import { createElement } from '../utils/dom.ts';
import { cycleTheme, applyTheme } from '../config/theme.ts';
import { applyDensity } from '../config/density.ts';
import { trackFeatureUse } from '../services/analytics.ts';
import { openAlertsModal } from '../ui/alertsModal.ts';
import { exportConfig, importConfig } from '../services/configSync.ts';
import type { App } from '../App.ts';
import type { ThemeName } from '../config/themes.ts';
import type { DensityMode } from '../config/density.ts';

interface Command {
  id: string;
  title: string;
  section: string;
  keywords: string;
  action: () => void;
}

let overlay: HTMLElement | null = null;
let commands: Command[] = [];

export function initCommandPalette(app: App): void {
  commands = buildCommands(app);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      toggle();
    }
  });
}

export function openCommandPalette(): void {
  if (!overlay) show();
}

function toggle(): void {
  if (overlay) {
    close();
  } else {
    show();
  }
}

function close(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function show(): void {
  close();
  trackFeatureUse('command_palette');

  overlay = createElement('div', { className: 'cmd-palette-overlay' });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const dialog = createElement('div', { className: 'cmd-palette' });
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Command palette');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cmd-palette-input';
  input.placeholder = 'Type a command...';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  const list = createElement('div', { className: 'cmd-palette-list' });

  let selectedIndex = 0;
  let filtered = commands;

  // Pre-render all command items once
  interface ItemEntry { el: HTMLElement; sectionEl: HTMLElement | null; cmd: Command }
  const allItems: ItemEntry[] = [];
  let currentSection = '';

  const emptyEl = createElement('div', {
    className: 'cmd-palette-empty',
    textContent: 'No commands found',
  });
  emptyEl.style.display = 'none';

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    let sectionEl: HTMLElement | null = null;

    if (cmd.section !== currentSection) {
      currentSection = cmd.section;
      sectionEl = createElement('div', {
        className: 'cmd-palette-section',
        textContent: currentSection,
      });
      list.appendChild(sectionEl);
    }

    const item = createElement('div', {
      className: 'cmd-palette-item',
      textContent: cmd.title,
    });
    item.dataset.index = String(i);
    item.addEventListener('click', () => {
      close();
      cmd.action();
    });
    item.addEventListener('mouseenter', () => {
      selectedIndex = filtered.indexOf(cmd);
      updateSelection();
    });
    list.appendChild(item);
    allItems.push({ el: item, sectionEl, cmd });
  }
  list.appendChild(emptyEl);

  function updateSelection() {
    for (let i = 0; i < allItems.length; i++) {
      const entry = allItems[i];
      const filteredIdx = filtered.indexOf(entry.cmd);
      entry.el.classList.toggle('cmd-palette-item-active', filteredIdx === selectedIndex);
    }
  }

  function updateVisibility() {
    const visibleSections = new Set<string>();
    for (const entry of allItems) {
      const visible = filtered.includes(entry.cmd);
      entry.el.style.display = visible ? '' : 'none';
      if (visible) visibleSections.add(entry.cmd.section);
    }
    // Show/hide section headers based on whether any item in the section is visible
    for (const entry of allItems) {
      if (entry.sectionEl) {
        entry.sectionEl.style.display = visibleSections.has(entry.cmd.section) ? '' : 'none';
      }
    }
    emptyEl.style.display = filtered.length === 0 ? '' : 'none';
    updateSelection();
  }

  input.addEventListener('input', () => {
    const query = input.value.toLowerCase().trim();
    if (!query) {
      filtered = commands;
    } else {
      filtered = commands.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.keywords.toLowerCase().includes(query) ||
          c.section.toLowerCase().includes(query),
      );
    }
    selectedIndex = 0;
    updateVisibility();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
      updateSelection();
      scrollToSelected(list);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateSelection();
      scrollToSelected(list);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        close();
        filtered[selectedIndex].action();
      }
    }
  });

  dialog.appendChild(input);
  dialog.appendChild(list);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  updateVisibility();
  requestAnimationFrame(() => input.focus());
}

function scrollToSelected(list: HTMLElement): void {
  const active = list.querySelector('.cmd-palette-item-active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function buildCommands(app: App): Command[] {
  const cmds: Command[] = [];

  // Navigation
  const panels = app.getPanels();
  for (const panel of panels) {
    cmds.push({
      id: `goto-${panel.id}`,
      title: `Go to ${panel.title}`,
      section: 'Navigation',
      keywords: `panel ${panel.id} jump scroll`,
      action: () => {
        if (!panel.enabled) app.togglePanel(panel.id, true);
        panel.container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    });
  }

  // Panel toggles
  for (const panel of panels) {
    cmds.push({
      id: `toggle-${panel.id}`,
      title: `Toggle ${panel.title} panel`,
      section: 'Panels',
      keywords: `show hide enable disable ${panel.id}`,
      action: () => app.togglePanel(panel.id, !panel.enabled),
    });
  }

  // Theme
  const themeNames: ThemeName[] = ['dark', 'light', 'oled'];
  for (const t of themeNames) {
    cmds.push({
      id: `theme-${t}`,
      title: `Theme: ${t.charAt(0).toUpperCase() + t.slice(1)}`,
      section: 'Appearance',
      keywords: `theme ${t} appearance mode`,
      action: () => applyTheme(t),
    });
  }
  cmds.push({
    id: 'theme-cycle',
    title: 'Cycle theme',
    section: 'Appearance',
    keywords: 'theme toggle next switch',
    action: () => cycleTheme(),
  });

  // Density
  const densityModes: DensityMode[] = ['compact', 'comfortable', 'spacious'];
  for (const d of densityModes) {
    cmds.push({
      id: `density-${d}`,
      title: `Density: ${d.charAt(0).toUpperCase() + d.slice(1)}`,
      section: 'Appearance',
      keywords: `density ${d} layout spacing`,
      action: () => applyDensity(d),
    });
  }

  // Map
  cmds.push({
    id: 'toggle-map',
    title: 'Toggle map',
    section: 'Actions',
    keywords: 'map show hide collapse expand news',
    action: () => {
      const mapHero = document.querySelector('.map-hero') as HTMLElement;
      if (!mapHero) return;
      const collapsing = !mapHero.classList.contains('map-collapsed');
      mapHero.classList.toggle('map-collapsed', collapsing);
      localStorage.setItem('dashview:map-collapsed', collapsing ? '1' : '');
      const expandBtn = document.querySelector('.map-expand-toggle') as HTMLElement;
      if (expandBtn) expandBtn.style.display = collapsing ? '' : 'none';
    },
  });

  // Actions
  cmds.push({
    id: 'refresh-all',
    title: 'Refresh all panels',
    section: 'Actions',
    keywords: 'reload update fetch data',
    action: () => {
      for (const p of app.getPanels()) {
        if (p.enabled) void p.refresh();
      }
    },
  });

  cmds.push({
    id: 'keyboard-shortcuts',
    title: 'Show keyboard shortcuts',
    section: 'Actions',
    keywords: 'help keys hotkeys bindings',
    action: () => {
      // Simulate ? key press to open help modal
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    },
  });

  cmds.push({
    id: 'open-settings',
    title: 'Open settings',
    section: 'Actions',
    keywords: 'settings gear preferences config',
    action: () => {
      const gearBtn = document.querySelector('.header-gear') as HTMLButtonElement;
      if (gearBtn) gearBtn.click();
    },
  });

  cmds.push({
    id: 'daily-briefing',
    title: 'Generate daily briefing',
    section: 'AI',
    keywords: 'briefing summary ai morning report digest',
    action: () => {
      document.dispatchEvent(new CustomEvent('dashview:briefing'));
    },
  });

  // Notes
  cmds.push({
    id: 'new-note',
    title: 'New note',
    section: 'Actions',
    keywords: 'note add create todo',
    action: () => {
      const notesPanel = app.getPanel('notes');
      if (notesPanel && !notesPanel.enabled) app.togglePanel('notes', true);
      if (notesPanel) {
        notesPanel.container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        requestAnimationFrame(() => {
          const input = notesPanel.container.querySelector('.notes-input') as HTMLTextAreaElement;
          if (input) input.focus();
        });
      }
    },
  });

  // Alerts
  cmds.push({
    id: 'manage-alerts',
    title: 'Manage price alerts',
    section: 'Actions',
    keywords: 'alert notification price stock crypto bell',
    action: () => openAlertsModal(),
  });

  // Export/Import
  cmds.push({
    id: 'export-config',
    title: 'Export config',
    section: 'Actions',
    keywords: 'export download backup save settings config',
    action: () => exportConfig(),
  });

  cmds.push({
    id: 'import-config',
    title: 'Import config',
    section: 'Actions',
    keywords: 'import upload restore load settings config',
    action: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const result = await importConfig(file);
        showToast(result.message, result.success ? 'success' : 'error');
      });
      input.click();
    },
  });

  return cmds;
}

function showToast(message: string, type: 'success' | 'error'): void {
  const toast = createElement('div', {
    className: `toast toast-${type}`,
    textContent: message,
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
