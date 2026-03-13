const stack: (() => void)[] = [];

function handleEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape' && stack.length > 0) {
    e.stopPropagation();
    const closeFn = stack.pop()!;
    closeFn();
    if (stack.length === 0) {
      document.removeEventListener('keydown', handleEscape, true);
    }
  }
}

export function pushModal(closeFn: () => void): void {
  if (stack.length === 0) {
    document.addEventListener('keydown', handleEscape, true);
  }
  stack.push(closeFn);
}

export function popModal(): void {
  stack.pop();
  if (stack.length === 0) {
    document.removeEventListener('keydown', handleEscape, true);
  }
}
