# DashPulse: Portfolio Case Study

## The Problem

The personal dashboard category is stale. Momentum has 3M+ Chrome Web Store users, and the value proposition hasn't changed in a decade: a clock, a greeting, a background photo. These products are passive wallpaper. They display nothing actionable and integrate with nothing real-time.

There is no zero-config, real-time intelligence dashboard built for tech professionals -- people who track markets before standup, scan headlines between meetings, and want weather, scores, and crypto without opening six tabs. The gap is a product that treats a browser's new-tab page as a control surface, not a screensaver.

DashPulse fills that gap: a panel-based, real-time dashboard that ships with smart defaults, runs entirely in the browser, and requires zero accounts or configuration to start using.

## Architecture Decisions

### Vanilla TypeScript over React

The entire application ships at 50-70KB gzipped. An equivalent React build would start at 150KB+ before any application code. For a dashboard that loads on every new tab, payload size is a first-class constraint. Vanilla TypeScript with direct DOM manipulation eliminates the framework tax entirely.

The trade-off is real: no component model, no declarative rendering, no ecosystem of ready-made UI primitives. The mitigation is an abstract `Panel` base class that enforces a consistent lifecycle (`fetchData`, `render`, `attachToDOM`, `startDataCycle`, `toggle`, `setCollapsed`) across all seven panels. Every panel is self-contained -- owns its DOM container, manages its own refresh interval, and handles its own error states.

### Edge Functions for API Proxying

All external API calls route through 12 Vercel Edge Functions. This is a non-negotiable architectural constraint: API keys stay server-side. Users never see a Finnhub key, an OpenWeatherMap key, or an RSS proxy credential in their browser's network tab.

Edge Functions were chosen over traditional serverless for cold-start performance. Sub-50ms cold starts mean the first data fetch after a deploy feels indistinguishable from a cache hit.

The system distinguishes between two panel tiers. Core panels (weather, stocks, news, crypto, sports) use deployer-level API keys set as environment variables. Opt-in panels (AI chat, calendar) use keys the user provides, stored in localStorage. This separation keeps the free tier functional without requiring any user accounts.

### Circuit Breaker on Fetch

Finnhub's free tier allows 60 calls per minute. Without protection, a user refreshing aggressively or a transient API outage would burn through the rate limit and degrade the experience for all users sharing the deployment.

Every fetch routes through `src/utils/fetch.ts`, which implements a circuit breaker finite state machine: three consecutive failures trip the circuit, triggering a five-minute backoff before retrying. This pattern prevents cascade failures and avoids hammering degraded upstream services.

### Priority-Based Panel Loading

Panels are instantiated with explicit priority levels: P0 (weather), P1 (stocks, news, crypto), P2 (sports, chat, notes). On initialization, the app attaches all enabled panels to the DOM immediately -- showing loading states -- then fetches data in priority order. The user sees the most time-sensitive information first without waiting for lower-priority panels to resolve.

Each panel manages its own refresh cycle via `setInterval`, started only after the first successful data fetch. Collapsed panels continue refreshing so data is current when expanded.

## Trade-offs

| Decision | Upside | Cost |
|---|---|---|
| No framework | 50-70KB bundle, zero dependency churn, full DOM control | More boilerplate, no component ecosystem, manual state management |
| PWA distribution | Zero-install, works on any device, offline support | No native push notifications (browser Notification API only), no app store presence |
| Hand-written service worker | Full control over caching strategies per route, no abstraction leaks | No Workbox convenience methods, manual cache versioning, more surface area for bugs |
| localStorage persistence | No backend database, instant reads, works offline | No cross-device sync without additional infrastructure (addressed in Phase 2 via KV-backed sync) |
| Deployer-level API keys | Users get a working dashboard immediately, no signup required | Deployment operator bears API costs, rate limits are shared across all users |

## Technical Highlights

**Circuit breaker FSM.** Three states: closed (normal), open (failing, requests short-circuited), half-open (probing with a single request). Transitions are deterministic based on failure count and cooldown timer. All panels share the same fetch utility, so a single upstream outage doesn't cascade into retry storms.

**Panel abstract class.** The `Panel` base class defines the full lifecycle contract. Subclasses implement `fetchData()` and `render(data)`. The base class handles DOM container creation, loading/error states, collapse persistence, refresh interval management, and cleanup. Adding a new panel is five steps: create the class, implement two methods, register it, add an Edge Function if needed, add types.

**CSS custom properties for theming.** Three themes (dark, light, OLED black) and three density modes (compact, comfortable, spacious) are implemented entirely through CSS custom properties. Theme switching is a single class change on the document root -- no re-rendering, no style recalculation beyond what the browser handles natively.

**Service worker caching strategy.** Network-first for API responses (always attempt fresh data, fall back to cache when offline). Cache-first for static assets and external resources (fonts, map tiles). Stale fallback ensures the dashboard remains functional during connectivity loss. The SW is hand-written with explicit route matching -- no Workbox runtime.

**Command palette.** `Cmd+K` opens a searchable command palette covering panel toggles, theme switching, density modes, alert management, and config export/import. Keyboard shortcuts (`?` for help, `t` for theme, `a` for alerts, `1-6` for panel focus) provide power-user navigation without touching the mouse.

## Metrics

| Dimension | Value |
|---|---|
| Panels | 7 shipped (weather, stocks, news, crypto, sports, chat, notes) |
| Themes | 3 (dark, light, OLED black) |
| Density modes | 3 (compact, comfortable, spacious) |
| Bundle size | ~50-70KB gzipped |
| Edge Functions | 12 |
| Keyboard shortcuts | 10+ bindings |
| Price alerts | Tier-gated (3 free, unlimited premium), browser notifications via service worker |
| Offline support | Full PWA with hand-written service worker, install prompt, offline indicator |
| Auth | Google/GitHub OAuth with guest, free, and premium tiers |
| Accessibility | ARIA landmarks, skip-link, focus-visible, screen reader roles |

## Product Thinking

### Competitive Landscape

**Momentum** (3M+ users) owns the "beautiful new-tab" category but offers no real-time data. **Tabliss** and **Bonjourr** are open-source alternatives in the same passive-wallpaper lane. **Dashy** and **Homer** target self-hosted homelab dashboards -- powerful but require Docker and manual configuration. None of these products serve the use case of a tech professional who wants market data, headlines, and weather in a single glance without infrastructure overhead.

### Target User

Tech professionals -- engineers, product managers, founders -- who consume information across multiple domains daily. They value keyboard-driven interfaces, care about bundle size, and will notice if a dashboard adds 200ms to their new-tab load time.

### Distribution Strategy

Open-source under MIT. The canonical deployment runs on Vercel at dashpulse.app. Any user can fork the repo, set environment variables, and deploy their own instance in under five minutes. This removes vendor lock-in concerns and makes the project portfolio-legible: the entire codebase is public, the architecture is inspectable, and the deployment is reproducible.

If community traction warrants it, a managed hosted version may be offered as a paid convenience. The open-source tool remains fully functional and free.

## What's Next

**Phase 2 -- Sign-In Value.** Cross-device preference sync (shipped: KV-backed with per-key merge and conflict resolution), custom news sources, multiple weather locations (shipped: up to 5 saved locations), and dashboard sharing.

**Phase 3 -- Premium Features.** Hosted AI chat (no user key required), drag-and-drop panel layout, Google Calendar integration, and advanced alert conditions beyond simple price thresholds.

**Phase 4 -- Platform Expansion.** Stripe payments for the premium tier, a plugin SDK enabling third-party panels, support for multiple named dashboards per user, and API access for external integrations.

**Phase 5 -- AI-Native Intelligence.** An AI co-pilot that surfaces insights proactively, natural language configuration ("show me tech stocks and crypto, hide sports"), automated trend detection across panels, and smart defaults that adapt to usage patterns over time.
