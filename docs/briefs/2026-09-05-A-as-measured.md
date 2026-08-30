# Version A — as measured

**DRAFT. Voice sign-off owed. Numbers marked `«»` are re-read on the day.**
Section spine matches `DAILY_SECTIONS`. The Ledger line is inserted mechanically
after the H1 by `daily-brief.ts`; it is shown here so the page can be read whole,
but it is not written by hand.

---

> **The Ledger** — «31» resolved today, «10» hit · OONI Brier «0.089» over «31», skill withheld (1 of 3 batches) · «818» open, next resolves 2026-09-06

## 🎯 Today's Call

Today we're not making one. We're settling «31» of them.

Two weeks ago we published 39 dated claims about whether OONI would confirm a
censorship event in 39 countries. This morning the resolver read the window and
marked them, with no human in the loop and no chance to revise. That's the whole
point of doing it this way, and it's the first time it's happened here.

«10» resolved hit. «21» resolved miss. «8» we're not scoring at all, and the
reason for those is the more interesting half of today.

## 📊 Top Signal

**We got a result, and we also got a problem with the instrument that produced
it. The problem is the bigger story, so we're leading with it.**

Every one of these calls resolves on the same test: did OONI record a
*confirmed* block in that country inside the window? Confirmed means the probe
matched a known blockpage fingerprint. It turns out that measures something
narrower than we assumed — and we can show you, from our own table:

| | anomaly rate | days with a confirmed block |
|---|---|---|
| China | **63.3%** | 62 of 134 |
| Venezuela | 17.0% | **0 of 134** |
| Yemen | 14.5% | **0 of 134** |
| Pakistan | 9.5% | **0 of 134** |
| Belarus | 8.9% | **0 of 134** |
| Turkey | 3.5% | **133 of 134** |
| Nigeria | 2.7% | **0 of 133** |

*Measured against our own `ooni_measurements` table on 2026-08-30, 134 days.*

Turkey has the lowest anomaly rate on that list and a confirmed block on almost
every single day. Venezuela has five times Turkey's anomaly rate and has never
recorded one. Turkey's confirmed rate per measurement is about twenty times
China's.

That's not a ranking of censorship. It's a ranking of which censors use a
blockpage our probes already have a fingerprint for. A country that drops
packets silently looks clean. **Nigeria would have resolved MISS through a total
national blackout** — 0 confirmed days in 133.

So some of today's misses are real, and some are our instrument failing to see.
We can't tell you which are which, and we're not going to pretend the
distinction doesn't exist.

We'd rather publish that ourselves than have you notice it.

## 🌍 The Board

**What we scored**

«31» calls resolved. «10» hit, «21» miss. Per kind only — everything today is
censorship, so there's nothing to pool and nothing to average across resolvers
with different failure modes.

**What we didn't score, and why**

«8» calls came due and we're not marking them: Central African Republic, Cuba,
Mali, Niger, Sudan, Somalia, South Sudan, Chad.

Before we score a call as a miss, we ask whether we looked hard enough to be
entitled to say so. For a fourteen-day call that's OONI observing the country on
at least 7 days, across at least 350 measurements. Sudan had «1» day. Mali and
Chad had none at all. Cuba was observed on «8» days but across only «183»
measurements — enough days, nowhere near enough looking.

Those calls stay open for seven more days in case the evidence arrives late. If
it hasn't by 12 September, they're marked unresolvable, with the day and
measurement counts written into the row, and they're excluded from every number
we publish.

**The part we'd rather not say out loud:** the countries we can't score are
Sahel and Horn conflict states. OONI is a volunteer network, and volunteers are
thinnest where running a measurement tool is most dangerous. Our coverage is
anti-correlated with the thing we're measuring. The countries we most want to be
right about are the ones we have least evidence for, and no threshold fixes
that.

**No skill score today**

You'll see "skill withheld (1 of 3 batches)" on the Ledger. One morning's
resolutions all share the same date and the same fortnight of weather, so
they're one observation, not «31». We need three independent batches before a
skill number means anything, and we published that rule before we had a score
rather than after.

We also won't be printing "«10» of «31» correct" as an accuracy figure. Seven of
these calls were near-certainties on countries that block something every week.
Getting those right is not evidence of anything.

**What would change our mind:** we're changing it today. From the next issuance,
censorship calls resolve on a country's own anomaly rate against its own
trailing history, not on `confirmed_blocked`. That threshold is being registered
in advance and won't be retuned to flatter a result. The «273» calls already on
the book resolve exactly as they were made — we're not rewriting a criterion
under an open position.

## 🙊 What We're Not Saying

- We're not saying today's misses mean those countries had no censorship. Some
  did and we couldn't see it.
- We're not claiming skill. We don't have enough batches, and the honest answer
  to "are you any good at this" is that we don't know yet.
- We're not saying the new instrument is better. It's better *reasoned*. It has
  three tests to pass and any of them can come back no.
- We're not going to quietly retire the countries we can't measure. They stay on
  the Ledger with their counts.

## 🧨 The Long Fuse

The next cohort resolves tomorrow, and from here every day carries FX as well as
censorship. Today was the last time this record will be a clean read on one
instrument — from tomorrow it's a blend, and blends hide things.

Three independent batches is roughly a month away. That's the first date any
skill number here means anything at all. We'll publish it whatever it says.
