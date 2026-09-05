# We scored our first 39 forecasts today. The instrument is the story.

**DRAFT — awaiting voice sign-off. Every figure re-verified against
production on its stated date. Placeholders: «» = fill on publish day.**

---

This morning at 09:45 UTC, a cron job we cannot interrupt marked 34 of our
censorship forecasts right or wrong. Nobody reviewed the answers. Nobody got
to reword anything. The calls were published two weeks ago with their
probabilities, the resolver read the evidence, and the ledger wrote the
outcomes down in a place we can't edit.

Ten hit. Twenty-four missed. Five weren't scored at all — and we'll get to
why, because the rule that held them back was published before we knew we'd
need it.

That's the record. Here's the part we'd rather tell you ourselves than have
someone else find.

## The test we were running isn't the test we thought

Every one of those calls resolved on one question: did OONI record a
*confirmed* blocking event in that country during the window? "Confirmed"
means a volunteer's probe hit a blockpage that matches a known fingerprint —
a wall the censor signs.

It turns out that measures something narrower than censorship. Measured from
our own collection table on 2026-09-05, over about 140 days per country:

| | anomaly rate | days with a confirmed block |
|---|---|---|
| China | 63.2% | 66 of 140 |
| Venezuela | 16.9% | **0 of 140** |
| Yemen | 14.0% | **0 of 140** |
| Pakistan | 9.4% | **0 of 140** |
| Belarus | 8.8% | **0 of 140** |
| India | 3.8% | 135 of 140 |
| Turkey | 3.4% | **139 of 140** |
| Nigeria | 2.7% | 0 of 139 |

Read that middle column against the right one. Turkey has nearly the lowest
anomaly rate on the list and a confirmed block on all but one day. Venezuela
runs five times Turkey's anomaly rate and has never recorded a single one.

That's not a ranking of who censors. It's a ranking of whose censorship
infrastructure uses a blockpage our probes already have a fingerprint for. A
government that drops packets silently — or throttles, or poisons DNS
without a branded wall — reads as clean. Nigeria could take its entire
network offline and this instrument would resolve our call as "no
censorship event."

So of today's twenty-four misses, some are the world declining to do what we
predicted — and some are our instrument failing to see it happen. We can't
fully separate the two, and we're not going to pretend we can.

## Why we're publishing this instead of quietly fixing it

Because the alternative is worse. If we retired the criterion silently,
today's record would stand as a clean-looking number over a broken ruler —
and the first person to compare Turkey's row to Venezuela's would be right
to ask what else we weren't saying.

We ran the experiment, the experiment worked, and one of the things it
measured was our own test. That is what this site is for. A register that
only reports its good mornings isn't a register.

## What we're changing, and what we're not

**Changing, for future calls only:** censorship calls will resolve on a
country's anomaly rate against *its own trailing history* — a country-
relative measure that works even where no fingerprint exists, with the
threshold registered in advance and never retuned after the fact. It has
three gate tests to pass first, and any of them can come back "no". If they
do, we'll publish that too.

**Not changing:** every call already on the book resolves exactly as it was
made. The «273» censorship calls issued under the old criterion keep the old
criterion to the end. Rewriting a resolution rule under an open position is
how a track record becomes a story, and we published that principle on the
ledger before the first call matured.

**Not claiming:** skill. The ledger shows "skill withheld — 1 of 3 batches"
today, because one morning's resolutions share one date and one fortnight of
weather. They're one observation, not thirty-four. We wrote that rule before
we had a score we might want to show you, which is the only time such a rule
can be written honestly. The withheld number publishes when three
independent batches exist, whatever it says.

And one more, smaller: ten of thirty-four were hits, and we won't be quoting
that as an accuracy figure. Several of those calls were near-certainties on
countries that block something every week. Getting Turkey right is not
forecasting.

## The five that weren't scored

Central African Republic, Mali, Sudan, South Sudan, Chad. OONI's coverage
there was too thin for absence-of-evidence to mean anything — volunteers
are scarcest exactly where running a measurement tool is most dangerous,
which means our evidence is thinnest in the places we most want to be right
about. Those calls stay open under a seven-day grace rule, then settle as
"unresolvable," on the ledger, with the coverage counts that put them there.
Not hits, not misses, not deleted.

The asymmetry is deliberate and worth stating plainly: a confirmed block we
*did* see resolves as a hit no matter how thin the window, because seeing
something happen is evidence it happened. Only the would-be miss needs a
well-observed window. That rule can remove misses from our record and can
never remove a hit — which is why every held call is published with its
reason rather than quietly dropped.

## What happens next

Tomorrow, sixty-six FX calls and thirty-nine more censorship calls mature,
and the register dilutes from a pure censorship reading into a blend. The
new instrument's gate tests run over the coming weeks. Three resolution
batches from now, a skill number publishes — ours to live with either way.

The forecast was never the asset. The register is: dated claims, external
resolution, rules published before results, and the honesty to report that
our first experiment's most solid finding was about our own ruler.

---
*Methodology, the coverage rule, and every call with its criterion:
[/ledger](https://nexuswatch.dev/ledger) ·
[/methodology](https://nexuswatch.dev/methodology)*
