# Operational knowledge

What has been **proved** about how this system behaves, with the evidence, and
an explicit note of what the investigation could *not* prove.

**The rule this file exists under.** A first guess recorded as a fact is worse
than no record: it institutionalises a belief nobody re-examines. So every entry
below states how it was verified. When an entry turns out to be wrong it is
**retracted in place**, not deleted — a quietly disappeared belief teaches
nobody, and the retraction is usually more useful than the original claim.

Last updated 2026-08-30.

---

## RETRACTED — "the blank OG card is an edge-runtime build difference"

**The belief, now withdrawn:** `/api/og` renders blank in production because
both og endpoints are `runtime: 'edge'`, where `@vercel/og` resolves a
different build than locally — and therefore local render proofs exercised code
production does not run.

**What is actually true.** `api/og.ts:110` declares `renderSiteCard(): string`,
`:231` declares `let html: string`, and `:251` calls
`new ImageResponse(html as any, …)`. Satori requires a React-element tree;
handed a string it renders the whole thing as a single text node. **The
`as any` is the tell — the type system caught this and was silenced.** No
`fonts` option is passed either, so whatever renders uses Satori's default face.

**Consequence for the old belief:** the local 44–52 KB renders were never cards
either. They were raw markup laid out as prose. The "local proves nothing
because edge differs" framing was wrong in both directions.

**How it was verified (2026-08-29):** fetched `https://nexuswatch.dev/api/og`
— HTTP 200, 4,411 bytes, a valid 1200×630 PNG — and **looked at it**. It is
entirely blank white. Then read the three source lines above.

**The lesson worth more than the fact:** *byte size is not a render check.*
4,411 bytes is a perfectly valid PNG. A card is verified by fetching the image
and looking, or by asserting non-background pixel fraction and distinct-colour
count. A blank card has one colour.

---

## Alerting

### The alarm was connected on 2026-08-28 and immediately sent nine emails for one problem

Read from Resend's sent log, not inferred:

| time (UTC) | event |
|---|---|
| 15:31 | test alert — "monitoring is now connected" |
| 16:31 → 20:30 | **9 × `[CRITICAL] DOWN /api/cii — timeout`**, one every 30 min |
| 20:41 | `perf(cii)` deploys — 13,620 ms → 488 ms |
| 21:31, 22:02 | 2 × `[WARNING] SLOW /api/briefs-sample — 3934 ms` |
| after 22:02 | silence |

**The alarm was not broken — it was working for the first time**, and it caught
a real fault (`/api/cii` timing out) that had been invisible for months.
`raiseAlert` simply had no cooldown, no deduplication and no all-clear.

Two facts to keep:

- **Recovery was never announced.** The alerts stopped when the fix deployed and
  nothing said so, leaving "fixed" and "the monitor died" indistinguishable from
  the inbox. An alarm without an all-clear is only half an alarm.
- **A dedup key must not be derived from the message body.** Bodies carry live
  numbers (`3934ms`) that change every run, so a body hash deduplicates nothing
  while appearing to. Key on the stable identity of the condition — which
  endpoints are affected, not how slow they were this minute.

Fixed by `alert_state` + `raiseAlert({ key })` + `clearAlert`. **Deliberately
fails open**: if the state table is unreachable, alerts send. A duplicate is an
annoyance; a swallowed alert is the failure the module exists to end.

---

## The OONI data, and what it can and cannot support

All measured against production 2026-08-28/29.

- **`confirmed_blocked` does not measure censorship.** It measures whether a
  censor deploys a *fingerprintable blockpage*. Italy's confirmed rate (1.73%)
  is **ten times China's** (0.16%), while China's anomaly rate is 57.9% against
  Italy's 3.9%. Belarus records **zero** confirmed blocks in 1.28 M
  measurements at a 9.9% anomaly rate. Nigeria has 0 confirmed days in 131 — so
  **a call on Nigeria would resolve MISS through a total national blackout.**
- **Coverage is anti-correlated with the thing being measured.** The
  thin-coverage countries are CF, ML, TD, SS, NE, SD — Sahel and Horn conflict
  states. OONI is a volunteer network, and volunteers are thinnest where running
  a measurement tool is most dangerous. The countries the product most wants to
  be right about are the ones it has least evidence for. This belongs on
  `/methodology`.
- **Coverage is bimodal, so the gate threshold barely matters.** Over a
  completed 15-day window, 32 of 39 countries had *complete* coverage and the
  rest had 0, 2, 3, 6, 6, 8. But **days alone are not enough**: Cuba had 15 of
  15 days on 479 measurements against Russia's 95,531 — a 200× spread. Hence a
  two-dimensional gate.
- **Only ~9 of 39 countries have ever varied** in the fortnightly
  `confirmed_blocked` outcome (24 always-NO, 6 always-YES). Under an
  anomaly-rate outcome it is 14, of which only **4 show persistent
  (predictable) state**; three are *anti*-persistent.
- **The collector ingests exactly one `test_name`** (`web_connectivity`), which
  is why `ooni_measurements` holds one row per country-day and why the
  resolver's `COUNT(DISTINCT measurement_date)` currently equals `COUNT(*)`
  (742 = 742). `api/_lib/evidence-unit.test.ts` fails if that stops being true.
- **A missed collector run is a permanent hole.** `source-ooni.ts:73` fetches
  only `since = yesterday`, so nothing backfills. ML was last seen 2026-07-05
  and TD 2026-08-02.

---

## Licensing — seven sources carry non-commercial terms

Verified 2026-08-29. This constrains the product's shape, not just its footer.

- **OONI data is CC BY-NC-SA 4.0** (`github.com/ooni/license`, `data/Readme.md`
  states it covers "all the data … published on `https://api.ooni.io`" — the
  exact endpoint `source-ooni.ts` calls). The repo carries **zero** occurrences
  of "Creative Commons", "BY-NC-SA", "NonCommercial" or "CC BY".
- Also non-commercial: Cloudflare Radar API data (BY-NC), WHO, Open-Meteo free
  tier, TwelveData free tier, Polymarket (bars "financial technology
  companies"), and **OpenSky**, whose §3(vi) requires a written licence for
  "integration into a live product, service, or automated system, **regardless
  of the entity's non-profit status**" — barred today, revenue or not.
- `api/v1/docs.ts:62-63` advertises **$99/$249 per month** while
  `cost-summary.ts:64` records Stripe in test mode. **Removing those tiers
  clears all seven sources at once.**
- Three institutions bar this product *category* by name: ElectionGuide
  ("predictive markets"), ISW ("markets and speculative markets"), FRED
  ("gambling").
- **IODA publishes no terms at all** — a verified absence, not a failed search.
  Its software is academic-use-only. Absence of a prohibition is not a grant.

### Resend prohibits cold outreach, and the blast radius is your own subscribers

Verified live at `resend.com/legal/acceptable-use`: *"You are prohibited from
sending unsolicited messages of any kind, **including cold outreach**"*, above
*"Your complaint rate must be lower than **0.08%** … your account may be shut
down **without warning**."*

`RESEND_API_KEY` is the send path for **both** `deliver-briefs.ts` and
`subscribe.ts`. At twenty cold recipients one complaint is 5% — sixty-two times
the threshold. **The realistic worst case is losing brief delivery to real
subscribers, for a marketing send.** Any outreach goes from a personal mail
client.

---

## Verification discipline — what went wrong while doing the above

These are recorded because they are the failures of the *method*, and the method
is reused far more often than any one fix.

### The MR reviewer read the working tree, not the branch

`scripts/codex-review-mr.sh` pointed Codex at `$(pwd)/$file` — the file **on
disk** — while showing it a diff from a different branch. Run from `main` after
a merge, it reviewed `main`'s code and reported that a branch's changes "are not
present in the file": confident, specific, sourced, and entirely wrong.

It was caught only because that one verdict was *obviously* wrong. Every earlier
review happened to be run while checked out on the branch under review, so they
were correct **by luck, not by construction**. A subtler wrong verdict would
have been accepted.

Fixed with `git show "$BRANCH:$file"` into a snapshot the reviewer reads.

**The general rule: verify the instrument before the finding.** Before trusting
any tool's output, prove it is looking at what you think it is. One assertion —
that the snapshot contains a string unique to the branch — would have caught
this on the first run instead of the ninth.

### Plant-test the tool, not only the code

Every guard written this week was plant-tested both ways. The *reviewer* never
was. The same discipline applies one level up: run the tool against a case where
you already know the answer, and confirm it can fail correctly. **A green result
is not evidence until you have shown what a wrong result would look like.**

### Confirm the plant landed where you think

A broken `package.json` was planted to test the hook's "cannot derive the guard
list" branch. The hook did block — at `npm run typecheck`, because npm cannot
read the file either. **The intended branch was never reached.** The plant
proved fail-closed behaviour and nothing about the guard it was aimed at. That
branch remains unproven and is recorded as such.

### Attach conditions to every measurement

"`COUNT(*)` equals `COUNT(DISTINCT measurement_date)`, 742 = 742" was correct
and its *scope* was wrong. The honest form is "…**given one `test_name`**",
which immediately implies the guard that now enforces it. A measurement in a
commit message protects nothing.

### Separate verified from reasoned, and weight accordingly

Across this work, claims that were *measured* held. Claims that were *reasoned*
— the OG edge-runtime theory, an assumption that country-level outcomes were
independent (measured φ = 0.115, so ~176 effective claims/year, not ~700), and a
worked example chosen for plausibility that turned out to refute its own thesis
— did not. Label which is which, and discount the second kind out loud.

### When a reviewer disagrees, go and measure

Every clean resolution came from new evidence — `npm run validate` genuinely
fails on untracked scratch; no caller reads `AlertChannel`; there is exactly one
`test_name`. Every muddy one came from arguing back. Reviewers are also wrong
sometimes: a red light needs its claim verified just as a green one needs its
mechanism verified.

---

## Known-unfixed

- **`by_kind` counts are computed from a paged array.** `/api/calls/ledger`
  reports `censorship_event.open: 3` against ~273 real, because `by_kind` is
  derived from the default 200-row page while `counts` comes from `COUNT(*)`.
  Pre-existing; a published count derived from a page size.
- **`npm run validate` fails in a clean worktree** — `format:check` runs
  tree-wide and trips on untracked scratch another process leaves behind
  (`docs/figma-mirror.snapshot.json`, `scripts/check-figma-mirror.mjs`). This is
  why the pre-push hook cannot simply run `validate`.

  **AMENDED 2026-08-30 — the two named files are no longer scratch.** They are
  committed on this branch, so once it merges they are tracked, formatted, and
  cannot trip `format:check` again. Measured after committing them:
  `npm run validate` exits **0** on a clean tree.

  Amended rather than deleted, because the *general* claim survives and is the
  useful half: `format:check` runs tree-wide, so ANY untracked file a parallel
  process leaves behind can fail `validate` on work that did not create it.
  That is still why the hook scopes prettier to the pushed delta instead of
  running `validate` wholesale. What is retracted is only the specific reading
  that this is a standing, unfixable condition — it was two uncommitted files,
  and the fix was to commit them rather than to work around them.
- **`lint` is excused from the pre-push hook** (measured 15 s; CI catches it
  before merge). It has already let one error through to CI. The exception
  register is capped at two entries so a third requires a deliberate change.
