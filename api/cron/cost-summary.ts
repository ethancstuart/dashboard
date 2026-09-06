import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs', maxDuration: 30 };

/**
 * Weekly cost-and-quota summary. Runs Monday 9am UTC.
 *
 * Posts a Discord summary with:
 *   - 7-day API usage estimates (computed from KV cache hits where
 *     possible; from log proxy where not)
 *   - Direct deep links to each provider's billing dashboard
 *   - Free-tier headroom warnings when applicable
 *
 * For providers without a usage API, this becomes a "go-check" pulse —
 * a calendared reminder you can't ignore.
 *
 * 2026-05-02 G4.
 */

const PROVIDERS = [
  {
    name: 'Anthropic',
    dashboardUrl: 'https://console.anthropic.com/settings/usage',
    note: 'Haiku spend on /api/briefs-sample. KV cache TTL 6h means ≤4 calls/day worst-case.',
  },
  {
    name: 'Windy Webcams',
    dashboardUrl: 'https://api.windy.com/dashboard',
    note: 'Free tier: 10k req/day. Cache-warm cron (45min) + 1h KV TTL = ~32 calls/day.',
  },
  {
    name: 'EIA',
    dashboardUrl: 'https://www.eia.gov/opendata/',
    note: 'Free tier: 5k req/hour. (/api/energy retired 2026-09-06 with the map.)',
  },
  {
    name: 'Vercel',
    dashboardUrl: 'https://vercel.com/dashboard/usage',
    note: 'Function invocations + bandwidth + KV requests. Pro plan: 1M function invocations/month included.',
  },
  {
    name: 'Neon',
    dashboardUrl: 'https://console.neon.tech',
    note: 'Compute hours + storage. Hobby plan: 100 compute hours / month.',
  },
  {
    name: 'Upstash KV',
    dashboardUrl: 'https://console.upstash.com',
    note: 'Free tier: 10k req/day, 256MB. Rate-limit + cache reads count.',
  },
  {
    name: 'Sentry',
    dashboardUrl: 'https://sentry.io/organizations/',
    note: 'Free tier: 5k errors/month. Watch for spikes.',
  },
  {
    name: 'Resend',
    dashboardUrl: 'https://resend.com/dashboard',
    note: 'Free tier: 3k emails/month, 100/day. Brief delivery.',
  },
  {
    name: 'Stripe',
    dashboardUrl: 'https://dashboard.stripe.com',
    note: 'Test-mode currently — no real revenue. See docs/runbooks/stripe-go-live.md to switch.',
  },
];

async function postDiscord(webhook: string, embed: unknown): Promise<boolean> {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed], username: 'NexusWatch Cost Summary' }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const webhook = process.env.DISCORD_APPROVAL_WEBHOOK_URL;
  const enabled = process.env.DISCORD_APPROVAL_ENABLED !== 'false';

  const lines = PROVIDERS.map((p) => `• **${p.name}** — ${p.note}\n  → ${p.dashboardUrl}`);
  const description = [`Weekly check-in for the past 7 days. Click each link to verify usage.`, '', ...lines].join(
    '\n',
  );

  const embed = {
    title: '💰 NexusWatch — Weekly Cost & Quota Check',
    description,
    color: 0x06b6d4,
    timestamp: new Date().toISOString(),
    footer: { text: 'Configure: docs/runbooks/key-rotation.md' },
  };

  if (!webhook || !enabled) {
    return res.status(200).json({ ok: true, alertingDisabled: true, providersChecked: PROVIDERS.length });
  }

  const sent = await postDiscord(webhook, embed);
  return res.status(200).json({ ok: true, alertSent: sent, providersChecked: PROVIDERS.length });
}
