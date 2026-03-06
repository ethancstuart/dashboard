import { Panel } from './panels/Panel.ts';
import type { PanelState } from './types/index.ts';
import * as storage from './services/storage.ts';

const STORAGE_KEY = 'dashview:panels';

// Panels that go in the right sidebar
const SIDEBAR_PANELS = new Set(['weather', 'stocks', 'chat']);
// Panels that go in the content area (below map, left of sidebar)
const CONTENT_PANELS = new Set(['news', 'sports']);

export class App {
  private panels = new Map<string, Panel>();
  gridContainer: HTMLElement | null = null;
  sidebarContainer: HTMLElement | null = null;
  contentContainer: HTMLElement | null = null;

  async init(): Promise<void> {
    const state = storage.get<PanelState>(STORAGE_KEY, { panels: {} });

    for (const [id, panel] of this.panels) {
      const saved = state.panels[id];
      if (saved !== undefined) {
        panel.enabled = saved.enabled;
      }

      // Route panel to correct container
      let container: HTMLElement | undefined;
      if (SIDEBAR_PANELS.has(id)) {
        container = this.sidebarContainer ?? this.gridContainer ?? undefined;
      } else {
        container = this.contentContainer ?? this.gridContainer ?? undefined;
      }

      await panel.init(container);
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
      state.panels[id] = { enabled: panel.enabled };
    }
    storage.set(STORAGE_KEY, state);
  }
}
