import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { sendMessage, storeApiKey } from '../services/chat.ts';
import * as storage from '../services/storage.ts';
import type { ChatMessage } from '../types/index.ts';

const CHAT_KEY = 'dashview-chat-messages';

export class ChatPanel extends Panel {
  private messages: ChatMessage[] = [];
  private sending = false;

  constructor() {
    super({
      id: 'chat',
      title: 'AI Chat',
      enabled: true,
      refreshInterval: 0,
      requiredTier: 'premium',
    });
    this.messages = storage.get<ChatMessage[]>(CHAT_KEY, []);
  }

  async fetchData(): Promise<void> {
    this.render(null);
  }

  render(_data: unknown): void {
    this.contentEl.textContent = '';

    const chatWrap = createElement('div', { className: 'chat-container' });

    // Messages area
    const messagesEl = createElement('div', { className: 'chat-messages' });
    if (this.messages.length === 0) {
      const empty = createElement('div', { className: 'chat-empty' });
      const emptyIcon = createElement('div', { className: 'chat-empty-icon', textContent: '\uD83E\uDD16' });
      const emptyText = createElement('div', {
        className: 'chat-empty-text',
        textContent: 'Ask me anything about your dashboard data, or just chat.',
      });
      empty.appendChild(emptyIcon);
      empty.appendChild(emptyText);
      messagesEl.appendChild(empty);
    } else {
      for (const msg of this.messages) {
        messagesEl.appendChild(this.createBubble(msg));
      }
    }
    chatWrap.appendChild(messagesEl);

    // Input area
    const inputArea = createElement('div', { className: 'chat-input-area' });
    const input = document.createElement('textarea');
    input.className = 'chat-input';
    input.placeholder = 'Type a message...';
    input.rows = 1;

    const sendBtn = createElement('button', { className: 'chat-send-btn', textContent: '\u2191' });

    const handleSend = async () => {
      const text = input.value.trim();
      if (!text || this.sending) return;

      const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
      this.messages.push(userMsg);
      this.saveMessages();
      input.value = '';

      // Re-render to show user message
      this.render(null);

      // Show typing indicator
      this.sending = true;
      const typingEl = createElement('div', { className: 'chat-typing', textContent: 'Thinking...' });
      const messagesContainer = chatWrap.querySelector('.chat-messages');
      messagesContainer?.appendChild(typingEl);
      messagesContainer?.scrollTo(0, messagesContainer.scrollHeight);

      try {
        const response = await sendMessage(this.messages);
        const assistantMsg: ChatMessage = { role: 'assistant', content: response, timestamp: Date.now() };
        this.messages.push(assistantMsg);
        this.saveMessages();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to get response';
        // Check if it's an API key error
        if (errorMsg.includes('No Anthropic API key')) {
          this.messages.pop(); // Remove the user message
          this.saveMessages();
          this.showApiKeyForm();
          return;
        }
        const errChatMsg: ChatMessage = {
          role: 'assistant',
          content: `Error: ${errorMsg}`,
          timestamp: Date.now(),
        };
        this.messages.push(errChatMsg);
        this.saveMessages();
      }

      this.sending = false;
      this.render(null);
    };

    sendBtn.addEventListener('click', () => void handleSend());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    });

    inputArea.appendChild(input);
    inputArea.appendChild(sendBtn);
    chatWrap.appendChild(inputArea);

    // Clear chat button
    if (this.messages.length > 0) {
      const clearBtn = createElement('button', { className: 'chat-clear-btn', textContent: 'Clear Chat' });
      clearBtn.addEventListener('click', () => {
        this.messages = [];
        this.saveMessages();
        this.render(null);
      });
      chatWrap.appendChild(clearBtn);
    }

    this.contentEl.appendChild(chatWrap);

    // Scroll to bottom
    requestAnimationFrame(() => {
      messagesEl.scrollTo(0, messagesEl.scrollHeight);
    });
  }

  private showApiKeyForm(): void {
    this.contentEl.textContent = '';

    const form = createElement('div', { className: 'chat-key-form' });
    const title = createElement('div', { className: 'chat-key-title', textContent: 'Set Anthropic API Key' });
    const desc = createElement('div', {
      className: 'chat-key-desc',
      textContent: 'Your key is stored securely server-side and never exposed to the browser.',
    });
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'sk-ant-...';
    input.className = 'landing-input';

    const saveBtn = createElement('button', { className: 'landing-btn landing-btn-primary', textContent: 'Save Key' });
    const status = createElement('div', { className: 'chat-key-status' });

    saveBtn.addEventListener('click', async () => {
      const key = input.value.trim();
      if (!key) return;
      saveBtn.textContent = 'Saving...';
      (saveBtn as HTMLButtonElement).disabled = true;
      try {
        await storeApiKey(key);
        status.textContent = 'Key saved! You can now chat.';
        status.style.color = 'var(--color-positive)';
        setTimeout(() => this.render(null), 1500);
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : 'Failed to save key';
        status.style.color = 'var(--color-negative)';
      }
      saveBtn.textContent = 'Save Key';
      (saveBtn as HTMLButtonElement).disabled = false;
    });

    form.appendChild(title);
    form.appendChild(desc);
    form.appendChild(input);
    form.appendChild(saveBtn);
    form.appendChild(status);
    this.contentEl.appendChild(form);
  }

  private createBubble(msg: ChatMessage): HTMLElement {
    const bubble = createElement('div', {
      className: `chat-bubble chat-bubble-${msg.role}`,
    });
    const text = createElement('div', { className: 'chat-bubble-text', textContent: msg.content });
    bubble.appendChild(text);
    return bubble;
  }

  private saveMessages(): void {
    // Keep last 50 messages
    const toSave = this.messages.slice(-50);
    storage.set(CHAT_KEY, toSave);
  }
}
