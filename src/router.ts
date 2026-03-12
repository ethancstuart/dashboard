type RouteHandler = (params?: Record<string, string>) => void | Promise<void>;

export class Router {
  private routes = new Map<string, RouteHandler>();
  private paramRoutes: { pattern: RegExp; keys: string[]; handler: RouteHandler }[] = [];
  private fallback: RouteHandler | null = null;
  private currentPath = '';

  on(path: string, handler: RouteHandler): Router {
    // Check for parameterized route
    if (path.includes(':')) {
      const keys: string[] = [];
      const pattern = path.replace(/:(\w+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      });
      this.paramRoutes.push({ pattern: new RegExp(`^${pattern}$`), keys, handler });
    } else {
      this.routes.set(path, handler);
    }
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

    // Exact match first
    const handler = this.routes.get(hash);
    if (handler) {
      void handler();
      return;
    }

    // Parameterized routes
    for (const route of this.paramRoutes) {
      const match = hash.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => { params[key] = match[i + 1]; });
        void route.handler(params);
        return;
      }
    }

    if (this.fallback) {
      void this.fallback();
    }
  }
}
