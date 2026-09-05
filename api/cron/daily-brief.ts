import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { truncateForX, xWeightedLength } from '../_lib/x-post.js';
import { channelsToAlert, formatAlertBody } from '../_lib/delivery-health.js';
import { groundDraft, type GroundingReport } from '../_lib/grounding.js';
import {
  DAILY_SECTIONS,
  SUNDAY_SECTIONS,
  validateBriefStructure,
  parseDeclaredSubject,
  chooseSubject,
} from '../_lib/brief-structure.js';
import { formatLedgerSummary, CALIBRATION_KINDS, type Call, type LedgerSummaryRow } from '../_lib/calls.js';
import { checkBudget, recordAnthropicSpend } from '../_lib/llm-budget.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

interface CIIEntry {
  code: string;
  name: string;
  /** Structural level (0-100) — changes only when baselines are reviewed. */
  score: number;
  /** Today's live deviation in points; the number that actually moves. */
  deviation: number;
  prevScore: number | null;
  prevDeviation: number | null;
  components: Record<string, number>;
}

interface MarketQuote {
  symbol: string;
  price: string;
  change: string;
  direction: 'up' | 'down' | 'flat';
}

export interface BriefData {
  date: string;
  utcTime: string;
  topRiskCountries: CIIEntry[];
  totalCountries: number;
  earthquakeCount: number;
  significantQuakes: string[];
  diseaseCount: number;
  recentOutbreaks: string[];
  conflictHeadlines: string[];
  markets: MarketQuote[];
  yesterdayEqCount: number | null;
  weeklyTrends: WeeklyTrend[];
  correlations: string[];
  newsHeadlines: NewsItem[];
  /** Pre-formatted open-call lines (divergence-ordered), for Today's Call. */
  openCallLines: string[];
  /**
   * Pre-formatted lines for calls RESOLVED in the current window (today, or
   * the last 7 days on Sundays). First line is always the aggregate.
   *
   * This field exists because of 2026-09-05: on the first resolution day in
   * the product's history, the model led with an unrelated FX call. It had no
   * way to do otherwise — the only calls query feeding the prompt selected
   * `status = 'pending'`, so the one thing the register exists to produce was
   * invisible to the writer the moment it existed.
   */
  resolvedCallLines: string[];
}

interface WeeklyTrend {
  name: string;
  code: string;
  scores: { date: string; score: number }[];
  currentScore: number;
  weekAgoScore: number | null;
  direction: 'rising' | 'falling' | 'stable' | 'volatile';
}

interface NewsItem {
  title: string;
  source: string;
}

// Critical infrastructure for proximity correlation detection
const CRITICAL_INFRA: { name: string; type: string; lat: number; lon: number }[] = [
  { name: 'Zaporizhzhia NPP', type: 'nuclear', lat: 47.51, lon: 34.58 },
  { name: 'Bushehr NPP', type: 'nuclear', lat: 28.83, lon: 50.89 },
  { name: 'Fukushima Daiichi', type: 'nuclear', lat: 37.42, lon: 141.03 },
  { name: 'Strait of Hormuz', type: 'chokepoint', lat: 26.56, lon: 56.25 },
  { name: 'Bab el-Mandeb', type: 'chokepoint', lat: 12.58, lon: 43.33 },
  { name: 'Suez Canal', type: 'chokepoint', lat: 30.46, lon: 32.34 },
  { name: 'Malacca Strait', type: 'chokepoint', lat: 2.5, lon: 101.8 },
  { name: 'Taiwan Strait', type: 'chokepoint', lat: 24.0, lon: 119.0 },
  { name: 'Panama Canal', type: 'chokepoint', lat: 9.08, lon: -79.68 },
  { name: 'Port of Shanghai', type: 'port', lat: 31.35, lon: 121.6 },
  { name: 'Port of Rotterdam', type: 'port', lat: 51.95, lon: 4.13 },
  { name: 'Port of Singapore', type: 'port', lat: 1.26, lon: 103.84 },
  { name: 'Ras Tanura Terminal', type: 'energy', lat: 26.64, lon: 50.15 },
  { name: 'Druzhba Pipeline Hub', type: 'energy', lat: 52.1, lon: 23.7 },
  { name: 'Kharg Island Terminal', type: 'energy', lat: 29.23, lon: 50.31 },
];

// OSINT + world news RSS feeds for headline context
/**
 * The brief's news roster.
 *
 * This was five English-language feeds — Bellingcat, Crisis Group, BBC World,
 * Al Jazeera, DW — for a product that claims a global view. 109 of the first
 * 133 briefs mentioned Bellingcat and one recent edition drew 5 of 5 "top
 * stories" from it, including a football-betting piece. Bellingcat is an
 * investigations shop on a multi-week cadence: excellent, and the wrong tempo
 * to drive a daily. Measured coverage across 120 briefs: Iran 120, Mexico 5,
 * Nigeria 8, DR Congo 7.
 *
 * EVERY FEED BELOW WAS FETCHED AND CONFIRMED TO RETURN ITEMS before being
 * added. Candidates that failed are recorded in the gap note rather than
 * added hopefully — an empty source is how V-Dem ended up cited on the landing
 * page for four months while its table held zero rows.
 *
 * STATE MEDIA IS INCLUDED AND TAGGED. It is never a fact source. What a state
 * outlet chooses to emphasise is evidence of that state's posture, which is
 * a different and genuinely useful observable — but it may only ever be cited
 * as "TASS is framing X as Y", never as "X happened". The tag is what makes
 * that rule enforceable in the prompt.
 *
 * KNOWN GAP, stated rather than papered over: there is no wire service here.
 * AP, Reuters, ISW, the Kyiv Independent and Times of Israel were all tested
 * and all failed (connection failure, 403, or 404). A daily brief without a
 * wire is a real weakness and it should be closed with a paid or authenticated
 * feed rather than by pretending.
 */
type BriefFeed = { url: string; source: string; region: string; stateMedia?: true };

const BRIEF_RSS_FEEDS: BriefFeed[] = [
  // Investigative and analytic
  { url: 'https://www.bellingcat.com/feed/', source: 'Bellingcat', region: 'global' },
  { url: 'https://www.crisisgroup.org/rss.xml', source: 'Crisis Group', region: 'global' },
  // Anglophone internationals
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World', region: 'global' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera', region: 'mena' },
  { url: 'https://rss.dw.com/xml/rss-en-all', source: 'DW', region: 'europe' },
  // Regional origin — the actual gap
  { url: 'https://www.thehindu.com/news/international/feeder/default.rss', source: 'The Hindu', region: 'south-asia' },
  { url: 'https://asia.nikkei.com/rss/feed/nar', source: 'Nikkei Asia', region: 'east-asia' },
  { url: 'https://www.scmp.com/rss/91/feed', source: 'SCMP', region: 'east-asia' },
  { url: 'https://www.premiumtimesng.com/feed', source: 'Premium Times', region: 'west-africa' },
  { url: 'https://www.dailymaverick.co.za/dmrss/', source: 'Daily Maverick', region: 'southern-africa' },
  { url: 'https://www.batimes.com.ar/feed', source: 'Buenos Aires Herald', region: 'latam' },
  { url: 'https://en.mercopress.com/rss/', source: 'MercoPress', region: 'latam' },
  { url: 'https://meduza.io/rss/en/all', source: 'Meduza', region: 'russia' },
  // State media — posture, never fact
  { url: 'https://tass.com/rss/v2.xml', source: 'TASS', region: 'russia', stateMedia: true },
  { url: 'https://www.globaltimes.cn/rss/outbrain.xml', source: 'Global Times', region: 'china', stateMedia: true },
  { url: 'https://en.irna.ir/rss', source: 'IRNA', region: 'iran', stateMedia: true },
];

/** Source names that may only be cited as evidence of state framing. */
const STATE_MEDIA_SOURCES = new Set(BRIEF_RSS_FEEDS.filter((f) => f.stateMedia).map((f) => f.source));

// === The NexusWatch Brief — AI Prompt ===
function getBriefSystemPrompt(now: Date): string {
  // UTC day index. 0=Sun, 1=Mon ... 5=Fri, 6=Sat. The cron runs at 10:00 UTC
  // (5:00 AM ET) so UTC day and US-East day match for the whole publication.
  const dayOfWeek = now.getUTCDay();
  const isSunday = dayOfWeek === 0;
  // Friday tool-of-the-week is gone with One More Thing (structure swap
  // 2026-08-23); neither the prompt nor the fallback varies by weekday now.

  // ---------------------------------------------------------------------------
  // Base voice — the 40/60 analyst/smart-friend rubric locked 2026-04-11.
  // Source of truth: docs/voice/nexuswatch-voice.md (Track C.0 Voice Model).
  // Changes here must stay in sync with the voice spec or the drafting engine
  // (Track C) and the newsletter will drift apart.
  // ---------------------------------------------------------------------------
  const baseVoice = `You are the editorial voice of The NexusWatch Brief, a daily geopolitical intelligence newsletter read by traders, analysts, founders, and curious professionals over morning coffee.

VOICE — 40% analyst / 60% smart friend. Get this right:
- You are a smart, well-connected friend who happens to run a global intelligence platform.
- Use "we" as the brand pronoun. "We're watching Iran closely" / "We flagged this yesterday." Never "I", never reference a specific founder or author.
- Conversational but credible — like a Bloomberg reporter at a dinner party, not a cable news anchor.
- Show personality on big days: "Okay, this one's worth your attention" / "This caught our eye" / "Big day."
- Every sentence must pass the "would I actually say this to a smart friend?" test.
- Brevity is respect. Every sentence earns its place. Target ~800-1000 words total.

FORBIDDEN PHRASES (auto-reject and rewrite if any appear):
- "geopolitical landscape"
- "in the realm of"
- "it remains to be seen"
- "remains a concern"
- "amid growing tensions"
- "tensions are rising"
- "experts say" / "analysts say" / "sources say"
- "a major development"
- "unprecedented"
- Any sentence that sounds like a government report, a college essay, or a LinkedIn post.

AUDIENCE: Global professionals — traders, analysts, founders, policy people, OSINT enthusiasts, journalists, corporate risk managers, defense-industry watchers. Frame events for a sophisticated, internationally-minded audience.

EDITORIAL STANCE — procedure, not position (owner ruling 2026-08-22):
We do not have a side. We have resolution criteria. Neutrality is enforced by
these mechanisms, every one of which a reader can check:
- THE ACTOR-SWAP TEST. Before writing any sentence about a state's behaviour,
  confirm you would publish the identical sentence with the actor names
  exchanged. If you would not, rewrite it. Apply this to every conflict
  sentence without exception.
- SYMMETRIC SOURCING. On any state-versus-state item, draw on at least one
  source from each side's information environment plus one third party, and
  name them in the text.
- NAME THE GAPS. Where the data is thin, say so and say where. "We have no
  reliable displacement data past March — treat this as low confidence" builds
  more trust than hedged prose.
- FACTS OF LAW AND OF THE RECORD ARE FACTS, NOT POSITIONS. An invasion is an
  invasion; a designation is a designation; a court ruling is a court ruling.
  Report the noun. Do not supply the adjective.
- Do NOT editorialize on which side is justified. Present what happened, cite
  the source, explain why it matters.
- Energy analysis covers global supply-chain dynamics, not any nation's interests.
- Epistemic humility IS the brand. When confidence is low, say so.

ATTRIBUTION: You are NexusWatch — the platform IS the source. Don't attribute to "reports say" or "according to sources." When referencing a specific investigation or report (Bellingcat, Crisis Group, ISW), name it. Otherwise, state facts with authority.

CRITICAL RULES:
- NEVER fabricate events, names, or claims not in the data. If the data doesn't support it, don't write it.
- NO SELF-HISTORY. Never write "the biggest move we've logged this year", "the
  last time we saw this", or compare to any past NexusWatch observation. This
  archive begins 2026-04-08 and holds no such history, so every one of those
  sentences has been invented — including a "2018 Sulawesi moved the CII
  equivalent by 28 points" that predates the product by eight years. A brief
  whose entire claim is a published record cannot invent its own record.
- NO RETROSPECTIVE CLAIMS AT ALL unless the item is in today's context. No past
  price moves, no historical analogies, no "in 2019...". You cannot check them
  and neither can the reader.
- ATTRIBUTE IN THE SENTENCE, not in a footnote. Any non-trivial factual claim
  names its source inline: "OONI recorded 2,136 confirmed blocks in Russia this
  week", not "Russia is tightening controls". Never name a source that is not in
  the context — published briefs have carried "ACLED reports 400+ civilian
  casualties" when ACLED has never been contacted by this system.
- SEPARATE OBSERVED FROM ASSESSED. "OONI recorded X" is observed. "We read this
  as pre-emptive posture" is assessed, and assessment carries a confidence word
  and a reason: "moderate confidence — single source, no corroboration yet."
- DO synthesize and connect dots — this is analysis, not aggregation.
- LEAD WITH STATE BEHAVIOUR. The Top Signal covers something a government,
  bloc or armed actor DID or DECIDED — a designation, a vote, a deployment, a
  blocking order, a negotiation, a court ruling. A natural event leads only when
  it has crossed a consequence threshold: major damage, population displacement,
  or disruption to energy, nuclear, port or cable infrastructure. "An earthquake
  occurred 180km from a facility" is a distance calculation, not news.
- The POLITICAL SIGNAL section is the highest-value input in the data context.
  Censorship and network interference are among the most reliable open leading
  indicators of a political crackdown, and they are frequently days ahead of any
  wire report. Use them.
- Be specific: numbers, country names, magnitudes, percentages.
- If data is thin on a topic, say less, not vaguer things.
- "Your Watchlist" is NOT generated by you. Ignore any user-specific content in your output — the template layer appends a per-user Watchlist section after your output.`;

  // ---------------------------------------------------------------------------
  // Sunday variant — Week in Review. Reflective, trajectory-focused.
  // ---------------------------------------------------------------------------
  if (isSunday) {
    return `${baseVoice}

OUTPUT FORMAT: Clean markdown. Use ## for section headers with emoji prefixes. **bold** for emphasis. Numbered lists for stories. Bullet points for outlook.

THIS IS THE SUNDAY WEEK IN REVIEW EDITION. Different structure from daily briefs — reflective, trajectory-focused.

FIRST LINE OF YOUR OUTPUT — before any section header — must be exactly one line
in this form:

SUBJECT: <the email subject line for today's issue>

Rules for it: 40-65 characters. It names the specific thing that happened today,
in plain words a busy professional would understand at a glance in an inbox. No
markdown, no date, no publication name, no section label, no colon-prefixed
category. It is a headline, not a topic.
Good:  Russia and Iran hit record censorship in the same week
Good:  We are calling Thailand at 52% against a 70% base rate
Bad:   Why it matters          (a transition phrase, not a story)
Bad:   Thailand                (a label, not a headline)
Bad:   NexusWatch Brief for Friday   (says nothing)

STRUCTURE (follow exactly — six sections, do NOT add, drop or reorder; the
template inserts the mechanical Ledger line above your output):

${SUNDAY_SECTIONS[0]}
2-3 sentences. Warm, reflective. "Happy Sunday. Here's what mattered this week — and what we're watching heading into Monday."

${SUNDAY_SECTIONS[1]}
The week on the record. From the RESOLVED CALLS section of the context: the aggregate line verbatim (settled, hits, misses, grace-held), then the two or three most informative resolutions with our stated probability and base rate beside each outcome — where we were right cheaply, where we were wrong confidently. Then from OUR OPEN CALLS: the single most divergent open call restated in one sentence with its probability, base rate and resolution date. Every number verbatim from the context. If both sections are empty, write exactly: "No calls on the book this week." Never invent a call.

${SUNDAY_SECTIONS[2]}
5-7 of the biggest stories from the past 7 days. Each story gets:
- A **bold headline**
- 2-3 sentences: what happened, how it developed over the week, where it stands now
- Focus on TRENDS and TRAJECTORIES, not isolated events

${SUNDAY_SECTIONS[3]}
The week's state of the board, three parts in one section:
- **Movers** — the 5-6 countries that moved most over 7 days. Format: **Country** CII_SCORE (▲+N or ▼-N) — driver. THE DRIVER MUST COME FROM THE CONTEXT OR NOT BE GIVEN: if nothing in the context explains a move, write exactly "driver not identified in this week's data." and stop.
- **Markets** — weekly moves connected to geopolitical developments. THE MARKET LINES ARE ETF SHARE PRICES, NOT THE UNDERLYING — quote the instrument as named, never restate as the underlying's level, and percentage moves are PERCENT, never "basis points".
- End the section with one line: **What would change our mind:** the single concrete, checkable observation that would most revise our current top read. It must name a source that appears in the context (OONI, an FX rate, a headline). Falsifiable, dated where possible, never a vibe.

${SUNDAY_SECTIONS[4]}
2-4 bullets of disciplined silence — the section where restraint is the content:
- Moves we are NOT explaining because no driver is identified.
- Narratives circulating this week that the data cannot support — cite the item ("[TASS · STATE MEDIA] is framing X as Y; nothing in OONI or the wires corroborates it").
- Data gaps: feeds down, stale, or missing, named plainly.
Never speculate under the guise of restraint. If there is nothing to withhold, say "Nothing withheld this week — the data covered what moved."

${SUNDAY_SECTIONS[5]}
5-6 things to watch Monday through Friday. Specific events, thresholds, and dates. This section should feel like a Monday morning prep sheet.`;
  }

  // ---------------------------------------------------------------------------
  // Daily variant (Mon-Sat) — the locked 7-section structure from Apr 10
  // Decision 5, plus the Friday-only "Tool of the Week" eighth section from
  // the same decision. "Your Watchlist" is template-level (Track A.9), not
  // part of the Sonnet output. Space & Tech is deliberately omitted — it
  // wasn't in the Apr 10 Decision 5 locked structure.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Daily variant (Mon-Sat) — the accountability loop (owner decision
  // 2026-08-23): Ledger (mechanical) → Today's Call → Top Signal → The Board
  // (with the mandatory "what would change our mind" clause) → What We're Not
  // Saying → The Long Fuse. Scenario Spotlight and One More Thing are killed —
  // an unfalsifiable hypothetical undermines a graded product, and a section
  // that advertises the product isn't a section. Headers come from
  // brief-structure.ts, the same constants the publish gate validates against.
  // ---------------------------------------------------------------------------
  return `${baseVoice}

OUTPUT FORMAT: Clean markdown. Use ## for section headers with emoji prefixes. **bold** for emphasis. Numbered lists for stories. Bullet points for outlook. NO HTML.

FIRST LINE OF YOUR OUTPUT — before any section header — must be exactly one line
in this form:

SUBJECT: <the email subject line for today's issue>

Rules for it: 40-65 characters. It names the specific thing that happened today,
in plain words a busy professional would understand at a glance in an inbox. No
markdown, no date, no publication name, no section label, no colon-prefixed
category. It is a headline, not a topic.
Good:  Russia and Iran hit record censorship in the same week
Good:  We are calling Thailand at 52% against a 70% base rate
Bad:   Why it matters          (a transition phrase, not a story)
Bad:   Thailand                (a label, not a headline)
Bad:   NexusWatch Brief for Friday   (says nothing)

STRUCTURE (follow exactly — five sections, do NOT add, drop or reorder; the
template inserts the mechanical Ledger line above your output):

${DAILY_SECTIONS[0]}

FIRST check the RESOLVED CALLS section of the context. If it lists anything,
LEAD WITH THE RECORD: state the aggregate line verbatim (how many settled,
hits, misses, and any still pending under the grace rule), then the single
most informative resolution — the one listed first — with our stated
probability and its base rate beside the outcome. A model that publishes
dated, falsifiable calls and then buries the day they settle is doing public
relations, not forecasting; the settled record ALWAYS outranks a new call.
Then, IF the OUR OPEN CALLS section lists anything, one further sentence
with the top open call; if it lists nothing, end the section after the
record — never invent an open call to fill the slot.

If RESOLVED CALLS is empty: the one call we are making today, from the OUR
OPEN CALLS section of the context — pick the call listed FIRST (they arrive
ordered by divergence from the base rate; the first is where we are saying
the most). Restate it in 1-2 sentences: the country, the claim, our
probability, the base rate beside it, and the resolution date.

Every number verbatim from the context. If the context lists no calls at
all, write exactly: "No open calls today." Never invent a call, never adjust
a probability, never editorialise the criterion.

${DAILY_SECTIONS[1]}

Lead with the single most important story of the day. This is the hero.
- 1 sentence hook that makes the reader stop scrolling (the "hey, you seeing this?" moment)
- 2-3 sentences on what happened (specific: names, numbers, places, sources)
- 2-3 sentences on why it matters (the "so what" for the reader's world — portfolio, policy, safety)
- Cite the source when referencing investigations (Bellingcat, Crisis Group, ISW, etc.)

If it's a quiet day, lead with the most interesting pattern or trend from the CII data, NOT a recap of yesterday's news.

${DAILY_SECTIONS[2]}

The day's state of the board — three parts inside one section, then the clause:

**Movers** — the countries that moved most in 24h. Data, not narrative.
Format each as: **Country** CII_SCORE (▲+N or ▼-N) — driver. Show 4-6, sorted by absolute change.

THE DRIVER MUST COME FROM THE CONTEXT OR NOT BE GIVEN. This is the strictest
rule in the brief and it overrides every stylistic instruction above.
- A driver is permitted ONLY when a named, dated item in the data context
  supports it — a headline, a censorship measurement, a sanctions event, a
  quake. Name that source in the line.
- If nothing in the context explains the move, write exactly:
  "driver not identified in today's data." Then stop. Do not speculate, do not
  offer alternatives, do not write "likely", "possible", "or", or "awaiting
  confirmation". An unexplained move is a true and publishable thing to report.
- Most CII moves have no external driver. Several components are static
  baselines and the disasters component decays as a rolling 24-hour feed ages
  out, so a fall is usually decay rather than de-escalation. Never narrate
  decay as an event.

Correct, with evidence:  **Iran** 61 (▲+4) — OONI recorded 1,611 confirmed blocking measurements this week, up from 340.
Correct, without:        **South Korea** 13 (▲+8) — driver not identified in today's data.

**Crises** — active crises and escalation risks, 2-4 bullets max, each: **bold
label** → 1-2 sentences on status and what to watch. Only genuine crises: a
live deviation ≥ 8, or a structurally severe country (level ≥ 80) with any
live deviation today. A high structural level ALONE is not a crisis — it is a
standing fact. If none qualify, write "No active crisis triggers today."

**Markets** — 2-4 sentences. THE MARKET LINES ARE ETF SHARE PRICES, NOT THE
UNDERLYING. They are labelled as such in the context — "Crude oil ETF (USO)",
"Dollar index ETF (UUP)". Never restate one as the underlying's level: USO's
share price is not the price of a barrel and UUP's is not the dollar index.
Quote the instrument as named, or describe the direction and size of the move
without asserting a level. Percentage moves in a share price are PERCENT,
never "basis points" — basis points measure yield, and using them for an
equity price move is both wrong and the fastest way to lose a reader who
trades. Reference chokepoints (Hormuz, Bab el-Mandeb, Suez, Malacca) when
relevant. What's priced in vs. what's a surprise?

End the section with one line: **What would change our mind:** the single
concrete, checkable observation that would most revise today's top read. It
must name a source that appears in the context (OONI, an FX rate, a headline,
a CII component). Falsifiable, dated where possible, never a vibe.

${DAILY_SECTIONS[3]}

2-4 bullets of disciplined silence — the section where restraint is the content:
- Moves we are NOT explaining, because no driver is identified in the data.
- Narratives circulating today that the data cannot support — cite the item
  ("[TASS · STATE MEDIA] is framing X as Y; nothing in OONI or the wires
  corroborates it"). State framing is quotable AS framing here, never as fact.
- Data gaps, named plainly: a feed down, a series stale, a country unscored.
Never speculate under the guise of restraint — "we can't yet confirm the coup"
implies a coup. If there is nothing to withhold, write "Nothing withheld today
— the data covered what moved."

${DAILY_SECTIONS[4]}

One slow-building development, 2-3 sentences — something visible in the 7-day
trajectories, the censorship series, or repeated headlines, that is weeks from
mattering rather than hours. Forward-looking and conditional ("if X continues
through month-end, Y").
NO HISTORICAL PRECEDENTS. Do not cite past events, past price moves, or past
NexusWatch observations here or anywhere else in the brief. A precedent
recalled from memory is unverifiable, and the attribution rules forbid hedging
it, so the two instructions together would manufacture confident false
statements. Nothing retrospective.`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  const dbUrl = process.env.DATABASE_URL;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  try {
    const sql = neon(dbUrl);
    const now = new Date();
    // Sunday drives both the prompt variant (weekly recap) and the resolved-
    // calls window (7 days, so "the week on the record" is answerable).
    const isSunday = now.getUTCDay() === 0;
    const today = now.toISOString().split('T')[0];
    const utcTime = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} UTC`;

    // Opaque but sortable run identifier shared by every channel's delivery-log
    // row for this cron invocation. See docs/migrations/2026-04-11-brief-delivery-log.sql
    // and Track A.4 in NEXUSWATCH-COMPLETION-PLAN.md.
    const runId = `${today}-${Date.now()}`;

    /**
     * Write one row to brief_delivery_log. Fire-and-forget from the caller's
     * perspective — logDelivery swallows its own errors so a logging failure
     * never breaks the cron. Keep `error` strings short; truncate to 500 chars
     * to avoid storing multi-KB API response bodies in Postgres.
     */
    async function logDelivery(params: {
      channel: 'archive' | 'beehiiv' | 'buffer' | 'resend' | 'notion';
      status: 'success' | 'failed' | 'partial';
      recipientCount?: number;
      failedCount?: number;
      error?: string;
      latencyMs: number;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      try {
        const errTruncated = params.error ? params.error.slice(0, 500) : null;
        const metaJson = params.metadata ? JSON.stringify(params.metadata) : null;
        await sql`
          INSERT INTO brief_delivery_log
            (run_id, brief_date, channel, status, recipient_count, failed_count, error, latency_ms, metadata)
          VALUES
            (${runId}, ${today}, ${params.channel}, ${params.status},
             ${params.recipientCount ?? null}, ${params.failedCount ?? null},
             ${errTruncated}, ${params.latencyMs}, ${metaJson})
        `;
      } catch (logErr) {
        console.error(
          '[daily-brief] logDelivery insert failed (non-fatal):',
          logErr instanceof Error ? logErr.message : logErr,
        );
      }
    }

    // === Atomic idempotency guard (P0 dedup fix, 2026-04-18) ===
    // Uses INSERT ON CONFLICT to atomically claim today's brief slot.
    // If another invocation already inserted a row for today, the INSERT
    // returns 0 rows and we skip. No race window.
    const claimed = await sql`
      INSERT INTO daily_briefs (brief_date, content, summary)
      VALUES (${today}, '{"pending":true}', 'generating...')
      ON CONFLICT (brief_date) DO NOTHING
      RETURNING brief_date
    `;
    if (claimed.length === 0) {
      console.log(`[daily-brief] Brief for ${today} already claimed — skipping (atomic dedup).`);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: `Brief for ${today} already generated or in progress.`,
        runId,
      });
    }

    // === Parallel data fetch ===
    const [
      ciiResult,
      prevCiiResult,
      earthquakeResult,
      diseaseResult,
      conflictResult,
      marketResult,
      yesterdaySnapResult,
      weeklyHistoryResult,
      newsResult,
    ] = await Promise.allSettled([
      // 1. Current CII scores
      sql`
        SELECT DISTINCT ON (country_code) country_code, country_name, score, components,
               COALESCE((components->>'deviation')::float, 0) AS deviation
        FROM country_cii_history ORDER BY country_code, timestamp DESC
      `,
      // 2. Yesterday's CII for trend arrows (deviation is what moves post-split)
      sql`
        SELECT DISTINCT ON (country_code) country_code, score,
               COALESCE((components->>'deviation')::float, 0) AS deviation
        FROM country_cii_history
        WHERE timestamp < NOW() - INTERVAL '20 hours'
        ORDER BY country_code, timestamp DESC
      `,
      // 3. Earthquakes
      fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', {
        signal: AbortSignal.timeout(10000),
      }).then((r) => (r.ok ? r.json() : null)),
      // 4. Disease outbreaks
      fetch('https://www.who.int/api/news/diseaseoutbreaknews?$top=10&$orderby=PublicationDate%20desc', {
        signal: AbortSignal.timeout(10000),
      }).then((r) => (r.ok ? r.json() : null)),
      // 5. Conflict headlines (GDELT — may be blocked)
      fetch(
        'https://api.gdeltproject.org/api/v2/doc/doc?query=attack%20OR%20airstrike%20OR%20ceasefire%20OR%20war%20OR%20sanctions&mode=artlist&maxrecords=15&timespan=1440min&format=json&sort=DateDesc',
        { signal: AbortSignal.timeout(10000) },
      ).then(async (r) => {
        if (!r.ok) return null;
        const text = await r.text();
        if (text.startsWith('Please limit')) return null;
        return JSON.parse(text);
      }),
      // 6. Markets
      (async () => {
        const apiKey = process.env.TWELVEDATA_API_KEY;
        if (!apiKey) return null;
        const r = await fetch(`https://api.twelvedata.com/quote?symbol=SPY,GLD,USO,UNG,XLE,UUP,TLT&apikey=${apiKey}`, {
          signal: AbortSignal.timeout(8000),
        });
        return r.ok ? r.json() : null;
      })(),
      // 7. Yesterday's earthquake snapshot for comparison
      sql`
        SELECT feature_count FROM event_snapshots
        WHERE layer_id = 'earthquakes' AND timestamp > NOW() - INTERVAL '36 hours'
        ORDER BY timestamp ASC LIMIT 1
      `,
      // 8. 7-day CII history for trend analysis
      sql`
        SELECT country_code, country_name,
               COALESCE((components->>'deviation')::float, 0) AS deviation,
               timestamp::date as day
        FROM country_cii_history
        WHERE timestamp > NOW() - INTERVAL '7 days'
        ORDER BY country_code, timestamp DESC
      `,
      // 9. OSINT + world news headlines
      fetchNewsHeadlines(),
    ]);

    // === Process results ===
    const ciiRows = ciiResult.status === 'fulfilled' ? (ciiResult.value as Record<string, unknown>[]) : [];
    const prevCiiRows = prevCiiResult.status === 'fulfilled' ? (prevCiiResult.value as Record<string, unknown>[]) : [];
    const prevScoreMap = new Map(prevCiiRows.map((r) => [r.country_code as string, r.score as number]));
    const prevDevMap = new Map(prevCiiRows.map((r) => [r.country_code as string, Number(r.deviation ?? 0)]));

    const allCII: CIIEntry[] = ciiRows
      .map((r) => ({
        code: r.country_code as string,
        name: r.country_name as string,
        score: r.score as number,
        deviation: Number(r.deviation ?? 0),
        prevScore: prevScoreMap.get(r.country_code as string) ?? null,
        prevDeviation: prevDevMap.get(r.country_code as string) ?? null,
        components: r.components as Record<string, number>,
      }))
      // Ranked by structural level, deviation as tiebreak — the "top risk"
      // list is about the level; the movers list below is about the day.
      .sort((a, b) => b.score - a.score || b.deviation - a.deviation);
    const topCII = allCII.slice(0, 10);

    // Biggest movers — by DEVIATION change. Post-split the structural score
    // is deliberately static, so a score delta would always be zero; what
    // moves day to day is the live deviation.
    const movers = allCII
      .filter((c) => c.prevDeviation !== null)
      .map((c) => ({ ...c, delta: c.deviation - (c.prevDeviation ?? 0) }))
      .filter((c) => Math.abs(c.delta) >= 3)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);

    // Earthquakes
    let earthquakeCount = 0;
    let significantQuakes: string[] = [];
    if (earthquakeResult.status === 'fulfilled' && earthquakeResult.value) {
      const qData = earthquakeResult.value as { features: Array<{ properties: { mag: number; place: string } }> };
      earthquakeCount = qData.features?.length || 0;
      significantQuakes = (qData.features || [])
        .filter((f) => f.properties.mag >= 4.5)
        .sort((a, b) => b.properties.mag - a.properties.mag)
        .slice(0, 5)
        .map((f) => `M${f.properties.mag.toFixed(1)} — ${f.properties.place}`);
    }

    const yesterdayEqCount =
      yesterdaySnapResult.status === 'fulfilled' && (yesterdaySnapResult.value as Record<string, unknown>[]).length > 0
        ? ((yesterdaySnapResult.value as Record<string, unknown>[])[0].feature_count as number)
        : null;

    // Disease
    let diseaseCount = 0;
    let recentOutbreaks: string[] = [];
    if (diseaseResult.status === 'fulfilled' && diseaseResult.value) {
      const dData = diseaseResult.value as { value: Array<{ Title: string }> };
      diseaseCount = dData.value?.length || 0;
      recentOutbreaks = (dData.value || []).slice(0, 5).map((o) => o.Title);
    }

    // Conflict
    let conflictHeadlines: string[] = [];
    if (conflictResult.status === 'fulfilled' && conflictResult.value) {
      const cData = conflictResult.value as { articles?: Array<{ title: string; url: string }> };
      conflictHeadlines = (cData.articles || []).slice(0, 10).map((a) => a.title);
    }

    // Markets
    const markets: MarketQuote[] = [];
    if (marketResult.status === 'fulfilled' && marketResult.value) {
      const mData = marketResult.value as Record<string, { close?: string; percent_change?: string }>;
      // Honest instrument names. These are ETF SHARE PRICES, and the prompt's
      // market rules assume the context says so — until 2026-08-23 this map
      // said "Crude Oil" and "USD Index", handing the model the exact
      // misstatement the rules forbid.
      const labels: Record<string, string> = {
        SPY: 'S&P 500 ETF (SPY)',
        GLD: 'Gold ETF (GLD)',
        USO: 'Crude oil ETF (USO)',
        UNG: 'Nat gas ETF (UNG)',
        XLE: 'Energy sector ETF (XLE)',
        UUP: 'Dollar index ETF (UUP)',
        TLT: 'Treasury bond ETF (TLT)',
      };
      for (const [sym, q] of Object.entries(mData)) {
        if (q?.close) {
          const pct = parseFloat(q.percent_change || '0');
          markets.push({
            symbol: labels[sym] || sym,
            price: `$${parseFloat(q.close).toFixed(2)}`,
            change: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
            direction: pct > 0.1 ? 'up' : pct < -0.1 ? 'down' : 'flat',
          });
        }
      }
    }

    // 7-day CII trends
    const weeklyTrends: WeeklyTrend[] = [];
    if (weeklyHistoryResult.status === 'fulfilled') {
      const histRows = weeklyHistoryResult.value as Record<string, unknown>[];
      // Trajectories track the DEVIATION (post-split) — a 7-day structural
      // trajectory is flat by construction and would say nothing.
      const byCountry = new Map<string, { name: string; entries: { date: string; score: number }[] }>();
      for (const r of histRows) {
        const code = r.country_code as string;
        const entry = byCountry.get(code) || { name: r.country_name as string, entries: [] };
        entry.entries.push({ date: String(r.day), score: Number(r.deviation ?? 0) });
        byCountry.set(code, entry);
      }
      // Build trends for top-risk countries
      for (const c of topCII) {
        const history = byCountry.get(c.code);
        if (!history || history.entries.length < 2) continue;
        // Deduplicate by date — keep FIRST entry per date (most recent, since query is DESC)
        const byDate = new Map<string, number>();
        for (const e of history.entries) {
          if (!byDate.has(e.date)) byDate.set(e.date, e.score);
        }
        const scores = Array.from(byDate.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, score]) => ({ date, score }));
        const weekAgo = scores.length >= 2 ? scores[0].score : null;
        // Use authoritative current deviation from allCII, not history query
        const current = c.deviation;
        // Detect volatility: if score swings >5 points in both directions
        let maxUp = 0,
          maxDown = 0;
        for (let i = 1; i < scores.length; i++) {
          const d = scores[i].score - scores[i - 1].score;
          if (d > maxUp) maxUp = d;
          if (d < maxDown) maxDown = d;
        }
        const direction: WeeklyTrend['direction'] =
          maxUp > 5 && Math.abs(maxDown) > 5
            ? 'volatile'
            : weekAgo !== null && current - weekAgo >= 3
              ? 'rising'
              : weekAgo !== null && current - weekAgo <= -3
                ? 'falling'
                : 'stable';
        weeklyTrends.push({
          name: c.name,
          code: c.code,
          scores,
          currentScore: current,
          weekAgoScore: weekAgo,
          direction,
        });
      }
    }

    // Server-side correlation detection (earthquakes near critical infrastructure)
    const correlations: string[] = [];
    if (earthquakeResult.status === 'fulfilled' && earthquakeResult.value) {
      const qData = earthquakeResult.value as {
        features: Array<{
          properties: { mag: number; place: string };
          geometry: { coordinates: [number, number, number] };
        }>;
      };
      for (const f of qData.features || []) {
        // Was 4.5, which fires most days somewhere on earth and is why this
        // section — which the prompt used to be told to lead with — read as a
        // seismic bulletin. Measured across the last 21 briefs the mix was
        // 18.5% seismic against 3.1% politics. A quake earns the lead by
        // consequence, not by occurring.
        if (f.properties.mag < 5.5) continue;
        const [lon, lat] = f.geometry.coordinates;
        for (const infra of CRITICAL_INFRA) {
          const dist = haversineKm(lat, lon, infra.lat, infra.lon);
          if (dist < 200) {
            correlations.push(
              `PROXIMITY ALERT: M${f.properties.mag.toFixed(1)} earthquake ${Math.round(dist)}km from ${infra.name} (${infra.type}). ${f.properties.place}.`,
            );
          }
        }
      }
      // Seismic cluster detection
      const sigQuakes = (qData.features || []).filter((f) => f.properties.mag >= 4.0);
      const clusters = new Map<string, number>();
      for (const q of sigQuakes) {
        const key = `${Math.round(q.geometry.coordinates[1] / 3) * 3},${Math.round(q.geometry.coordinates[0] / 3) * 3}`;
        clusters.set(key, (clusters.get(key) || 0) + 1);
      }
      for (const [key, count] of clusters) {
        if (count >= 3) {
          const [lat, lon] = key.split(',').map(Number);
          const nearby = sigQuakes.find(
            (q) => Math.abs(q.geometry.coordinates[1] - lat) < 3 && Math.abs(q.geometry.coordinates[0] - lon) < 3,
          );
          correlations.push(
            `SEISMIC CLUSTER: ${count} M4.0+ earthquakes concentrated near ${nearby?.properties.place || `${lat}°N ${lon}°E`}. Elevated aftershock/escalation risk.`,
          );
        }
      }
    }
    // CII convergence: multiple high-CII countries in same region
    const highCII = allCII.filter((c) => c.score >= 50);
    if (highCII.length >= 5) {
      correlations.push(
        `MULTI-REGION INSTABILITY: ${highCII.length} countries above CII 50 threshold — elevated global risk posture. Top: ${highCII
          .slice(0, 3)
          .map((c) => `${c.name} (${c.score})`)
          .join(', ')}.`,
      );
    }

    // News headlines
    const newsHeadlines: NewsItem[] = newsResult.status === 'fulfilled' ? (newsResult.value as NewsItem[]) : [];

    const briefData: BriefData = {
      date: today,
      utcTime,
      topRiskCountries: topCII,
      totalCountries: ciiRows.length,
      earthquakeCount,
      significantQuakes,
      diseaseCount,
      recentOutbreaks,
      conflictHeadlines,
      markets,
      yesterdayEqCount,
      weeklyTrends,
      correlations,
      newsHeadlines,
      openCallLines: [],
      resolvedCallLines: [],
    };

    // === Generate AI brief (outputs markdown text) ===
    let briefText: string;
    let aiDebug: string | null = null;
    let grounding: GroundingReport | null = null;
    // The model's declared subject. Cleared if a gate refuses the draft — a
    // subject describing a refused issue must never ship with the fallback.
    let declaredSubject: string | null = null;

    if (anthropicKey) {
      try {
        const trendArrow = (c: CIIEntry) => {
          if (c.prevDeviation === null) return '';
          const d = c.deviation - c.prevDeviation;
          if (d >= 3) return ` ↑${d.toFixed(0)}`;
          if (d <= -3) return ` ↓${Math.abs(d).toFixed(0)}`;
          return ' →';
        };

        // === POLITICAL SIGNAL ===
        // The brief has never seen any of this. Measured across the last 21
        // briefs the topic mix was markets 49.7%, seismic 18.5%, conflict
        // 18.1%, politics 3.1% — the thing the product is named for came last
        // but one. Censorship deltas and the open call book are both political,
        // both dated, and both already in the database.
        //
        // Non-fatal: a query failure costs a section, never the brief.
        let censorshipLines: string[] = [];
        let openCallLines: string[] = [];
        let sanctionsLines: string[] = [];
        try {
          const nameOf = new Map(allCII.map((c) => [c.code, c.name]));
          const blocks = (await sql`
            SELECT country_code, SUM(confirmed_blocked)::int AS blocked, MAX(measurement_date)::text AS last_seen
            FROM ooni_measurements
            WHERE measurement_date > NOW() - INTERVAL '7 days' AND confirmed_blocked > 0
            GROUP BY country_code
            ORDER BY blocked DESC
            LIMIT 12
          `) as unknown as Array<{ country_code: string; blocked: number; last_seen: string }>;
          censorshipLines = blocks.map(
            (b) =>
              `${nameOf.get(b.country_code) ?? b.country_code} (${b.country_code}): ${b.blocked} confirmed blocking measurement${b.blocked === 1 ? '' : 's'} in the last 7d, latest ${b.last_seen.slice(0, 10)}`,
          );

          // Ordered by DIVERGENCE from the base rate, not by probability.
          // Sorting by probability surfaced seven identical 84% calls — the
          // countries where blocking is constant and the forecast is simply the
          // climatology. Those are true and uninteresting. The calls worth a
          // sentence are the ones where recent activity has pulled us away from
          // the long-run rate: that is where we are actually saying something.
          const open = (await sql`
            SELECT kind, country_code, probability::float AS p, base_rate::float AS base,
                   resolves_on::text AS resolves_on, threshold_pct::float AS threshold_pct
            FROM calls
            -- Calibration-harness calls (seismicity) are excluded EXPLICITLY,
            -- not by trusting their zero divergence to sort them out of the
            -- top 8 — and the per-kind phrasing below doesn't speak seismic.
            WHERE status = 'pending' AND base_rate IS NOT NULL AND NOT (kind = ANY(${[...CALIBRATION_KINDS]}))
            ORDER BY ABS(probability - base_rate) DESC, probability DESC
            LIMIT 8
          `) as unknown as Array<{
            kind: string;
            country_code: string;
            p: number;
            base: number;
            resolves_on: string;
            threshold_pct: number | null;
          }>;
          openCallLines = open.map((c) => {
            const delta = (c.p - c.base) * 100;
            const vs =
              Math.abs(delta) < 1
                ? 'in line with its base rate'
                : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}pts vs its base rate of ${(c.base * 100).toFixed(0)}%`;
            // Phrase the claim by KIND. Before 2026-08-23 every call here was
            // described as "a confirmed censorship event" — including the FX
            // calls, which would have handed the model a false claim to
            // faithfully repeat.
            // No else-branch that lies: an unknown kind gets wording true of
            // every call by construction, same rule as claimWording below.
            const claim =
              c.kind === 'fx_devaluation'
                ? `${(c.p * 100).toFixed(0)}% chance the currency depreciates ${c.threshold_pct !== null ? `≥${c.threshold_pct}% ` : ''}peak-vs-issue by ${c.resolves_on}`
                : c.kind === 'censorship_event'
                  ? `${(c.p * 100).toFixed(0)}% chance of a confirmed censorship event by ${c.resolves_on}`
                  : `${(c.p * 100).toFixed(0)}% chance of the outcome it names, against its declared external source, by ${c.resolves_on}`;
            return `${nameOf.get(c.country_code) ?? c.country_code} (${c.country_code}): ${claim} — ${vs}`;
          });
          briefData.openCallLines = openCallLines;

          // RESOLVED CALLS — the reason this block exists is 2026-09-05: the
          // first resolution day in the product's history, and the model led
          // with an unrelated FX call because nothing below selected anything
          // but status='pending'. The register's whole output was invisible to
          // its own writer.
          //
          // Window: today on weekdays; the last 7 days on Sunday, whose prompt
          // has asked "which calls resolved this week and how" since 08-23 —
          // an instruction that was unsatisfiable until this query existed.
          // Calendar-day semantics, not a rolling 24h: "today" must mean
          // resolved_at::date = CURRENT_DATE, or a late manual resolution
          // yesterday afternoon gets published as today's. Sunday looks back
          // 7 calendar days for "the week on the record".
          //
          // The exclusion DERIVES from CALIBRATION_KINDS — the canonical
          // "not a public claim" property in api/_lib/calls.ts — rather than
          // naming seismicity_window here. A future calibration kind is
          // excluded the day it is added to the set, not the day someone
          // remembers this file exists.
          const calibrationKinds = [...CALIBRATION_KINDS];
          // COUNTS FROM COUNT(*), DETAIL FROM THE PAGE — the same law the
          // ledger endpoint had to learn twice (by_kind published a page size
          // on 2026-08-30). The aggregate line quotes these totals; the paged
          // fetch below only supplies which INDIVIDUAL calls get a sentence.
          const resolvedTotals = (await sql`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE status = 'hit')::int AS hits
            FROM calls
            WHERE status IN ('hit','miss') AND NOT (kind = ANY(${calibrationKinds}))
              AND resolved_at::date > CURRENT_DATE - ${isSunday ? 7 : 1}::int
          `) as unknown as Array<{ total: number; hits: number }>;
          const resolvedRows = (await sql`
            SELECT kind, country_code, probability::float AS probability,
                   base_rate::float AS base_rate, status,
                   resolves_on::text AS resolves_on, evidence_count
            FROM calls
            WHERE status IN ('hit','miss') AND NOT (kind = ANY(${calibrationKinds}))
              AND resolved_at::date > CURRENT_DATE - ${isSunday ? 7 : 1}::int
            ORDER BY ABS(probability - COALESCE(base_rate, probability)) DESC
            LIMIT 40
          `) as unknown as ResolvedCallRow[];
          // Due-but-unresolved: matured rows still pending. Includes the
          // coverage-grace holds (expected, and the formatter says so) — and,
          // in the failure case, a resolver that did not run. Either way the
          // brief must not read like an ordinary day by silent omission.
          const dueStillPending = (await sql`
            SELECT COUNT(*)::int AS n FROM calls
            WHERE status = 'pending' AND resolves_on <= CURRENT_DATE
              AND NOT (kind = ANY(${calibrationKinds}))
          `) as unknown as Array<{ n: number }>;
          const duePending = dueStillPending[0]?.n ?? 0;
          if (resolvedRows.length === 0 && duePending > 0) {
            console.error(
              `[daily-brief] ${duePending} calls due but ZERO resolved in window — ` +
                'resolve-calls may not have run; the brief will say so rather than go quiet',
            );
          }
          briefData.resolvedCallLines = formatResolvedCallLines(
            resolvedRows,
            duePending,
            nameOf,
            resolvedTotals[0] ?? { total: resolvedRows.length, hits: 0 },
          );

          // Designation deltas — real adds/removes/updates from the rebuilt
          // sanctions collector (a diff against the stored snapshot, not a
          // re-insert of the whole list). Sparse by nature: ~5 designation
          // days a year, which is exactly why it is brief signal and not a
          // call domain.
          const sanctions = (await sql`
            SELECT source, change_type, entity_name, country_codes, programs, source_date::text AS source_date
            FROM sanctions_events
            WHERE observed_at > NOW() - INTERVAL '7 days'
            ORDER BY observed_at DESC LIMIT 12
          `) as unknown as Array<{
            source: string;
            change_type: string;
            entity_name: string;
            country_codes: string[];
            programs: string[];
            source_date: string | null;
          }>;
          sanctionsLines = sanctions.map((ev) => {
            const src = ev.source === 'ofac' ? 'OFAC' : 'UN';
            const verb = ev.change_type === 'add' ? 'designated' : ev.change_type === 'remove' ? 'delisted' : 'amended';
            const cc = ev.country_codes?.length ? ` [${ev.country_codes.join(', ')}]` : '';
            const pg = ev.programs?.length ? ` under ${ev.programs.slice(0, 2).join(', ')}` : '';
            return `${src} ${verb}: ${ev.entity_name}${pg}${cc}${ev.source_date ? ` (${ev.source_date})` : ''}`;
          });
        } catch (polErr) {
          console.error(
            '[daily-brief] political signal unavailable (non-fatal):',
            polErr instanceof Error ? polErr.message : polErr,
          );
        }

        const dataContext = `DATE: ${today} ${utcTime}
COUNTRIES MONITORED: ${ciiRows.length}

=== TOP RISK COUNTRIES (structural level 0-100 · live deviation today) ===
The LEVEL changes only when baselines are reviewed; the DEVIATION is today's
live signal on top of it (0 = quiet). They are two numbers, never one sum.
${topCII.map((c) => `${c.name}: level ${c.score}/100 · today +${c.deviation}${trendArrow(c)} [conflict=${c.components.conflict}, governance=${c.components.governance}, market=${c.components.marketExposure} | live: disasters=${c.components.disasters}, censorship=${c.components.infrastructure}]`).join('\n')}

=== BIGGEST DEVIATION MOVES (24h) ===
${movers.length > 0 ? movers.map((m) => `${m.name}: deviation ${m.delta > 0 ? '+' : ''}${m.delta.toFixed(0)} (${m.prevDeviation?.toFixed(0)} → ${m.deviation}) on structural level ${m.score}`).join('\n') : 'No significant deviation moves (±3 threshold)'}

=== POLITICAL SIGNAL — NETWORK INTERFERENCE (OONI, last 7 days) ===
${censorshipLines.length > 0 ? censorshipLines.join('\n') : 'No confirmed blocking events recorded in the last 7 days.'}

=== RESOLVED CALLS (settled against external ground truth — ${isSunday ? 'the last 7 days' : 'today'}) ===
${briefData.resolvedCallLines.length > 0 ? briefData.resolvedCallLines.join('\n') : isSunday ? 'No calls resolved this week.' : 'No calls resolved today.'}

=== OUR OPEN CALLS (dated, falsifiable, resolved against OONI and FX reference rates) ===
${openCallLines.length > 0 ? openCallLines.join('\n') : 'No open calls.'}

=== SANCTIONS DESIGNATION CHANGES (OFAC SDN + UN consolidated, last 7 days) ===
${sanctionsLines.length > 0 ? sanctionsLines.join('\n') : 'No designation changes observed in the last 7 days.'}

=== 7-DAY CII TRAJECTORIES ===
${weeklyTrends.length > 0 ? weeklyTrends.map((t) => `${t.name} [${t.direction.toUpperCase()}]: ${t.weekAgoScore ?? '?'} → ${t.currentScore} over 7d | Daily: ${t.scores.map((s) => s.score).join(' → ')}`).join('\n') : 'Insufficient history for weekly trends'}

=== CROSS-DOMAIN CORRELATIONS (auto-detected) ===
${correlations.length > 0 ? correlations.join('\n') : 'No significant cross-domain correlations detected'}

=== SEISMIC ACTIVITY ===
${earthquakeCount} earthquakes in last 24h${yesterdayEqCount !== null ? ` (yesterday: ${yesterdayEqCount}, ${earthquakeCount > yesterdayEqCount ? 'INCREASING' : earthquakeCount < yesterdayEqCount ? 'decreasing' : 'stable'})` : ''}
Significant (M4.5+): ${significantQuakes.length > 0 ? significantQuakes.join('; ') : 'None'}

=== HEALTH SECURITY ===
${diseaseCount} active WHO outbreak notices
${recentOutbreaks.length > 0 ? recentOutbreaks.join('\n') : 'No recent outbreak reports'}

=== CONFLICT & SECURITY HEADLINES ===
${conflictHeadlines.length > 0 ? conflictHeadlines.map((h) => `- ${h}`).join('\n') : '(GDELT feed unavailable from this origin)'}

=== OSINT & WORLD NEWS (last 24h) ===
Items marked [STATE MEDIA] are evidence of that government's framing, NOT of
what happened. Cite them only as "TASS is presenting X as Y". Never as a fact.
${
  newsHeadlines.length > 0
    ? newsHeadlines
        .map((n) => `- [${n.source}${STATE_MEDIA_SOURCES.has(n.source) ? ' · STATE MEDIA' : ''}] ${n.title}`)
        .join('\n')
    : 'No headlines available'
}

=== MARKET INDICATORS ===
${markets.length > 0 ? markets.map((m) => `${m.symbol}: ${m.price} (${m.change})`).join(' | ') : 'Market data unavailable'}

=== ENERGY CHOKEPOINT RISK CONTEXT ===
Strait of Hormuz: ~20% of global oil transits. Adjacent to Iran (CII: ${allCII.find((c) => c.code === 'IR')?.score ?? '?'}), Yemen (CII: ${allCII.find((c) => c.code === 'YE')?.score ?? '?'})
Bab el-Mandeb: Red Sea gateway. Adjacent to Yemen, Somalia (CII: ${allCII.find((c) => c.code === 'SO')?.score ?? '?'})
Suez Canal: ~12% of global trade. Adjacent to instability in Sudan (CII: ${allCII.find((c) => c.code === 'SD')?.score ?? '?'}), Libya (CII: ${allCII.find((c) => c.code === 'LY')?.score ?? '?'})
${(() => {
  const oilQuote = markets.find((m) => m.symbol.includes('USO'));
  const gasQuote = markets.find((m) => m.symbol.includes('UNG'));
  const energyQuote = markets.find((m) => m.symbol.includes('XLE'));
  return `Oil: ${oilQuote ? `${oilQuote.price} (${oilQuote.change})` : 'N/A'} | Nat Gas: ${gasQuote ? `${gasQuote.price} (${gasQuote.change})` : 'N/A'} | Energy Sector (XLE): ${energyQuote ? `${energyQuote.price} (${energyQuote.change})` : 'N/A'}`;
})()}

=== SPACE & TECHNOLOGY ===
NexusWatch tracks satellites, launches, GPS jamming zones, and internet outages globally.
${(() => {
  const parts: string[] = [];
  // Internet outages affect cyber/tech posture
  const highCIICountries = allCII.filter((c) => c.score >= 40);
  const infraRisk = highCIICountries.filter((c) => c.components.infrastructure > 5);
  if (infraRisk.length > 0) {
    parts.push(
      `Infrastructure disruption risk elevated in: ${infraRisk.map((c) => `${c.name} (infra: ${c.components.infrastructure})`).join(', ')}`,
    );
  }
  parts.push(`GPS jamming zones, satellite orbits, and launch schedules are tracked on the live platform.`);
  return parts.join('\n');
})()}`;

        // Cron path: bypassCap — the daily brief is mission-critical and must
        // ship even at the cap — but the check still runs so the soft-warn
        // telemetry fires as spend approaches the limit.
        await checkBudget({ endpoint: 'daily-brief', bypassCap: true });
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 6000,
            system: getBriefSystemPrompt(now),
            messages: [
              {
                role: 'user',
                content: `Generate today's intelligence briefing.\n\n${dataContext}`,
              },
            ],
          }),
          signal: AbortSignal.timeout(240000),
        });

        if (aiRes.ok) {
          const aiData = (await aiRes.json()) as {
            content: Array<{ text: string }>;
            usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
          };
          // The single largest, most reliable Anthropic spend in the system —
          // a full Sonnet brief, every day at 10:00 UTC — and until now it
          // recorded nothing, leaving the $9/day kill-switch blind to it.
          await recordAnthropicSpend('claude-sonnet-4-5-20250929', aiData.usage, 'daily-brief');
          const rawDraft = aiData.content?.[0]?.text || '';
          // Strip the declared SUBJECT line before anything else reads the
          // draft: the gates must score the body, and the line must never
          // reach a reader.
          const parsedSubject = parseDeclaredSubject(rawDraft);
          declaredSubject = parsedSubject.subject;
          briefText = rawDraft ? parsedSubject.body : '';
          if (!briefText) {
            aiDebug = 'ai-empty-response';
            declaredSubject = null;
            briefText = buildFallbackText(briefData);
          } else {
            // === Mechanical grounding gate (Phase 2) ===
            // Every numeral in the draft must be present in, or derivable
            // from, the context it was generated from. Published briefs have
            // carried invented casualty figures attributed to ACLED, an
            // invented WHO statement, and a false precedent reproduced from
            // the prompt itself. An instruction not to fabricate is not a
            // gate; this is the gate, and it fails LOUDLY to the
            // deterministic builder — which is grounded by construction —
            // rather than silently shipping invention.
            grounding = groundDraft(briefText, dataContext);
            const structure = validateBriefStructure(briefText, isSunday);
            if (!grounding.pass) {
              aiDebug = `grounding-failed: ${grounding.unsupported.length}/${grounding.draftNumerals.length} unsupported numerals [${grounding.unsupported.slice(0, 8).join(', ')}]`;
              console.error('[daily-brief] GROUNDING GATE REFUSED THE DRAFT:', aiDebug);
              declaredSubject = null;
              briefText = buildFallbackText(briefData);
            } else if (!structure.pass) {
              // The section spine is a contract with the reader (and with the
              // renderer). A draft that resurrects Scenario Spotlight, drops
              // What We're Not Saying, or forgets the change-our-mind clause
              // is refused the same way an ungrounded one is.
              aiDebug = `structure-failed: missing=[${structure.missing.join('; ')}] extra=[${structure.extra.join('; ')}]${structure.misordered ? ' misordered' : ''}${structure.missingChangeOurMind ? ' no-change-our-mind-clause' : ''}`;
              console.error('[daily-brief] STRUCTURE GATE REFUSED THE DRAFT:', aiDebug);
              declaredSubject = null;
              briefText = buildFallbackText(briefData);
            } else {
              aiDebug = `ai-success (grounding ${grounding.unsupported.length}/${grounding.draftNumerals.length} unsupported)`;
            }
          }
        } else {
          const errBody = await aiRes.text().catch(() => 'unknown');
          aiDebug = `ai-failed:${aiRes.status}:${errBody.slice(0, 300)}`;
          console.error(`AI brief failed: ${aiRes.status} — ${errBody.slice(0, 200)}`);
          briefText = buildFallbackText(briefData);
        }
      } catch (aiErr) {
        aiDebug = `ai-error:${aiErr instanceof Error ? aiErr.message : String(aiErr)}`;
        console.error('AI brief error:', aiErr instanceof Error ? aiErr.message : aiErr);
        briefText = buildFallbackText(briefData);
      }
    } else {
      aiDebug = 'no-api-key';
      briefText = buildFallbackText(briefData);
    }

    // === The Ledger line (Phase 2) ===
    // Goes at the very top of the brief, above everything the model wrote.
    // This is the habit mechanic: a reader who saw a call made has a stake in
    // it resolving, and the resolution lands on a schedule they do not
    // control. It also drags the differentiator out of a page nobody visits
    // and into the one surface with demonstrated daily engagement.
    //
    // Non-fatal by construction — a brief must still go out if the ledger
    // query fails, and it must never claim a record it does not have.
    try {
      // Same derivation as the prompt queries above: the exclusion reads from
      // CALIBRATION_KINDS, never a literal — round three of the rule-2 review
      // caught these three queries still naming seismicity_window while the
      // commit message claimed the class was fixed.
      const calKinds = [...CALIBRATION_KINDS];
      const resolvedToday = (await sql`
        SELECT country_code, status, probability::float AS probability
        FROM calls
        WHERE resolved_at::date = CURRENT_DATE AND status IN ('hit','miss')
          AND NOT (kind = ANY(${calKinds}))
      `) as unknown as Array<{ country_code: string; status: string; probability: number }>;

      // kind and resolved_at are REQUIRED, not decorative: the summary scores
      // per kind and gates on the number of distinct resolution batches. The
      // previous query selected neither, which is why the brief could only
      // produce one pooled, ungated number.
      const allScoredRows = (await sql`
        SELECT kind, probability::float AS probability, base_rate::float AS base_rate,
               status, resolved_at::text AS resolved_at
        FROM calls
        WHERE status IN ('hit','miss') AND NOT (kind = ANY(${calKinds}))
      `) as unknown as Array<{
        kind: string;
        probability: number;
        base_rate: number | null;
        status: string;
        resolved_at: string | null;
      }>;

      const openRows = (await sql`
        SELECT COUNT(*)::int AS n, MIN(resolves_on)::text AS next_resolves
        FROM calls WHERE status = 'pending' AND NOT (kind = ANY(${calKinds}))
      `) as unknown as Array<{ n: number; next_resolves: string | null }>;

      const scoredRows: LedgerSummaryRow[] = allScoredRows.map((r) => ({
        kind: r.kind,
        probability: r.probability,
        outcome: (r.status === 'hit' ? 1 : 0) as 0 | 1,
        baseRate: r.base_rate ?? undefined,
        resolvedOn: (r.resolved_at ?? '').slice(0, 10),
      }));

      const ledger = formatLedgerSummary({
        resolvedToday: resolvedToday as unknown as Call[],
        scored: scoredRows,
        openCount: openRows[0]?.n ?? 0,
        nextResolvesOn: openRows[0]?.next_resolves ?? null,
      });

      briefText = spliceLedgerLine(briefText, ledger);
    } catch (ledgerErr) {
      console.error(
        '[daily-brief] ledger line skipped (non-fatal):',
        ledgerErr instanceof Error ? ledgerErr.message : ledgerErr,
      );
    }

    // === Render Light Intel Dossier (Track B.3) ===
    // Single rendering pass produces all outputs: email shell for Resend,
    // inner-modules HTML for beehiiv, plain-text multipart fallback, and
    // the DB archive summary. All paths (AI success, AI failure, no key)
    // go through the same dossier pipeline so the archive, email, and
    // beehiiv post are visually identical.
    const dossier = renderDossierEmail({
      briefText,
      date: today,
      time: utcTime,
      markets,
    });
    const briefHtml = dossier.beehiivHtml;

    // Store both markdown and HTML versions. Instrumented as the 'archive'
    // channel — this row failing means the entire run is broken, so the outer
    // try/catch converts it to a 500. The logDelivery call below only fires
    // on success.
    // Update the placeholder row inserted by the atomic dedup guard above.
    const archiveT0 = Date.now();
    await sql`
      UPDATE daily_briefs
      SET content = ${JSON.stringify({ ...briefData, briefText, subject: chooseSubject(declaredSubject, briefText) })},
          summary = ${briefHtml}
      WHERE brief_date = ${today}
    `;
    await logDelivery({
      channel: 'archive',
      status: 'success',
      latencyMs: Date.now() - archiveT0,
      metadata: {
        brief_html_length: briefHtml.length,
        ai: aiDebug,
        // Watched, not hoped about: the unsupported-claim rate per issue.
        grounding_unsupported: grounding?.unsupported.length ?? null,
        grounding_total_numerals: grounding?.draftNumerals.length ?? null,
        grounding_rate: grounding ? Math.round(grounding.unsupportedRate * 1000) / 1000 : null,
      },
    });

    // === Record CII snapshots for prediction ledger (Phase 3) ===
    // Every daily brief records the CII scores at publication time.
    // Used by the accuracy dashboard to track prediction accuracy.
    try {
      let snapshotCount = 0;
      for (const country of allCII) {
        const components = country.components || {};
        await sql`
          INSERT INTO cii_daily_snapshots (date, country_code, cii_score, confidence,
            component_conflict, component_disasters, component_sentiment,
            component_infrastructure, component_governance, component_market_exposure,
            source_count, data_point_count)
          VALUES (${today}, ${country.code}, ${country.score}, ${'medium'},
            ${components.conflict ?? null}, ${components.disasters ?? null}, ${components.sentiment ?? null},
            ${components.infrastructure ?? null}, ${components.governance ?? null}, ${components.marketExposure ?? null},
            ${0}, ${0})
          ON CONFLICT (date, country_code) DO NOTHING
        `;
        snapshotCount++;
      }
      console.log(`[daily-brief] Recorded ${snapshotCount} CII snapshots for ${today}`);
    } catch (snapshotErr) {
      // Non-fatal — the brief still sends even if snapshots fail
      console.error('CII snapshot recording failed:', snapshotErr instanceof Error ? snapshotErr.message : snapshotErr);
    }

    // === Publish to beehiiv ===
    const beehiivKey = process.env.BEEHIIV_API_KEY;
    const beehiivPubId = process.env.BEEHIIV_PUB_ID;
    if (beehiivKey && beehiivPubId) {
      const beehiivT0 = Date.now();
      try {
        // beehiiv rejects a malformed publication id with an opaque 400 that
        // names a regex and nothing else. Production ran that 400 every day
        // for 34 consecutive days (brief_delivery_log, since 2026-07-09)
        // because the error was recorded and never surfaced. Check the shape
        // ourselves and say which env var is wrong and what it should look
        // like — a config error should read as a config error.
        if (!/^pub_[0-9a-fA-F-]+$/.test(beehiivPubId)) {
          throw new Error(
            'BEEHIIV_PUB_ID is malformed: expected the publication id in the ' +
              'form pub_<uuid> (copy it from beehiiv → Settings → API). ' +
              `Got a ${beehiivPubId.length}-character value starting ` +
              `"${beehiivPubId.slice(0, 4)}". Fix the env var in Vercel; ` +
              'no request was sent.',
          );
        }
        // Extract Good Morning line for subtitle. The ledger line is spliced
        // into the FIRST section (see spliceLedgerLine), which on Sundays is
        // Good Morning — strip it here or the subtitle becomes the stat line
        // instead of the greeting. Caught by the rule-2 review of the splice
        // change; the greeting, not the record, is the subtitle's job.
        const subtitleMatch = briefText.match(/## ☕ Good Morning\n+([\s\S]*?)(?=\n##|\n\n##)/);
        const subtitle = subtitleMatch
          ? subtitleMatch[1]
              .replace(/^\*\*The Ledger\*\*.*$/m, '')
              .trim()
              .slice(0, 200)
          : `Your daily geopolitical intelligence scan — ${today}`;

        const beehiivRes = await fetch(`https://api.beehiiv.com/v2/publications/${beehiivPubId}/posts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${beehiivKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: `The NexusWatch Brief — ${today}`,
            subtitle,
            // Light Intel Dossier inner modules. beehiiv wraps with its own
            // masthead/footer/unsubscribe chrome, so we ship just the content.
            content_html: dossier.beehiivHtml,
            // 'draft' works on all beehiiv plans. 'confirmed' + send_to requires Enterprise.
            // Drafts appear in beehiiv dashboard for review + manual send.
            // To auto-send: upgrade beehiiv to Enterprise and change to status: 'confirmed', send_to: 'all'.
            status: 'draft',
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!beehiivRes.ok) {
          const body = await beehiivRes.text().catch(() => '');
          // beehiiv POST API requires Enterprise plan. Log and skip gracefully.
          if (beehiivRes.status === 403) {
            console.log(
              '[daily-brief] beehiiv API requires Enterprise plan — skipping. Brief delivered via other channels.',
            );
            await logDelivery({
              channel: 'beehiiv',
              status: 'partial',
              latencyMs: Date.now() - beehiivT0,
              metadata: { reason: 'enterprise_plan_required' },
            });
          } else {
            throw new Error(`beehiiv ${beehiivRes.status}: ${body.slice(0, 200)}`);
          }
        }

        // Parse post ID for traceability — not fatal if the shape changes.
        let postId: string | undefined;
        try {
          const beehiivData = (await beehiivRes.json()) as { data?: { id?: string } };
          postId = beehiivData.data?.id;
        } catch {
          /* ignore parse errors */
        }

        await logDelivery({
          channel: 'beehiiv',
          status: 'success',
          latencyMs: Date.now() - beehiivT0,
          metadata: { post_id: postId, subtitle_length: subtitle.length },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[daily-brief] beehiiv publish failed:', msg);
        await logDelivery({
          channel: 'beehiiv',
          status: 'failed',
          error: msg,
          latencyMs: Date.now() - beehiivT0,
        });
      }
    }

    // === Post to X via Buffer (GraphQL API) ===
    const bufferToken = process.env.BUFFER_ACCESS_TOKEN;
    // Hardcoded NexusWatchDev channel ID (stable, verified working)
    const bufferChannelId = '69d95485031bfa423cee6b71';
    if (bufferToken) {
      const bufferT0 = Date.now();
      try {
        // Build post content from brief
        const gmMatch = briefText.match(/## ☕ Good Morning\n+([\s\S]*?)(?=\n##)/);
        // Strip the spliced ledger line — bold markdown shipped raw to X once
        // is once too many, and the social copy's job is the greeting.
        const goodMorning = gmMatch ? gmMatch[1].replace(/^\*\*The Ledger\*\*.*$/m, '').trim() : '';

        const storiesMatch = briefText.match(/## 📍 Today's Top Stories\n+([\s\S]*?)(?=\n##)/);
        const topStory = storiesMatch
          ? storiesMatch[1]
              .trim()
              .split(/\n\d+\./)[1]
              ?.trim()
              .slice(0, 180) || ''
          : '';

        // NOT `.slice(0, 280)`. X counts weighted characters — the ☕ and 📍
        // weigh 2 each and the trailing link weighs a flat 23 — so a string
        // sliced to 280 JS characters measures over 280 at X and Buffer
        // rejects the whole post. See api/_lib/x-post.ts.
        const postText = truncateForX(
          [
            `☕ ${goodMorning.slice(0, 220)}`,
            topStory ? `\n\n📍 ${topStory}` : '',
            `\n\nFull brief → brief.nexuswatch.dev`,
          ].join(''),
        );

        // Create and queue the post on @NexusWatchDev
        const bufferRes = await fetch('https://api.buffer.com', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bufferToken}`,
          },
          body: JSON.stringify({
            query: `mutation CreatePost($text: String!, $channelId: ChannelId!) {
              createPost(input: {
                text: $text,
                channelId: $channelId,
                schedulingType: automatic,
                mode: addToQueue
              }) {
                ... on PostActionSuccess { post { id } }
                ... on MutationError { message }
              }
            }`,
            variables: {
              text: postText,
              channelId: bufferChannelId,
            },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!bufferRes.ok) {
          const body = await bufferRes.text().catch(() => '');
          throw new Error(`buffer ${bufferRes.status}: ${body.slice(0, 200)}`);
        }

        // Buffer returns 200 even on GraphQL-level errors — inspect the body.
        let bufferPostId: string | undefined;
        let bufferMutationError: string | undefined;
        let bufferDuplicate = false;
        try {
          const bufferData = (await bufferRes.json()) as {
            data?: { createPost?: { post?: { id?: string }; message?: string } };
            errors?: Array<{ message?: string }>;
          };
          bufferPostId = bufferData.data?.createPost?.post?.id;
          bufferMutationError = bufferData.data?.createPost?.message || bufferData.errors?.[0]?.message;
        } catch {
          /* non-JSON response — treat as soft success, Buffer's GraphQL is stable */
        }

        if (bufferMutationError) {
          // Buffer refuses an identical post already queued for the same
          // window. That is the pipeline behaving correctly, not a delivery
          // failure — recording it as `failed` buried the ONE error in this
          // channel that actually needed a human (the 280-char rejection)
          // among six that never did. Distinguish them.
          if (/already got this one scheduled or posted/i.test(bufferMutationError)) {
            console.log('[daily-brief] buffer duplicate — already queued, skipping.');
            await logDelivery({
              channel: 'buffer',
              status: 'partial',
              latencyMs: Date.now() - bufferT0,
              metadata: { reason: 'duplicate_content' },
            });
            bufferMutationError = undefined;
            bufferDuplicate = true;
          } else {
            throw new Error(`buffer mutation: ${bufferMutationError}`);
          }
        }

        if (bufferPostId !== undefined || !bufferDuplicate) {
          await logDelivery({
            channel: 'buffer',
            status: 'success',
            latencyMs: Date.now() - bufferT0,
            metadata: {
              post_id: bufferPostId,
              post_length: postText.length,
              post_weighted_length: xWeightedLength(postText),
            },
          });
        }

        // === Track C.2 — Also enqueue the X thread draft for
        // human-in-loop review via the Track C.1 social queue.
        //
        // Dual-write: the legacy Buffer path above still posts the
        // thread to X directly via Buffer's scheduled pipeline. This
        // enqueue call ALSO puts the same text into social_queue as a
        // pending draft so, once the Track C.5 send worker ships, we
        // can flip from "Buffer pipeline" to "queue + send worker"
        // by removing the Buffer call and letting the worker drain
        // approved drafts. No-op if SOCIAL_AUTONOMY_ENABLED is not
        // 'true' — the core function short-circuits and returns 503.
        // Non-fatal: an enqueue failure here never breaks the brief
        // cron, only logs.
        try {
          const enqueueResult = await enqueueDraftCore(sql, {
            platform: 'x',
            action_type: 'thread',
            draft_content: postText,
            rationale: `daily brief X thread for ${today}`,
            source: `daily-brief cron run ${runId}`,
            source_url: `https://nexuswatch.dev/brief/${today}`,
          });
          if (enqueueResult.ok) {
            const enqueuedId = (enqueueResult.body as { id?: number }).id;
            console.log(
              `[daily-brief] C.2 enqueue: queued X thread draft id=${enqueuedId} (SOCIAL_AUTONOMY_ENABLED=true)`,
            );
          } else if (enqueueResult.status === 503) {
            // Kill switch off — expected until autonomy is enabled.
            // Log at debug level, not error, so we don't spam the
            // cron logs with expected output.
            console.log('[daily-brief] C.2 enqueue skipped — SOCIAL_AUTONOMY_ENABLED is off (expected during staging)');
          } else {
            console.error(`[daily-brief] C.2 enqueue returned ${enqueueResult.status}:`, enqueueResult.body);
          }
        } catch (enqueueErr) {
          console.error(
            '[daily-brief] C.2 enqueue threw (non-fatal):',
            enqueueErr instanceof Error ? enqueueErr.message : enqueueErr,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[daily-brief] Buffer/X post failed:', msg);
        await logDelivery({
          channel: 'buffer',
          status: 'failed',
          error: msg,
          latencyMs: Date.now() - bufferT0,
        });
      }
    }

    // === Email delivery delegated to deliver-briefs.ts (D-2, 2026-04-18) ===
    // Resend batch sending removed. The deliver-briefs hourly cron handles
    // timezone-aware delivery at 7am local per subscriber. This cron only
    // generates content + archives to daily_briefs table.
    await logDelivery({
      channel: 'resend',
      status: 'success',
      recipientCount: 0,
      latencyMs: 0,
      metadata: { note: 'delivery delegated to deliver-briefs.ts cron' },
    });

    // === Push to Notion (Substack-ready) ===
    const notionKey = process.env.NOTION_API_KEY;
    const notionBriefsPage = '33e45c2d-baf4-8104-b0e9-f6794c462363';
    if (notionKey) {
      const notionT0 = Date.now();
      try {
        // Use the markdown text directly — already clean and copy-paste ready
        const plainBrief = briefText;

        // Create a subpage for today's brief
        const pageRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${notionKey}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28',
          },
          body: JSON.stringify({
            parent: { page_id: notionBriefsPage },
            icon: { type: 'emoji', emoji: '📋' },
            properties: {
              title: [{ type: 'text', text: { content: `Intelligence Brief — ${today}` } }],
            },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!pageRes.ok) {
          const body = await pageRes.text().catch(() => '');
          throw new Error(`notion page create ${pageRes.status}: ${body.slice(0, 200)}`);
        }

        const page = (await pageRes.json()) as { id: string };

        // Split into chunks of ~2000 chars (Notion block limit)
        const chunks = splitTextToChunks(plainBrief, 1900);
        const blocks = chunks.map((chunk) => ({
          object: 'block' as const,
          type: 'paragraph' as const,
          paragraph: {
            rich_text: [{ type: 'text' as const, text: { content: chunk } }],
          },
        }));

        // Notion API accepts max 100 blocks per request
        let blocksWritten = 0;
        for (let i = 0; i < blocks.length; i += 100) {
          const batch = blocks.slice(i, i + 100);
          const blockRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${notionKey}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28',
            },
            body: JSON.stringify({ children: batch }),
            signal: AbortSignal.timeout(10000),
          });
          if (!blockRes.ok) {
            const body = await blockRes.text().catch(() => '');
            throw new Error(`notion block patch ${blockRes.status} (batch ${i}): ${body.slice(0, 200)}`);
          }
          blocksWritten += batch.length;
        }

        await logDelivery({
          channel: 'notion',
          status: 'success',
          latencyMs: Date.now() - notionT0,
          metadata: { page_id: page.id, blocks: blocksWritten },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[daily-brief] Notion push failed:', msg);
        await logDelivery({
          channel: 'notion',
          status: 'failed',
          error: msg,
          latencyMs: Date.now() - notionT0,
        });
      }
    }

    // === Delivery-channel health check ===
    // Runs last, once every channel above has recorded its outcome. Recording
    // a failure is not the same as reporting one: beehiiv 400'd on every run
    // for 34 consecutive days (since 2026-07-09) and the only witness was a
    // Postgres row nobody read.
    //
    // NOTE the ::text cast. `brief_date` is a TEXT column, not a date — the
    // obvious `brief_date > CURRENT_DATE - INTERVAL '45 days'` raises
    // "operator does not exist: text > timestamp", and the catch below would
    // have swallowed it. A silent failure inside the thing built to stop
    // silent failures. Caught by running this query against production.
    //
    // Swallows its own errors — a broken alert must never break a brief.
    try {
      const recent = (await sql`
        SELECT channel, brief_date::text AS brief_date, status, error
        FROM brief_delivery_log
        WHERE brief_date > (CURRENT_DATE - INTERVAL '45 days')::text
      `) as Array<{ channel: string; brief_date: string; status: string; error: string | null }>;

      const broken = channelsToAlert(recent);
      if (broken.length > 0) {
        const admins = (process.env.ADMIN_EMAILS || '')
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean);
        const alertKey = process.env.RESEND_API_KEY;
        const body = formatAlertBody(broken);
        console.error('[daily-brief] delivery channel alert:\n' + body);

        if (alertKey && admins.length > 0) {
          const subject =
            broken.length === 1
              ? `NexusWatch: ${broken[0].channel} delivery has failed ${broken[0].streak} days running`
              : `NexusWatch: ${broken.length} delivery channels are failing`;
          const alertRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alertKey}` },
            body: JSON.stringify({
              from: 'NexusWatch Alerts <alerts@nexuswatch.dev>',
              to: admins,
              subject,
              text: body,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!alertRes.ok) {
            console.error('[daily-brief] delivery alert email failed:', alertRes.status);
          }
        } else {
          console.error(
            '[daily-brief] delivery alert NOT emailed: ' +
              (admins.length === 0 ? 'ADMIN_EMAILS is empty' : 'RESEND_API_KEY is unset'),
          );
        }
      }
    } catch (healthErr) {
      console.error(
        '[daily-brief] delivery health check failed (non-fatal):',
        healthErr instanceof Error ? healthErr.message : healthErr,
      );
    }

    return res.json({ success: true, date: today, briefLength: briefHtml.length, ai: aiDebug });
  } catch (err) {
    console.error('Daily brief cron error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Brief generation failed' });
  }
}

// ============================================================================
// Email rendering — Light Intel Dossier (Track A.6)
// ============================================================================
//
// Replaces the pre-2026-04-11 `wrapEmailTemplate` which produced a dark
// terminal-themed HTML wrapper around a Sonnet-generated body. The new
// renderer owns both the shell AND the section-level rendering, following
// the Apr 11 CEO lock "we own the HTML" (Decision 5).
//
// Design tokens live in src/styles/email-tokens.ts — the canonical source
// of truth for the Light Intel Dossier palette, typography, and spacing.
// All inline styles in this module flow from those tokens via `style()`
// and `typeStyle()` helpers. Do not introduce hardcoded hex colors or
// font stacks below — use the tokens, or add new ones there first.
//
// Three outputs per render:
//   1. emailHtml  — full standalone HTML for Resend transactional send
//                   (masthead + modules + CTA + footer + unsubscribe)
//   2. beehiivHtml — inner modules only, no shell chrome, since beehiiv
//                    adds its own masthead/footer when sending
//   3. plainText  — text/plain multipart fallback (15% of intel readers
//                   are on text-only clients + higher deliverability)
// ============================================================================

import {
  colors,
  fonts,
  type,
  space,
  layout,
  style,
  typeStyle,
  escapeHtml,
  styleAttr,
} from '../../src/styles/email-tokens.js';
import {
  REGIONS,
  THREATS,
  matchesInterests,
  type Interests,
  type RegionId,
} from '../../src/services/interests-types.js';
import { enqueueDraftCore } from '../social/enqueue-core.js';
import { requireCron } from '../_cron-utils.js';

export interface RenderedBrief {
  emailHtml: string;
  beehiivHtml: string;
  plainText: string;
}

/**
 * Country shape used by the Watchlist personalization layer. Intentionally
 * narrower than CIIEntry so callers that don't have the full component
 * breakdown can still feed the renderer — only name/code/score are required.
 *
 * `regionIds` lets the caller pre-tag a country with the regions it belongs
 * to so matchesInterests() can fire on region matches. Track A.9.1 ships
 * this as an optional passthrough; Track A.9.2 will generate the mapping
 * server-side during brief generation so the per-user render doesn't need
 * to reconstruct country → region membership.
 */
export interface WatchlistCountry {
  code?: string;
  name: string;
  score: number;
  regionIds?: RegionId[];
  topThreat?: 'conflict' | 'disasters' | 'disease' | 'cyber' | 'markets' | 'space';
}

export interface RenderBriefOptions {
  briefText: string; // Markdown body (Sonnet output or buildFallbackText)
  date: string; // YYYY-MM-DD
  time: string; // "10:00 UTC"
  markets: MarketQuote[];
  /** URL of the corresponding /brief/:date permalink, for forward-to-colleague. */
  archiveUrl?: string;
  /**
   * Per-recipient interests. When present, renderDossierEmail emits a
   * "Your Watchlist" module at the end of the inner content showing the
   * top-risk countries that match the user's interest regions/threats.
   * When absent, no Watchlist module is rendered — appropriate for the
   * shared beehiiv post body or for anonymous preview requests. See
   * Track A.9 in NEXUSWATCH-COMPLETION-PLAN.md.
   */
  interests?: Interests;
  /**
   * The country-level risk data the Watchlist filter runs against. Pulled
   * from briefData.topRiskCountries at send time and forwarded through
   * renderDossierEmail. Accepts the narrow WatchlistCountry shape above
   * so callers can project from whatever their own structure looks like.
   */
  watchlistCountries?: WatchlistCountry[];
}

/**
 * Parse Sonnet's markdown output into addressable sections. Each section
 * begins with `## <emoji> <title>` and runs until the next `##`.
 */
interface BriefSection {
  emoji: string;
  title: string;
  body: string;
}
function parseSections(markdown: string): BriefSection[] {
  const sections: BriefSection[] = [];
  // Split on '## ' at line starts, drop the leading empty fragment.
  const fragments = markdown.split(/\n?^## /m).filter(Boolean);
  for (const frag of fragments) {
    const firstNewline = frag.indexOf('\n');
    const headerLine = firstNewline === -1 ? frag : frag.slice(0, firstNewline);
    const body = firstNewline === -1 ? '' : frag.slice(firstNewline + 1).trim();

    // The header line is something like "☕ Good Morning" — split off the emoji.
    // Emojis can be 1-2 code points; we accept anything up to the first space.
    const firstSpace = headerLine.indexOf(' ');
    if (firstSpace === -1) {
      sections.push({ emoji: '', title: headerLine.trim(), body });
    } else {
      sections.push({
        emoji: headerLine.slice(0, firstSpace).trim(),
        title: headerLine.slice(firstSpace + 1).trim(),
        body,
      });
    }
  }
  return sections;
}

/**
 * Render a section body from Sonnet markdown into dossier-styled HTML.
 * Handles the subset of markdown the prompt actually emits:
 *   - **bold** → <strong>
 *   - numbered lists (`1. `) → numbered story cards
 *   - bullet lists (`- `) → bullet paragraphs
 *   - paragraphs separated by blank lines
 *   - inline "**Why it matters**" runs → oxblood callout blocks
 */
function renderSectionBody(body: string): string {
  if (!body.trim()) return '';
  const paragraphBase = typeStyle(type.body, { color: colors.textPrimary, margin: `0 0 ${space.md} 0` });
  const bulletBase = typeStyle(type.body, {
    color: colors.textPrimary,
    margin: `0 0 ${space.sm} 0`,
    paddingLeft: space.lg,
  });
  const whyItMattersLabel = typeStyle(type.sectionLabel, {
    color: colors.accent,
    textTransform: 'uppercase',
    margin: `0 0 ${space.xs} 0`,
    display: 'block',
  });
  const whyItMattersBody = typeStyle(type.body, { color: colors.textPrimary, margin: 0 });
  const calloutBlock = style({
    margin: `${space.md} 0 ${space.lg} 0`,
    padding: `${space.md} ${space.lg}`,
    background: colors.accentBgSoft,
    borderLeft: `3px solid ${colors.accent}`,
    borderRadius: layout.radiusCallout,
  });

  // Split body into blocks separated by blank lines, then render each block
  // as a paragraph, numbered story, or bullet list based on its leading token.
  const blocks = body.split(/\n\s*\n/);
  const rendered: string[] = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    // Numbered story (`1. **Headline**\n   Body text...`).
    const numberedMatch = block.match(/^(\d+)\.\s+(.*)$/s);
    if (numberedMatch) {
      const num = numberedMatch[1];
      const rest = numberedMatch[2];
      rendered.push(
        `<div ${styleAttr(
          style({
            margin: `0 0 ${space.xl} 0`,
            paddingBottom: space.lg,
            borderBottom: `1px solid ${colors.border}`,
          }),
        )}>` +
          `<div ${styleAttr(
            typeStyle(type.kicker, {
              color: colors.textTertiary,
              margin: `0 0 ${space.xs} 0`,
            }),
          )}>STORY ${num}</div>` +
          `<div ${styleAttr(paragraphBase)}>${renderInline(rest)}</div>` +
          `</div>`,
      );
      continue;
    }

    // Bullet list (lines starting with `- ` or `* `).
    if (/^[-*]\s/.test(block)) {
      const items = block
        .split(/\n/)
        .filter((l) => /^[-*]\s/.test(l.trim()))
        .map((l) => l.trim().replace(/^[-*]\s+/, ''));
      rendered.push(
        items
          .map(
            (item) =>
              `<div ${styleAttr(bulletBase)}>` +
              `<span ${styleAttr(style({ color: colors.accent, marginRight: space.sm }))}>▸</span>` +
              renderInline(item) +
              `</div>`,
          )
          .join(''),
      );
      continue;
    }

    // "Why it matters" callout — detect when the block leads with the phrase.
    const whyMatch = block.match(/^\*\*Why it matters[:\s*]+\*\*\s*(.*)$/is);
    if (whyMatch) {
      rendered.push(
        `<div ${styleAttr(calloutBlock)}>` +
          `<span ${styleAttr(whyItMattersLabel)}>Why it matters</span>` +
          `<p ${styleAttr(whyItMattersBody)}>${renderInline(whyMatch[1])}</p>` +
          `</div>`,
      );
      continue;
    }

    // Plain paragraph.
    rendered.push(`<p ${styleAttr(paragraphBase)}>${renderInline(block)}</p>`);
  }

  return rendered.join('\n');
}

/**
 * Render inline markdown — **bold**, *italic*, and standalone "Why it matters"
 * phrases that appear mid-paragraph. Keeps the output safe by escaping raw
 * text first and then reintroducing the markup.
 */
function renderInline(text: string): string {
  let out = escapeHtml(text);
  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, `<strong ${styleAttr(style({ color: colors.textPrimary }))}>$1</strong>`);
  // *italic*
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return out;
}

/**
 * Render the Market Pulse module — mono ticker strip with semantic
 * up/down/flat coloring. Emitted as its own dossier block so the parent
 * template can place it independently of the Sonnet "Market Signal"
 * narrative section.
 */
function renderMarketPulse(markets: MarketQuote[]): string {
  if (markets.length === 0) return '';
  const strip = markets
    .map((m) => {
      const color = m.direction === 'up' ? colors.up : m.direction === 'down' ? colors.down : colors.flat;
      const symbolStyle = styleAttr(typeStyle(type.data, { color: colors.textTertiary, marginRight: space.xs }));
      const changeStyle = styleAttr(typeStyle(type.dataStrong, { color }));
      return `<span ${styleAttr(style({ display: 'inline-block', marginRight: space.lg, marginBottom: space.xs }))}>
        <span ${symbolStyle}>${escapeHtml(m.symbol)}</span> <span ${changeStyle}>${escapeHtml(m.change)}</span>
      </span>`;
    })
    .join('');

  return (
    `<div ${styleAttr(
      style({
        margin: `0 0 ${space.xl} 0`,
        padding: `${space.md} ${space.lg}`,
        background: colors.bgMuted,
        borderTop: `2px solid ${colors.divider}`,
        borderBottom: `2px solid ${colors.divider}`,
      }),
    )}>` +
    `<div ${styleAttr(
      typeStyle(type.sectionLabel, {
        color: colors.textTertiary,
        marginBottom: space.sm,
        textTransform: 'uppercase',
      }),
    )}>Market Pulse</div>` +
    strip +
    `</div>`
  );
}

/**
 * Render the "Your Watchlist" personalized module (Track A.9).
 *
 * Takes a recipient's declared interests + the brief's top-risk
 * countries, filters the countries down to the ones matching the
 * recipient's regions or top threat category, and emits a dossier
 * module with the top 3 matches. Each match gets a score badge and
 * a short "why this matters to you" tag built from the intersection
 * reasons.
 *
 * Returns an empty string if:
 *   - interests is undefined (anonymous preview / shared beehiiv path)
 *   - countries list is empty
 *   - no country matches the user's interests (we'd rather show
 *     nothing than a misleading empty card; the brief's main body
 *     still covers the global situation)
 *
 * This is the "hybrid personalization" from Apr 10 Decision 9: the
 * shared brief body is the same for every reader; the Watchlist
 * module is the one slice that varies per recipient.
 */
function renderYourWatchlist(interests: Interests | undefined, countries: WatchlistCountry[] | undefined): string {
  if (!interests || !countries || countries.length === 0) return '';

  // Score each country against the user's interests and keep the
  // matches. matchesInterests returns {match, reasons} — we sort by
  // CII score within the matched set so the most urgent items lead.
  const matched = countries
    .map((country) => {
      const result = matchesInterests(country, interests);
      return result.match ? { country, reasons: result.reasons } : null;
    })
    .filter((m): m is { country: WatchlistCountry; reasons: string[] } => m !== null)
    .sort((a, b) => b.country.score - a.country.score)
    .slice(0, 3);

  if (matched.length === 0) return '';

  const rows = matched
    .map(({ country, reasons }) => {
      const scoreColor =
        country.score >= 70
          ? colors.down
          : country.score >= 50
            ? colors.accent
            : country.score >= 30
              ? colors.divider
              : colors.up;

      return (
        `<div ${styleAttr(
          style({
            display: 'block',
            margin: `0 0 ${space.md} 0`,
            padding: `${space.md} ${space.lg}`,
            background: colors.bgCard,
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${scoreColor}`,
            borderRadius: layout.radiusCallout,
          }),
        )}>` +
        // Row: country name on the left, score chip on the right.
        `<div ${styleAttr(
          style({
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: space.xs,
          }),
        )}>` +
        `<span ${styleAttr(
          typeStyle(type.storyHeadline, {
            color: colors.textPrimary,
            fontSize: '18px',
            margin: 0,
          }),
        )}>${escapeHtml(country.name)}</span>` +
        `<span ${styleAttr(
          typeStyle(type.dataStrong, {
            color: scoreColor,
            fontSize: '14px',
          }),
        )}>CII ${country.score}</span>` +
        `</div>` +
        // Reasons tag — why this country is in THIS user's Watchlist.
        `<div ${styleAttr(
          typeStyle(type.caption, {
            color: colors.textTertiary,
            marginTop: space.xs,
          }),
        )}>` +
        `<span ${styleAttr(
          style({
            fontFamily: fonts.mono,
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: colors.accent,
            marginRight: space.sm,
          }),
        )}>Matches</span>` +
        `${reasons.map((r) => escapeHtml(r)).join(' · ')}` +
        `</div>` +
        `</div>`
      );
    })
    .join('');

  // Summary strip at the top of the section so the reader sees which
  // of their interests the match was against. Built from the
  // intersection of the interests enums so we don't leak the raw
  // region/threat IDs into the email.
  const regionLabels = interests.regions.map((r) => REGIONS.find((x) => x.id === r)?.label ?? r).join(' · ');
  const threatLabels = interests.threats.map((t) => THREATS.find((x) => x.id === t)?.label ?? t).join(' · ');

  return (
    `<div ${styleAttr(
      style({
        margin: `${space.xxl} 0 ${space.xxl} 0`,
        paddingTop: space.xl,
        borderTop: `2px solid ${colors.divider}`,
      }),
    )}>` +
    // Kicker label + serif headline
    `<div ${styleAttr(
      typeStyle(type.kicker, {
        color: colors.accent,
        margin: `0 0 ${space.xs} 0`,
      }),
    )}>YOUR WATCHLIST</div>` +
    `<h2 ${styleAttr(
      typeStyle(type.storyHeadline, {
        color: colors.textPrimary,
        margin: `0 0 ${space.sm} 0`,
      }),
    )}>Based on your interests</h2>` +
    // Interest summary strip
    `<div ${styleAttr(
      typeStyle(type.caption, {
        color: colors.textTertiary,
        margin: `0 0 ${space.lg} 0`,
      }),
    )}>${[regionLabels, threatLabels].filter(Boolean).join(' · ')}</div>` +
    // Matched country rows
    rows +
    `</div>`
  );
}

/**
 * Render the Map of the Day static image block. Embeds an <img> pointing
 * at /api/brief/screenshot?date=X&size=email — the endpoint returns
 * either a Mapbox Static Images redirect (when MAPBOX_TOKEN is set) or
 * a branded SVG fallback (when it isn't). Either way the layout holds.
 *
 * The 600px content width means we render the image at the same width
 * the dossier card expects — the screenshot endpoint generates at
 * 1200x630 so retina displays look crisp when scaled down.
 */
function renderMapOfTheDayImage(date: string): string {
  const imgUrl = `https://nexuswatch.dev/api/brief/screenshot?date=${encodeURIComponent(date)}&size=email`;
  return (
    `<div ${styleAttr(style({ margin: `${space.md} 0 ${space.lg} 0` }))}>` +
    `<img src="${imgUrl}" alt="Map of the Day — ${escapeHtml(date)}" width="${parseInt(layout.contentWidth, 10) - 64}" ${styleAttr(
      style({
        display: 'block',
        width: '100%',
        maxWidth: '100%',
        height: 'auto',
        borderRadius: layout.radiusCallout,
        border: `1px solid ${colors.border}`,
      }),
    )} />` +
    `</div>`
  );
}

/**
 * Render a Sonnet-written section into a Light Intel Dossier module. Every
 * section gets the same shell: kicker + serif headline + body. The body
 * renderer handles per-paragraph, per-bullet, per-story-card treatments
 * inside the shell.
 *
 * The "Map of the Day" section gets special treatment: an <img> of the
 * auto-generated screenshot is prepended to the body text so readers get
 * the visual anchor before the caption.
 */
function renderSection(section: BriefSection, dateForImage?: string): string {
  const kickerStyle = styleAttr(
    typeStyle(type.kicker, {
      color: colors.accent,
      margin: `0 0 ${space.xs} 0`,
    }),
  );
  const headlineStyle = styleAttr(
    typeStyle(type.storyHeadline, {
      color: colors.textPrimary,
      margin: `0 0 ${space.md} 0`,
    }),
  );
  const emojiInline = section.emoji
    ? `<span ${styleAttr(style({ marginRight: space.sm }))}>${section.emoji}</span>`
    : '';

  // Special case: Map of the Day gets the screenshot image embedded before
  // the Sonnet-generated caption.
  const isMapOfTheDay = /map of the day/i.test(section.title);
  const imageBlock = isMapOfTheDay && dateForImage ? renderMapOfTheDayImage(dateForImage) : '';

  return (
    `<div ${styleAttr(style({ margin: `0 0 ${space.xxl} 0` }))}>` +
    `<div ${kickerStyle}>${emojiInline}${escapeHtml(section.title.toUpperCase())}</div>` +
    `<h2 ${headlineStyle}>${escapeHtml(section.title)}</h2>` +
    imageBlock +
    renderSectionBody(section.body) +
    `</div>`
  );
}

/**
 * Masthead block. Rendered at the top of the email-only shell (not in
 * beehiivHtml — beehiiv writes its own). Shows the wordmark, date, and a
 * parchment-gold rule that anchors the dossier aesthetic.
 */
function renderMasthead(date: string, time: string): string {
  return (
    `<div ${styleAttr(style({ margin: `0 0 ${space.xl} 0`, textAlign: 'center' }))}>` +
    `<div ${styleAttr(
      typeStyle(type.masthead, {
        color: colors.textPrimary,
        margin: `0 0 ${space.xs} 0`,
        letterSpacing: '-0.01em',
      }),
    )}>NexusWatch</div>` +
    `<div ${styleAttr(
      typeStyle(type.kicker, {
        color: colors.accent,
        margin: `0 0 ${space.md} 0`,
      }),
    )}>SITUATION BRIEF</div>` +
    `<div ${styleAttr(
      style({
        height: '2px',
        background: `linear-gradient(to right, transparent, ${colors.divider}, transparent)`,
        margin: `0 0 ${space.md} 0`,
      }),
    )}></div>` +
    `<div ${styleAttr(
      typeStyle(type.issueMeta, {
        color: colors.textTertiary,
      }),
    )}>${escapeHtml(date)} · ${escapeHtml(time)}</div>` +
    `</div>`
  );
}

/**
 * CTA block — "Open Live Map" + "Read the Brief Archive" pairing. Rendered
 * in the email shell only.
 */
function renderCTA(): string {
  const ctaButton = style({
    display: 'inline-block',
    padding: `${space.md} ${space.xl}`,
    background: colors.accent,
    color: colors.textInverse,
    textDecoration: 'none',
    borderRadius: layout.radiusCallout,
    fontFamily: fonts.mono,
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  });
  const ctaSecondary = style({
    display: 'inline-block',
    padding: `${space.md} ${space.xl}`,
    background: 'transparent',
    color: colors.textPrimary,
    textDecoration: 'none',
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: layout.radiusCallout,
    fontFamily: fonts.mono,
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginRight: space.md,
  });

  return (
    `<div ${styleAttr(style({ margin: `${space.xl} 0`, textAlign: 'center' }))}>` +
    `<a href="https://nexuswatch.dev/#/intel" ${styleAttr(ctaSecondary)}>Open Live Map →</a>` +
    `<a href="https://nexuswatch.dev/#/briefs" ${styleAttr(ctaButton)}>Read the Brief Archive →</a>` +
    `</div>`
  );
}

/**
 * Footer — unsubscribe, preferences, forward-to-colleague permalink, and
 * the brand signature. Forward-to-colleague is the growth loop: a clickable
 * permalink to the /brief/:date archive page, which subscribers can share
 * directly without exposing their email address.
 */
function renderFooter(date: string, archiveUrl: string): string {
  const footerText = typeStyle(type.caption, {
    color: colors.textTertiary,
    margin: `0 0 ${space.sm} 0`,
  });
  const footerLink = style({
    color: colors.accent,
    textDecoration: 'none',
  });
  return (
    `<div ${styleAttr(
      style({
        marginTop: space.xxl,
        paddingTop: space.xl,
        borderTop: `1px solid ${colors.border}`,
        textAlign: 'center',
      }),
    )}>` +
    `<p ${styleAttr(footerText)}>` +
    `Know someone who should read this? ` +
    `<a href="${escapeHtml(archiveUrl)}" ${styleAttr(footerLink)}>Forward today's brief →</a>` +
    `</p>` +
    `<p ${styleAttr(footerText)}>` +
    `<a href="https://nexuswatch.dev/#/preferences" ${styleAttr(footerLink)}>Preferences</a>` +
    ` · ` +
    `<a href="https://nexuswatch.dev/#/unsubscribe" ${styleAttr(footerLink)}>Unsubscribe</a>` +
    ` · ` +
    `<a href="mailto:hello@nexuswatch.dev" ${styleAttr(footerLink)}>hello@nexuswatch.dev</a>` +
    `</p>` +
    `<p ${styleAttr(
      typeStyle(type.caption, {
        color: colors.textTertiary,
        margin: `${space.md} 0 0 0`,
      }),
    )}>NexusWatch Intelligence · Issue ${escapeHtml(date)}</p>` +
    `</div>`
  );
}

/**
 * Render a text/plain multipart fallback from the markdown body. ~15% of
 * intel readers use text-only mail clients, and Resend + beehiiv both
 * treat a plain-text alternative as a deliverability signal. Preserves
 * section structure and reading order without trying to ASCII-art it.
 */
function renderPlainText(briefText: string, date: string, time: string, archiveUrl: string): string {
  // Strip bold/italic markers but keep the plain text. Section headers
  // already use `## ` and read fine as-is in a mono client.
  const stripped = briefText
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();

  return [
    `NEXUSWATCH SITUATION BRIEF`,
    `${date} · ${time}`,
    `──────────────────────────────────────────`,
    '',
    stripped,
    '',
    `──────────────────────────────────────────`,
    ``,
    `Open the live map: https://nexuswatch.dev/#/intel`,
    `Read the Brief Archive: https://nexuswatch.dev/#/briefs`,
    `Forward today's brief: ${archiveUrl}`,
    ``,
    `Preferences: https://nexuswatch.dev/#/preferences`,
    `Unsubscribe: https://nexuswatch.dev/#/unsubscribe`,
    `Contact: hello@nexuswatch.dev`,
    ``,
    `NexusWatch Intelligence`,
  ].join('\n');
}

/**
 * Compose the inner dossier content block (used by both the full email and
 * the beehiiv post body). Structure: Market Pulse → all Sonnet sections in
 * order → optional Your Watchlist module (per-recipient). The Sonnet output
 * controls the narrative sections; this function just styles them and
 * inserts the Market Pulse module after Good Morning and the Watchlist
 * module at the end.
 *
 * Passes `date` down to renderSection so the Map of the Day module can
 * embed the correct screenshot URL. When `interests` + `watchlistCountries`
 * are provided, appends the personalized Watchlist at the end via
 * renderYourWatchlist (Track A.9). When absent, no Watchlist is rendered —
 * appropriate for the shared beehiiv post body.
 */
function renderDossierInner(
  briefText: string,
  markets: MarketQuote[],
  date: string,
  interests?: Interests,
  watchlistCountries?: WatchlistCountry[],
): string {
  const sections = parseSections(briefText);
  if (sections.length === 0) {
    // Fallback: wrap the whole body as a single paragraph block.
    return `<div ${styleAttr(typeStyle(type.body, { color: colors.textPrimary }))}>${renderInline(briefText)}</div>`;
  }

  const pieces: string[] = [];
  let marketPulseInserted = false;

  for (const section of sections) {
    pieces.push(renderSection(section, date));
    // Insert the Market Pulse module right after Top Signal, so the
    // reader gets price context before diving into the movers.
    if (!marketPulseInserted && /top signal|good morning/i.test(section.title)) {
      pieces.push(renderMarketPulse(markets));
      marketPulseInserted = true;
    }
  }

  // If there's no Good Morning section (shouldn't happen with Sonnet output,
  // but defensive against the fallback builder), prepend Market Pulse.
  if (!marketPulseInserted) {
    pieces.unshift(renderMarketPulse(markets));
  }

  // Per-recipient Watchlist module — empty string when interests is
  // undefined or no countries match, so the beehiiv shared post body
  // gets no Watchlist section automatically.
  const watchlistHtml = renderYourWatchlist(interests, watchlistCountries);
  if (watchlistHtml) pieces.push(watchlistHtml);

  return pieces.join('\n');
}

/**
 * The Apple Mail dark-mode override. Shipped inside a `<style>` block
 * scoped by `@media (prefers-color-scheme: dark)`. Gmail and most other
 * clients strip or ignore this, so light is canonical — dark is a bonus.
 */
function renderDarkModeStyleBlock(): string {
  return `
    <style>
      @media (prefers-color-scheme: dark) {
        body, table, td {
          background-color: #0E1116 !important;
          color: #E8E6DE !important;
        }
        .dossier-card {
          background-color: #161B22 !important;
          border-color: #2A2F38 !important;
        }
        .dossier-text-primary { color: #E8E6DE !important; }
        .dossier-text-secondary { color: #C2BCAB !important; }
        .dossier-text-tertiary { color: #8B8478 !important; }
        .dossier-accent { color: #D66A64 !important; }
        .dossier-border { border-color: #2A2F38 !important; }
      }
    </style>
  `;
}

/**
 * Main export — render a brief into all three delivery formats.
 *
 * This is the only function the rest of the handler (and the preview
 * endpoint in api/admin/brief/preview.ts) should call. It guarantees the
 * three outputs stay synchronized: same content, three different
 * renderings (email shell, beehiiv content, plain-text).
 */
export function renderDossierEmail(opts: RenderBriefOptions): RenderedBrief {
  const { briefText, date, time, markets, interests, watchlistCountries } = opts;
  const archiveUrl = opts.archiveUrl ?? `https://nexuswatch.dev/#/brief/${date}`;
  const inner = renderDossierInner(briefText, markets, date, interests, watchlistCountries);

  // Full standalone email shell for Resend transactional path.
  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>NexusWatch Situation Brief · ${escapeHtml(date)}</title>
  ${renderDarkModeStyleBlock()}
</head>
<body ${styleAttr(
    style({
      margin: 0,
      padding: 0,
      background: colors.bgPage,
      fontFamily: fonts.sans,
      color: colors.textPrimary,
      WebkitTextSizeAdjust: '100%',
      msTextSizeAdjust: '100%',
    }),
  )}>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${styleAttr(
    style({ background: colors.bgPage, padding: `${space.xl} ${space.md}` }),
  )}>
    <tr><td align="center">
      <table role="presentation" width="${layout.contentWidth}" cellpadding="0" cellspacing="0" border="0" class="dossier-card" ${styleAttr(
        style({
          maxWidth: layout.contentWidth,
          background: colors.bgCard,
          borderRadius: layout.radiusCard,
          border: `1px solid ${colors.border}`,
          padding: layout.gutter,
        }),
      )}>
        <tr><td>
          ${renderMasthead(date, time)}
          ${inner}
          ${renderCTA()}
          ${renderFooter(date, archiveUrl)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Inner modules only for the beehiiv post body. beehiiv adds its own
  // masthead, footer, and unsubscribe footer, so we ship just the content.
  const beehiivHtml = `<div ${styleAttr(
    style({
      fontFamily: fonts.sans,
      color: colors.textPrimary,
      background: colors.bgCard,
      padding: space.md,
      maxWidth: layout.contentWidth,
    }),
  )}>${inner}${renderCTA()}</div>`;

  const plainText = renderPlainText(briefText, date, time, archiveUrl);

  return { emailHtml, beehiivHtml, plainText };
}

// === RSS fetcher for news headlines ===
async function fetchNewsHeadlines(): Promise<NewsItem[]> {
  const headlines: NewsItem[] = [];
  const results = await Promise.allSettled(
    BRIEF_RSS_FEEDS.map(async (feed) => {
      const r = await fetch(feed.url, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'NexusWatch/1.0 Intelligence Brief' },
      });
      if (!r.ok) return [];
      const xml = await r.text();
      return parseRssItems(xml, feed.source);
    }),
  );
  for (const r of results) {
    if (r.status === 'fulfilled') headlines.push(...r.value);
  }
  // Sort by recency heuristic (position in feed) and deduplicate
  const seen = new Set<string>();
  return headlines
    .filter((h) => {
      const key = h.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function parseRssItems(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
    const item = match[1];
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/.exec(item);
    const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    if (title && title.length > 10) {
      items.push({ title, source });
    }
  }
  return items;
}

// === Haversine distance for correlation detection ===
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// === Fallback brief in markdown (when AI fails) ===
// Matches the A.5 locked structure (Apr 10 Decision 5): 7 weekday sections
// + optional Friday Tool of the Week. No Space & Tech (deliberately dropped
// during A.5 — wasn't in the locked structure). Sunday falls back to the
/**
 * Format resolved calls for the prompt context and the fallback.
 *
 * The first line is ALWAYS the aggregate; detail lines follow, ordered by
 * divergence from the stored base rate (most informative first — a hit at 16%
 * against a 10% base says more than the seventh hit at 84%). Capped so a
 * 105-resolution morning cannot flood the prompt; the cap is stated in the
 * output so the model knows the list is bounded rather than complete.
 *
 * Every numeral here lands in dataContext, which is what makes it QUOTABLE:
 * the grounding gate (groundDraft) verifies the draft's numerals against the
 * context, so a resolution the model mentions must appear here first or the
 * whole draft is refused in favour of the fallback.
 */
export interface ResolvedCallRow {
  kind: string;
  country_code: string;
  probability: number;
  base_rate: number | null;
  status: string;
  resolves_on: string;
  evidence_count: number | null;
}

/**
 * Splice the standing ledger line into a brief body.
 *
 * INSIDE the first section, as a bold paragraph — never as a preamble and
 * never as a blockquote. Both halves of that were learned on 2026-09-05, the
 * first resolution day: the old splice put `> **The Ledger** ...` at line 0,
 * and (a) no renderer in the product handles `>`, so the literal character
 * shipped to every subscriber, while (b) parseSections splits on `^## `, so
 * everything before the first header became a TITLELESS pseudo-section with
 * an empty kicker and empty h2 above it. The single most important line the
 * product had ever published went out mis-rendered on all three surfaces.
 *
 * A bold paragraph under the first `## ` header renders correctly in the
 * email renderer, the SPA mirror, and the archive today, with zero renderer
 * changes. The dedicated masthead treatment belongs to the redesign.
 */
export function spliceLedgerLine(briefText: string, ledger: string): string {
  const lines = briefText.split('\n');
  const firstHeader = lines.findIndex((l) => l.startsWith('## '));
  const block = ['', `**The Ledger** — ${ledger}`];
  if (firstHeader >= 0) lines.splice(firstHeader + 1, 0, ...block);
  else lines.push(...block);
  return lines.join('\n');
}

/**
 * The claim wording, BY KIND, with no default that lies. An independent
 * review caught the first version's `fx ? … : censorship` else-branch: a new
 * call kind would have been described to the public as "a confirmed
 * censorship event" — a false claim manufactured by omission. Unknown kinds
 * now get wording that is true of every call by construction (each names its
 * external resolver at creation), and the resolver itself refuses to score
 * kinds it does not know, so this is defence in depth, not the only wall.
 */
function claimWording(kind: string, resolvesOn: string): string {
  if (kind === 'fx_devaluation') return `currency depreciation by ${resolvesOn}`;
  if (kind === 'censorship_event') return `a confirmed censorship event by ${resolvesOn}`;
  return `the outcome it named against its declared external source by ${resolvesOn}`;
}

export function formatResolvedCallLines(
  rows: ResolvedCallRow[],
  stillDuePending: number,
  nameOf: Map<string, string> | undefined,
  // REQUIRED, deliberately. Round three caught the optional version: a caller
  // omitting totals silently fell back to rows.length — a PAGE — which is the
  // by_kind page-size defect with a default parameter for a disguise. The
  // aggregate comes from COUNT(*) or the caller does not compile.
  totals: { total: number; hits: number },
  cap = 12,
): string[] {
  const total = totals.total;
  const hits = totals.hits;
  if (total === 0 && stillDuePending === 0) return [];
  const lines: string[] = [];
  const graceNote =
    stillDuePending > 0
      ? ` ${stillDuePending} due call${stillDuePending === 1 ? '' : 's'} remain${stillDuePending === 1 ? 's' : ''} pending under the coverage-grace rule (thin evidence, never scored as a miss).`
      : '';
  if (total === 0) {
    // Due calls exist and NONE resolved — either everything is grace-held, or
    // the resolver did not run. Say which is knowable, and never go quiet.
    lines.push(`${stillDuePending} calls came due and none has resolved yet.${graceNote}`);
    return lines;
  }
  lines.push(`${total} calls settled against external ground truth: ${hits} hit, ${total - hits} miss.${graceNote}`);
  const byInfo = [...rows].sort(
    (a, b) =>
      Math.abs((b.probability ?? 0) - (b.base_rate ?? b.probability ?? 0)) -
      Math.abs((a.probability ?? 0) - (a.base_rate ?? a.probability ?? 0)),
  );
  for (const r of byInfo.slice(0, cap)) {
    const name = nameOf?.get(r.country_code) ?? r.country_code;
    const outcome = r.status === 'hit' ? 'HIT' : 'MISS';
    const base = r.base_rate !== null ? ` (base rate ${(r.base_rate * 100).toFixed(0)}%)` : '';
    const evidence =
      r.kind === 'censorship_event' && r.evidence_count !== null && r.status === 'hit'
        ? ` — OONI confirmed blocking on ${r.evidence_count} day${r.evidence_count === 1 ? '' : 's'} in the window`
        : '';
    lines.push(
      `${name} (${r.country_code}): ${outcome} — we said ${(r.probability * 100).toFixed(0)}%${base} for ${claimWording(r.kind, r.resolves_on)}${evidence}`,
    );
  }
  const shown = Math.min(byInfo.length, cap);
  if (total > shown) lines.push(`…and ${total - shown} more, listed in full on the ledger.`);
  return lines;
}

// weekday shape rather than Week in Review, because the fallback only fires
// when Sonnet is fully unavailable and we want coverage parity over format.
export function buildFallbackText(data: BriefData): string {
  // The deterministic edition — published when the model draft fails a gate
  // (grounding, structure) or the API fails. Same section spine as the model
  // version (brief-structure.ts), grounded by construction: every line below
  // is a restatement of a value already in BriefData. It says plainly that it
  // is the mechanical edition; on a site whose brand is "we publish our
  // misses", telling the reader the AI draft was refused today is a feature.
  const trendArrow = (c: CIIEntry) => {
    if (c.prevDeviation === null) return '';
    const d = c.deviation - c.prevDeviation;
    if (d >= 3) return ` ↑${d.toFixed(0)}`;
    if (d <= -3) return ` ↓${Math.abs(d).toFixed(0)}`;
    return ' →';
  };
  const topCountry = data.topRiskCountries[0];

  let text = `${DAILY_SECTIONS[0]}\n\n`;
  // The record first, when there is one. Same rule as the model prompt: a
  // register that buries the day its calls settle is doing PR, and the
  // mechanical edition is not exempt. Aggregate line, most informative
  // resolution, then the top open call.
  if (data.resolvedCallLines.length > 0) {
    text += `${data.resolvedCallLines[0]}\n\n`;
    if (data.resolvedCallLines.length > 1) text += `${data.resolvedCallLines[1]}\n\n`;
  }
  text += data.openCallLines.length > 0 ? `${data.openCallLines[0]}\n\n` : `No open calls today.\n\n`;

  text += `${DAILY_SECTIONS[1]}\n\n`;
  if (data.newsHeadlines.length > 0) {
    const n = data.newsHeadlines[0];
    text += `**${n.title}** (${n.source}). This is the mechanical edition — the model draft was withheld today, so we give you the lead as the wire carried it rather than a synthesis.\n\n`;
  } else if (topCountry) {
    text += `**${topCountry.name} leads the board — structural ${topCountry.score}/100, +${topCountry.deviation} live today${trendArrow(topCountry)}.** ${data.topRiskCountries.filter((c) => c.score >= 50).length} countries sit above CII 50 of ${data.totalCountries} scored.\n\n`;
  } else {
    text += `A quiet board. ${data.earthquakeCount} seismic events in 24h; nothing above the consequence threshold.\n\n`;
  }

  text += `${DAILY_SECTIONS[2]}\n\n`;
  text += `**Movers**\n\n`;
  const movers = data.topRiskCountries
    .filter((c) => c.prevDeviation !== null && Math.abs(c.deviation - (c.prevDeviation as number)) >= 3)
    .slice(0, 6);
  if (movers.length > 0) {
    for (const c of movers) {
      const d = c.deviation - (c.prevDeviation as number);
      text += `- **${c.name}** ${c.score} (${d > 0 ? '▲+' : '▼'}${d.toFixed(0)}) — driver not identified in today's data.\n`;
    }
    text += `\n`;
  } else {
    text += `No moves past the ±3 threshold in 24h.\n\n`;
  }
  text += `**Crises**\n\n`;
  const crises = data.topRiskCountries
    .filter((c) => c.deviation >= 8 || (c.score >= 80 && c.deviation > 0))
    .slice(0, 4);
  text +=
    crises.length > 0
      ? crises.map((c) => `- **${c.name}** — CII ${c.score}${trendArrow(c)}.`).join('\n') + `\n\n`
      : `No active crisis triggers today.\n\n`;
  text += `**Markets**\n\n`;
  text +=
    data.markets.length > 0
      ? data.markets.map((m) => `${m.symbol}: ${m.price} (${m.change})`).join(' | ') + `\n\n`
      : `Market data unavailable.\n\n`;
  text += `**What would change our mind:** a confirmed OONI blocking event, or an FX reference-rate move past a stored threshold, in any country on the open book above — the resolvers check daily.\n\n`;

  text += `${DAILY_SECTIONS[3]}\n\n`;
  text += `- This is the mechanical edition: the model draft was withheld by a publish gate, so today carries data without narrative.\n`;
  text += `- Every mover above is unexplained by construction — we do not attribute causes mechanically.\n`;
  if (data.conflictHeadlines.length === 0)
    text += `- The conflict headline feed returned nothing today; that gap is a gap.\n`;
  text += `\n`;

  text += `${DAILY_SECTIONS[4]}\n\n`;
  const trending = data.weeklyTrends.find((t) => t.direction === 'rising' || t.direction === 'falling');
  text += trending
    ? `${trending.name} has ${trending.direction === 'rising' ? 'risen' : 'fallen'} from ${trending.weekAgoScore ?? '?'} to ${trending.currentScore} over 7 days. If the direction holds through month-end, it moves onto the crisis list${trending.direction === 'falling' ? ' — or off it' : ''}.\n`
    : `No sustained 7-day trajectory stands out; the long fuse is quiet.\n`;

  return text;
}

function splitTextToChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a paragraph boundary
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }
  return chunks;
}
