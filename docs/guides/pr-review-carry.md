# PR review: carrying settled verdicts across heads

After a fix push the next review round used to verify every finding again, even
those the push could not have touched. `carry` decides, per candidate finding,
whether the verification verdict an earlier head settled still stands. Anything
it is not sure of is verified again: every rule fails toward re-verification,
because a wrong "carry" silently reuses a stale verdict.

```bash
node packages/development/lib/pr-review-cli.js carry < payload.json
```

`carry` is one subcommand with three `action`s: `plan`, `record` and
`reconcile`. It never hashes anything and never runs `git`. The one file `plan`
reads is the PR's own state report (the same read as `state-read`, at
`lastReviewedSha`), which is where the prior verdicts and the prior ledger come
from. The hashing is a separate step, `lib/pr-review-carry-hash-cli.js`, which
reads git objects at the head under review.

## Flow

1. `review-range` answers `delta` and the prepare facts' `deltaPlan.mode` is `delta`. Otherwise nothing carries: verify everything.
2. Build the candidates: the open findings of the prior ledger, re-presented with their own `id`, `claim` = the ledger finding's `failureMode` verbatim, and `file` and `line`/`lines` from its `locationOrLink`; plus the new candidates of this round.
3. Hash them at the new head: `node "$PR_REVIEW_CARRY_HASH_CLI"` with `{ repoRoot?, headSha, citations }`. Each answered candidate carries `headSha` (the head it was hashed at), `hunkHash`, `depHashes` and `dependents` (or `hashError`). Pass the candidates on exactly as answered, and hash again after any push.
4. Run `carry` with `action: "plan"`, giving it the `deltaPlan`, `deltaPaths` and `deltaRange` of the prepare facts for THIS head (`deltaRange` = `{ headSha: facts.headSha, lastReviewedSha: facts.delta.lastReviewedSha }`). Copy all three from that one set of facts: `plan` never reads the repository, so a `deltaRange` written from the round's own `headSha` and `lastReviewedSha` over the facts of an earlier push would carry stale verdicts, and nothing would say so (see the honest limits).
5. Use the answer's `ledger` as the round's existing ledger. It is the prior ledger with the carried findings stamped; never stamp by hand. A `null` ledger means `plan` has no ledger to give: the prior state was not read, the report holds no ledger list, or the plan was refused (`ok:false`, a ledger finding is already stamped with the current head). Nothing carries: verify every candidate, and never put an empty ledger in its place.
6. Verify only the `reverify` candidates and the new ones, with the unchanged verification contract.
7. Run `carry` with `action: "record"` for the findings of the `votes` result.
8. Write the state report's `verdicts` = the `carried` records of step 4 plus the `verdicts` of step 7.
9. Run `carry` with `action: "reconcile"` with every observation of the round (the `votes` result's findings, every outcome).

An unreadable or `ok:false` answer, `prior-state-unavailable`, a failed hash or
any doubt means: verify everything.

## Input

A request parameter that is missing or of the wrong type is an error (exit 1),
never read as empty. Every other fact is graded in band: a missing or invalid
one means re-verification (`plan`) or a refusal (`record`), exit 0.

`plan`:

| Key | Required | Meaning |
|---|---|---|
| `prId` | request parameter | The PR; also names the state report to read. |
| `candidates` | request parameter | Every candidate this round has, hashed at `headSha`. A prior verdict is only ever carried onto one of these. Each carries the head the hash step hashed it at; one stamped with another head, or none, is verified again (`candidate-head-mismatch`). |
| `cwd` | optional | Where the state report is looked up (default: the current directory). |
| `headSha`, `lastReviewedSha` | in band | Full object ids: the head under review and the head the previous round reviewed (the delta's start). |
| `baseSha` | in band | The base the round reviews against (full object id). |
| `depth`, `expectedVerifiers` | in band | The round's verifier depth word and, optionally, its verifier count override (the `votes` inputs). |
| `deltaPlan` | in band | The `deltaPlan` of `facts.json`; only `mode: 'delta'` carries, and its `readSet` must be readable. |
| `deltaPaths` | in band | The `facts.delta.changedPaths` of the same facts. The code checks only that they equal the read set's `changed` entries. The content of `deltaPlan` and `deltaPaths` is a caller assertion, trusted to be what `prepare` computed for the range `deltaRange` names: `plan` never reads the repository, so it cannot check that they are the paths changed between the two heads. |
| `deltaRange` | in band, required | `{ headSha, lastReviewedSha }`: the range `deltaPlan` and `deltaPaths` were computed for, copied from those same facts (`facts.headSha`, `facts.delta.lastReviewedSha`). It must be this round's `headSha` and `lastReviewedSha` (full object ids, compared without regard to case); a missing, malformed or different one carries nothing (`delta-range-mismatch`). It is the caller's assertion and is compared with nothing but this round's two heads: the facts of an earlier push are refused because their own range is the earlier one, not because anything checks their content. |
| `highPaths` | in band | The High or sensitive paths from `paths`, changed or not. |

A payload carrying `priorVerdicts` or `priorLedger` is refused (exit 1): they
are read from the state report, never from stdin.

`record`:

| Key | Required | Meaning |
|---|---|---|
| `findings` | request parameter | The `findings` of the `votes` result (ledger entries with `outcome` and `votes`). |
| `candidates` | request parameter | The hash step's candidates for this head, matched to the findings by `id`. One hashed at another head is skipped (`candidate-head-mismatch`). |
| `prId`, `baseSha`, `headSha`, `depth`, `expectedVerifiers` | in band | As for `plan`; an unreadable one is answered `ok:false` with the reason. |

`reconcile` (all four keys are request parameters):

| Key | Meaning |
|---|---|
| `ledger` | The round's ledger (the `ledger` of the `plan` answer, with this round's findings merged in). |
| `changedLocations` | The locations the push changed. |
| `headSha` | The head under review. |
| `observations` | EVERY observation of the round, passed to `clearFixedFindings` as `reReported`. |

## Record shapes

Verdict record (the state report's `verdicts`; `record` is the one producer):
`{ id, file, claim, lines, hunkHash, depHashes, head, carriedFrom?, outcome, votes[{ verifier, verdict }], prId, baseSha, depth, expectedVerifiers }`.
`prId`, `baseSha`, `depth` and `expectedVerifiers` bind the verdict to the PR,
the base and the verifier depth and count it was settled under; `lines` is the
cited `[start, end]`; `hunkHash` is the sha256 of the cited lines widened by
three lines of context; `depHashes` is `{ path: sha256 }` of the transitive
relative imports of the cited file (`{}` is "no dependencies"; absent or
unreadable is "missing").

Candidate: `{ id?, file, claim, line|lines, hunkHash, depHashes, dependents, headSha }`;
exactly one of `line` and `lines`. `dependents` is the sorted list of files that
use the cited file at the head. `headSha` is the head the candidate was hashed
at: the hash step stamps it on every candidate it answers, `hashError` ones
included.

Answers:

- `plan`: `{ ok, carried[], reverify[], unmatched[], reasons[], ledger, priorState }` (`ledger` is an array or `null`).
  - `carried`: the prior verdict and votes, `head` = the current head, `carriedFrom` = the head it was first settled on (kept through any number of carries).
  - `reverify`: `{ id?, file, claim, reasons[] }`, every reason that applies.
  - `unmatched`: a prior verdict no current candidate re-presents (`no-current-candidate`); never carried.
  - `reasons`: the whole-round reasons that apply to every candidate. `ok:false` for an unreadable request, and when the stamp is refused: a ledger finding already stamped with the current head (what a same-head or full-range plan produces). Then `carried`, `reverify` and `unmatched` are empty, `reasons` is the refusal (`ledger finding F1 is already stamped with the current head`) and `ledger` is `null`: verify every candidate.
  - `ledger`: the prior ledger with exactly the carried findings stamped (`headSha` = the carried record's head, `carriedFrom`), so `mergeFindings` does not re-open them and `clearFixedFindings` does not clear them. It is an array only when the state report was read (`priorState` `read`) AND holds a ledger array, so an empty array means "the report holds an empty ledger", never "nothing was read". It is `null` in every other case: `priorState` is not `read` (absent, discarded, corrupt, unreadable); the report was read but has no ledger list (a missing, `null` or non-list `ledger` is not an empty one: `ledger-unreadable`); or the stamp was refused (`ok:false`, see `reasons`; the report was read). The answer is the round's existing ledger and an empty one reads as no open findings, so a `null` means `plan` has no ledger to give: nothing carries, every candidate is verified, and an empty ledger is NEVER substituted for it. Use only a ledger you read yourself with `state-read`; with none, the prior round's open findings are unknown to this round (neither carried nor verified again): say so in the report and list them as unverified.
  - `priorState`: `read`, or why nothing was read: `absent`, `discarded`, `corrupt`, `unreadable`. Anything but `read` adds `prior-state-unavailable` to every reason list: nothing carries, and `ledger` is `null`.
- `record`: `{ ok, verdicts[], skipped[{ id, reason }] }` (or `{ ok:false, verdicts:[], skipped:[], reason }`). A finding that is not settled, has no id, no candidate (or an ambiguous one), no usable hash, cites another file or claim than its ledger entry says, or whose votes do not give its outcome under the round's verifier count is `skipped` and recorded nowhere: the next round verifies it again.
- `reconcile`: `{ ok, ledger[], cleared[] }`. A finding no reviewer reported again whose cited location the push changed is cleared; one that was observed again, whatever its verdict, is not.

A candidate's identity is its file and its claim: the claim as written, with
runs of whitespace collapsed and nothing else erased, case included. `x < y`
and `x > y`, `if (!ok)` and `if (ok)`, or `Foo is unchecked` and `foo is
unchecked`, are different claims.

## Rules

Any one of these forces re-verification; all that apply are listed. The
whole-round gates hold for every candidate: when one holds, nothing carries.

| Reason | When |
|---|---|
| `range-not-delta` | Whole-round gate. The delta plan is not a readable `delta`: a full range carries nothing. |
| `head-unknown` | Whole-round gate: the head or the last reviewed head is not a full object id. Per candidate: the verdict's own head (or its `carriedFrom`) is not a full object id. |
| `delta-range-mismatch` | Whole-round gate. `deltaRange` (the head and last reviewed head the delta facts were computed for) is missing, malformed, or is not this round's `headSha` and `lastReviewedSha`: the delta is of another range, and says nothing of what this push changed (a caller it added, an edit to the cited file outside the cited window). |
| `delta-paths-unreadable` | Whole-round gate. The delta's changed paths are not a list of paths. |
| `high-paths-unreadable` | Whole-round gate. The High/sensitive paths are not a list of paths. |
| `high-path-touched` | Whole-round gate. The delta touched a High or sensitive path. |
| `read-set-unreadable` | Whole-round gate. The delta plan carries no readable `readSet`, so its blast radius is unknown. |
| `delta-inconsistent` | Whole-round gate. The changed paths differ from the read set's `changed` entries: the two came from different deltas. |
| `pr-unknown` | Whole-round gate. No PR to bind verdicts to. |
| `base-unknown` | Whole-round gate. The base is not a full object id. |
| `depth-unreadable` | Whole-round gate. The depth is unreadable or expects no verifier (Quick settles nothing). |
| `ledger-unreadable` | Whole-round gate. The prior ledger is not a list of findings. |
| `prior-state-unavailable` | Whole-round gate (added by the CLI). The PR's state report at `lastReviewedSha` is missing, discarded, corrupt or unreadable. |
| `new-candidate` | No prior verdict for it. |
| `candidate-unreadable` | No file, or a claim with no words, or a duplicate of another candidate's key. |
| `candidate-head-mismatch` | The candidate's `headSha` (the head the hash step hashed it at) is missing or is not this round's `headSha`: its hashes and its `dependents` describe another tree (a caller added since is not among them). `record` skips such a candidate with the same reason. |
| `ambiguous-prior-verdict` | Two prior verdicts for one key. |
| `id-mismatch` | The candidate's id is not the id of the verdict it would inherit. |
| `head-not-last-reviewed` | The verdict was last confirmed on a head other than the delta's start, so the delta does not cover everything that changed since (a carried verdict is re-stamped with each head it passes). |
| `verdict-not-settled` | The prior outcome is not `present` or `filtered` (`disputed` and `unverified` are not settled), or its votes are not distinct verifiers' `real` / `not-real` / `abstain`, or an assigned verifier was incomplete: a verdict nobody recorded is not carried. |
| `verdict-other-pr` | The verdict was recorded for another PR (or for none). |
| `verdict-other-base` | The verdict was recorded against another base (or none). |
| `verdict-other-depth` | The verdict was settled at another depth or verifier count than this round runs. |
| `verdict-retally-differs` | Its votes, counted again under this round's verifier count, do not give its outcome (exactly K distinct voters; `present` needs a strict majority of K `real`, `filtered` must not have one). |
| `verdict-not-in-ledger` | The prior ledger holds no finding with the verdict's id, file and claim. |
| `hash-missing` | The prior or the current hunk hash, its location, or either dependency hash map is missing. |
| `dependents-missing` | The candidate's dependents are not a list of paths. |
| `cited-file-in-delta` | The cited file is among the delta's changed paths (whatever the hashes say). |
| `blast-radius` | The cited file is in the delta plan's read set for a reason other than `changed` (`caller-of:`, `test-of:` or `names:`). |
| `dependent-changed` | A file that uses the cited file (one of its `dependents`) is among the changed paths. |
| `hunk-changed` | The cited hunk's hash differs. |
| `hunk-moved` | The cited lines differ from the verdict's (identical text elsewhere in the file is not it). |
| `dependency-changed` | A dependency file is among the changed paths, or the dependency set or a hash differs. |
| `no-current-candidate` | Not a `reverify` reason: the `unmatched` entry of a prior verdict that no candidate re-presents. |

## Honest limits

- `carry plan` never hashes: `hunkHash`, `depHashes` and `dependents` are inputs, and it trusts them; it cannot tell a wrong hash from a right one. They must be taken at `headSha`: the hash step stamps each candidate with the head it read, and `plan` and `record` refuse a candidate stamped with another head, so a candidate list from before the push cannot carry. The stamp is only as honest as the step that wrote it: nothing proves the hashing was done at the head it names, or that the output was passed on unaltered.
- The delta and its range are caller assertions. `plan` never reads the repository: it takes `deltaPlan`, `deltaPaths` and `deltaRange` as written and checks only that `deltaRange` is this round's `headSha` and `lastReviewedSha` and that the changed paths equal the read set's `changed` entries. That refuses the facts of an earlier push when the orchestrator copies their own range (`delta-range-mismatch`), but it cannot tell facts computed for this range from facts of an earlier push passed with a range written to match this round: such a pair carries stale verdicts across a caller the push added (`dependent-changed` never fires) or an edit to the cited file outside the cited window (`cited-file-in-delta` never fires), both reproduced in review. The contract is the orchestrator's: copy the three from the prepare facts of THIS head, and never write `deltaRange` from the round's own variables. A verified bind is possible and not done: `plan` would recompute `git diff-tree -r --name-only --no-renames -z lastReviewedSha headSha` and refuse the round unless `deltaPaths` is exactly that set. It would make `carry plan` shell out to git and take a repository root, so it is left for the owner. The same trust covers `highPaths` (the classification the caller took from `paths`) and the read set's entries other than `changed`.
- Verdict provenance is procedural. `carry record` is the only producer of verdict records, but it accepts whatever votes it is given, and `state-write` accepts any report, so nothing proves real verifiers cast the votes: a hand-typed vote set settles a verdict that then carries.
- The hunk hash covers only the cited window (the cited lines plus three lines of context). An edit to the cited file outside that window leaves the hash unchanged, so the `cited-file-in-delta` check is the only protection against it; acceptance criterion AC2 is met by that check, not by the hash.
- Direct dependents only: the files that use the cited file (importers, name-matched tests, computed-specifier files naming it) are listed and a changed one re-verifies; callers of callers are not covered. Anything the cited file reads at run time that no relative specifier names is not covered either.
- A relative specifier that resolves to no tracked file (a directory, a glob, a dangling path) is recorded as absent: it invalidates a verdict only when a file at exactly that path appears. A cited file that reads a directory's contents therefore keeps its verdict when a file under that directory changes (it is not a dependent of the files under the directory).
- Bare npm packages (`require('lodash')`) are not hashed: an upgraded third-party dependency invalidates nothing.
- The dependency closure is capped at 200 files; a larger one is not hashed (the citation gets `hashError`, hence `hash-missing`) rather than truncated.
- Symlinks are refused by the hash step, whether cited or in the dependency closure (the citation gets `hashError`). So is a specifier whose path passes through a symlinked directory or a submodule: any ancestor directory of the specifier's normalized path (resolved or absent) that git stores as a symlink (mode 120000) or as a submodule gitlink (mode 160000), for the cited file's specifiers and for those of every closure member (`require('./vendor.js/pkg')` with `lib/vendor.js` a link to a directory, `require('./gl.js/x')` with `lib/gl.js` a submodule), and a cited path that itself goes through one (the error says so, not that the file does not exist). Git lists such a link or submodule as one entry holding its link text or its commit id and nothing under it, so the import resolves to nothing and no hash would see its target move (a retargeted link, a moved submodule pointer).
- Redaction: the hash CLI's output and the state writer replace the value of any key matching `/token|secret|password|api[-_]?key|authorization/i`. A `depHashes` entry keyed like `lib/token-cache.js` comes back `[REDACTED]`, which reads as a missing hash and disables carry for that closure (it fails closed).
- A claim's identity is its exact words, symbols and capitalisation (only runs of whitespace are collapsed), so a re-worded, re-punctuated or re-capitalised claim is a new candidate and is verified again. That is the fail-closed side: it costs a verifier run, never a dropped finding.
- `runId` is not bound: the state report records no run id (`prepare` takes one to name its snapshot directory and `timing` reads one trace, but nothing writes one into the report or the ledger), so a verdict has nothing to be compared with. Recording a run id in the state report would change that contract, which is left for the owner. A verdict is bound to the PR, the base, the verifier depth and count, and a finding of the prior ledger (id, file, claim), not to a run.
- The state report is an untracked file. The binding stops a verdict from the wrong PR, base, depth or ledger; it does not stop someone who can write the repository's `.ensemble/` directory from forging a report.
- Only `present` and `filtered` verdicts carry. A `full` range carries nothing.
- In this repository `packages/development/lib/**` is a High path (`highPaths` in `REVIEW.md`), and nothing carries whenever a changed path is High. A fix push that touches lib code therefore carries nothing; the saving applies to docs-, tests- and skill-only pushes.
- The plan's "about 5x on re-review" (`docs/plans/pr-review-speedup-plan.md`, section 3B) is the target, not a measurement. No live re-review has been run: acceptance criterion AC5 of kata `qw98` is open and belongs to kata `q3a9`.
