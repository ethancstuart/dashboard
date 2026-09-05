/**
 * Global Search — unified index across countries, entities,
 * scenarios, pages, and verified signals.
 *
 * Powers both the Cmd+K command palette and /#/search.
 *
 * Client-side index: fast, no API round-trip. For live signal
 * data (verified events, recent CII changes), pulls from the
 * in-memory caches.
 */

import { getCachedCII, getMonitoredCountries } from './countryInstabilityIndex.ts';
import { ENTITIES } from './entityRegistry.ts';
import { PRESET_SCENARIOS } from './scenarioEngine.ts';
import { getVerifiedSignals } from './verificationEngine.ts';

export type SearchResultKind = 'country' | 'entity' | 'scenario' | 'page' | 'signal' | 'command';

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  /** Icon character or emoji. */
  icon?: string;
  /** Fuzzy match score. Higher = better match. */
  score: number;
  /** Optional keyboard shortcut hint. */
  shortcut?: string;
}

const PAGES: Array<{ id: string; title: string; href: string; keywords: string[]; icon?: string; shortcut?: string }> =
  [
    {
      id: 'briefs',
      title: 'Brief Archive',
      href: '#/briefs',
      keywords: ['newsletter', 'daily', 'archive'],
      icon: '📰',
    },
    {
      id: 'methodology',
      title: 'Methodology',
      href: '#/methodology',
      keywords: ['how', 'cii', 'score', 'formula', 'weights'],
      icon: '📊',
    },
    {
      id: 'accuracy',
      title: 'Accuracy Ledger',
      href: '#/accuracy',
      keywords: ['predictions', 'tracking', 'transparency'],
      icon: '✓',
    },
    { id: 'status', title: 'System Status', href: '#/status', keywords: ['health', 'uptime', 'outage'], icon: '📡' },
    { id: 'api', title: 'API Docs', href: '#/api', keywords: ['endpoint', 'developer', 'rest', 'json'], icon: '⚙' },
    { id: 'roadmap', title: 'Roadmap', href: '#/roadmap', keywords: ['future', 'planned', 'coming soon'], icon: '🗺' },
    { id: 'about', title: 'About NexusWatch', href: '#/about', keywords: ['company', 'info'], icon: 'ⓘ' },
  ];

const COMMANDS: Array<{
  id: string;
  title: string;
  href: string;
  keywords: string[];
  icon?: string;
  shortcut?: string;
}> = [];

/**
 * Score a search term against a target string. Higher = better match.
 * - Exact match: 1000
 * - Starts with: 500
 * - Contains (word boundary): 200
 * - Contains (substring): 100
 * - Fuzzy (letters in order): 50
 */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;

  // Word-boundary match
  const words = t.split(/[\s-_/]+/);
  if (words.some((w) => w.startsWith(q))) return 300;
  if (t.includes(q)) return 100 + (q.length / t.length) * 50;

  // Fuzzy: all letters appear in order
  let ti = 0;
  for (const c of q) {
    ti = t.indexOf(c, ti);
    if (ti === -1) return 0;
    ti++;
  }
  return 30;
}

export function search(query: string, limit = 30): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const results: SearchResult[] = [];

  // Pages
  for (const p of PAGES) {
    const scores = [fuzzyScore(q, p.title), ...p.keywords.map((k) => fuzzyScore(q, k) * 0.7)];
    const maxScore = Math.max(...scores);
    if (maxScore > 0) {
      results.push({
        kind: 'page',
        id: p.id,
        title: p.title,
        subtitle: 'Page',
        href: p.href,
        icon: p.icon,
        score: maxScore,
        shortcut: p.shortcut,
      });
    }
  }

  // Commands
  for (const c of COMMANDS) {
    const scores = [fuzzyScore(q, c.title), ...c.keywords.map((k) => fuzzyScore(q, k) * 0.7)];
    const maxScore = Math.max(...scores);
    if (maxScore > 0) {
      results.push({
        kind: 'command',
        id: c.id,
        title: c.title,
        subtitle: c.shortcut ? `Shortcut: ${c.shortcut}` : 'Command',
        href: c.href,
        icon: c.icon,
        score: maxScore,
        shortcut: c.shortcut,
      });
    }
  }

  // Countries — both CII-ranked and monitored-list
  const monitored = getMonitoredCountries();
  const cii = getCachedCII();
  for (const c of monitored) {
    const cScore = cii.find((s) => s.countryCode === c.code);
    const scores = [fuzzyScore(q, c.name), fuzzyScore(q, c.code) * 1.2];
    const maxScore = Math.max(...scores);
    if (maxScore > 0) {
      results.push({
        kind: 'country',
        id: c.code,
        title: c.name,
        subtitle: cScore ? `CII ${cScore.score} · ${cScore.confidence.toUpperCase()} · ${c.tier}` : `Tier: ${c.tier}`,
        href: `#/audit/${c.code}`,
        icon: '🗺',
        score: maxScore,
      });
    }
  }

  // Entities
  for (const e of ENTITIES) {
    const aliasScores = (e.aliases || []).map((a) => fuzzyScore(q, a));
    const scores = [fuzzyScore(q, e.name), ...aliasScores];
    const maxScore = Math.max(...scores);
    if (maxScore > 0) {
      results.push({
        kind: 'entity',
        id: e.id,
        title: e.name,
        subtitle: `${e.type.replace(/_/g, ' ')} · ${e.homeCountry}${e.sanctioned ? ' · 🚫' : ''}`,
        href: `#/entities/${e.id}`,
        icon: '🕸',
        score: maxScore,
      });
    }
  }

  // Scenarios
  for (const s of PRESET_SCENARIOS) {
    const scores = [fuzzyScore(q, s.name), fuzzyScore(q, s.description) * 0.6];
    const maxScore = Math.max(...scores);
    if (maxScore > 0) {
      results.push({
        kind: 'scenario',
        id: s.id,
        title: s.name,
        subtitle: s.description.slice(0, 70),
        href: '#/ledger',
        icon: '?',
        score: maxScore,
      });
    }
  }

  // Verified signals (live)
  const signals = getVerifiedSignals();
  for (const sig of signals.slice(0, 30)) {
    const text = sig.summary;
    const score = fuzzyScore(q, text);
    if (score > 50) {
      results.push({
        kind: 'signal',
        id: sig.id,
        title: sig.summary.slice(0, 70),
        subtitle: `${sig.level.toUpperCase()} · ${sig.sources.length} sources`,
        href: '#/ledger',
        icon: sig.level === 'confirmed' ? '🛡' : '◈',
        score: score * 0.8, // live signals slightly deprioritized vs canonical
      });
    }
  }

  // Sort and cap
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/** Group results by kind for UI rendering. */
export function groupResults(results: SearchResult[]): Array<{ kind: SearchResultKind; items: SearchResult[] }> {
  const groupOrder: SearchResultKind[] = ['command', 'page', 'country', 'entity', 'scenario', 'signal'];
  const groups = new Map<SearchResultKind, SearchResult[]>();
  for (const r of results) {
    if (!groups.has(r.kind)) groups.set(r.kind, []);
    groups.get(r.kind)!.push(r);
  }
  return groupOrder.filter((k) => groups.has(k)).map((kind) => ({ kind, items: groups.get(kind)! }));
}

export function kindLabel(kind: SearchResultKind): string {
  switch (kind) {
    case 'country':
      return 'Countries';
    case 'entity':
      return 'Entities';
    case 'scenario':
      return 'Scenarios';
    case 'page':
      return 'Pages';
    case 'signal':
      return 'Verified Signals';
    case 'command':
      return 'Commands';
  }
}
