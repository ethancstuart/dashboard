import { describe, it, expect } from 'vitest';
import { createElement, qs } from './dom.ts';

describe('createElement', () => {
  it('returns correct element type with className and textContent', () => {
    const el = createElement('div', { className: 'card', textContent: 'Hello' });
    expect(el).toBeInstanceOf(HTMLDivElement);
    expect(el.className).toBe('card');
    expect(el.textContent).toBe('Hello');
  });

  it('returns element without options', () => {
    const el = createElement('span');
    expect(el).toBeInstanceOf(HTMLSpanElement);
    expect(el.className).toBe('');
    expect(el.textContent).toBe('');
  });
});

describe('qs', () => {
  it('finds element by selector', () => {
    const div = document.createElement('div');
    div.id = 'test-qs';
    document.body.appendChild(div);

    const found = qs('#test-qs');
    expect(found).toBe(div);

    document.body.removeChild(div);
  });

  it('returns null when element is missing', () => {
    const result = qs('#nonexistent-element-xyz');
    expect(result).toBeNull();
  });

  it('scopes query to parent element', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    child.className = 'scoped-child';
    parent.appendChild(child);
    document.body.appendChild(parent);

    // Should find within parent
    const found = qs('.scoped-child', parent);
    expect(found).toBe(child);

    // Should not find outside parent scope using a different parent
    const other = document.createElement('div');
    document.body.appendChild(other);
    const notFound = qs('.scoped-child', other);
    expect(notFound).toBeNull();

    document.body.removeChild(parent);
    document.body.removeChild(other);
  });
});
