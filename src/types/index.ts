export interface PanelConfig {
  id: string;
  title: string;
  enabled: boolean;
  refreshInterval: number;
}

export interface PanelSettings {
  enabled: boolean;
  [key: string]: unknown;
}

export interface PanelState {
  panels: Record<string, PanelSettings>;
}
