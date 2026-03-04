# dashview

Open-source real-time intelligence dashboard. Built with Vite + TypeScript. No framework.

## Quick Start
```bash
git clone https://github.com/YOUR_USERNAME/dashview.git
cd dashview
cp .env.example .env.local
# Add your API keys to .env.local
npm install
npm run dev
```

## API Keys Needed

- **OpenWeatherMap** (free): https://openweathermap.org/api
- **Finnhub** (free, coming in Phase 2): https://finnhub.io

## Architecture

Panel-based — every data source is a self-contained class with its own refresh cycle. No backend database. User preferences stored in localStorage. API keys proxied through Vercel Edge Functions.

See [ROADMAP.md](ROADMAP.md) for what's shipped and what's coming.

## Built With

- [Vite](https://vitejs.dev) + TypeScript
- [Vercel](https://vercel.com) Edge Functions
- [Claude Code](https://docs.anthropic.com) — built entirely through AI-assisted development

## License

MIT
