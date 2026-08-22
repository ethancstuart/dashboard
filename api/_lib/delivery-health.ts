/**
 * Delivery-channel health — notices when a publishing channel has quietly
 * stopped working.
 *
 * WHY THIS EXISTS: beehiiv returned 400 on every daily-brief run for 34
 * consecutive days (since 2026-07-09, still broken) and nothing said so. The
 * failures were faithfully recorded in `brief_delivery_log` and faithfully
 * ignored, because recording is not alerting. `api/cron/data-health.ts`
 * watches DATA SOURCES; nothing watched the channels we publish through.
 *
 * The alert cadence is deliberately STATELESS — derived from the streak
 * length itself rather than from a "last alerted" column — so there is no
 * new table to migrate, nothing to get out of sync, and no way for a failed
 * bookkeeping write to silence the alert it was supposed to schedule.
 */

export interface DeliveryRow {
  channel: string;
  /** ISO date (YYYY-MM-DD) of the brief this attempt belongs to. */
  brief_date: string;
  status: string;
  error?: string | null;
}

export interface ChannelStreak {
  channel: string;
  /** Consecutive most-recent brief dates on which the channel only failed. */
  streak: number;
  /** First (most recent) error seen in the streak, for the alert body. */
  lastError: string | null;
  /** Earliest brief_date in the streak — "broken since". */
  since: string | null;
}

/** Alert once a channel has failed this many brief dates in a row. */
export const DEFAULT_THRESHOLD = 3;

/** Having alerted, alert again only every N further failures. */
export const DEFAULT_REPEAT_EVERY = 7;

/**
 * A brief date counts as a failure for a channel only if the channel
 * produced NO success or partial on that date. `partial` is explicitly not
 * a failure — it is how a duplicate Buffer post and a beehiiv plan-tier skip
 * are recorded, and neither needs a human.
 */
function dateFailed(rowsForDate: DeliveryRow[]): boolean {
  return rowsForDate.length > 0 && rowsForDate.every((r) => r.status === 'failed');
}

/**
 * Consecutive-failure streak per channel, counted backwards from the most
 * recent brief date that channel has any row for.
 *
 * Rows may arrive in any order and may contain several attempts per date.
 */
export function computeFailureStreaks(rows: DeliveryRow[]): ChannelStreak[] {
  const byChannel = new Map<string, Map<string, DeliveryRow[]>>();

  for (const row of rows) {
    let dates = byChannel.get(row.channel);
    if (!dates) {
      dates = new Map<string, DeliveryRow[]>();
      byChannel.set(row.channel, dates);
    }
    const forDate = dates.get(row.brief_date);
    if (forDate) forDate.push(row);
    else dates.set(row.brief_date, [row]);
  }

  const out: ChannelStreak[] = [];

  for (const [channel, dates] of byChannel) {
    const ordered = [...dates.keys()].sort().reverse();
    let streak = 0;
    let lastError: string | null = null;
    let since: string | null = null;

    for (const date of ordered) {
      const rowsForDate = dates.get(date) as DeliveryRow[];
      if (!dateFailed(rowsForDate)) break;
      streak++;
      since = date;
      if (lastError === null) {
        lastError = rowsForDate.find((r) => r.error)?.error ?? null;
      }
    }

    out.push({ channel, streak, lastError, since });
  }

  return out.sort((a, b) => b.streak - a.streak || a.channel.localeCompare(b.channel));
}

/**
 * Whether a streak of this length warrants an email right now.
 *
 * Fires at the threshold, then every `repeatEvery` failures after it — so a
 * channel broken for a month produces roughly four emails, not thirty. A
 * channel that has never failed, or is still below the threshold, is silent.
 */
export function shouldAlert(
  streak: number,
  threshold: number = DEFAULT_THRESHOLD,
  repeatEvery: number = DEFAULT_REPEAT_EVERY,
): boolean {
  if (streak < threshold) return false;
  return (streak - threshold) % repeatEvery === 0;
}

/** Channels that are both broken and due an alert on this run. */
export function channelsToAlert(
  rows: DeliveryRow[],
  threshold: number = DEFAULT_THRESHOLD,
  repeatEvery: number = DEFAULT_REPEAT_EVERY,
): ChannelStreak[] {
  return computeFailureStreaks(rows).filter((c) => shouldAlert(c.streak, threshold, repeatEvery));
}

/** Plain-text alert body. Says what broke, for how long, and with what error. */
export function formatAlertBody(broken: ChannelStreak[]): string {
  const lines = broken.map((c) => {
    const err = c.lastError ? `\n    last error: ${c.lastError.slice(0, 300)}` : '';
    return `  • ${c.channel} — ${c.streak} consecutive failed brief${c.streak === 1 ? '' : 's'}, since ${c.since ?? 'unknown'}${err}`;
  });
  return [
    'A NexusWatch delivery channel has stopped working.',
    '',
    ...lines,
    '',
    'Recorded in brief_delivery_log. Other channels are unaffected unless listed above.',
  ].join('\n');
}
