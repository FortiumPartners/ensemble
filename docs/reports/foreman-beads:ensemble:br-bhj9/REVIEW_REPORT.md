# Repo-Rules Review — beads:ensemble:br-bhj9 ## Review engine Repository-rules reviewer: this
phase (Foreman `repo-rules-review`, phase 3 of `run-488ac083a99c847cd3cc780684deee95`). No
external review CLI was used. Diff range reviewed: `git diff dev...HEAD`
(`FOREMAN_BASE_BRANCH=dev`). At review start that range contained **45 insertions across two
report files only** — `docs/reports/foreman-beads:ensemble:br-bhj9/FIX_REPORT.md` and
`docs/reports/foreman-beads:ensemble:br-bhj9/REVIEW_CODERABBIT_REPORT.md` — i.e. **zero source
changes**. The bead's defect was therefore still live at HEAD. Rules applied: root `AGENTS.md`
(Generated Artifact Policy in particular), `CONTRIBUTING.md` (conventional commits,
Keep-a-Changelog format, PR size), and the established idiom in `packages/development/lib/` for
the four rule classes this phase brief names. **Carry-forward note:**
`REVIEW_CODERABBIT_REPORT.md` beside this artifact contains **no** `FOREMAN_REVIEW_FINDINGS_START`
/ `_END` markers, so there were no marked findings to copy. Its prose does carry one Critical
unresolved item (the bead's defect, unfixed at HEAD) and records that phase 1 shipped no code;
that item was verified against the code, confirmed still live, and fixed in this phase. 
## Findings

Each finding was triaged against the code as it currently stands before acting on it.

| # | Finding | Rule source | Triage |
|---|---------|-------------|--------|
| 1 | Bead's defect unfixed at HEAD: `lib/trd-cli.js` ended in `process.exit(code)`, truncating piped stdout at 65536 bytes. Carried forward in prose from the CodeRabbit report. | `AGENTS.md` / run scope; `CONTRIBUTING.md` "update docs if behavior changes" | **Fixed** |
| 2 | Implement-phase report missing: no `docs/reports/.../IMPLEMENT_REPORT.md` exists although the `fix` workflow defines an implement phase. | Foreman workflow contract | **Declined** |
| 3 | Generated mirror `packages/pi/vendor/lib/trd-cli.js` had to be regenerated after the source edit; the Generated Artifact Policy forbids leaving mirrors stale. | root `AGENTS.md` "Generated Artifact Policy" | **Fixed** (regenerated) |
| 4 | Behavior-affecting fix undocumented in the changelog the package maintains. | `CONTRIBUTING.md` changelog convention | **Fixed** |
| 5 | Same latent truncation in sibling CLIs (`prd-cli.js:387`, `beads-refine-cli.js:99`, `trd-graph-cli.js:152`, `pr-review-cli.js:641`). | `AGENTS.md` "every changed line must trace to the task" | **Declined** |
| 6 | `packages/development/lib/trd-cli.js` is not Prettier-formatted. | repo defines no Prettier script or format gate | **Declined** |



## Fixed

**`packages/development/lib/trd-cli.js:1656-1664`** - the CLI wrapper ended in
`const code = main(process.argv.slice(2)); process.exit(code);`. When stdout is a pipe, Node writes
it asynchronously, so bytes past the 64 KiB libuv pipe buffer were still in flight when the process
was killed: `node packages/development/lib/trd-cli.js parse <large TRD> | consumer` handed the
consumer invalid JSON cut at exactly position 65536, while the same command redirected to a file
produced the complete object. The wrapper now assigns `process.exitCode = main(...)` instead, so the
event loop drains stdout and the process exits naturally with an identical code. I chose that over
the `fs.writeSync(1, ...)` alternative named in the bead because it leaves `main()`'s exit-code
contract untouched, keeps all three subcommands writing stdout through one code path, and follows
precedent already in this repo: `scripts/tests/fixtures/toolchain/real-ledger-steps/fail.js` sets
`process.exitCode` for exactly this documented async-pipe race, as do
`packages/development/lib/estimate-actual.js:95` and `complexity-analyzer.js:644`. A comment at the
call site records why it is not `process.exit`.

**`packages/pi/vendor/lib/trd-cli.js`** - regenerated, never hand-edited, by `npm run generate` and
then `npm run generate:pi` from the repository root, per the Generated Artifact Policy in
`AGENTS.md`. That file is bundled from `packages/development/lib` by
`packages/pi/src/transformers/lib-bundler.ts`, and it is now byte-identical to the source.

**`packages/development/tests/fixtures/TRD-2026-999-stdout-flush.md`** (new, 60 KB) - a synthetic
16-task TRD, sized so that `parse` emits 124,742 bytes and `scaffold-plan` emits 82,924 bytes, both
above the 65,536-byte threshold. Sixteen tasks rather than nine because `scaffold-plan` only crosses
the buffer at fourteen. Its header comment says why the filler payload must not be pruned, and the
fixture-guard tests below make a silent shrinking impossible.

**`packages/development/tests/trd-cli-flush.test.js`** (new, 13 tests) - runs the real binary as a
subprocess with stdout on a pipe. Two fixture-guard tests assert the payload still exceeds the buffer
when redirected, so the regression checks can never pass vacuously. The regression tests assert the
byte count, that the piped bytes parse as JSON, that pipe and redirect agree byte-for-byte, that no
task is silently dropped, and explicitly that the size is not 65536 - the bug's signature. Four more
pin the exit-code contract at 0, 1, 1, 1 for the happy path, an unreadable path, an unknown
subcommand and a missing subcommand. One asserts Generated Artifact Policy parity between this source
and the `packages/pi` vendored copy. Verified by hand as well: the pre-fix binary goes red at exactly
65536 bytes and green at 124,742 with the fix.

**`packages/development/CHANGELOG.md`** - one bullet under `## [Unreleased]` / `### Fixed`, in the
Keep-a-Changelog style the file already uses. This is the only user-facing documentation the fix
needs: `packages/development/README.md` describes `parse` through its consumer contract, which is
unchanged for any caller whose output stays under 64 KiB.

## Declined

**Missing `docs/reports/foreman-beads:ensemble:br-bhj9/IMPLEMENT_REPORT.md`.** A real gap, but it is
a Foreman pipeline artifact owned by the implement phase, not repository source. Authoring one from a
review phase would misdescribe what that phase actually did, so it is recorded for operator visibility
in the findings block below rather than papered over here.

**The same latent truncation in `prd-cli.js`, `beads-refine-cli.js`, `trd-graph-cli.js` and
`pr-review-cli.js`.** All four end in the same exit shape and would truncate the same way, but the
bead names `trd-cli` only, none of them is in this run's diff, and `AGENTS.md` requires every changed
line to trace to the task. Deliberately untouched; a follow-up bead is the right home. `prd-cli`'s
`parse` output is around 20 KB for the TRDs in tree, so it is fragile rather than broken today.

**Prettier formatting of `packages/development/lib/trd-cli.js`.** `npx prettier --check` flags the
file, but it flags the pre-fix copy from `dev` just as badly: the repo defines no Prettier script, no
format gate and no ignore file, and `npm run validate` does not check JS formatting, so nothing here
treats these files as expected-to-be-formatted. Reformatting a 64 KB file - and by extension its
vendored mirror - inside a one-line bug fix would violate the surgical-change rule for no behavioural
benefit.

## Verification

All commands run from the repository root of this run's worktree; exit codes as shown.

| Command | Exit | Result |
|---------|------|--------|
| `git diff dev...HEAD` (at review start) | 0 | 45 insertions, 2 report files, 0 source changes |
| `node packages/development/lib/trd-cli.js parse <fixture>` piped to a counting sink, before fix | - | `65536 INVALID` (defect reproduced) |
| same command, after fix | - | `124742 valid` |
| `scaffold-plan` piped, after fix | - | `82924 valid` |
| `packages/pi/vendor/lib/trd-cli.js` piped, after fix | - | `124742 valid` |
| `npm run generate` | 0 | 65 files generated |
| `npm run generate:pi` | 0 | Pi bundle regenerated; no Pi version bump (the script decided none was needed) |
| `npm run generate:validate` | 0 | Validation passed (65 files), no drift |
| `npm run validate` | 0 | all checks pass; one pre-existing unrelated prompt-baseline warning |
| `npx jest tests/trd-cli-flush.test.js` (fixed code) | 0 | 13 passed |
| `npx jest tests/trd-cli-flush.test.js` (pre-fix code restored) | 1 | 6 failed, 7 passed - the red-first proof |
| `npx jest tests/trd-cli.test.js tests/trd-cli-flush.test.js` | 0 | 54 passed |
| `npx jest tests/trd-cli.test.js tests/trd-cli-flush.test.js tests/trd-cli-adapter-swap.test.js` | 0 | 62 passed, 3 suites |
| `npx jest` (packages/development, full) | 1 | 6213 passed, 1 failed: `tests/local-ci-adversarial.test.js` |
| `npx jest tests/local-ci-adversarial.test.js` (this change reverted) | 1 | 70 passed, 1 failed - same test, so pre-existing |
| `npx eslint packages/development/lib/trd-cli.js packages/development/tests/trd-cli-flush.test.js` | 0 | 0 errors; `lib/trd-cli.js` is matched by a repo eslint ignore pattern (warning only) |
| `npx prettier --check` on both edited files | 1 | both flagged - pre-existing, see Declined |
| `node ... parse <fixture>` piped to `tail -c 120` | 0 | complete object with a valid JSON tail |
| `node ... parse <fixture>` piped to `head -c 60` (consumer closes early) | 0 | CLI status 0 before and after the fix - unchanged |
| `diff packages/development/lib/trd-cli.js packages/pi/vendor/lib/trd-cli.js` | 0 | identical |

The one full-suite failure is **pre-existing and unrelated to this change**:
`tests/local-ci-adversarial.test.js`, the test named "GH_TOKEN/GITHUB_TOKEN in a maintainer
environment never reach a step that prints its env, nor the result". It fails identically with
`trd-cli.js` reverted to `dev`. It fails here because this worktree sits under nested
`.foreman/worktrees/...` directories that appear in the child's inherited `PATH`, so the assertion at
line 286 that the printed environment mentions `PATH` trips on a `PATH` value that contains no token.
The assertion is checkout-path dependent. Not caused by, and not fixed by, this phase.

Re-read of `git diff dev...HEAD` after the fixes confirmed that the fixes introduce no new violation:
`git diff dev` on the source shows exactly the six comment lines plus the one changed line, the
piped and redirected outputs are byte-identical, the source and its generated mirror are
byte-identical, no generated file was hand-edited, and no rule in `AGENTS.md` or `CONTRIBUTING.md` is
newly broken.

Fixes are **left uncommitted** for Foreman to commit this phase's work. The working tree at phase
end: modified `packages/development/lib/trd-cli.js`, `packages/pi/vendor/lib/trd-cli.js`
(regenerated, not hand-edited) and `packages/development/CHANGELOG.md`; new
`packages/development/tests/trd-cli-flush.test.js`,
`packages/development/tests/fixtures/TRD-2026-999-stdout-flush.md` and this report. Scratch files
were deleted and nothing outside this worktree was touched.


<!-- FOREMAN_REVIEW_FINDINGS_START -->
- `docs/reports/foreman-beads:ensemble:br-bhj9/IMPLEMENT_REPORT.md:1` Major - the run's implement phase produced no artifact at all (phase 1 shipped zero code and wrote only FIX_REPORT.md), so the pipeline's phase-record contract is unmet and needs operator follow-up rather than a code change.
- `packages/development/tests/local-ci-adversarial.test.js:286` Minor - pre-existing environment-sensitive failure: the secret-redaction assertion trips when the repository is checked out under nested `.foreman/worktrees/...` paths, because the inherited `PATH` legitimately appears in the printed-environment payload; it fails identically with this run's change reverted.
- `packages/development/lib/prd-cli.js:387` Minor - the same latent 65536-byte pipe truncation is present in `prd-cli.js`, `beads-refine-cli.js`, `trd-graph-cli.js` and `pr-review-cli.js`, which all still end in the `process.exit` shape this run removed from `trd-cli.js`; out of this bead's scope and worth its own issue.
<!-- FOREMAN_REVIEW_FINDINGS_END -->
