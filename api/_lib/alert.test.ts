import { describe, it, expect } from 'vitest';
import { isNotificationDue, ongoingHoursSince, ALERT_REMINDER_HOURS } from './alert.js';

/**
 * THE INCIDENT THIS ENCODES — 2026-08-28, verified against Resend's sent log.
 *
 * The alarm was connected at 15:31 UTC and immediately earned its place: it
 * caught /api/cii timing out, a fault that had been invisible for months. It
 * then sent NINE identical [CRITICAL] emails for that one continuous
 * condition, every thirty minutes from 16:31 to 20:30, plus two more for a
 * slow endpoint. When the perf fix deployed at 20:41 the alerts simply
 * stopped, and nothing said the problem was over.
 *
 * Nine emails for one problem is how a person learns to ignore the alarm — a
 * worse outcome than the silence it replaced, because silence at least does
 * not pretend to be information.
 */
describe('alert deduplication — one problem, one notification', () => {
  const now = new Date('2026-08-28T20:30:00Z');

  it('notifies the first time a condition is seen', () => {
    expect(isNotificationDue(null, now)).toBe(true);
  });

  it('stays quiet on the next cron tick, which is what sent nine emails', () => {
    // cron-health runs every 30 minutes. Under the old code each tick sent.
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60_000);
    expect(isNotificationDue(thirtyMinutesAgo, now)).toBe(false);
  });

  it('stays quiet across the whole four-hour flood window', () => {
    // 16:31 -> 20:30 was nine sends. Under the new rule it is one.
    const firstSend = new Date('2026-08-28T16:31:00Z');
    let sends = 0;
    let lastSent: Date | null = null;
    for (let t = firstSend.getTime(); t <= now.getTime(); t += 30 * 60_000) {
      const tick = new Date(t);
      if (isNotificationDue(lastSent, tick)) {
        sends++;
        lastSent = tick;
      }
    }
    expect(sends).toBe(1);
  });

  it('reminds once the interval elapses — quiet is not the same as forgotten', () => {
    const sent = new Date(now.getTime() - ALERT_REMINDER_HOURS * 3_600_000);
    expect(isNotificationDue(sent, now)).toBe(true);
  });

  it('does not remind one minute early', () => {
    const sent = new Date(now.getTime() - (ALERT_REMINDER_HOURS * 3_600_000 - 60_000));
    expect(isNotificationDue(sent, now)).toBe(false);
  });

  it('sends at most five times a day for a condition nobody fixes', () => {
    // The point is a paced reminder, not silence. 24h / 6h = 4 reminders plus
    // the initial notification.
    let sends = 0;
    let lastSent: Date | null = null;
    const start = new Date('2026-08-28T00:00:00Z').getTime();
    for (let t = start; t < start + 24 * 3_600_000; t += 30 * 60_000) {
      const tick = new Date(t);
      if (isNotificationDue(lastSent, tick)) {
        sends++;
        lastSent = tick;
      }
    }
    expect(sends).toBeLessThanOrEqual(5);
    // And it must not be zero — a deduplicator that never sends is the old
    // silence with extra steps.
    expect(sends).toBeGreaterThan(0);
  });
});

describe('ongoing duration, for the reminder wording', () => {
  it('reports whole hours since the condition began', () => {
    const now = new Date('2026-08-28T20:30:00Z');
    expect(ongoingHoursSince(new Date('2026-08-28T16:31:00Z'), now)).toBe(3);
    expect(ongoingHoursSince(new Date('2026-08-28T20:29:00Z'), now)).toBe(0);
  });

  it('never returns a negative duration', () => {
    const now = new Date('2026-08-28T20:30:00Z');
    expect(ongoingHoursSince(new Date('2026-08-29T00:00:00Z'), now)).toBe(0);
  });

  it('treats a missing start as zero rather than throwing', () => {
    expect(ongoingHoursSince(null)).toBe(0);
  });
});
