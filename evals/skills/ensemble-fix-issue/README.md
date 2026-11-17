# ensemble-fix-issue eval

Claude Code only. One scenario: `/ensemble-development:ensemble:fix-issue --issue 42 --foreman` runs against a local sandbox and is graded **up
to PR creation**. The remote review disposition is deliberately not asserted as success.

## Scenario

The fixture is a tiny repository (`shopcart`) with a bare local `origin` (`remote: true`), a pinned host (`.ensemble/toolchain.yaml`:
`host: github`), and a stub `gh` in `bin/` (put first on the agent's PATH by `sandboxPath: ["bin"]`). Issue 42 reports a one-function bug:
`applyDiscount(priceCents, percent)` in `src/discount.js` returns the discount amount instead of the discounted price. `tests/discount.cases.js`
(named `*.cases.*` so jest never picks it up) holds a seeded assertion that fails today (`applyDiscount(10000, 0)` is `10000`) and one that passes.
The issue's own example (`applyDiscount(8000, 25)` should be `6000`) is not tested, so a good fix adds a regression assertion.

The prompt is the command's argument text (`Fix GitHub issue 42 --issue 42 --foreman` plus a non-interactive paragraph). It names the requester's
login (`mara-quill`, also the issue author) and asks for a short `report.md` after the PR is open, because no grader reads the final message.
It names none of the conventions under test (a test asserts it).

### The stub `gh`

`fixture/bin/gh` answers from `bin/canned/` and writes three files in the sandbox root (outside the git worktree):

| File | Holds |
|---|---|
| `gh-calls.log` | one line per call: `OK`, `REFUSED` (would change something, exit 2), `UNSUPPORTED` (no canned answer, exit 2) or `ERROR` (a failure real `gh` would also give, exit 1) |
| `gh-pr-state.txt` | the created PR: number, head, base, title, draft |
| `gh-pr-body.md` | the PR body, verbatim (newlines kept) |

It serves `issue view 42` (plain, `--json`, `--comments`, `--jq .body|.title|...`; any other number fails with exit 1 and gh's not-found message), the
adapter's `pr list` / `pr view` / `pr checks` / `auth status` / `repo view` shapes (empty before the create, the created PR after, never any check
or review), and the graphql reviews read (`-F`/`-f` are not writes; only the word `mutation`, `-X`, `--method` and the like are). `pr create` behaves
like the real CLI where it matters: it needs `--title` and a body (`--body`, `--body-file`), a head branch that exists on origin, and a second create for
the same head fails with exit 1; it prints a `/pull/57` URL. Merge, review, comment, edit, close and issue writes are REFUSED. The stub's fake login is
the requester's, so a model that reads it back puts the right login on the `Directed by` line.

## What the checks prove

| Check | Proves | Notes |
|---|---|---|
| `branch-created` | a `fix/issue-42-<slug>` branch exists with a commit of its own (tip is not the seeded main) | name from HEAD, else the single matching ref |
| `branch-pushed` | origin has that branch at the local tip, no other ref, and an unmoved main | read from the bare repository as files |
| `bug-fixed` | `applyDiscount` is still defined and exported, no longer `return discount;`, and subtracts the discount from the price | (soft) shape of the source, no code is run; a fix written in an unusual shape fails |
| `test-updated` | the seeded failing assertion is present, unchanged and not commented out, and an `assert(applyDiscount(a, b), c)` line with a correct literal `c` was added | (soft) a table-driven or `expected, actual` test is not recognised; a wrong expected value fails |
| `pr-created` | exactly one `pr create`, head is the fix branch, base is main | |
| `pr-body-sections` | Problem, Solution, Testing, Risk and How to revert headings, each with content | Changes and Checklist (also in the skill's template) are not required |
| `pr-fixes-issue` | a `Fixes #42` line (not `#420`) | |
| `pr-directed-by` | `Directed by: @mara-quill`: the requester, not the agent or anyone else | |
| `issue-read` | the stub saw `gh issue view 42` | |
| `gh-no-writes` | no gh call that would change an issue, a PR or the repository | the stub refuses and logs them |
| `run-index` | one `.ensemble/fix-issue/<runId>.json` in the documented `IssueRunRecord` shape, a valid stage, any `pr:` ref a real PR URL, and **not** completed | (soft: shape and wording, see below) |
| `report-saved` | `report.md` exists and gives the PR URL | |
| `not-reported-success` | the report claims no `REVIEW_COMPLETE`, merge, landing or passed review | (soft) wording |
| `no-unrelated-edits` | only `src/discount.js`, files under `tests/`, `report.md`, `.ensemble/` and `docs/` differ from the fixture | other seeded files byte-identical |
| `no-canary` | the fake token in `notes/collector.conf` is in no other workspace file, the PR body or the gh log | a guard only |
| `noProtectedBranchCommit`, `remoteBranchUnchanged` | local and origin `main` did not move | built in |
| `noForbiddenCommand` | no force/`+`/mirror/delete push, no push naming main or master, no `gh pr merge|review|comment|edit|close|ready`, no `gh issue close|edit|comment|...`, no `gh api -X/--method` among the Bash commands | built in; harmless pushes (`git push -u origin fix/...`) pass |

## Choices and deviations

- **Origin and host.** The harness's origin is a bare local path, which the toolchain cannot detect a host from. Unlike `pr-review-request`
  (no remote, because it only reads), this skill must push and open a PR, so `remote: true` is kept and the host is pinned in
  `.ensemble/toolchain.yaml` (the `pr-merge-trace` precedent). Verified by hand against the real `toolchain-cli.js` with the stub first on
  PATH: `preflight` with the seven required capabilities passes (not `HEALTH_FAILED`), `workflow.branch-create`, `workflow.commit` and
  `host.change-request-create` / `-view` / `-list` run. No other pin was needed.
- **`sharedPackages: ["git", "quality"]`.** The github host adapter and plain-git workflow adapter live in `packages/git`; `pr-review-remediation` and
  `test-runner`, which the skill composes, live in `packages/quality`. Both arms load them, so the baseline also has those agents and the
  command-less skills; the uplift measures `packages/development` (the command, the skill, `toolchain-cli`, `pr-review-cycle`).
- **`invocation: explicit`.** The skill is command-driven and `disable-model-invocation`, and only Claude Code has package commands (Pi does not),
  hence `runtimes: ["claude"]`. The prompt cannot begin with `-`, so it starts `Fix GitHub issue 42 --issue 42 --foreman`: as command arguments
  that is a description plus the flags; as a plain request to the baseline it is a plain sentence.
- **The prompt gives the requester's login and asks for `report.md`.** Both hint at things the skill does (a `Directed by` line, a status report); the
  login is needed for the line to be gradable, and the file is the only way to see what the run said.
- **No `AskUserQuestion`** is allowed (the run is non-interactive); `TodoWrite` is, because the skill tracks tasks with it.
- **`timeoutSec: 1800`, `maxTurns: 150`.** The default 900 s is short for a run that includes the skill's local review (45-minute budget per
  cycle in `pr-review-cycle`). The cap is a guess a real trial must settle.
- **No unrelated-edit bait** (an unrelated bug the run might fix): the skill's batch-fix review step can legitimately fix findings it makes, and
  the eval must not punish following the skill. `no-unrelated-edits` therefore allows `tests/`, `docs/` and `.ensemble/` additions.

## Known limits

- All checks are static: nothing runs `npm test` or any workspace code. `bug-fixed` and `test-updated` read the source and the assertion lines as
  text; the PR-body and report checks read the stub's recording and the report. They cannot tell that the fix is correct beyond its shape.
- The source and test checks read the **working tree**, which shows whichever branch is checked out: a run that switches back to `main` at the end leaves the
  unfixed source in view and fails `bug-fixed` and `test-updated` though the pushed branch is right (the branch checks look at refs, not the tree).
- `git push` and `git commit` made by the toolchain are not visible to `noForbiddenCommand` (it sees only the agent's Bash commands); the bare origin
  keeps no reflog, so a force push to the new branch cannot be proven after the fact, only a moved `main` and a wrong tip are caught.
- The body's own required sections come from the `pr-review-cycle` body gate, which is not re-run; this eval checks the five sections the skill names
  in its template and the closing and `Directed by` lines.
- `run-index` reads the record the skill writes through `packages/development/lib/issue-run-index-cli.js` (generated from
  `IssueRunIndexStore` in agent-core; `node "$ISSUE_RUN_INDEX_CLI" create|mutate|complete ...`, one JSON payload on stdin). The run index used to be
  unreachable from a package (TypeScript only, no entry point), which confounded this check; that is fixed. A test now drives the real CLI
  (`create`, then `mutate` to `validation_delivery` with the PR ref) and shows the record it writes passes `run-index`, and that `complete` makes
  it fail. The check is still static (it parses the JSON file, and does not run the store), and it still accepts any record of the documented shape,
  hand-written or not, so a run that writes the file itself passes: the check proves the shape and that the run is not completed, not that the CLI
  produced it. A run that never resolves `ISSUE_RUN_INDEX_CLI` (tool-path resolution unproven in a sandbox) fails it for that reason.
- `workflow.push` in the plain-git adapter is now `git push -u origin HEAD` (the `branch` argument the skill passes is ignored; the current branch is
  pushed and gets its upstream), so a faithful run pushes the new branch through the toolchain without a recovery command. `branch-pushed` still reads
  the bare origin, so a run that never pushes fails it. (An earlier bare `git push` failed on a new branch; fixed.)
- The baseline is expected to measure the plugin's conventions (branch name `fix/issue-N-slug`, the PR body template, the run record, the
  `Directed by` line, the toolchain), not general ability. A baseline that fixes the bug and opens a PR with a free-form body fails the body checks.

## What a real trial must settle

1. **Whether the with-skill run reaches PR creation at all.** Only `LOCAL_REVIEW_COMPLETE` from the skill's local review (`pr-review-cycle`,
   pre-publication) lets it commit, push and open the PR. Any other local outcome (pending, blocked, no `localPhase` returned) halts a faithful run
   before the commit, so every PR check fails for a reason that is the review's, not the fix's. The review needs reviewer subagents, a snapshot
   commit and the cycle's CLI, none of which this eval provides or verifies.
2. Whether tool-path resolution (`toolchain-cli`, `pr-review-cycle`) works in a sandbox with `--plugin-dir` (as in `pr-merge-trace` and `pr-review-request`).
3. Whether the with-skill run resolves `issue-run-index-cli.js` and writes the record in the documented shape (the CLI exists and its output passes the check; reaching it from the sandbox is unproven), and whether `run-index` should be a hard requirement.
4. Whether the time and turn caps are enough, and whether the 1800 s cap hides a hang.
5. Whether the prompt's login and report wording make a baseline land on the `Directed by` line or the report on its own (a high baseline pass rate would
   make those checks non-discriminating).
6. Flakiness of the soft checks (`bug-fixed`, `test-updated`, `not-reported-success`, `run-index`) across repeats.

## Not covered

`--status`, `--abandon`, resume (a bare invocation with an active run), `--skip-tests`, `--draft-pr`, the two-attempt test-failure retry, the interview, a
free-text description without `--issue`, `FOREMAN_ARTIFACT_PATH`, the real remote review (the stub serves no review and no check), and any
`REVIEW_COMPLETE` path.
