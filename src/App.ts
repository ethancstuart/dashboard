import { Panel } from './panels/Panel.ts';
import type { PanelState } from './types/index.ts';
import * as storage from './services/storage.ts';
import { getPanelOrder } from './ui/layout.ts';

const STORAGE_KEY = 'dashview:panels';

export class App {
  private panels = new Map<string, Panel>();
  panelGridContainer: HTMLElement | null = null;

  async init(): Promise<void> {
    const state = storage.get<PanelState>(STORAGE_KEY, { panels: {} });
    const order = getPanelOrder();

    // Phase 1: Attach all panels to DOM in order
    // First, handle panels in the saved order
    const attached = new Set<string>();
    for (const id of order) {
      const panel = this.panels.get(id);
      if (!panel) continue;
      this.initPanel(panel, state);
      attached.add(id);
    }
    // Then any remaining panels not in the order
    for (const [id, panel] of this.panels) {
      if (attached.has(id)) continue;
      this.initPanel(panel, state);
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

  private initPanel(panel: Panel, state: PanelState): void {
    const saved = state.panels[panel.id];
    if (saved !== undefined) {
      panel.enabled = saved.enabled;
      if (saved.collapsed) panel.collapsed = true;
    }

    panel.attachToDOM(this.panelGridContainer ?? undefined);
    if (panel.collapsed) panel.setCollapsed(true);
    panel.container.addEventListener('panel:statechange', () => this.savePreferences());
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
