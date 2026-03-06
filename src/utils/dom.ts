interface CreateElementOptions {
  className?: string;
  textContent?: string;
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: CreateElementOptions,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options?.className) el.className = options.className;
  if (options?.textContent) el.textContent = options.textContent;
  return el;
}

export function qs<T extends Element = Element>(
  selector: string,
  parent: Element | Document = document,
): T | null {
  return parent.querySelector<T>(selector);
}
