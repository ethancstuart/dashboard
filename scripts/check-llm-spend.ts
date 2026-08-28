/**
 * CI guard: every LLM call in api/ must record its spend.
 *
 * WHY: api/_lib/llm-budget.ts carries a $9/day hard kill-switch, and its
 * header has documented the convention — check, call, record — since it was
 * written. On 2026-08-22 an audit found 10 of 12 Anthropic call sites
 * recorded nothing, including api/cron/daily-brief.ts, which runs Sonnet
 * every single day at 10:00 UTC. llm_spend_daily held exactly ONE row, from
 * 2026-05-18. So the kill-switch was reading a small fraction of real spend
 * and could not have fired no matter what we spent.
 *
 * A convention in a docstring is not a guard. This is the guard.
 *
 * IT DERIVES, IT DOES NOT ENUMERATE. There is no list of known call sites to
 * fall out of date. Scope is computed from the property itself — a file that
 * actually calls an LLM HTTP endpoint in code (not in a comment) — so a NEW
 * call site added tomorrow fails by default rather than passing because
 * nobody remembered to add it here. The burden is on new code to prove it is
 * out of scope, never on this script to have pre-listed it.
 *
 * A file that genuinely should not record declares so IN THE FILE:
 *
 *   // llm-spend-exempt: <reason>
 *
 * with a real reason. The marker is deliberately in-file rather than in an
 * allowlist here, so the justification sits where the next reader is already
 * looking and travels with the code if it moves.
 *
 * Usage: npx tsx scripts/check-llm-spend.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, 'api');

/** Hosts that cost money per call. */
const BILLED_HOSTS = ['api.anthropic.com', 'api.openai.com'];

/** Any of these in a file means it participates in spend accounting. */
const RECORDING_MARKERS = ['recordSpend', 'recordAnthropicSpend'];

/**
 * And this means it consults the kill switch. Recording without gating is how
 * the switch saw the fire and was wired to three rooms of twelve: 9 of 12 call
 * sites — including every public unauthenticated endpoint — could keep
 * spending past any limit. Both properties are now required of every billed
 * call site.
 */
const GATING_MARKERS = ['checkBudget'];

const EXEMPT_RE = /\/\/\s*llm-spend-exempt:\s*(\S.*)$/m;
const GATE_EXEMPT_RE = /\/\/\s*llm-budget-gate-exempt:\s*(\S.*)$/m;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Remove comments so a host named in a docstring does not put a file in
 * scope. Read-only analysis — this never writes back to the file.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface Finding {
  file: string;
  hosts: string[];
  missing: string;
}

const violations: Finding[] = [];
const exempt: Array<{ file: string; reason: string }> = [];
let inScope = 0;

for (const file of walk(SCAN_DIR)) {
  const src = readFileSync(file, 'utf8');
  const code = stripComments(src);
  const hosts = BILLED_HOSTS.filter((h) => code.includes(h));
  if (hosts.length === 0) continue;

  inScope++;
  const rel = relative(ROOT, file);

  const records = RECORDING_MARKERS.some((m) => code.includes(m));
  const gates = GATING_MARKERS.some((m) => code.includes(m));

  // The presence of `checkBudget` is not the property — how bypassCap is BOUND
  // is. api/v2/council.ts passed `bypassCap: body.bypass_budget` from an
  // unauthenticated request body, defeating both the $9/day hard kill and the
  // DISABLE_LLM_USER_FACING switch, and this guard reported it green because
  // the string was present. bypassCap must be a literal: anything else is a
  // caller-influenced kill-switch and fails by default.
  const badBypass = [...code.matchAll(/bypassCap\s*:\s*([^,}\n]+)/g)]
    .map((m) => m[1].trim())
    .filter((v) => v !== 'true' && v !== 'false');

  if (!records) {
    const exemption = src.match(EXEMPT_RE);
    if (exemption) exempt.push({ file: rel, reason: exemption[1].trim() });
    else violations.push({ file: rel, hosts, missing: 'recording' });
  }

  if (!gates) {
    const gateExemption = src.match(GATE_EXEMPT_RE);
    if (gateExemption) exempt.push({ file: rel, reason: `gate: ${gateExemption[1].trim()}` });
    else violations.push({ file: rel, hosts, missing: 'gating' });
  }

  // A caller-influenced bypass is worse than a missing gate: the gate is
  // present, so every other check reports compliance while the kill-switch
  // answers to the request.
  if (badBypass.length > 0) {
    violations.push({ file: rel, hosts, missing: `bypassCap bound to non-literal (${badBypass.join(', ')})` });
  }
}

console.log(`[check-llm-spend] ${inScope} file(s) in api/ call a billed LLM endpoint.`);
for (const e of exempt) {
  console.log(`  exempt: ${e.file} — ${e.reason}`);
}

if (violations.length > 0) {
  console.error(`\n[check-llm-spend] FAILED — ${violations.length} call site(s) record no spend:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}  (calls ${v.hosts.join(', ')}) — missing ${v.missing}`);
  }
  console.error(
    '\nEvery billed call site must RECORD its spend and GATE on the kill switch:\n' +
      "    import { checkBudget, recordAnthropicSpend } from '../_lib/llm-budget.js';\n" +
      "    const gate = await checkBudget({ endpoint: 'x', bypassCap: false }); // crons: bypassCap: true\n" +
      "    await recordAnthropicSpend(model, data.usage, 'x');\n" +
      '\nOr declare, in the file, why it should not:\n' +
      '    // llm-spend-exempt: <reason>          (recording)\n' +
      '    // llm-budget-gate-exempt: <reason>    (gating; e.g. a library whose callers gate)\n' +
      '\nUnrecorded spend is invisible to the $9/day kill-switch; ungated spend\n' +
      'ignores it. Both happened here — the switch saw one row from May while ten\n' +
      'call sites spent silently, then saw everything and gated three of twelve.',
  );
  process.exit(1);
}

console.log('[check-llm-spend] OK — every billed call site records spend and gates on the budget.');
