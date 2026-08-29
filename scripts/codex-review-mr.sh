#!/bin/sh
# Codex merge-request review — an independent model reviews a branch before it merges.
#
# WHY THIS EXISTS. Governance rule 2: anything touching auth, spend, the
# resolver or the ledger's arithmetic is reviewed by a DIFFERENT model before
# it counts as done. Self-review does not catch self-inflicted defects — on
# 2026-08-01 four vulnerabilities reached production and two of them were
# introduced by the fixes for the other two, written and reviewed by the same
# model, which passed its own work every time.
#
# This script encodes the invocation and brief shape that actually complete.
# Each part below cost real time to learn; none of it is decoration.
#
#   usage:
#     scripts/codex-review-mr.sh                      # review HEAD vs main
#     scripts/codex-review-mr.sh feat/my-branch       # review a branch vs main
#     scripts/codex-review-mr.sh feat/my-branch api/x.ts   # review ONE file
#
# Output lands in .codex-reviews/<branch>/ — one brief + one review per file,
# plus VERDICTS.md. That directory is gitignored: reviews are evidence for the
# author, not repo content.

set -e

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
ONLY_FILE="${2:-}"
BASE="${CODEX_REVIEW_BASE:-main}"

if [ "$BRANCH" = "$BASE" ]; then
  echo "refusing to review $BASE against itself — pass a branch" >&2
  exit 2
fi

command -v codex >/dev/null 2>&1 || { echo "codex CLI not found on PATH" >&2; exit 2; }

OUT=".codex-reviews/$(echo "$BRANCH" | tr '/' '-')"
mkdir -p "$OUT"

if [ -n "$ONLY_FILE" ]; then
  FILES="$ONLY_FILE"
else
  # Only source files. A review of a lockfile diff is a wasted run.
  FILES=$(git diff --name-only --diff-filter=d "$BASE...$BRANCH" \
            | grep -E '\.(ts|tsx|js|mjs|sql|sh)$' \
            | grep -v -E '\.test\.(ts|tsx)$' || true)
fi

if [ -z "$FILES" ]; then
  echo "no reviewable source files in $BASE...$BRANCH"
  exit 0
fi

COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
echo "reviewing $COUNT file(s) on $BRANCH vs $BASE"
echo

# A 28 KB prompt with files pasted in dies almost immediately; a ~2 KB prompt
# pointing at ONE absolute path did 4,300 lines of real work. So: one brief per
# file, the diff inlined as evidence (it is small), the file itself read by
# Codex from disk.
for f in $FILES; do
  SAFE=$(echo "$f" | tr '/' '-')
  BRIEF="$OUT/brief-$SAFE.txt"
  REVIEW="$OUT/review-$SAFE.txt"
  SNAP="$OUT/snapshot/$f"
  mkdir -p "$(dirname "$SNAP")"
  git show "$BRANCH:$f" > "$SNAP" 2>/dev/null || {
    echo "  $f — SKIPPED (not present on $BRANCH)"; continue; }
  ABS="$(cd "$(dirname "$SNAP")" && pwd)/$(basename "$SNAP")"

  # MATERIALISE THE BRANCH VERSION, and do not trust the working tree.
  #
  # This script used to point Codex at "$(pwd)/$f" — the file ON DISK. So it
  # reviewed whatever branch happened to be checked out, while showing Codex a
  # diff from a different one. Run from `main` after a merge, it read main's
  # files and reported that a branch's changes "are not present in the file" —
  # a confident, sourced, entirely wrong verdict.
  #
  # Caught 2026-08-29 only because one review said the change was absent when it
  # demonstrably was not. Every earlier review happened to be run while checked
  # out on the branch under review, so they were correct by luck rather than by
  # construction. `git show` makes the branch the source of truth regardless of
  # what is checked out, and touches nothing in the worktree.
  SUBJECT=$(git log --format=%s "$BASE..$BRANCH" -- "$f" | head -3 | sed 's/^/  - /')
  # Prompt size is the difference between a review and a dead run. A ~7 KB
  # prompt did 4,300 lines of real work; a 28 KB prompt died almost
  # immediately. Codex reads the file from disk anyway, so the diff is here
  # only to say WHAT CHANGED — it does not need to be complete.
  DIFF=$(git diff "$BASE...$BRANCH" -- "$f" | head -250)

  cat > "$BRIEF" <<BRIEF_END
Skills WAIVED by your human partner. Do not read any SKILL.md.

Read ONE file: $ABS
Read nothing else unless a single import is strictly required to settle a question.
Do not modify anything. Do not run tests.

You are reviewing a change before it merges. The author wrote it; you are a
different model, and your job is to REFUTE it, not to summarise it. Assume the
change is wrong until the code shows otherwise.

WHAT THE AUTHOR SAYS THIS CHANGE DOES:
$SUBJECT

THE DIFF (truncated at 400 lines if longer):
$DIFF

REPO INVARIANTS a change here must not break:
- A guard must DERIVE its scope from the property itself, never enumerate a
  list of known cases. A check satisfiable by a list is already out of date.
- Published counts must never equal a query's page size.
- The call ledger's base_rate must never absorb a forecast signal.
- resolve-calls must never read probability; it reads only frozen criterion columns.
- Public renderers read colour from src/styles/email-tokens.ts. No hex literals.
- A check whose result does not gate an action is a log line, not a check.

ANSWER EXACTLY TWO QUESTIONS. State CONFIRMED or REFUTED, then 3-6 sentences
citing line numbers.

Q1. HYPOTHESIS: this change does what its commit message claims, and does ONLY
that. Confirm or refute. Name any behaviour it changes that the message does
not mention, any case it silently stops handling, and any caller it breaks.

Q2. HYPOTHESIS: this change introduces no regression and violates none of the
invariants above. Confirm or refute. If it adds or edits a guard, state
specifically whether that guard DERIVES its scope or ENUMERATES it, and whether
a NEW instance of the guarded thing would fail by default or pass by omission.

OUTPUT FORMAT, nothing else:
Q1: CONFIRMED|REFUTED — <3-6 sentences>
Q2: CONFIRMED|REFUTED — <3-6 sentences>
BLOCKER: <the one thing that should stop this merging, or "none">
BRIEF_END

  SIZE=$(wc -c < "$BRIEF" | tr -d ' ')
  if [ "$SIZE" -gt 12000 ]; then
    echo "  $f  (${SIZE} byte brief — LARGE, large prompts die; review this file alone if it stalls)"
  else
    echo "  $f  (${SIZE} byte brief)"
  fi

  # Every part of this invocation is load-bearing:
  #   < /dev/null  — codex exec BLOCKS ON STDIN when stdin is not redirected.
  #                  It does not error, time out, or print. It looks exactly
  #                  like a large review taking a while. Cost: 50 minutes, once.
  #   > file       — not `| tail`. A pipe buffers until exit, so a hung run and
  #                  a working run are indistinguishable while you wait.
  codex exec --dangerously-bypass-approvals-and-sandbox "$(cat "$BRIEF")" \
    > "$REVIEW" 2>&1 < /dev/null
done

echo
echo "=== VERDICTS ==="
VERDICTS="$OUT/VERDICTS.md"
{
  echo "# Codex review — $BRANCH vs $BASE"
  echo
  echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ). Reviewer: codex (independent model, rule 2)."
  echo
} > "$VERDICTS"

for f in $FILES; do
  SAFE=$(echo "$f" | tr '/' '-')
  REVIEW="$OUT/review-$SAFE.txt"
  [ -f "$REVIEW" ] || continue

  # THE EXTRACTION TRAP: the brief is echoed back near the top of the output,
  # so a naive grep finds the literal "Q1: CONFIRMED|REFUTED" placeholder from
  # our own output format rather than Codex's answer. Take the LAST line that
  # actually resolves to one verdict word.
  LINE=$(grep -n '^Q1: \(CONFIRMED\|REFUTED\)' "$REVIEW" | tail -1 | cut -d: -f1 || true)

  {
    echo "## \`$f\`"
    echo
    if [ -n "$LINE" ]; then
      sed -n "${LINE},\$p" "$REVIEW" | sed -n '1,12p'
    elif grep -q "tokens used" "$REVIEW"; then
      echo "**Run completed but produced no verdict in the required format.** Read $REVIEW."
    else
      echo "**NO VERDICT — run did not complete.** A partial review is not a review."
      echo "Diagnose with CPU time, not elapsed: \`ps -o pid,etime,time -p \$(pgrep -f 'codex exec')\`."
      echo "Low TIME at high ELAPSED means blocked, not thinking."
    fi
    echo
  } >> "$VERDICTS"
done

cat "$VERDICTS"
echo
echo "full reviews: $OUT/"

# The script's exit code IS the gate. A review whose result does not gate the
# merge is a log line — the failure this repo has already legislated against.
# Non-zero on: a stated blocker, a refuted hypothesis, or a run that produced
# no verdict at all. "It did not finish" must never read as "it passed".
if grep -i '^BLOCKER:' "$VERDICTS" | grep -qiv 'none'; then
  echo
  echo "BLOCKED: the reviewer named a blocker. This branch does not merge until it is answered."
  exit 1
fi
if grep -q '^Q[12]: REFUTED' "$VERDICTS"; then
  echo
  echo "BLOCKED: the reviewer refuted a hypothesis. Read it before merging."
  exit 1
fi
if grep -q 'NO VERDICT' "$VERDICTS"; then
  echo
  echo "BLOCKED: a review did not complete. A partial review is not a review."
  exit 1
fi
echo
echo "All hypotheses confirmed, no blockers. This is one input to a merge decision, not a merge."
