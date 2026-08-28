import { defineConfig } from 'vitest/config';
import { visualizer } from 'rollup-plugin-visualizer';

// Bundle analyzer is opt-in via env var to avoid slowing routine builds.
// Run with: ANALYZE=1 npm run build
const ANALYZE = process.env.ANALYZE === '1' || process.env.ANALYZE === 'true';

export default defineConfig({
  build: {
    manifest: true,
    chunkSizeWarningLimit: 1100, // MapLibre is ~1MB, expected
    rollupOptions: {
      output: {
        // Vendor chunk strategy:
        //   - vendor-maplibre: MapLibre GL is the heaviest dep (~1MB).
        //     Isolating it lets the dashboard chunk be cached independently
        //     and lets non-map routes skip downloading it entirely.
        //   - vendor-d3: d3 is only used by a handful of UI modules
        //     (sparklines, charts). Splitting prevents accidental inclusion
        //     in the landing chunk.
        //   - vendor-satellite: satellite.js is only used by the satellite
        //     map layer (lazy-loaded).
        //   - vendor-sentry: pulled in at boot but cleanly separable so
        //     parsing the main app chunk is faster.
        //   - vendor-neon: server-side data lib, tiny but split for clarity.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('maplibre-gl')) return 'vendor-maplibre';
          if (id.includes('@sentry')) return 'vendor-sentry';
          if (id.includes('satellite.js')) return 'vendor-satellite';
          if (id.includes('/d3-') || id.includes('node_modules/d3/')) return 'vendor-d3';
          if (id.includes('@neondatabase')) return 'vendor-neon';
          // Other vendor code falls into the default per-entry chunk.
          return undefined;
        },
      },
    },
  },
  plugins: ANALYZE
    ? [
        visualizer({
          filename: `docs/perf/bundle-${new Date().toISOString().slice(0, 10)}.html`,
          gzipSize: true,
          brotliSize: true,
          template: 'treemap',
          open: false,
        }),
      ]
    : [],
  test: {
    environment: 'happy-dom',
    // EXCLUDE AGENT WORKTREES. `.claude/worktrees/` sits INSIDE the repo, so a
    // running agent's checkout doubled the suite (429 -> 868 on 2026-08-28) and
    // every test count taken during that window was measuring the wrong thing.
    // Worse: a stale worktree pinned to an older commit can fail CI on main for
    // code main does not contain. Default excludes are restated because
    // supplying `exclude` replaces them rather than extending them.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/worktrees/**', '**/.git/**'],
  },
});
