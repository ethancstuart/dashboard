import { fetchWithRetry } from '../utils/fetch.ts';
import type { ChatMessage } from '../types/index.ts';

export async function sendMessage(
  messages: ChatMessage[],
  context?: string,
): Promise<string> {
  const res = await fetchWithRetry('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      context,
    }),
  });

  const data = await res.json();

  if (data.error) throw new Error(data.error);

  // Anthropic response format
  if (data.content && Array.isArray(data.content)) {
    return data.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('');
  }

  return data.response || 'No response';
}

export async function storeApiKey(keyValue: string): Promise<void> {
  const res = await fetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyName: 'anthropic', keyValue }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
}
