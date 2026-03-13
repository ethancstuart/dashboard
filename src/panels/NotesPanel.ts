import { Panel } from './Panel.ts';
import { createElement } from '../utils/dom.ts';
import * as storage from '../services/storage.ts';
import type { Note } from '../types/index.ts';

const STORAGE_KEY = 'dashview-notes';

export class NotesPanel extends Panel {
  private notes: Note[] = [];

  constructor() {
    super({
      id: 'notes',
      title: 'Notes',
      enabled: true,
      refreshInterval: 0,
      priority: 2,
      category: 'utility',
    });
    this.notes = storage.get<Note[]>(STORAGE_KEY, []);
  }

  async fetchData(): Promise<void> {
    this.notes = storage.get<Note[]>(STORAGE_KEY, []);
    this.render(null);
  }

  render(_data: unknown): void {
    this.contentEl.textContent = '';

    // Input area
    const inputArea = createElement('div', { className: 'notes-input-area' });
    const input = document.createElement('textarea');
    input.className = 'notes-input';
    input.placeholder = 'Add a note...';
    input.rows = 2;

    const addBtn = createElement('button', {
      className: 'notes-add-btn',
      textContent: 'Add',
    });
    addBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      this.addNote(text);
      input.value = '';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        this.addNote(text);
        input.value = '';
      }
    });

    inputArea.appendChild(input);
    inputArea.appendChild(addBtn);
    this.contentEl.appendChild(inputArea);

    // Notes list
    if (this.notes.length === 0) {
      const empty = createElement('div', {
        className: 'panel-empty-state',
        textContent: 'No notes yet',
      });
      this.contentEl.appendChild(empty);
      return;
    }

    const list = createElement('div', { className: 'notes-list' });
    for (const note of this.notes) {
      list.appendChild(this.createNoteRow(note));
    }
    this.contentEl.appendChild(list);
  }

  private createNoteRow(note: Note): HTMLElement {
    const row = createElement('div', {
      className: `notes-item ${note.done ? 'notes-item-done' : ''}`,
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!note.done;
    checkbox.className = 'notes-checkbox';
    checkbox.addEventListener('change', () => {
      this.toggleDone(note.id);
    });

    const text = createElement('span', {
      className: 'notes-text',
      textContent: note.text,
    });

    const meta = createElement('span', {
      className: 'notes-meta',
      textContent: this.formatTime(note.createdAt),
    });

    const deleteBtn = createElement('button', {
      className: 'notes-delete-btn',
      textContent: '\u00D7',
    });
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteNote(note.id);
    });

    row.appendChild(checkbox);
    row.appendChild(text);
    row.appendChild(meta);
    row.appendChild(deleteBtn);
    return row;
  }

  private addNote(text: string): void {
    const note: Note = {
      id: crypto.randomUUID(),
      text,
      createdAt: Date.now(),
    };
    this.notes.unshift(note);
    this.save();
    this.render(null);
  }

  private toggleDone(id: string): void {
    const note = this.notes.find((n) => n.id === id);
    if (note) {
      note.done = !note.done;
      this.save();
      this.render(null);
    }
  }

  private deleteNote(id: string): void {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.save();
    this.render(null);
  }

  private save(): void {
    storage.set(STORAGE_KEY, this.notes);
  }

  private formatTime(ts: number): string {
    const now = Date.now();
    const diff = now - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }
}
