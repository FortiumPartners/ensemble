# completion-verification eval

Scope: the `completion-verification` skill (package `development`) re-verifies a TRD's completion against its checkboxes, the linked PRD and the test suite, writes `docs/reports/<slug>-completion-<date>.md` and blocks a "done" claim while gaps remain.

Scenario: a seeded checkbox-mode TRD (`docs/TRD/slugify.md`) with TRD-001 and TRD-001-TEST closed, TRD-002 closed but TRD-002-TEST open, TRD-003 open; a PRD with REQ-001 and REQ-002 (Must) and REQ-003 (Should, satisfied only by TRD-003); a one-package npm workspace whose suite passes. The correct report has three gaps (TASK-OPEN TRD-003, TEST-GAP TRD-002, REQ-UNSATISFIED REQ-003) and an INCOMPLETE verdict. The prompt is plain (no command): the skill is normally called by `implement-trd-beads`.

What the checks cover (`evals/checks/completion-verification.js`): one dated report saved; INCOMPLETE verdict as the last line; gap count 3; each gap under its class; no gap for finished work; the task inventory statuses; the requirement coverage rows and the Should priority; suite result PASS; the seeded TRD, PRD and code byte-identical with no new file outside `docs/reports/`.

Known limits:
- Report content and shape only. A transcript is not checked, so it is not shown that the suite or the `trd-cli` parser was run, nor that statuses were derived independently rather than copied from the checkboxes.
- `inventory` and `coverage` need the prescribed tables with a Status column (and a Priority column for coverage); a report with the same facts in prose fails them.
- Not covered: beads mode, the PARSE-FAILURE cross-check, TEST-SUITE-FAILURE, REQ-PRIORITY-UNPARSED, the user-override path.
- A run that writes nothing passes only `source-untouched`.
- The baseline arm has no skill and measures the plugin's conventions (report path, class names, verdict line), so part of any uplift is format knowledge.
- Claude only: the skill resolves a plugin CLI (`trd-cli.js`).

A real trial must settle: whether the agent finds `trd-cli.js` (via `CLAUDE_PLUGIN_ROOT`) when the TRD sits in a bare fixture, and what it reports when it cannot (a PARSE-FAILURE report would fail `gap-count` and `gap-classes`, which may be the honest outcome); whether the model applies the Step 2 and 3 rules the same way each time (TEST-GAP versus TASK-OPEN for TRD-002-TEST); whether the baseline writes the report where the skill prescribes; and the repeat reliability.
