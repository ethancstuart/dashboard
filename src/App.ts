export class App {
  init(): void {
    const root = document.getElementById('app');
    if (!root) return;
    root.textContent = 'dashview';
  }
}
