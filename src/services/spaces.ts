import type { Space, SpaceWidget, WidgetSize } from '../types/index.ts';
import * as storage from './storage.ts';

const SPACES_KEY = 'dashview:spaces';
const ACTIVE_SPACE_KEY = 'dashview:active-space';

const DEFAULT_SPACES: Space[] = [
  {
    id: 'overview',
    name: 'Overview',
    icon: '\u26A1',
    widgets: [
      { panelId: 'weather', size: 'medium', colSpan: 4, position: 0 },
      { panelId: 'stocks', size: 'medium', colSpan: 4, position: 1 },
      { panelId: 'crypto', size: 'medium', colSpan: 4, position: 2 },
      { panelId: 'news', size: 'medium', colSpan: 6, position: 3 },
      { panelId: 'sports', size: 'compact', colSpan: 3, position: 4 },
      { panelId: 'entertainment', size: 'compact', colSpan: 3, position: 5 },
      { panelId: 'globe', size: 'compact', colSpan: 3, position: 6 },
    ],
  },
  {
    id: 'markets',
    name: 'Markets',
    icon: '\uD83D\uDCC8',
    widgets: [
      { panelId: 'stocks', size: 'large', colSpan: 6, position: 0 },
      { panelId: 'crypto', size: 'large', colSpan: 6, position: 1 },
      { panelId: 'news', size: 'large', colSpan: 12, position: 2 },
    ],
  },
  {
    id: 'world',
    name: 'World',
    icon: '\uD83C\uDF0D',
    widgets: [
      { panelId: 'globe', size: 'medium', colSpan: 6, position: 0 },
      { panelId: 'news', size: 'large', colSpan: 6, position: 1 },
      { panelId: 'weather', size: 'medium', colSpan: 4, position: 2 },
      { panelId: 'sports', size: 'medium', colSpan: 4, position: 3 },
      { panelId: 'entertainment', size: 'medium', colSpan: 4, position: 4 },
    ],
  },
  {
    id: 'personal',
    name: 'Personal',
    icon: '\uD83C\uDFE0',
    widgets: [
      { panelId: 'calendar', size: 'medium', colSpan: 6, position: 0 },
      { panelId: 'notes', size: 'medium', colSpan: 6, position: 1 },
      { panelId: 'weather', size: 'medium', colSpan: 4, position: 2 },
      { panelId: 'chat', size: 'large', colSpan: 8, position: 3 },
    ],
  },
];

export function getSpaces(): Space[] {
  const saved = storage.get<Space[] | null>(SPACES_KEY, null);
  if (saved && saved.length > 0) return saved;
  return DEFAULT_SPACES.map((s) => ({ ...s, widgets: [...s.widgets] }));
}

export function saveSpaces(spaces: Space[]): void {
  storage.set(SPACES_KEY, spaces);
}

export function getActiveSpace(): string {
  return storage.get<string>(ACTIVE_SPACE_KEY, 'overview');
}

export function setActiveSpace(id: string): void {
  storage.set(ACTIVE_SPACE_KEY, id);
}

export function createSpace(name: string, icon: string, widgets: SpaceWidget[] = []): Space {
  const spaces = getSpaces();
  const id = `space-${Date.now()}`;
  const space: Space = { id, name, icon, widgets };
  spaces.push(space);
  saveSpaces(spaces);
  return space;
}

export function deleteSpace(id: string): void {
  const spaces = getSpaces().filter((s) => s.id !== id);
  saveSpaces(spaces);
  if (getActiveSpace() === id && spaces.length > 0) {
    setActiveSpace(spaces[0].id);
  }
}

export function updateSpace(id: string, changes: Partial<Pick<Space, 'name' | 'icon' | 'widgets'>>): void {
  const spaces = getSpaces();
  const space = spaces.find((s) => s.id === id);
  if (!space) return;
  if (changes.name !== undefined) space.name = changes.name;
  if (changes.icon !== undefined) space.icon = changes.icon;
  if (changes.widgets !== undefined) space.widgets = changes.widgets;
  saveSpaces(spaces);
}

export function addWidgetToSpace(spaceId: string, panelId: string, size: WidgetSize = 'medium'): void {
  const spaces = getSpaces();
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) return;
  // Don't add duplicates
  if (space.widgets.some((w) => w.panelId === panelId)) return;
  const colSpanMap: Record<WidgetSize, number> = { compact: 3, medium: 6, large: 12 };
  const position = space.widgets.length;
  space.widgets.push({ panelId, size, colSpan: colSpanMap[size], position });
  saveSpaces(spaces);
}

export function removeWidgetFromSpace(spaceId: string, panelId: string): void {
  const spaces = getSpaces();
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) return;
  space.widgets = space.widgets.filter((w) => w.panelId !== panelId);
  // Re-index positions
  space.widgets.forEach((w, i) => { w.position = i; });
  saveSpaces(spaces);
}

export function reorderWidgets(spaceId: string, widgetOrder: string[]): void {
  const spaces = getSpaces();
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) return;
  const byPanel = new Map(space.widgets.map((w) => [w.panelId, w]));
  space.widgets = widgetOrder
    .map((pid, i) => {
      const w = byPanel.get(pid);
      if (!w) return null;
      return { ...w, position: i };
    })
    .filter((w): w is SpaceWidget => w !== null);
  saveSpaces(spaces);
}

export function getDefaultSpaces(): Space[] {
  return DEFAULT_SPACES;
}
