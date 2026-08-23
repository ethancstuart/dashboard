/**
 * Lightweight per-page SEO helper.
 *
 * Updates <title>, <meta name="description">, <link rel="canonical">,
 * Open Graph + Twitter Card meta tags on route changes. Runs entirely
 * client-side because NexusWatch is a hash-based SPA — search engines
 * see the index.html defaults; this exists for share-link unfurls in
 * apps that execute JS (Slack desktop, iMessage previews) and for the
 * local dev / human user.
 *
 * For SEO that matters to crawlers, the server-rendered shells under
 * /api/brief/og and /api/country/[code] already set proper meta tags
 * and JSON-LD via the Vercel rewrite. This helper is the SPA mirror.
 */

const BASE_URL = 'https://nexuswatch.dev';
const DEFAULT_OG = `${BASE_URL}/api/og?type=site`;

export interface PageSeo {
  /** Page name without site suffix. Final title becomes "X · NexusWatch". */
  title: string;
  /** 140-160 char description, ending with "Free." for marketing pages. */
  description: string;
  /** Path WITHOUT origin, e.g. "/about" or "/brief/2026-04-27". */
  canonicalPath: string;
  /** Full OG image URL (defaults to /api/og?type=site). */
  ogImage?: string;
  /** og:type, defaults to "website". Set "article" for briefs. */
  ogType?: 'website' | 'article';
}

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function setPageSeo(seo: PageSeo): void {
  const fullTitle = seo.title.endsWith('NexusWatch') ? seo.title : `${seo.title} · NexusWatch`;
  document.title = fullTitle;

  const canonical = seo.canonicalPath.startsWith('http')
    ? seo.canonicalPath
    : `${BASE_URL}${seo.canonicalPath.startsWith('/') ? '' : '/'}${seo.canonicalPath}`;
  const image = seo.ogImage || DEFAULT_OG;
  const ogType = seo.ogType || 'website';

  setMeta('meta[name="description"]', 'name', 'description', seo.description);
  setLink('canonical', canonical);

  // Open Graph
  setMeta('meta[property="og:title"]', 'property', 'og:title', fullTitle);
  setMeta('meta[property="og:description"]', 'property', 'og:description', seo.description);
  setMeta('meta[property="og:url"]', 'property', 'og:url', canonical);
  setMeta('meta[property="og:image"]', 'property', 'og:image', image);
  setMeta('meta[property="og:type"]', 'property', 'og:type', ogType);

  // Twitter
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle);
  setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', seo.description);
  setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', image);
}

/**
 * Inject a JSON-LD structured-data block. Pass a unique id so re-renders
 * replace the previous block instead of accumulating.
 */
export function setJsonLd(id: string, data: Record<string, unknown>): void {
  const existing = document.head.querySelector<HTMLScriptElement>(
    `script[type="application/ld+json"][data-seo="${id}"]`,
  );
  if (existing) existing.remove();
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.setAttribute('data-seo', id);
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

export const PAGE_SEO = {
  landing: {
    title: 'Real-Time Geopolitical Intelligence',
    description:
      '45+ live data layers on a 3D globe. 158 countries scored. Daily AI briefs and dark vessel detection. Open-source. Free.',
    canonicalPath: '/',
  },
  intel: {
    title: 'Intel Map',
    description:
      'A 3D globe of every conflict, disaster, vessel, satellite, and signal we track in real time. Toggle 45+ data layers. Free.',
    canonicalPath: '/intel',
  },
  about: {
    title: 'About',
    description:
      'NexusWatch is an open-source geopolitical intelligence platform built for analysts, journalists, and the curious. Free.',
    canonicalPath: '/about',
  },
  whyFree: {
    title: 'Why Free',
    description:
      'Why NexusWatch is free, forever. The economics, the open-source license, and the case for accessible geopolitical intelligence. Free.',
    canonicalPath: '/why-free',
  },
  briefs: {
    title: 'Daily Briefs',
    description:
      'Three-minute geopolitical intelligence brief, every morning at 5 AM ET. Composed by AI, evidence-chained, free to read. Free.',
    canonicalPath: '/briefs',
  },
  compare: {
    title: 'Compare Countries',
    description:
      'Side-by-side instability scoring across 158 countries: conflict, disasters, sentiment, infrastructure, governance, market exposure. Free.',
    canonicalPath: '/compare',
  },
  watchlist: {
    title: 'Watchlist',
    description:
      'Track the countries, regions, and signals you care about. Personalized morning briefs. Browser notifications. Free.',
    canonicalPath: '/watchlist',
  },
  feed: {
    title: 'Live Feed',
    description:
      'Continuous stream of conflict events, disasters, market moves, and intelligence signals. Filter by region or layer. Free.',
    canonicalPath: '/feed',
  },
  faq: {
    title: 'FAQ',
    description:
      'Common questions about NexusWatch — data sources, methodology, the Country Instability Index, and why the product is free. Free.',
    canonicalPath: '/faq',
  },
  methodology: {
    title: 'Methodology',
    description:
      'How NexusWatch computes the Country Instability Index, weighting, evidence chains, confidence scoring, and source provenance. Free.',
    canonicalPath: '/methodology',
  },
  accuracy: {
    title: 'The Ledger',
    description:
      'Every call NexusWatch makes, resolved against an external source on a date fixed in advance — with the score published whether it flatters us or not.',
    canonicalPath: '/ledger',
  },
  ledger: {
    title: 'The Ledger',
    description:
      'Every call NexusWatch makes, resolved against an external source on a date fixed in advance — with the score published whether it flatters us or not.',
    canonicalPath: '/ledger',
  },
  roadmap: {
    title: 'Roadmap',
    description:
      'What NexusWatch is shipping next — data layers, AI features, and intelligence systems on the public roadmap. Free.',
    canonicalPath: '/roadmap',
  },
  portfolio: {
    title: 'Portfolio Geopolitical Exposure',
    description:
      "Map your portfolio's geopolitical risk exposure to country instability scores across 158 countries. Holdings → CII-weighted exposure. Free.",
    canonicalPath: '/portfolio',
  },
  entities: {
    title: 'Entity Graph',
    description:
      'Browse geopolitical non-state actors — armed groups, intelligence agencies, PMCs, sanctioned organizations. Sponsors, proxies, operating countries. Free.',
    canonicalPath: '/entities',
  },
  countryBrief: {
    title: 'Country Brief',
    description:
      'Printable single-page country brief: CII score, 6-component breakdown, top signals, data gaps, rule version. Suitable for boardrooms. Free.',
    canonicalPath: '/brief-country',
  },
  releaseNotes: {
    title: "What's New",
    description:
      'Release notes for NexusWatch — new data layers, AI features, intelligence systems, and platform improvements. Building in public. Free.',
    canonicalPath: '/whats-new',
  },
  terms: {
    title: 'Terms of Service',
    description:
      'Terms of Service for NexusWatch — usage policies, attribution requirements, and the open-source commitment. Free.',
    canonicalPath: '/terms',
  },
  privacy: {
    title: 'Privacy Policy',
    description:
      'How NexusWatch handles user data — local-first storage, optional cross-device sync, and what we never collect. Free.',
    canonicalPath: '/privacy',
  },
  apidocs: {
    title: 'Public API v2',
    description:
      'NexusWatch Intelligence API v2 — verified geopolitical data with source attribution, confidence scores, and methodology metadata. Free.',
    canonicalPath: '/api',
  },
  mcp: {
    title: 'MCP Server for AI Agents',
    description:
      'Connect Claude Code, Cursor, or any MCP client to NexusWatch. 9 geopolitical intelligence tools — country risk, scenarios, portfolio exposure. No auth. Free.',
    canonicalPath: '/mcp',
  },
  liveBrief: {
    title: 'Live Agent Brief',
    description:
      'Watch a NexusWatch AI agent gather live data and synthesize a geopolitical brief for any country — every tool call visible, every source named. Free.',
    canonicalPath: '/live-brief',
  },
  whatIf: {
    title: 'What-If Scenarios',
    description:
      'Counterfactual geopolitical scenarios — Strait of Hormuz, Taiwan blockade, Russia-NATO, and 11 more. Deterministic CII cascade + AI agent interpretation. Free.',
    canonicalPath: '/what-if',
  },
  cinematic: {
    title: 'The World, As It Moves',
    description:
      'A cinematic look at the world tonight — live crisis triggers, animated globe, scroll-driven narrative. The shareable face of NexusWatch. Free.',
    canonicalPath: '/cinematic',
  },
  lab: {
    title: 'Data Lab',
    description:
      'Run SQL against the NexusWatch public dataset in your browser. DuckDB-WASM, Parquet exports, one-click charts. No login. Free.',
    canonicalPath: '/lab',
  },
  audio: {
    title: 'NexusWatch FM',
    description:
      'Daily 90-second AI-narrated geopolitical brief, public podcast feed, plus a "call the analyst" voice agent. Subscribe in Apple/Spotify. Free.',
    canonicalPath: '/audio',
  },
  globe: {
    title: 'Time-Machine Globe',
    description:
      'WebGL Earth with atmospheric glow, day/night terminator, NASA clouds, pulsing crisis markers, and a draggable time scrubber. Free.',
    canonicalPath: '/globe',
  },
  audit: {
    title: 'Public Audit Viewer',
    description:
      "Drill into any country's CII computation history — every rule applied, every source cited, every delta. Radical transparency. Free.",
    canonicalPath: '/audit',
  },
  status: {
    title: 'Data Health',
    description:
      'Real-time service health for every NexusWatch data source — 45+ layers, circuit-breaker states, last-success timestamps. Public transparency. Free.',
    canonicalPath: '/status',
  },
  caseStudy: {
    title: 'Case Study',
    description:
      'Technical case study for NexusWatch — system design, data pipeline, AI integration, and the engineering choices behind the platform. Free.',
    canonicalPath: '/case-study',
  },
  // ---------------------------------------------------------------------------
  // Routes intentionally without entries:
  //
  //   /welcome          — onboarding flow, transient, behind first-visit gate
  //   /settings         — account settings, requires login, noindex by intent
  //   /admin/*          — admin tooling (social-queue, marketing), private
  //   /entities/:id     — dynamic detail; uses entities entry as base then
  //                       overrides via setPageSeo() per entity at render time
  //   /audit/:country   — dynamic detail; uses audit entry as base
  //   /brief/:date      — dynamic brief detail; sets canonical per brief
  //
  // These either don't need SEO (private) or override the base entry at
  // render time with the dynamic resource's title/description.
  // ---------------------------------------------------------------------------
} as const satisfies Record<string, PageSeo>;
