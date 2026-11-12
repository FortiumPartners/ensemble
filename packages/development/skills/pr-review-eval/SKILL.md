---
name: pr-review-eval
description: Add an escaped bug (incident or revert) to the reviewer eval set as a code-owner-confirmed case, and run the eval set when reviewer rules, prompts or model change - score each case, compare with the previous run, report regressions. Use when a maintainer says "add this incident to the eval set" or "run the reviewer eval"; do not use to review a PR (that is `pr-review-cycle`) or to compute cohort review metrics (that is `pr-review-cli.js metrics`).
---

# PR Review Eval

Two jobs, one procedure (REQ-020, AC-020-1, AC-020-2):

- **ADD** — a change escaped review and caused an incident or a revert. Record
  it as a case the code owner of the affected area confirmed.
- **RUN** — the reviewer's rules, prompts or model changed. Run the reviewer
  over every case, score what it found, compare with the previous run and
  report regressions.

This skill owns editable prose only (Rule 8); every judgement that grades a
claim is made by `pr-review-cli.js` (Rule 7). Resolve `PR_REVIEW_CLI` for
`packages/development/lib/pr-review-cli.js` per the tool-path-resolution skill
(`packages/development/skills/tool-path-resolution/SKILL.md`) before running any
command below.

Detail (field table, hash snippet, case example, verification command,
compare/stale commands): `reference/eval-details.md`, read when a step names it.

---

## Inputs

| Variable | Type | Description |
|---|---|---|
| `MODE` | `'add'` \| `'run'` | Anything else is an error, not a default. |
| `REPO_ROOT` | string | Every path below is relative to it and never leaves it. |
| `CASE` | object (ADD) | Maintainer-supplied fields (Step A1); the skill derives `rulesFile` and `rulesHash`. |
| `PREVIOUS_RUN` | path (RUN, optional) | Previous `eval-score` result. Absent means nothing to compare, reported as such — never as "no regression". |
| `REVIEWER` | string (RUN, optional) | Reviewer configuration under test; recorded in the report. |

`evalCasesDir` is **not** an input: read it from the repository policy.

```bash
# The policy block of the root REVIEW.md, read from the base commit (REQ-024).
node "$PR_REVIEW_CLI" policy <<< "$(jq -n \
  --arg text "$(git show "$BASE_SHA:REVIEW.md" 2>/dev/null)" --arg base "$BASE_SHA" \
  '{text: $text, baseSha: $base}')"
```

Use `.policy.evalCasesDir`. When the policy cannot be read the CLI answers with
the strict defaults, and the default is `docs/review-eval/cases` — a missing
policy never means "put the case anywhere".

## Outputs

Exactly one of:

- **`EVAL_CASE_ADDED`** — the path written and the owner who confirmed it.
- **`EVAL_CASE_REFUSED`** — the field that failed and why; **no file is
  written**. An unconfirmed case is not a case (AC-020-1).
- **`EVAL_RUN_COMPLETE`** — per-case score, total, comparison with the previous
  run, and stale cases needing owner re-review.
- **`EVAL_RUN_BLOCKED`** — what could not be read or run, and no score.

Never a score for an uncollected case.

---

## MODE = add

### Step A1 — Gather the case record

Ask for and record verbatim every field; infer none from another or the title: `id` (file-safe, becomes the file name), `change` (PR number or
commit SHA with a link), `bug` (the defect, not the symptom, in one or two
sentences), `location.path`, `location.startLine`, `location.endLine` (integers
>= 1, `endLine >= startLine`), `confirmedBy` (login of the confirming code
owner). A missing field is refused (`missing-field`, `invalid-case-id`,
`invalid-location`, `missing-confirmation`); the per-field table is in the
reference.

Record the bug location from the **escaping change**, not from the fix: the
case asks "would a reviewer have caught this when it was proposed?".

### Step A2 — The code-owner confirmation is checked, not asserted

A maintainer's say-so is not the confirmation. Resolve the owners of
`location.path` from CODEOWNERS and require `confirmedBy` to be one of them:

```bash
node "$PR_REVIEW_CLI" paths <<< "$(jq -n \
  --arg p "$CASE_PATH" --arg owners "$(git show "$BASE_SHA:CODEOWNERS" 2>/dev/null)" --arg base "$BASE_SHA" \
  '{changedPaths: [$p], codeowners: $owners, baseSha: $base}')"
```

Read `.paths[0].owners`. Then:

- `confirmedBy` matches an owner login (without `@`, case-insensitively) → proceed.
- The path has **no** owner → `EVAL_CASE_REFUSED: no-code-owner`. Add a
  CODEOWNERS entry first; nobody owns the area, so nobody can confirm.
- The only owners are teams (`@org/team`) → no login is checkable offline
  (`confirmed-by-not-owner`). Ask a named member to confirm.
- `confirmedBy` is not among them → `EVAL_CASE_REFUSED: confirmed-by-not-owner`,
  naming the owners who could confirm it.

Never record a confirmation the owner did not give, nor the operator as
confirmer unless they are the owner and said so.

### Step A3 — Pin the rules the case was confirmed against

Record the area rules file (else root `REVIEW.md`) and its git hash-object value,
so `eval-stale` can tell later that the rules moved (snippet in the reference).
Do not guess a rules file, and never record a hash you did not compute from the
file you named — a mismatched hash makes every later staleness answer a lie.

### Step A4 — Write the case, and nothing else

Write `<evalCasesDir>/<id>.json` with exactly the keys `id`, `change`, `bug`,
`location {path,startLine,endLine}`, `confirmedBy`, `rulesFile`, `rulesHash`
(example in the reference); copy `packages/development/skills/pr-review-eval/case-template.json`
(that shape, fields empty), do not write one from memory.

- The file name is `<id>.json` directly under `evalCasesDir`. A case written
  anywhere else is not loaded (`case-outside-eval-dir`), and a file whose name
  does not match its `id` is rejected (`case-filename-mismatch`).
- One case per file; never edit a case to describe a different bug — add a
  new one. No credentials, customer data or incident text beyond `bug`.

### Step A5 — Verify what was written

Re-read the file and run it through `eval-score` as a case with no recorded
findings (command in the reference). `cases[0].reason` must be
`no-important-finding-at-location`; `invalid-case` or `no-findings-recorded`
means fix it, or delete the file and refuse. Report `EVAL_CASE_ADDED` only
after this passes.

---

## MODE = run

### Step R1 — Load the cases

Read every `*.json` directly under `evalCasesDir`. A file that does not parse,
or is not an object, is reported as unloadable and the run continues — but it is
never counted as a case the reviewer missed, and never as one it found.

### Step R2 — Review each case the way a PR is reviewed

For each case, run the reviewer under test over the change the case names, with
the **same** fresh-context dispatch `pr-review-cycle` uses: the reviewer sees
the diff, the applied rules and repository guidance, and never the incident
report, the case record or this conversation. A reviewer told where the bug is
proves nothing about whether it would have found it.

Collect candidate findings per case id into
`findingsByCase: { "<case id>": [ findings ] }`, each with the `severity` and
`file:line` anchor the ledger requires, recorded as a review round does.

If a case's change cannot be reached, do not invent a review: leave it out of
`findingsByCase` (`eval-score` reports `no-findings-recorded`) and name it in
`EVAL_RUN_BLOCKED` when nothing could be run at all.

### Step R3 — Score, compare, and report regressions

```bash
# R3.1 Score this run. CODEOWNERS is read from the base commit and passed so a
# case no owner confirmed scores `case-unconfirmed`, never as evidence (AC-020-1).
jq -n --slurpfile cases /tmp/eval-cases.json --slurpfile findings /tmp/eval-findings.json \
  --arg owners "$(git show "$BASE_SHA:CODEOWNERS" 2>/dev/null)" \
  '{cases: $cases[0], findingsByCase: $findings[0], codeowners: $owners}' \
  | node "$PR_REVIEW_CLI" eval-score > /tmp/eval-run-today.json
```

Then run `eval-compare` (a lower total is a regression, by name) and
`eval-stale` (which cases need owner re-review because their rules file moved);
commands and the `rulesHashes` build are in `reference/eval-details.md` — a
rules file left out of that map makes its cases stale. Report `EVAL_RUN_COMPLETE` with:

- the per-case result (`found`, matched finding id, reason when not found) and
  the total `found / cases` with its score;
- the comparison: `regression: true` with the `flipped` cases named, or
  `regression: false` with the delta. When `PREVIOUS_RUN` was absent say "no
  previous run to compare against" — never `regression: false`;
- the `stale` case ids with reasons, as the owner re-review list;
- the reviewer configuration under test.

A `regression` is a result, not a crash: report it and stop. This skill
does not re-run the eval to get a better number, does not retune a prompt to
clear the regression, and does not edit a case to match what the reviewer
found — each would make the eval unable to fail.

### Step R3a — Guard

Before a pipeline-changing PR lands, run `review-eval-guard.js --base "$BASE_SHA"` (`reference/eval-details.md`). It matches by location and severity, not by what a finding says; exit 1: a lost Important finding or unproven input.

### Step R4 — Recurrence belongs to the host repository

Run when the reviewer's rules, prompts or model change, or a maintainer asks. Do
not add a schedule, a cron entry, a watcher or a workflow `schedule:` trigger
for it (Rule 4). A host repository that wants a weekly run wires it in its own
automation and invokes this skill by name.

---

## Reachability

Invoked by name by a maintainer. Every capability is reached through
`pr-review-cli.js`; no YAML caller references the CLI, as the parity tests
require. Rules live in `packages/development/lib/pr-review-eval.js`; the runbook
form is `docs/guides/pr-review-metrics.md` §5.
