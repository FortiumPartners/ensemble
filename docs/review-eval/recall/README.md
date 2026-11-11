# Recall guard: did the review lose a known Important finding?

Plan section 5: *a faster run that loses a real Important finding is a regression, not a win.* This directory holds a **reference
set** per reviewed head and the procedure that scores a run against it, so two measurements are comparable (kata `yg7k`).

```sh
node packages/development/lib/review-recall-guard.js \
  --reference docs/review-eval/recall/pr207-48c862c.json \
  --findings  <the run's collect output, or its .ensemble/pr-review/pr-<n>.json state>   # an array, or an object with `ledger` / `findings`
  [--max-false-negative 0]   # default 0: any lost Important finding fails (exit 1). Exit 2 = unreadable input or a bad flag, never a pass
```

Output is one JSON line: per item `found` (an Important finding matches), `downgraded` (the defect was raised, but only as a Nit /
Pre-existing, which the review defers, so for the guard it is lost), `not-raised`; plus `falseNegativeRate` =
(downgraded + not-raised) / items and `notRaisedRate`. The two rates say different things: `notRaisedRate` is a reading failure (the
reviewers never saw or never reported it), the downgraded part is a grading failure.

A reference item gives `terms` (lists of words; a finding matches when its `failureMode`, and `evidence` if the ledger has it, holds
every word of one list) and/or `anchors` (`path`, `startLine`, `endLine`; a finding matches within `--slack` lines, default 3). Pick
words only the defect uses: a finding that merely mentions them is counted. The match is by wording and place, not by understanding, so
read `matchedBy` in the output before trusting a `found`. The fixture check in
`packages/development/tests/review-recall-guard.test.js` pins the measured run's score.

`review-eval-guard.js` is the other guard: it grades CODEOWNERS-confirmed cases from the base commit by location alone. Use this one
to compare two runs on the same head, and that one to gate a change.

## The measurement this reproduces (first Medium run, PR 207, head 48c862c, effort hi, 7 reviewers + lane, 17 verifiers)

`pr207-48c862c.json` lists the six Important findings an earlier multi-reviewer pass confirmed on this head. Scored against the run's
ledger as committed in `packages/development/tests/fixtures/review-recall/pr207-medium-run-ledger.json` (the collect output's ledger,
evidence included): **1 found (E1), 1 downgraded (E4: three reviewers raised it as a
Nit), 4 not raised (E2, E3, E5, E6): false-negative 5/6, not raised 4/6.**

## Why each was lost (from the run files)

Sources: the run's `collect` outputs and result files under `~/.omp/pr-review-speedup/q3a9/run1/b-hi-effort/` and the run directory of the
measurement worktree. They are **not in this repository**; the committed evidence is the ledger fixture above and the reference file. The two
run artifacts also disagree on wall time (`run.json` `wallMs` 1650580, `timing.json` 1609481); nothing here depends on wall time.

| Item | Where it was reviewed | What the data shows | Cause |
|---|---|---|---|
| E1 | three reviewers, three files | raised 3 times (f1, f13, f18), all voted real 3/3 | found; the three copies cost nine verifier passes |
| E4 | the `lib` slice read by two reviewers, the whole-range reader, a docs slice | raised in five places (f9, f10, f11, f17, f20), always graded `nit`; none of the findings says a call throws: they describe a generated file that does not compile or a step that omits an input | **grading**: the reviewer contract named `important` and `nit` and defined neither (the adjudication later deferred them as nits in an opt-in path, which is the orchestrator's wording, not a reviewer's) |
| E2, E3, E5 | `lib/spec-writer.js` / `lib/e2e-framework.js`, read by a correctness reviewer, a tests reviewer and the whole-range reader | never raised. Each needs the code run; the brief allowed **one** snippet and the correctness reviewer's evidence shows it ran snippets on nits (f1, f2) | **budget** (brief): one snippet and 40 tool calls. [INFERENCE] the plan's figure for an earlier full-mode run (reviewers 73 to 144 tool calls, section 1) is a different PR and not this review's count |
| E6 | `agents/playwright-tester.yaml`, docs slice, read under `correctness` + `security` | never raised; a cross-file contract | **reviewer effort / lens depth**: no code path shows it was filtered |

What the data does **not** show: verifiers rejecting a real finding (14 of 17 candidates got three real votes, three (f5, f12, f19) two real
votes because one verifier expired, none a not-real), a triage or dedupe step dropping one, or a runner screen dropping one (nothing was
unbriefable). So the loss is at reading and at the reviewer's own grading.

## What changed, and what it cannot fix

Code (kata `yg7k`): the reviewer and whole-range briefs now state `Tool calls` and `Throwaway snippets` from the policy (defaults 40 and
**3**, was 1) and say to spend snippets on a claim about what code *does*; every agent the RUNNER dispatches that writes findings (the slice reviewers, the whole-range reader and the security lane) is given the Severity bullets of `REVIEW.md`
read at the base commit (a built-in copy, pinned equal to the file, when the base has none; a REVIEW.md whose Severity section cannot be read is named in the manifest's `sizing.warnings` as `severity-guide-fallback`). Nothing is added to them: no sentence, no category, no example. The narrated path
(the `brief` CLI call of the skill) returns the bare template without a contract, as before, so it is not covered. The security lane has no tool-call cap or snippet guidance
(pre-existing: its template never had one) and this PR does not add one. Verifier briefs are untouched: independence, the one-claim-per-verifier brief and the vote rules hold.

Not fixable in code, stated plainly: whether a reviewer *thinks* to run `detectE2eFrameworkInDir('/no/such/dir')`, or notices that a
documented option is read nowhere, is the model's depth. The knobs that buy it are operator settings in the `ensemble-review-policy`
block of `REVIEW.md`, each with a cost:

| Knob | Default | Buys | Costs |
|---|---|---|---|
| `reviewerToolCalls` (10-200) | 40 | deeper reading and more probes per reviewer | wall time and tokens up to the cap per reviewer, 7 to 8 reviewers a Medium run; raise `deadlineMinutes.reviewer` with it or a reviewer that uses its budget is reported not reviewed |
| `reviewerSnippets` (1-10) | 3 | the "does it actually throw / match" probes the earlier review made | a few more tool calls only; each is a short read-only command |
| `effort` of the dispatcher's agent call (not a policy key: the dispatcher sets it) | the agent default | more reasoning per reviewer | tokens and time, unmeasured here |
| lenses per slice (`depth.standard.reviewers`) | 2 | a third lens on a slice (another pass over the same paths) | one more reviewer per slice |

An out-of-range value of either key is reported as `invalid-type`, the reason every simple policy key uses (pre-existing precedent, e.g. `maxConcurrentAgents`);
`reviewerSnippets` at or above `reviewerToolCalls` is rejected as `exceeds-tool-calls`, because snippets count toward the cap.

**The knobs are advisory.** The runner sizes a reviewer's deadline from paths and changed lines only; it does not read `reviewerToolCalls`,
checks nothing and warns about nothing. The plan's figures for an earlier run (17 to 41 minutes for 73 to 144 calls) imply roughly 0.23 to
0.29 minutes per call, so 200 calls would need about 47 to 57 minutes, reachable only with `deadlineMinutes.reviewer` near its maximum of 60. A
reviewer that reaches its call cap returns its findings and the paths it did not reach; one that reaches its deadline is reported not reviewed.
The default of 3 snippets is a judgement, like `deadlineHeadroom`: the run only shows that one was spent on a nit.

**The answer key is in the repository.** The reference and fixture are tracked files, and a snapshot is the exact head tree (the prepare step fails with
`snapshot-mismatch` for anything else), so a reviewer of any head that contains them could read them. The PR 207 re-measure is on the immutable head `48c862c`,
whose tree does not hold them; run the guard from a checkout of this repository, never against a head that has merged these files, and re-measure a head
that has them only after removing them from that head. The guard refuses findings that state another `headSha` (`head-mismatch`).

Interplay with PR 282 (open when this was written: a 22-minute reviewer floor): both touch `pr-review-run.js`, `review-run.md`, the CHANGELOG and the
`REVIEW.md` / user-guide policy rows; whichever merges second resolves the conflict. A longer reviewer deadline gives more room for more
calls, and the two are independent settings.

None of these is proven to recover E2, E3, E5 or E6: the next measurement is the test. Re-run the same PR with the same reference and
report `falseNegativeRate` and the wall time beside it.
