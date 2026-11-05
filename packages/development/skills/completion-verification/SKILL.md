---
name: completion-verification
description: Independently re-verify a TRD's completion against code, tests and docs, blocking "done" claims until gaps are fixed or explicitly overridden. Use before declaring a TRD complete; not for unfinished work.
---

# TRD Completion Verification Gate

Independently re-verify a TRD's completion state before any calling command is
allowed to declare the TRD "done." If gaps are found, block completion
messaging and require an explicit user override before proceeding.

## Motivation

A TRD was reported "complete" via `/ensemble:implement-trd-beads`, but manual
inspection found large swaths of missing functionality. The root cause: the
existing completion logic trusts *self-reported* state — bead status set by
whichever agent closed a task, checkbox ticks, and `req-verified:` comment
tokens written by that same task-closing agent — without ever independently
re-reading the actual codebase, test suite, or a deterministic re-parse of the
TRD against that self-reported state. This skill closes that gap: it
recomputes completion from first principles (deterministic TRD parse, live
bead/checkbox state, a fresh PRD requirement scan, and a full test-suite run)
and refuses to let the calling command declare victory when the recomputed
state disagrees.

This skill is a sibling of `staleness-gate` (`packages/development/skills/staleness-gate/SKILL.md`):
staleness-gate gates the *start* of implementation on TRD freshness; this skill
gates the *end* of implementation on independently-verified completion.

---

## Inputs

| Variable          | Type   | Description |
|-------------------|--------|-------------|
| `TRD_FILE_PATH`   | string | Absolute or repo-relative path to the TRD `.md` file |
| `TRD_SLUG`        | string | TRD slug (same derivation used by the calling command) |
| `TRACKING_MODE`   | string | `'beads'` or `'checkbox'` |
| `ROOT_EPIC_ID`    | string | **Required when `TRACKING_MODE == 'beads'`.** The TRD's root epic bead id |
| `TRD_TO_BEAD_MAP` | object | **Required when `TRACKING_MODE == 'beads'`.** Map of `taskId -> beadId` built during Scaffold |

---

## Algorithm

### Step 1 — Deterministic Task Inventory

Resolve `$TRD_CLI` using the same resolution chain already established in
`implement-trd-beads.yaml` (Preflight step 3, Tool Availability Check): first
try the canonical monorepo root via `git rev-parse --show-toplevel 2>/dev/null`
+ `/packages/development/lib/trd-cli.js`; if that fails, fall back to the
legacy CWD-relative `packages/development/lib/trd-cli.js` for backward
compatibility; finally check `${CLAUDE_PLUGIN_ROOT}/lib/trd-cli.js`. If none
exist OR `which node` fails: print the same error used there ("ERROR:
Node.js and the TRD CLI (lib/trd-cli.js) are required for deterministic TRD
parsing. Ensure Node.js is installed and the ensemble-development plugin is
present.") and treat this as a `PARSE-FAILURE` gap (see below) — this gate
must never silently skip itself just because tooling is unavailable.

```bash
node "$TRD_CLI" parse "<TRD_FILE_PATH>"
```

Parse the JSON result as `{ok, trd: {tasksById, phases, prdReference,
warnings, ...}}`.

Independent cross-check (catches exactly the class of bug that motivated this
skill — a formatting deviation, such as a missing `**bold**` wrap around the
task id, that makes the deterministic parser silently return zero tasks while
reporting no hard error):

```bash
PARSED_COUNT=$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(0,"utf8")).trd.tasksById).length)' < parse_output.json)
INDEPENDENT_COUNT=$(grep -cE '^\s*- \[[ xX]\]\s+\*{0,2}TRD-[A-Za-z0-9-]+\*{0,2}' "<TRD_FILE_PATH>")
```

`INDEPENDENT_COUNT` is scoped to lines that look like a task marker (checkbox
followed by a `TRD-` id token, bold or not) rather than a bare `- [ ]` count,
so it does not false-positive on unrelated nested Acceptance-Criteria/sub-item
checklists that also use `- [ ]` markers but are not top-level tasks.

```
IF ok is false:
    GAP: class=PARSE-FAILURE, reason="node \"$TRD_CLI\" parse exited non-zero or returned malformed JSON"
    SKIP Steps 2-4, go to Step 5 with whatever partial data exists
    FORCE verdict=INCOMPLETE at Step 6

ELSE IF any warning in trd.warnings matches /no tasks found/i:
    GAP: class=PARSE-FAILURE, reason="parser warning: '<matching warning text>'"
    SKIP Steps 2-4, go to Step 5, FORCE verdict=INCOMPLETE

ELSE IF PARSED_COUNT == 0:
    GAP: class=PARSE-FAILURE, reason="tasksById is empty"
    SKIP Steps 2-4, go to Step 5, FORCE verdict=INCOMPLETE

ELSE IF PARSED_COUNT != INDEPENDENT_COUNT:
    GAP: class=PARSE-FAILURE, reason="deterministic parser found <PARSED_COUNT> task(s) but a raw grep of the TRD file found <INDEPENDENT_COUNT> task-shaped checkbox line(s) — the parser silently missed real tasks (check for a formatting deviation such as a missing **bold** wrap around a task id)"
    SKIP Steps 2-4, go to Step 5, FORCE verdict=INCOMPLETE

ELSE:
    Task inventory is trustworthy — proceed to Step 2.
```

A `PARSE-FAILURE` gap is unconditionally blocking: verification cannot
proceed reliably against a task inventory it cannot trust, so Steps 2-4 are
skipped entirely rather than producing false-confidence partial results.

---

### Step 2 — Task Closure Cross-Check

For every non-TEST task id in the inventory (`isTest == false`):

```
IF TRACKING_MODE == 'beads':
    bead_id = TRD_TO_BEAD_MAP[task.id]
    run: br show <bead_id> --json           # live query — never trust a cached status
    require: status == 'closed'

IF TRACKING_MODE == 'checkbox':
    require: the task's line in TRD_FILE_PATH reads "- [x] **<task.id>**" or
             "- [X] **<task.id>**" (re-read the file now; do not reuse any
             earlier in-memory checkbox state)
```

If the closure check fails: `GAP: class=TASK-OPEN, task=<task.id>`.

Test-pair check (runs for every task in the inventory, whether or not it
closed cleanly): if `tasksById["<task.id>-TEST"]` exists, that paired TEST
task must ALSO pass the same closure check (live bead status `closed` in
`beads` mode, `- [x]` in `checkbox` mode). A task closed without its test pair
closed is `GAP: class=TEST-GAP, task=<task.id>, testTask=<task.id>-TEST`.

---

### Step 3 — Requirement Coverage Cross-Check

Skipped if `trd.prdReference` is empty/null (no PRD to cross-check).

1. Resolve the PRD path as `trd-cli.js`'s internal `resolvePrd()` does: try
   `trd.prdReference` as-given from cwd, then relative to `TRD_FILE_PATH`'s
   directory. If neither resolves to a readable file, record one gap
   (`class=REQ-UNSATISFIED`, `reason="PRD reference '<trd.prdReference>' could
   not be resolved to a file"`) and skip the rest of this step.

2. Extract REQ-NNN ids and MoSCoW priorities with
   `packages/development/lib/prd-parser.js#extractReqPriorities` (read-only):

   ```bash
   node -e '
     const fs = require("fs");
     const { extractReqPriorities } = require(process.argv[1]);
     process.stdout.write(JSON.stringify(extractReqPriorities(fs.readFileSync(process.argv[2], "utf8"))));
   ' "<dir of $TRD_CLI>/prd-parser.js" "<resolved PRD path>"
   ```

   Returns `[{id: "REQ-011", priority: "Must"}, ...]`; a REQ with no readable
   priority is `null` (items 3-4).

3. For every REQ-NNN with `priority` in `{Must, Should}`: confirm at least one
   task in the inventory has `task.satisfies` containing that REQ-NNN
   (`trd.tasksById[*].satisfies`, already extracted by Step 1's parse — do not
   re-scan the TRD text for `[satisfies ...]` annotations) AND that task
   passed Step 2's closure check.

   ```
   IF no satisfying task exists, OR the satisfying task(s) all failed Step 2:
       GAP: class=REQ-UNSATISFIED, req=<REQ-NNN>, priority=<Must|Should>
   ```

4. Coverage sanity check. A PRD whose REQs all lack a priority was never checked.

   ```
   IF item 2 returned 0 REQs, OR every parsed REQ has priority === null:
       GAP: class=REQ-PRIORITY-UNPARSED,
            reason="<resolved PRD path>: <N> REQ(s), none with a MoSCoW priority"
   ```

   The gap forces `INCOMPLETE`: the Must/Should gate in item 3 had nothing to
   check. Partially unclassified is not a gap: classified REQs gate in item 3.

---

### Step 4 — Independent Full Test-Suite Execution

Run the full suite RIGHT NOW, from the repo root, regardless of what any
earlier phase-gate recorded:

```bash
npm run test --workspaces --if-present
```

This is deliberate, not redundant: a prior phase's recorded "tests passed"
does not prove the FULL suite still passes after later phases' changes — this
is the direct mechanism behind the reported bug (integration regressions
introduced by a later phase going unnoticed because no phase re-runs the
*whole* suite at the end).

```
IF exit code != 0:
    GAP: class=TEST-SUITE-FAILURE, note="<failing test file(s)/suite(s) if
         discoverable from output, else 'see full output above'>"
```

---

### Step 5 — Report Generation

Always runs — whether the verdict ends up COMPLETE or INCOMPLETE. This is a
durable audit trail, not just a failure notice.

1. Create `docs/reports/` if it does not exist.
2. Write `docs/reports/<TRD_SLUG>-completion-<YYYY-MM-DD>.md` (today's date,
   `YYYY-MM-DD`; if the file already exists from an earlier run today,
   overwrite it — one report per TRD per day).
3. Report structure:

```markdown
# Completion Verification Report: <TRD_SLUG>

- TRD file: <TRD_FILE_PATH>
- TRD slug: <TRD_SLUG>
- Date: <YYYY-MM-DD>
- Tracking mode: <beads|checkbox>

## Task Inventory

| ID | Description | Status | Evidence |
|----|--------------|--------|----------|
| TRD-001 | <description> | closed / open | br show TRD-001 bead → closed |
| TRD-001-TEST | <description> | closed / open | TRD file checkbox `- [x]` |
| ... | | | |

## Requirement Coverage

(omitted entirely if trd.prdReference is empty)

| REQ-NNN | Priority | Satisfying Task(s) | Status |
|---------|----------|---------------------|--------|
| REQ-011 | Must | TRD-007 | SATISFIED |
| REQ-012 | Should | (none) | UNSATISFIED |
| REQ-013 | Could | — | informational only |

## Gap Summary

Total gaps: <N>

### PARSE-FAILURE (<count>)
- <reason>

### REQ-PRIORITY-UNPARSED (<count>)
- <reason> (no REQ priority classifiable)

### TASK-OPEN (<count>)
- TRD-NNN: still open

### TEST-GAP (<count>)
- TRD-NNN closed without TRD-NNN-TEST closed

### REQ-UNSATISFIED (<count>)
- REQ-NNN (Must): no closed satisfying task

### TEST-SUITE-FAILURE (<count>)
- <failing suite/file summary>

## Test Suite Result

<PASS|FAIL> — `npm run test --workspaces --if-present` — <brief output summary>

---

**VERDICT: COMPLETE (0 gaps)**
```

or, when gaps exist:

```markdown
**VERDICT: INCOMPLETE (<N> gaps found)**
```

The verdict line is always the final line of the report and is printed
verbatim (not paraphrased) by the calling command.

---

### Step 6 — Gate Behavior / Return Contract

The skill returns `{verdict, gapCount, reportPath}` to the calling command.

```
IF verdict == 'INCOMPLETE':
    The calling command MUST NOT:
      - declare the TRD/implementation complete in any user-facing message
      - close the root epic (beads mode)
      - write PR/completion messaging that claims full completion
    The calling command MUST:
      - print "COMPLETION VERIFICATION FAILED: <gapCount> gap(s) found. Report: <reportPath>"
      - require an EXPLICIT user override before proceeding anyway (e.g. an
        AskUserQuestion confirmation, or an explicit non-interactive
        --force-complete-style flag if the calling command defines one)
      - if the user does not override: HALT / pause, do not proceed with
        completion

IF verdict == 'COMPLETE':
    The calling command proceeds with its existing completion flow unchanged,
    and MUST mention <reportPath> in its final printed output so the audit
    trail is discoverable.
```

**RETURN** (implicit on `COMPLETE`, or on `INCOMPLETE` with explicit user
override): resume execution at the next step in the calling command's
completion flow.
**HALT** (on `INCOMPLETE` without an override): the calling command stops
before any completion side effect (epic closure, checkbox sync framed as
"done", completion PR).

---

## Known Limitations

**The Step 1 independent grep count is heuristic, not exact.** It matches any
checkbox line that looks like `- [ ] TRD-...` (bold or not), which means a
task line embedded in unusual prose (e.g. quoted inside a code fence as an
example) could inflate `INDEPENDENT_COUNT` and trigger a false-positive
`PARSE-FAILURE`. This is an accepted tradeoff: false positives here cost a
report + a confirmation prompt, whereas the false negative this skill exists
to prevent (silently trusting a zero-task parse) is the actual reported bug.

**`extractReqPriorities()` reads two MoSCoW conventions, not every PRD style.**
Priority is a bracketed tag ending a `###`/`####`
`REQ-NNN:` heading (`(Must)`, `[Should]`, a trailing `[RISK: ...]` allowed) or a
`**Priority:**` line in that heading's scope; both case-insensitive and
canonicalized, so `(must)` yields `'Must'`. A REQ with neither is `null`. When
*every* REQ is null, or the PRD uses only the `# REQ-NNN — Title` style
`extractPrdContext` matches (0 REQs), item 3 is vacuous - item 4 files a gap.
Re-author such headings as `### REQ-NNN: Title (Must)`.

