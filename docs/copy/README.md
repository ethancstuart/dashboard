# The sign-off batch

Everything in this directory is DRAFT COPY awaiting the owner's voice
sign-off. Nothing here is published, linked, or rendered by the app. The
deal (owner decision, 2026-09-05): machinery lands continuously; words wait
for one review pass.

| file | destination when signed off |
|---|---|
| `2026-09-XX-the-instrument.md` | a new /writing or /brief-adjacent page; also the announcement the ledger links |
| (queued) landing narrative | `/` hero + section copy on the redesign branch |
| (queued) masthead + email CTA wording | ssr-shell, renderDossierEmail |

House rules for anything added here: every number carries its measurement
date; no number appears that api/ledger.ts would withhold; voice per
docs/voice/nexuswatch-voice.md (40% analyst / 60% smart friend, we/our,
numbers-places-dates in analyst sentences).

## Deployed ahead of sign-off — flag, not precedent

The OG cards (PR #29, 2026-09-05) shipped with copy harvested from parked
PR #2, drafted 2026-08-28 and never voice-checked:

- ledger card: "Every call we make, scored against something that isn't us."
  · "CALLS OPEN" · "CALLS THAT LANDED" · "resolved by an external source, on
  a date fixed in advance" · "FREE."
- call card: "WHAT WE SAID" · "STATED <date>" · "RESOLVES/RESOLVED <date>"

Shipped because the alternative was keeping the cards BLANK for another
review cycle; flagged here because the deal is one sign-off batch and these
words jumped the queue. Edit freely — the card templates live in api/og.ts
and re-render on deploy. One watch-item for the wording pass: "CALLS THAT
LANDED" over a raw hit fraction sits close to the spurious-excellence line
the ledger legislates against; a label like "RESOLVED · 10 HIT" may be the
more honest shape.
