import { Panel } from './panels/Panel.ts';
import type { PanelState } from './types/index.ts';
import * as storage from './services/storage.ts';

const STORAGE_KEY = 'dashview:panels';

export class App {
  private panels = new Map<string, Panel>();
  gridContainer: HTMLElement | null = null;

  async init(): Promise<void> {
    const state = storage.get<PanelState>(STORAGE_KEY, { panels: {} });

    for (const [id, panel] of this.panels) {
      const saved = state.panels[id];
      if (saved !== undefined) {
        panel.enabled = saved.enabled;
      }
      await panel.init(this.gridContainer ?? undefined);
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
