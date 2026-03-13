import { fetchWithRetry } from '../utils/fetch.ts';
import { getSpaces, getActiveSpace } from './spaces.ts';

export interface AIAction {
  action: 'navigate_space' | 'add_widget' | 'remove_widget' | 'create_space' | 'answer' | 'highlight';
  params?: Record<string, unknown>;
  message: string;
}

interface AIShellResponse {
  action: string;
  params?: Record<string, unknown>;
  message: string;
}

function buildContext(): string {
  const spaces = getSpaces();
  const activeId = getActiveSpace();
  const activeSpace = spaces.find((s) => s.id === activeId);

  const spaceList = spaces.map((s) => `${s.name} (${s.id}): ${s.widgets.map((w) => w.panelId).join(', ')}`).join('\n');

  const availablePanels = [
    'weather', 'stocks', 'news', 'crypto', 'sports',
    'chat', 'calendar', 'entertainment', 'notes',
  ];

  return [
    `Active space: ${activeSpace?.name || 'unknown'} (${activeId})`,
    `Spaces:\n${spaceList}`,
    `Available panels: ${availablePanels.join(', ')}`,
  ].join('\n\n');
}

export async function interpretQuery(query: string): Promise<AIAction> {
  const context = buildContext();

  try {
    const res = await fetchWithRetry('/api/ai-shell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, context }),
    });

    const data = await res.json() as AIShellResponse | { error: string };

    if ('error' in data) {
      return { action: 'answer', message: data.error };
    }

    return {
      action: (data.action || 'answer') as AIAction['action'],
      params: data.params,
      message: data.message || 'Done.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI request failed';
    return { action: 'answer', message: msg };
  }
}

export async function getRemainingQueries(): Promise<number> {
  try {
    const res = await fetch('/api/ai-shell?check=quota');
    const data = await res.json() as { remaining: number };
    return data.remaining ?? 0;
  } catch {
    return 0;
  }
}
