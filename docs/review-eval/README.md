# Review eval set

Escaped-bug cases the review pipeline must keep finding, and the guard that fails
when it does not (kata `cwd4`; plan: `docs/plans/pr-review-speedup-plan.md`
section 5, third bullet: *a faster run that loses a real Important finding is a
regression, not a win*).

| Path | What it is |
|---|---|
| `cases/<id>.json` | One case per file, shape of `packages/development/skills/pr-review-eval/case-template.json`. `change` carries the PR link **and the 40-hex commit the line range is pinned to**, so later drift in the base branch cannot move a case. |
| `baselines/deep-review-reconstructed.json` | A reconstruction of the findings the deep review reported for those cases, in `{ findingsByCase }` form. See "Provenance and limits". |
| `history.jsonl` | One line per guard run: base commit, per-case found/not, total, false-negative rate, reviewer label, pass. The first line is a seed, not a measurement. |

## Running the guard

```bash
node packages/development/lib/review-eval-guard.js --base "$BASE_SHA" \
  --findings "$PIPELINE_FINDINGS" \
  --history docs/review-eval/history.jsonl --reviewer "$REVIEWER"
```

`$BASE_SHA` is the commit the change under test is proposed against (the PR's
base commit); `--base` is required. `$PIPELINE_FINDINGS` is the pipeline's
output, `{ "findingsByCase": { "<case id>": [ findings ] } }`, and `$REVIEWER`
labels the run in the history. A pipeline-changing child (`runner`,
`verifyassign`, `shard`, `carry`) runs this before it lands and records the
result in its PR. How the guard decides is in the header of
`packages/development/lib/review-eval-guard.js`; the procedure is
`packages/development/skills/pr-review-eval/SKILL.md`, Step R3a.

## What a pass means

Exit 0 means no problem was found. It is a narrower claim than "the pipeline
still finds every expected bug":

- **The inputs come from the base commit.** The cases, `.github/CODEOWNERS`,
  the rules files and the previous history entry are read from `--base`, never
  from the checkout under test, so a change cannot make its own run easier by
  deleting a case, editing CODEOWNERS or removing the history. A case a change
  adds is graded once it is on the base; to try a new case first, commit it and
  pass `--base HEAD`, which grades the change against its own copy.
- **A match is by location and severity, not by what a finding says.** A case
  is found when the pipeline reports an Important finding anchored `file:line`
  in the case's file at a line inside the case's range. The finding's text is
  not compared with the case, so any Important finding in the range satisfies
  it, and a range anchor such as `file:12-20` is not read. A pass means no
  expected location lost its Important finding, not that the same defect was
  found again. A per-case text check is a follow-up.
- **A pin proves the commit and the file's length, not the lines.** The guard
  checks that the pinned commit is in the checkout, holds the case's file, and
  that the file has at least `endLine` lines. It does not read the recorded
  lines. A pinned commit this checkout lacks fails the run as `pin-unverifiable`
  (the commits are listed in `unverifiableCommits`): `git fetch origin <sha>`
  them, or pass `--allow-unverifiable-pins` to report them as an advisory
  instead. Three of the four pinned commits (`7d4d9d28`, `39674722`, `86a8c9b5`)
  are PR-branch commits that `dev`'s history does not contain (#233 was
  squash-merged, #228 had not merged when the cases were written), so a fresh
  clone needs that fetch; `c700622b` is on `dev`.
- **Stale cases are an advisory.** A case goes stale when its rules file
  (`REVIEW.md`) changes on the base after the owner confirmed it (its
  `rulesHash` is the blob hash of `REVIEW.md` when the case was written). The
  guard lists stale cases in `stale` and `advisories` for owner re-review and
  does not fail the run, because a stale case is still evidence the pipeline
  must satisfy. `--fail-on-stale` makes it fail.
- **The history must exist.** With `--history`, the base commit must have that
  file with at least one readable entry; a missing or unreadable history fails
  the run (`eval-history-missing`, `eval-history-unreadable`) and appends
  nothing. The base's last entry is compared with this run: a case it found
  that this run loses or drops is a regression. Each run that reaches scoring
  appends its line to the working-tree file, failures included. A corrupt last
  line at the base fails every run until a reviewed change repairs it there.

Exit 1 is a lost Important finding or an input the guard could not prove; exit 2
is bad usage. The JSON on stdout names the `problems`, the `missed` case ids and
the false-negative rate.

## Cases

| Case | Where it was found | Pinned at |
|---|---|---|
| `pr228-v1-…` | #228 merge review, V-1 (`scripts/validate-all.js:273-284`) | #228 head `7d4d9d28` |
| `pr233-f01-…`, `-f02-…`, `-f03-…` | #233 fix round 1 (commit `86a8c9b`) | `39674722` (the commit before that fix) |
| `pr233-n01-…`, `-n05-n06-…`, `-n12-…` | #233 fix round 2 (commit `67764f6`) | `86a8c9b5` (the commit before that fix) |
| `pr234-verdict-count-…`, `pr234-slice-sharding-…` | #234 correction commit `8a202c6`: 145 not 180 verdicts, slicing is not two independent passes | `c700622b` (the commit before that correction) |

## Provenance and limits

- The raw review ledgers for #228 and #233 were not persisted. Cases and
  baseline findings are **reconstructed** from the #228 merge-review comment,
  the #233 and #234 fix-commit messages and the code at the pinned commits. The
  line ranges were read from the pinned commits by hand; the guard re-checks only
  that each file exists at its commit with at least that many lines (see "What a
  pass means").
- Only V-1 is recorded with the severity the review gave it. The #233 and #234
  findings are treated as Important because the fix commits describe them as
  ways to defeat the approval floor or as real errors found by the review;
  that is an inference the code owner confirms by merging these files.
  `confirmedBy` names the CODEOWNERS owner of each path; `validateCase` checks
  the name against `.github/CODEOWNERS`, it cannot check that the person said so.
- #233 findings F-04 and F-21/F-22 and the #235 review items N2-01, F-04 and
  F-05 are **not** cases: the first are of unrecorded severity, and the #235
  items are a Nit, a Nit and a Pre-existing finding, which the eval library
  never counts as found (only an Important finding anchored inside the range
  does). N-05 and N-06 are recorded as one case because they share one fix and
  one location.
- The baseline is a **reconstruction, not a captured run**: it holds one
  finding per case, authored to match, so it passes 9 of 9 by construction. It
  proves the guard accepts a complete output and rejects an incomplete one; it
  says nothing about whether today's pipeline finds these bugs. A pipeline child
  proves itself by running its own output through the guard. The first line of
  `history.jsonl` is that baseline recorded as a seed, so there is a previous
  entry to compare with; its false-negative rate of 0 is not a measurement, and
  the series of measurements starts with the first captured run.
- The cases grade a reviewer's output; they never run the cited code, so they
  cannot fail because that code regressed.
