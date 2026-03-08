# DashPulse — Open-Source Real-Time Intelligence Dashboard

## Project Overview
Vite + vanilla TypeScript dashboard with a panel-based architecture.
Open-source, MIT licensed. Ships with smart defaults, fully configurable.
Deployed to Vercel at https://dashpulse.app. Built entirely through Claude Code.
Long-term north star: worldmonitor.app architecture patterns.
Part of Ethan Stuart's portfolio: "I don't just manage products — I build them."

## Tech Stack
- Vite (build tool, dev server, HMR)
- TypeScript (strict mode, no framework)
- CSS custom properties for theming
- Vercel Edge Functions for API proxying
- Anthropic SDK for AI chat panel (opt-in, BYO key)
- Service Worker for PWA offline support (hand-written, no Workbox)

## Architecture
- Panel-based: every data source is a self-contained Panel class
- App.ts is the central orchestrator (panel lifecycle, state, layout)
- All external API calls go through api/ Edge Functions (keys stay server-side)
- User preferences persist in localStorage (no backend database)
- Each panel manages its own refresh cycle independently
- Circuit breaker pattern on fetch — 3 failures then 5min backoff
- Two panel tiers: "core" (weather, stocks, news, crypto, sports) and "opt-in" (calendar, chat)
- Core panels use deployer-level API keys (env vars) or free APIs (CoinGecko, ESPN)
- Opt-in panels use user-provided keys (stored in localStorage)
- Daily AI briefing aggregates live dashboard data, requires user's AI provider key
- Responsive panel grid layout: `repeat(auto-fill, minmax(340px, 1fr))`
- Panel ordering stored in `dashview:panel-order` localStorage key

## Panel Lifecycle
1. App.init() reads panel preferences (enabled, collapsed) from localStorage
2. Enabled panels are instantiated and registered with a priority (0=highest)
3. Panels are attached to DOM in saved panel order (dashview:panel-order)
4. panel.attachToDOM(parent) creates DOM container, shows loading state — no data fetch yet
5. App fetches data in priority order: P0 (weather) → P1 (stocks, news, crypto) → P2 (sports, chat, notes)
6. panel.startDataCycle() calls fetchData() then starts setInterval(refreshInterval)
7. panel.render() updates the DOM directly (no virtual DOM)
8. panel.toggle() shows/hides and starts/stops the refresh cycle
9. panel.setCollapsed() toggles content visibility while keeping refresh running

## Conventions
- Panel classes: PascalCase in src/panels/ (WeatherPanel.ts)
- Services: camelCase in src/services/ (weather.ts, alerts.ts, analytics.ts, configSync.ts)
- Edge Functions: camelCase in api/ (weather.ts)
- Config: src/config/ (theme.ts, themes.ts, density.ts, preferences.ts)
- UI modules: src/ui/ (header.ts, layout.ts, keyboard.ts, onboarding.ts, alertsModal.ts, installPrompt.ts, offlineIndicator.ts)
- Types: centralized in src/types/index.ts
- DOM helpers: src/utils/dom.ts (createElement, querySelector wrappers)
- All fetches go through src/utils/fetch.ts (retry + circuit breaker)

## Key Commands
npm run dev        → Start dev server (localhost:5173)
npm run build      → Production build (dist/) + SW manifest injection
npm run preview    → Preview production build locally
vercel             → Deploy to Vercel

## Panel Status
- [x] Weather (OpenWeatherMap) — core, priority 0
- [x] Stocks (Finnhub) — core, priority 1, price alerts
- [x] News (RSS feeds via proxy) — core, priority 1
- [x] Sports (ESPN) — core, priority 2
- [x] Crypto (CoinGecko) — core, priority 1, price alerts
- [x] Chat (multi-provider) — opt-in, priority 2
- [x] Notes (localStorage) — core, priority 2, no network
- [ ] Calendar (Google Calendar API) — opt-in, planned

## Important Notes
- No React or UI framework — vanilla TypeScript + DOM
- .env.local for deployer API keys (gitignored), .env.example committed
- Opt-in modules (Calendar, Chat) don't require deployer keys
- Finnhub free tier: 60 calls/min
- RSS feeds fetched server-side via proxy to avoid CORS
- No personal data in defaults — location auto-detected, tickers are broad market
- Adding a new panel: create class extending Panel, register in App.ts/dashboard.ts, add Edge Function if needed
- Three themes (dark/light/OLED) stored in dashview:theme, three density modes in dashview:density
- Unit preferences (°F/°C, 12h/24h) stored in dashview:preferences
- Command palette: Cmd+K opens searchable command palette (panels, themes, density, alerts, export/import, actions)
- Daily briefing: AI-generated summary using live dashboard context, cached per day
- Keyboard shortcuts: Cmd+K palette, ? help, / search, t theme, m map, a alerts, 1-6 panels, Esc close
- First-time visitors see a 5-step onboarding flow (dashview:onboarding)
- All panels support collapse (click header), state persists per panel
- ARIA landmarks, skip-link, focus-visible, and role attributes for screen readers
- PWA: manifest.json, service worker (public/sw.js), install prompt, offline indicator
- SW caching: network-first for API, cache-first for static/external assets, stale fallback when offline
- Price alerts: stored in dashview-alerts, tier-gated (3 free / unlimited premium), browser notifications via SW
- Notes: stored in dashview-notes, fully offline, no refresh cycle
- Export/Import: JSON config portability via configSync.ts, excludes sensitive keys
- Analytics: lightweight event tracking in dashview-analytics, 30-day rolling window, visible in settings
- Layout: responsive panel grid (no sidebar/content split), panel order from dashview:panel-order
