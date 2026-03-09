# DashPulse Roadmap

## Shipped

### Core Dashboard
- Panel-based architecture with self-contained data sources
- Weather panel (OpenWeatherMap) with 3-day forecast, hourly sparklines, interactive map
- Markets panel (Finnhub) with 10-stock watchlist, detail views, drag-to-reorder, sparklines
- Crypto panel (CoinGecko) with top 10 coins, 7-day sparklines, market cap, ATH tracking
- News panel with 7 categories, interactive Mapbox map with day/night terminator
- Sports panel (ESPN) with NBA, NFL, MLB, EPL live scores and team favorites
- Notes panel with quick-capture to-dos, fully offline

### AI & Intelligence
- Multi-provider AI chat (Anthropic, OpenAI, Google, xAI) with BYO key
- Daily AI briefing using live dashboard context
- Prediction markets (Polymarket, Kalshi)
- Scrolling market ticker

### Platform
- Google/GitHub OAuth with guest, free, and premium tiers
- PWA with service worker, offline caching, install prompt
- Command palette (Cmd+K)
- Price alerts with browser notifications (tier-gated)
- Export/import dashboard config as JSON
- Lightweight usage analytics (30-day rolling window)

### UX & Accessibility
- Dark, light, and OLED black themes
- 3 density modes (compact, comfortable, spacious)
- Responsive panel grid layout
- Keyboard shortcuts (press ? for help)
- ARIA landmarks, skip-link, focus-visible, screen reader support
- 5-step onboarding flow for first-time visitors
- Priority-based data loading, collapsible panels, retry on error

### Infrastructure
- Vercel Edge Function API proxying (keys stay server-side)
- Circuit breaker fetch pattern (3 failures, 5-min backoff)
- Security headers (CSP, HSTS, X-Frame-Options)
- CI pipeline (build check on PRs)

## Phase 2 — Sign-In Value
- Cross-device sync
- Custom news sources
- Multiple weather locations
- Dashboard sharing

## Phase 3 — Premium Features
- Hosted AI chat (no key needed)
- Drag-and-drop layout
- Calendar integration (Google Calendar)
- Advanced alert conditions

## Phase 4 — Platform Expansion
- Stripe payments
- Plugin SDK
- Custom dashboards
- API access

## Phase 5 — AI-Native Intelligence
- AI co-pilot
- Natural language config
- Trend detection
- Smart defaults

## Open Source
DashPulse is MIT licensed and free forever. If community interest grows, a managed hosted version may be offered as a convenience -- the open-source tool will always remain fully functional and free.
