import { Panel } from './panels/Panel.ts';
import type { PanelState } from './types/index.ts';
import * as storage from './services/storage.ts';

const STORAGE_KEY = 'dashview:panels';

// Panels that go in the right sidebar
const SIDEBAR_PANELS = new Set(['weather', 'stocks', 'crypto', 'chat']);
// Panels that go in the content area (below map, left of sidebar)
const CONTENT_PANELS = new Set(['news', 'sports']);

export class App {
  private panels = new Map<string, Panel>();
  gridContainer: HTMLElement | null = null;
  sidebarContainer: HTMLElement | null = null;
  contentContainer: HTMLElement | null = null;

  async init(): Promise<void> {
    const state = storage.get<PanelState>(STORAGE_KEY, { panels: {} });

    // Phase 1: Attach all panels to DOM (no data fetching yet)
    for (const [id, panel] of this.panels) {
      const saved = state.panels[id];
      if (saved !== undefined) {
        panel.enabled = saved.enabled;
        if (saved.collapsed) panel.collapsed = true;
      }

      let container: HTMLElement | undefined;
      if (SIDEBAR_PANELS.has(id)) {
        container = this.sidebarContainer ?? this.gridContainer ?? undefined;
      } else {
        container = this.contentContainer ?? this.gridContainer ?? undefined;
      }

      panel.attachToDOM(container);
      if (panel.collapsed) panel.setCollapsed(true);
      panel.container.addEventListener('panel:statechange', () => this.savePreferences());
    }

    // Phase 2: Fetch data in priority order
    const panels = Array.from(this.panels.values()).filter((p) => p.enabled);
    const byPriority = new Map<number, Panel[]>();
    for (const p of panels) {
      const group = byPriority.get(p.priority) ?? [];
      group.push(p);
      byPriority.set(p.priority, group);
    }

    const priorities = Array.from(byPriority.keys()).sort((a, b) => a - b);
    for (const priority of priorities) {
      const group = byPriority.get(priority)!;
      await Promise.all(group.map((p) => p.startDataCycle()));
    }
  }

  getPanels(): Panel[] {
    return Array.from(this.panels.values());
  }

  registerPanel(panel: Panel): void {
    this.panels.set(panel.id, panel);
  }

  togglePanel(id: string, enabled: boolean): void {
    const panel = this.panels.get(id);
    if (!panel) return;
    panel.toggle(enabled);
    this.savePreferences();
  }

  getPanel(id: string): Panel | undefined {
    return this.panels.get(id);
  }

  savePreferences(): void {
    const state: PanelState = { panels: {} };
    for (const [id, panel] of this.panels) {
      state.panels[id] = { enabled: panel.enabled, collapsed: panel.collapsed };
    }
    storage.set(STORAGE_KEY, state);
  }
}
