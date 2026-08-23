import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { recordAnthropicSpend } from '../_lib/llm-budget.js';
import { checkBudget } from '../_lib/llm-budget.js';

export const config = { runtime: 'nodejs', maxDuration: 120 };

/**
 * Automated Intelligence Report Generator.
 *
 * Generates deep analytical reports (8-15 sections) comparable to what
 * a Stratfor or Eurasia Group analyst produces. Uses Claude with the
 * full NexusWatch data corpus via multi-turn tool-use.
 *
 * NOT the 3-minute daily brief — these are comprehensive intelligence
 * products: situation assessment, historical context, force disposition,
 * scenario modeling, risk matrix, pattern matches, and recommended
 * monitoring posture.
 *
 * POST /api/v2/intelligence-report
 * Body: { country: "SD", topic?: "civil war trajectory", depth?: "comprehensive" }
 */

const CORS_ORIGIN = 'https://nexuswatch.dev';

interface ReportRequest {
  country: string;
  topic?: string;
  depth?: 'brief' | 'standard' | 'comprehensive';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Budget gate — the $9/day kill switch only works if every public spender
  // checks it. Until now it gated 3 of 12 call sites; this endpoint could keep
  // spending past any limit.
  const gate = await checkBudget({ endpoint: 'intelligence-report', bypassCap: false });
  if (!gate.ok) {
    res.setHeader('Retry-After', '3600');
    return res.status(503).json(gate);
  }
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({
      available: false,
      error: 'Intelligence report generation requires AI configuration.',
      hint: 'Set ANTHROPIC_API_KEY in Vercel environment variables.',
    });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'database_not_configured' });

  const { country, topic, depth = 'standard' } = req.body as ReportRequest;
  if (!country || country.length !== 2) {
    return res.status(400).json({ error: 'country (2-letter ISO code) required' });
  }

  const sql = neon(dbUrl);
  const countryCode = country.toUpperCase();

  try {
    // ═══ Gather intelligence data for the report ═══
    const [ciiHistory, crisisTriggers, recentEvents, patternContext] = await Promise.all([
      // CII history (30 days)
      sql`
        SELECT country_code, score, components, timestamp
        FROM country_cii_history
        WHERE country_code = ${countryCode}
        ORDER BY timestamp DESC LIMIT 30
      `,
      // Active crisis triggers
      sql`
        SELECT playbook_key, trigger_type, cii_score, magnitude, notes, triggered_at
        FROM crisis_triggers
        WHERE country_code = ${countryCode}
          AND resolved_at IS NULL
        ORDER BY triggered_at DESC LIMIT 10
      `,
      // Recent events (ACLED-derived from cached layer data)
      sql`
        SELECT title, timestamp, metadata
        FROM event_snapshots
        WHERE country_code = ${countryCode}
        ORDER BY timestamp DESC LIMIT 20
      `.catch(() => []),
      // Pattern matches from crisis triggers
      sql`
        SELECT playbook_key, notes, triggered_at
        FROM crisis_triggers
        WHERE country_code = ${countryCode}
          AND trigger_type = 'pattern-match'
        ORDER BY triggered_at DESC LIMIT 5
      `.catch(() => []),
    ]);

    // Get latest CII and components
    const latestCII = ciiHistory[0] as { score: number; components: Record<string, number> } | undefined;
    const ciiTrend =
      ciiHistory.length >= 7
        ? `CII 7 days ago: ${(ciiHistory[6] as { score: number })?.score ?? 'N/A'}, now: ${latestCII?.score ?? 'N/A'}`
        : 'Insufficient history for trend';

    // Build the data context for Claude
    const dataContext = `
COUNTRY: ${countryCode}
CURRENT CII SCORE: ${latestCII?.score ?? 'N/A'}/100
CII COMPONENTS: ${latestCII?.components ? JSON.stringify(latestCII.components) : 'N/A'}
CII TREND: ${ciiTrend}
DATA QUALITY: ${(latestCII?.components as unknown as Record<string, string>)?.dataQuality ?? 'N/A'}

ACTIVE CRISIS TRIGGERS (${crisisTriggers.length}):
${crisisTriggers.map((t) => `- [${t.trigger_type}] ${t.playbook_key}: ${t.notes}`).join('\n') || 'None active'}

PATTERN MATCHES:
${patternContext.map((p) => `- ${p.notes}`).join('\n') || 'No pattern matches detected'}

RECENT EVENTS (${recentEvents.length}):
${
  recentEvents
    .slice(0, 10)
    .map((e) => `- [${new Date(e.timestamp as string).toISOString().split('T')[0]}] ${e.title}`)
    .join('\n') || 'No recent events'
}
`;

    // ═══ Generate the report via Claude ═══
    const sectionCount = depth === 'comprehensive' ? 12 : depth === 'standard' ? 8 : 5;
    const wordCount = depth === 'comprehensive' ? '3000-4000' : depth === 'standard' ? '1500-2500' : '800-1200';

    const systemPrompt = `You are the NexusWatch Intelligence Analyst, producing professional-grade intelligence reports comparable to Stratfor, Eurasia Group, or RAND Corporation products.

Your reports are data-driven, source-cited, and structured for decision-makers (fund managers, policy analysts, corporate risk officers, journalists).

VOICE: Authoritative but accessible. No jargon without definition. Every claim cites its source. Name limitations and data gaps explicitly — epistemic humility is the brand.

OUTPUT: Clean markdown. Use ## for section headers. **bold** for emphasis. Bullet points for key findings. Tables for risk matrices. No HTML.`;

    const userPrompt = `Generate a ${depth} intelligence report on ${countryCode}${topic ? `: ${topic}` : ''}.

DATA CONTEXT (NexusWatch live data — cite this):
${dataContext}

STRUCTURE (${sectionCount} sections, ${wordCount} words total):

## 1. EXECUTIVE SUMMARY
2-3 paragraphs. Key findings, current risk level, trajectory. This is what a busy executive reads.

## 2. SITUATION ASSESSMENT
Current state of affairs. What's happening right now. Cite CII score and components.

## 3. HISTORICAL CONTEXT
How did we get here? Key events in the last 6-12 months. Reference pattern matches if any detected.

## 4. KEY ACTORS & DYNAMICS
Who are the relevant parties? What are their interests? Power dynamics.

## 5. RISK MATRIX
Table format: Risk | Probability | Impact | Timeframe | Indicators to Watch

## 6. SCENARIO ANALYSIS
3 scenarios: Best case, most likely, worst case. Each with CII projection and trigger conditions.

${
  depth !== 'brief'
    ? `
## 7. ECONOMIC & MARKET IMPACT
How does this affect markets, trade routes, supply chains? Reference commodity prices and FX data if relevant.

## 8. MONITORING POSTURE
Specific indicators to watch over the next 7-30 days. Thresholds that would change the assessment.
`
    : ''
}

${
  depth === 'comprehensive'
    ? `
## 9. REGIONAL IMPLICATIONS
How does this cascade to neighboring countries? Reference cascade rules and chokepoint dependencies.

## 10. INTELLIGENCE GAPS
What don't we know? Where is our confidence lowest? What data would change our assessment?

## 11. COMPOUND SIGNAL ASSESSMENT
Are any compound signals (Digital Canary, Economic Stress, Attention Precursor) active for this country?

## 12. PATTERN MATCH ANALYSIS
Does this country's current signature match any historical crisis fingerprint? What does that imply?
`
    : ''
}

CRITICAL RULES:
- Cite NexusWatch data (CII scores, components, events) as primary source
- Name confidence levels: HIGH (3+ sources), MEDIUM (2 sources), LOW (1 source)
- Every scenario must have specific, measurable trigger conditions
- The risk matrix must use 5-level probability/impact scales
- End with actionable monitoring recommendations`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[intelligence-report] Anthropic error:', response.status, errText.slice(0, 200));
      return res.status(502).json({ error: 'Report generation failed', detail: `API returned ${response.status}` });
    }

    const result = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    await recordAnthropicSpend('claude-sonnet-4-5', result.usage, 'intelligence-report');
    const reportText = result.content?.[0]?.text || '';
    const tokens = result.usage;

    // Store the generated report
    try {
      await sql`
        INSERT INTO event_snapshots (layer_id, country_code, title, timestamp, metadata)
        VALUES ('intelligence-report', ${countryCode},
                ${`Intelligence Report: ${countryCode}${topic ? ' — ' + topic : ''}`},
                NOW(),
                ${JSON.stringify({
                  depth,
                  topic: topic || null,
                  word_count: reportText.split(/\s+/).length,
                  tokens_used: tokens,
                  cii_at_generation: latestCII?.score,
                })})
      `;
    } catch {
      /* storage is best-effort */
    }

    return res.json({
      success: true,
      country: countryCode,
      depth,
      report: reportText,
      metadata: {
        wordCount: reportText.split(/\s+/).length,
        sectionCount: (reportText.match(/^## /gm) || []).length,
        tokensUsed: tokens,
        ciiAtGeneration: latestCII?.score,
        generatedAt: new Date().toISOString(),
        patternMatchesUsed: patternContext.length,
        crisisTriggersUsed: crisisTriggers.length,
      },
    });
  } catch (err) {
    console.error('[intelligence-report] Error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Report generation failed' });
  }
}
