# DashPulse — Personal Intelligence Terminal

## Project Overview
Vite + vanilla TypeScript dashboard with a space-based, widget-driven architecture.
Open-source, MIT licensed. Ships with smart defaults, fully configurable.
Deployed to Vercel at https://dashpulse.app. Built entirely through Claude Code.
Inspired by Bloomberg Terminal and worldmonitor.app — information-dense, keyboard-driven, AI-native.
Part of Ethan Stuart's portfolio: "I don't just manage products — I build them."

## Tech Stack
- Vite (build tool, dev server, HMR)
- TypeScript (strict mode, no framework)
- CSS custom properties for theming (terminal aesthetic, JetBrains Mono)
- Vercel Edge Functions for API proxying
- Anthropic SDK for AI chat panel (opt-in, BYO key) + deployer-hosted Haiku for AI shell
- Service Worker for PWA offline support (hand-written, no Workbox)

## Architecture
- **Space-based**: dashboard organized into named Spaces (Overview, Markets, World, Personal), each with its own 12-column CSS grid of widgets
- **Widget system**: Panels render at different sizes (compact/medium/large) via `renderAtSize()` — each widget has a `colSpan` in the grid
- **AI Bar**: persistent top bar replacing header/ticker/command palette — handles `/` commands and natural language AI queries
- **Pulse Bar**: cross-panel intelligence strip showing real-time correlations (stock moves, weather alerts, live games)
- **Auth required**: Google/GitHub OAuth, no guest tier — `free` is the baseline, `premium` unlocks more
- App.ts is the central orchestrator, dashboard.ts wires spaces + AI bar + pulse bar
- All external API calls go through api/ Edge Functions (keys stay server-side)
- User preferences persist in localStorage, cross-device sync via Vercel KV
- Each panel manages its own refresh cycle independently
- Circuit breaker pattern on fetch — 3 failures then 5min backoff
- Panels dispatch `dashview:panel-data` events after successful fetch for cross-panel intelligence

## Core Concepts

### Spaces
- Named contexts with their own widget layouts, stored in `dashview:spaces`
- Default spaces: Overview, Markets, World, Personal
- Users can create, rename, delete, and reorder spaces
- CRUD via `src/services/spaces.ts`

### Widgets
- Evolution of Panel system — same data lifecycle, now size-aware
- Sizes: `compact` (2-3 cols), `medium` (4-6 cols), `large` (6-12 cols)
- 12-column CSS grid, drag-to-reorder, resize handles
- Grid rendering via `src/ui/widgetGrid.ts`

### AI Bar
- Persistent input at top: `Cmd+K` or click to focus
- `/` prefix → command mode (autocomplete from registry)
- Natural language → AI mode (deployer Haiku, 5 free/day, BYO key unlimited)
- Status pills: weather temp, market index change
- AI responses shown in transient overlay below bar

### Pulse Bar
- Cross-space intelligence strip at bottom
- Shows pills from `src/services/intelligence.ts` correlation rules
- Categories: market moves >2%, crypto swings >5%, weather alerts, sports proximity, news-stock correlations
- Click pill → scroll to relevant widget with highlight

### Panel Categories
- `markets`: Stocks, Crypto
- `world`: Weather, News, Sports, Entertainment
- `personal`: Chat, Calendar
- `utility`: Notes
- Category determines accent stripe color on widget cards

## Panel Lifecycle
1. dashboard.ts checks auth → redirects to landing if not logged in
2. Spaces loaded, active space determined, widgets rendered into 12-col grid
3. Panels instantiated with category and priority
4. panel.attachToDOM(parent) creates DOM container, shows loading state
5. Data fetched in priority order: P0 (weather) → P1 (stocks, news, crypto) → P2 (sports, chat, notes)
6. panel.startDataCycle() calls fetchData() then starts setInterval(refreshInterval)
7. After successful fetch, dispatches `dashview:panel-data` event for intelligence/pulse
8. panel.renderAtSize(size) renders appropriate compact/medium/large variant
9. panel.render() updates the DOM directly (no virtual DOM)

## File Structure
- Panel classes: `src/panels/` (WeatherPanel.ts, StocksPanel.ts, etc.)
- Services: `src/services/` (weather.ts, spaces.ts, intelligence.ts, interests.ts, aiShell.ts, etc.)
- Edge Functions: `api/` (weather.ts, ai-shell.ts, etc.)
- UI modules: `src/ui/` (aiBar.ts, spaceBar.ts, widgetGrid.ts, pulseBar.ts, settingsPanel.ts, aiOverlay.ts, etc.)
- Config: `src/config/` (theme.ts, themes.ts, density.ts, preferences.ts)
- Types: `src/types/index.ts`
- Styles: `src/styles/` (panel.css, layout.css, ai-bar.css, space-bar.css, pulse-bar.css, etc.)
- DOM helpers: `src/utils/dom.ts` — `createElement()`, `qs()`
- Fetch utility: `src/utils/fetch.ts` — `fetchWithRetry()`
- Storage: `src/services/storage.ts` — `get()`, `set()`

## Key Commands
npm run dev        → Start dev server (localhost:5173)
npm run build      → Production build (dist/) + SW manifest injection
npm run preview    → Preview production build locally
npx vitest run     → Run test suite
vercel             → Deploy to Vercel

## Panel Status
- [x] Weather (OpenWeatherMap) — world, priority 0, compact variant
- [x] Stocks (Finnhub) — markets, priority 1, price alerts, compact variant
- [x] News (RSS feeds via proxy) — world, priority 1
- [x] Sports (ESPN) — world, priority 2, compact variant
- [x] Crypto (CoinGecko) — markets, priority 1, price alerts, compact variant
- [x] Chat (multi-provider) — personal, priority 2
- [x] Notes (localStorage) — utility, priority 2, no network
- [ ] Calendar (Google Calendar API) — personal, planned
- [x] Entertainment (TMDB) — world, priority 2, compact variant

## Shared Context — home-base
This project is part of a portfolio managed from ~/Projects/home-base.
Before planning features or making architectural decisions, reference:
- `~/Projects/home-base/registry.md` — project registry, status, and cross-project alignment
- `~/Projects/home-base/apis/catalog.md` — curated API catalog for potential integrations and new panels
- `~/Projects/home-base/standards/quality.md` — shared quality standards
- `~/Projects/home-base/standards/design-principles.md` — shared design philosophy
- `~/Projects/home-base/personal/CLAUDE.local.md` — who Ethan is, how he works

When planning new panels, check the API catalog first — it maps APIs to DashPulse features.

## Important Notes
- No React or UI framework — vanilla TypeScript + DOM
- .env.local for deployer API keys (gitignored), .env.example committed
- `ANTHROPIC_API_KEY` env var powers deployer-hosted Haiku for AI shell (5 free queries/day per user)
- Finnhub free tier: 60 calls/min
- RSS feeds fetched server-side via proxy to avoid CORS
- No personal data in defaults — location auto-detected, tickers are broad market
- Adding a new panel: create class extending Panel with category, register in dashboard.ts, add Edge Function if needed
- Three themes (dark/light/OLED) stored in dashview:theme, three density modes in dashview:density
- Terminal aesthetic: JetBrains Mono font, category accent stripes, uppercase monospace section headers
- Unit preferences (°F/°C, 12h/24h) stored in dashview:preferences
- AI Bar: Cmd+K opens AI bar, `/` prefix for commands, natural language for AI queries
- Keyboard shortcuts: Cmd+K AI bar, ? help, t theme, 1-6 panels, Esc close
- AI-driven onboarding: interests picker → personalized spaces (dashview:onboarding)
- All panels support collapse (click header), state persists per panel
- ARIA landmarks, skip-link, focus-visible, and role attributes for screen readers
- PWA: manifest.json, service worker (public/sw.js), install prompt, offline indicator
- SW caching: network-first for API, cache-first for static/external assets, stale fallback when offline
- Price alerts: stored in dashview-alerts, tier-gated (5 free / unlimited premium), browser notifications via SW
- Notes: stored in dashview-notes, fully offline, no refresh cycle
- Export/Import: JSON config portability via configSync.ts, excludes sensitive keys
- Analytics: lightweight event tracking in dashview-analytics, 30-day rolling window, visible in settings
- Layout: 12-column CSS grid per space, responsive (12 cols >1200px, 8 cols 768-1200px, 1 col <768px)
- Multi-location weather: up to 5 saved locations in dashview-locations, pill switcher in panel
- Cross-device sync: logged-in users sync preferences to KV via api/prefs.ts
  - Pulls on login and tab focus (5-min cooldown), pushes on change (5-sec debounce)
  - Conflict resolution: per-key merge, local dirty keys take priority over server
  - Beacon flush on tab close for pending changes
  - Change tracking via dashview:storage-changed CustomEvent on document
