type RouteHandler = () => void | Promise<void>;

export class Router {
  private routes = new Map<string, RouteHandler>();
  private fallback: RouteHandler | null = null;
  private currentPath = '';

  on(path: string, handler: RouteHandler): Router {
    this.routes.set(path, handler);
    return this;
  }

  otherwise(handler: RouteHandler): Router {
    this.fallback = handler;
    return this;
  }

  navigate(path: string): void {
    window.location.hash = '#' + path;
  }

  start(): void {
    window.addEventListener('hashchange', () => this.resolve());
    this.resolve();
  }

  private resolve(): void {
    const hash = window.location.hash.slice(1) || '/';
    if (hash === this.currentPath) return;
    this.currentPath = hash;

    const handler = this.routes.get(hash);
    if (handler) {
      void handler();
    } else if (this.fallback) {
      void this.fallback();
    }
  }
}
