import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import { sendMessage, hasApiKey, getProvider, PROVIDER_LABELS } from '../services/chat.ts';
import * as storage from '../services/storage.ts';
import type { ChatMessage } from '../types/index.ts';

const CHAT_KEY = 'dashview-chat-messages';
const MAX_CHAT_MESSAGES = 50;

export class ChatPanel extends Panel {
  private messages: ChatMessage[] = [];
  private sending = false;

  constructor() {
    super({
      id: 'chat',
      title: 'AI Chat',
      enabled: true,
      refreshInterval: 0,
      priority: 2,
      requiredTier: 'premium',
      category: 'personal',
    });
    this.messages = storage.get<ChatMessage[]>(CHAT_KEY, []).slice(-MAX_CHAT_MESSAGES);
  }

  async fetchData(): Promise<void> {
    this.render(null);

    // Proactively show setup prompt if no key is stored
    if (this.messages.length === 0) {
      const keyExists = await hasApiKey();
      if (!keyExists) {
        this.showSetupPrompt();
      }
    }
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
        if (errorMsg.includes('API key configured')) {
          this.messages.pop(); // Remove the user message
          this.saveMessages();
          this.showSetupPrompt();
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

    // Bottom bar: provider badge + clear button
    const bottomBar = createElement('div', { className: 'chat-bottom-bar' });
    const providerBadge = createElement('button', {
      className: 'chat-provider-badge',
      textContent: PROVIDER_LABELS[getProvider()],
    });
    providerBadge.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('dashview:open-settings', { detail: { tab: 'personal' } }));
    });
    bottomBar.appendChild(providerBadge);

    if (this.messages.length > 0) {
      const clearBtn = createElement('button', { className: 'chat-clear-btn', textContent: 'Clear Chat' });
      clearBtn.addEventListener('click', () => {
        this.messages = [];
        this.saveMessages();
        this.render(null);
      });
      bottomBar.appendChild(clearBtn);
    }
    chatWrap.appendChild(bottomBar);

    this.contentEl.appendChild(chatWrap);

    // Scroll to bottom
    requestAnimationFrame(() => {
      messagesEl.scrollTo(0, messagesEl.scrollHeight);
    });
  }

  private showSetupPrompt(): void {
    this.contentEl.textContent = '';

    const form = createElement('div', { className: 'chat-key-form' });
    const title = createElement('div', { className: 'chat-key-title', textContent: 'Set Up AI Provider' });
    const desc = createElement('div', {
      className: 'chat-key-desc',
      textContent: 'Configure your AI provider and API key in Settings to start chatting.',
    });

    const openBtn = createElement('button', { className: 'landing-btn landing-btn-primary', textContent: 'Open Settings' });
    openBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('dashview:open-settings', { detail: { tab: 'personal' } }));
    });

    form.appendChild(title);
    form.appendChild(desc);
    form.appendChild(openBtn);
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
    const toSave = this.messages.slice(-MAX_CHAT_MESSAGES);
    storage.set(CHAT_KEY, toSave);
  }
}
