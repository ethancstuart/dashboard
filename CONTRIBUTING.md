# Contributing to DashPulse

Thanks for your interest in contributing! DashPulse is built entirely with [Claude Code](https://claude.ai/claude-code) and vanilla TypeScript -- no framework overhead.

## Development Setup

```bash
git clone https://github.com/ethancstuart/Dashboard.git
cd Dashboard
cp .env.example .env.local
# Add API keys to .env.local (see README for required keys)
npm install
npm run dev
```

The dev server runs at [localhost:5173](http://localhost:5173) with hot module replacement.

## Architecture Overview

DashPulse uses a **panel-based architecture**. Every data source is a self-contained class:

```
src/
  panels/        # Panel classes (WeatherPanel, StocksPanel, etc.)
  services/      # API clients, auth, storage helpers
  pages/         # Full-page views (landing, roadmap, dashboard)
  utils/         # Shared utilities (DOM helpers, fetch with circuit breaker)
  types/         # Centralized TypeScript types
api/             # Vercel Edge Functions (API proxies)
```

### Key Patterns

- **Panel lifecycle:** Each panel extends `Panel` base class, manages its own DOM container, refresh interval, and data fetching
- **No framework:** Direct DOM manipulation via helpers in `src/utils/dom.ts`
- **Circuit breaker:** All fetches go through `src/utils/fetch.ts` -- 3 failures trigger 5-minute backoff
- **API proxying:** External API calls route through `api/` Edge Functions so keys stay server-side
- **Two panel tiers:** "Core" panels use deployer API keys; "opt-in" panels (chat) use user-provided keys

### Adding a New Panel

1. Create `src/panels/YourPanel.ts` extending `Panel`
2. Implement `fetchData()` and `render(data)`
3. Register in `src/App.ts`
4. Add an Edge Function in `api/` if the panel needs external API access
5. Add types to `src/types/index.ts`

## Pull Request Guidelines

- **One feature per PR** -- keep changes focused and reviewable
- **Run `npm run build`** before submitting -- CI will check this too
- **TypeScript strict mode** -- no `any` types, no type assertion shortcuts
- **Test locally** -- verify your changes work in the browser
- **Descriptive commits** -- imperative mood, explain the "why" not just the "what"

## Code Style

- PascalCase for panel classes, camelCase for services and utils
- CSS custom properties for all colors and spacing
- No external UI libraries -- vanilla TypeScript + DOM
- Keep panel implementations self-contained

## Reporting Issues

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Browser and OS info
- Console errors (if any)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
