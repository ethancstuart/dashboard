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
1. App.init() reads panel preferences from localStorage
2. Enabled panels are instantiated and registered
3. Each panel creates its own DOM container and attaches to the grid
4. panel.fetchData() runs immediately, then on setInterval(refreshInterval)
5. panel.render() updates the DOM directly (no virtual DOM)
6. panel.toggle() shows/hides and starts/stops the refresh cycle

## Conventions
- Panel classes: PascalCase in src/panels/ (WeatherPanel.ts)
- Services: camelCase in src/services/ (weather.ts)
- Edge Functions: camelCase in api/ (weather.ts)
- Types: centralized in src/types/index.ts
- DOM helpers: src/utils/dom.ts (createElement, querySelector wrappers)
- All fetches go through src/utils/fetch.ts (retry + circuit breaker)

## Key Commands
npm run dev        → Start dev server (localhost:5173)
npm run build      → Production build (dist/)
npm run preview    → Preview production build locally
vercel             → Deploy to Vercel

## Panel Status
- [ ] Weather (OpenWeatherMap) — core
- [ ] Stocks (Finnhub) — core
- [ ] News (RSS feeds via proxy) — core
- [ ] Calendar (Google Calendar API) — opt-in
- [ ] Chat (Anthropic API) — opt-in
- [ ] Settings (localStorage preferences) — core

## Important Notes
- No React or UI framework — vanilla TypeScript + DOM
- .env.local for deployer API keys (gitignored), .env.example committed
- Opt-in modules (Calendar, Chat) don't require deployer keys
- Finnhub free tier: 60 calls/min
- RSS feeds fetched server-side via proxy to avoid CORS
- No personal data in defaults — location auto-detected, tickers are broad market
- Adding a new panel: create class extending Panel, register in App.ts, add Edge Function if needed
