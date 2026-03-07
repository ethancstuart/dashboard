import { fetchWithRetry } from '../utils/fetch.ts';
import type { ChatMessage, ChatProvider } from '../types/index.ts';
import * as storage from './storage.ts';

const PROVIDER_KEY = 'dashview-chat-provider';

export const PROVIDER_LABELS: Record<ChatProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google (Gemini)',
  xai: 'xAI (Grok)',
};

export const PROVIDER_PLACEHOLDERS: Record<ChatProvider, string> = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  google: 'AIza...',
  xai: 'xai-...',
};

export function getProvider(): ChatProvider {
  return storage.get<ChatProvider>(PROVIDER_KEY, 'anthropic');
}

export function setProvider(provider: ChatProvider): void {
  storage.set(PROVIDER_KEY, provider);
}

export async function sendMessage(
  messages: ChatMessage[],
  context?: string,
): Promise<string> {
  const provider = getProvider();
  const res = await fetchWithRetry('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      context,
      provider,
    }),
  });

  const data = await res.json();

  if (data.error) throw new Error(data.error);

  return data.response || 'No response';
}

export async function hasApiKey(): Promise<boolean> {
  const provider = getProvider();
  try {
    const res = await fetch('/api/keys');
    const data = await res.json();
    return Array.isArray(data.keys) && data.keys.includes(provider);
  } catch {
    return false;
  }
}

export async function storeApiKey(keyValue: string): Promise<void> {
  const provider = getProvider();
  const res = await fetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyName: provider, keyValue }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
}
