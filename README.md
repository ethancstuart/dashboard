# DashPulse

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Deployed on Vercel](https://img.shields.io/badge/deployed%20on-Vercel-black.svg)](https://dashpulse.app)
[![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-blueviolet.svg)](https://claude.ai/claude-code)

**Your real-time intelligence dashboard.** Weather, markets, news, sports, predictions, and AI chat -- all in one browser tab. No framework, no bloat, just live data.

Built entirely with [Claude Code](https://claude.ai/claude-code).

## What's Live

- **Weather** -- Hyperlocal forecasts, hourly sparklines, conditions on an interactive world map, °F/°C toggle
- **Markets** -- 10-stock watchlist with real-time quotes, detail views, drag-to-reorder, and sparklines (Finnhub)
- **Crypto** -- Top 10 coins with 7-day sparklines, market cap, volume, ATH tracking (CoinGecko)
- **News** -- 7 categories with headlines mapped to their origin on an interactive Mapbox map with day/night terminator
- **Sports** -- NBA, NFL, MLB, EPL live scores with team favorites
- **AI Chat** -- Multi-provider (Anthropic, OpenAI, Google, xAI), bring your own API key
- **Daily Briefing** -- AI-generated morning summary using live dashboard data
- **Notes** -- Quick-capture notes and to-dos, fully offline, persists in localStorage
- **Price Alerts** -- Set stock/crypto price thresholds, browser notifications, tier-gated (3 free)
- **Predictions** -- Live odds from Polymarket and Kalshi
- **Market Ticker** -- Scrolling real-time market data
- **Command Palette** -- Cmd+K to search commands, jump to panels, manage alerts, export/import config
- **PWA + Offline** -- Installable as native app, service worker caching, offline indicator
- **Export/Import** -- Download/restore dashboard config as JSON (zero-backend config portability)
- **Usage Analytics** -- Lightweight local tracking of panel views, feature usage, 30-day rolling window
- **Auth** -- Google/GitHub OAuth with guest, free, and premium tiers
- **Themes** -- Dark, light, and OLED black with 3 density modes (compact/comfortable/spacious)
- **Responsive Layout** -- Panel grid adapts from 3-4 columns (desktop) to 1 column (mobile)
- **Keyboard Shortcuts** -- Full shortcut system (press `?` for help)
- **Accessibility** -- ARIA landmarks, skip-link, focus-visible outlines, screen reader support
- **Onboarding** -- Guided setup for first-time visitors
- **Smart Loading** -- Priority-based data fetching, collapsible panels, retry on error

## Quick Start

```bash
git clone https://github.com/ethancstuart/Dashboard.git
cd Dashboard
cp .env.example .env.local
# Add your API keys to .env.local
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173) to see the dashboard.

## API Keys

| Service | Tier | Purpose |
|---------|------|---------|
| [OpenWeatherMap](https://openweathermap.org/api) | Free | Weather data |
| [Finnhub](https://finnhub.io) | Free (60 calls/min) | Stock quotes |
| [Mapbox](https://www.mapbox.com) | Free tier | News map |

Optional (BYO key for AI Chat): Anthropic, OpenAI, Google AI, xAI

## Architecture

Panel-based -- every data source is a self-contained TypeScript class with its own refresh cycle. No React, no framework. DOM updates are direct. API keys are proxied through Vercel Edge Functions (never exposed client-side).

- **Panels:** `src/panels/` -- WeatherPanel, StocksPanel, NewsPanel, SportsPanel, CryptoPanel, ChatPanel, NotesPanel
- **Services:** `src/services/` -- API clients, auth, storage
- **Edge Functions:** `api/` -- server-side API proxies
- **Pages:** `src/pages/` -- landing, roadmap, dashboard

User preferences persist in localStorage (no backend database for core features). Circuit breaker pattern on all fetches -- 3 failures trigger 5-minute backoff.

## Commands

```bash
npm run dev        # Dev server (localhost:5173)
npm run build      # Production build
npm run preview    # Preview production build
vercel             # Deploy to Vercel
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, PR guidelines, and architecture overview.

## Tech Stack

- [Vite](https://vitejs.dev) + TypeScript (strict mode)
- Vanilla DOM (no framework)
- CSS custom properties for theming
- [Vercel](https://vercel.com) Edge Functions
- [Leaflet](https://leafletjs.com) + [Mapbox](https://www.mapbox.com) for maps

## License

MIT
