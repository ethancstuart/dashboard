# dashview — Open-Source Real-Time Intelligence Dashboard

## Project Overview
Vite + vanilla TypeScript dashboard with a panel-based architecture.
Open-source, MIT licensed. Ships with smart defaults, fully configurable.
Deployed to Vercel. Built entirely through Claude Code.
Long-term north star: worldmonitor.app architecture patterns.

## Tech Stack
- Vite (build tool, dev server, HMR)
- TypeScript (strict mode, no framework)
- CSS custom properties for theming
- Vercel Edge Functions for API proxying
- Anthropic SDK for AI chat panel (opt-in, BYO key)

## Architecture
- Panel-based: every data source is a self-contained Panel class
- App.ts is the central orchestrator (panel lifecycle, state, layout)
- All external API calls go through api/ Edge Functions (keys stay server-side)
- User preferences persist in localStorage (no backend database)
- Each panel manages its own refresh cycle independently
- Circuit breaker pattern on fetch — 3 failures then 5min backoff
- Two panel tiers: "core" (weather, stocks, news) and "opt-in" (calendar, chat)
- Core panels use deployer-level API keys (env vars)
- Opt-in panels use user-provided keys (stored in localStorage)

## Panel Lifecycle
1. App.init() reads panel preferences (enabled, collapsed) from localStorage
2. Enabled panels are instantiated and registered with a priority (0=highest)
3. panel.attachToDOM(parent) creates DOM container, shows loading state — no data fetch yet
4. App fetches data in priority order: P0 (weather) → P1 (stocks, news) → P2 (sports, chat)
5. panel.startDataCycle() calls fetchData() then starts setInterval(refreshInterval)
6. panel.render() updates the DOM directly (no virtual DOM)
7. panel.toggle() shows/hides and starts/stops the refresh cycle
8. panel.setCollapsed() toggles content visibility while keeping refresh running

## Conventions
- Panel classes: PascalCase in src/panels/ (WeatherPanel.ts)
- Services: camelCase in src/services/ (weather.ts)
- Edge Functions: camelCase in api/ (weather.ts)
- Config: src/config/ (theme.ts, themes.ts, density.ts, preferences.ts)
- UI modules: src/ui/ (header.ts, layout.ts, keyboard.ts, onboarding.ts)
- Types: centralized in src/types/index.ts
- DOM helpers: src/utils/dom.ts (createElement, querySelector wrappers)
- All fetches go through src/utils/fetch.ts (retry + circuit breaker)

## Key Commands
npm run dev        → Start dev server (localhost:5173)
npm run build      → Production build (dist/)
npm run preview    → Preview production build locally
vercel             → Deploy to Vercel

## Panel Status
- [x] Weather (OpenWeatherMap) — core, priority 0
- [x] Stocks (Finnhub) — core, priority 1
- [x] News (RSS feeds via proxy) — core, priority 1
- [x] Sports (ESPN) — core, priority 2
- [x] Chat (multi-provider) — opt-in, priority 2
- [ ] Calendar (Google Calendar API) — opt-in, planned

## Important Notes
- No React or UI framework — vanilla TypeScript + DOM
- .env.local for deployer API keys (gitignored), .env.example committed
- Opt-in modules (Calendar, Chat) don't require deployer keys
- Finnhub free tier: 60 calls/min
- RSS feeds fetched server-side via proxy to avoid CORS
- No personal data in defaults — location auto-detected, tickers are broad market
- Adding a new panel: create class extending Panel, register in App.ts, add Edge Function if needed
- Three themes (dark/light/OLED) stored in dashview:theme, three density modes in dashview:density
- Unit preferences (°F/°C, 12h/24h) stored in dashview:preferences
- Keyboard shortcuts: ? help, / search, t theme, m map, 1-5 panels, Esc close
- First-time visitors see a 5-step onboarding flow (dashview:onboarding)
- All panels support collapse (click header), state persists per panel
- ARIA landmarks, skip-link, focus-visible, and role attributes for screen readers
