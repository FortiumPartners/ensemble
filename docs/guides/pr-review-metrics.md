# PR Review Metrics and Reviewer Eval Runbook

How to produce the review metrics of REQ-019 and the reviewer eval score of REQ-020 with the
`pr-review-cli.js` subcommands added by TRD-032, from data fetched with the already-authenticated
`gh` CLI. No dashboard, no scheduler, no new dependency: every command here is run by hand (or from
a throwaway script) when someone wants the numbers.

This guide **extends** [`pr-review-cycle-time-pilot.md`](pr-review-cycle-time-pilot.md), it does not
replace it:

- the five cycle-time metric definitions (open-to-merge, first-review latency, rounds, wait) stay in
  §3 of the pilot guide;
- the review-process metric definitions and the committed-baseline `jq` program stay in §6 of the
  pilot guide (TRD-044);
- what is here is the part a maintainer repeats: fetching the inputs, running the subcommands, and
  reading the verdicts.

Review **wall time** (how long a review takes, by tier, against the plan's 5x target) is a different
cohort with a different baseline file: see [`pr-review-walltime.md`](pr-review-walltime.md).

---

## 1. The cohort rule, before anything else

A cohort is reportable only when it has **at least 20 PRs AND at least 30 days**
(earliest to latest `createdAt`). This is an AND, not an OR, and it is the same rule as §2 and §6.1
of the pilot guide. `metrics-compare` enforces it: a side that does not clear both floors comes back
in `insufficient` with `cohortOk: false` and **no targets graded at all** — a thin cohort can never
certify that a review change worked.

Both cohorts (baseline and post-change) must clear the rule independently.

## 2. Fetch the inputs with `gh`

Each query below produces exactly one part of a subcommand payload. All are read-only.

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# 2.1 The cohort: merged PRs in the window (narrow with --search for a marker cohort).
gh pr list --repo "$REPO" --state merged --limit 1000 \
  --search 'merged:2026-07-01..2026-09-30' --json number > /tmp/cohort-numbers.json
jq 'length' /tmp/cohort-numbers.json   # WARNING if this equals --limit: the cohort is truncated.

# 2.2 Per-PR records: reviews WITH THE COMMIT ID each was given on, comments and commits.
#     `reviews` carries commit ids, which is what binds an approval to a commit (REQ-014);
#     `commits` is what rounds-to-pass counts.
for n in $(jq -r '.[].number' /tmp/cohort-numbers.json); do
  gh pr view "$n" --repo "$REPO" \
    --json number,title,author,createdAt,mergedAt,reviews,comments,commits
done | jq -s '.' > /tmp/cohort-prs.json

# 2.3 Review requests (who was asked, and when) -- wait-on-human time starts at the request
#     when there was one, so fetch them for any cohort where reviewers are requested explicitly.
for n in $(jq -r '.[].number' /tmp/cohort-numbers.json); do
  gh api "repos/$REPO/pulls/$n/requested_reviewers"
done | jq -s '.' > /tmp/cohort-review-requests.json

# 2.4 Review threads (resolved vs unresolved), which say whether a finding was answered.
for n in $(jq -r '.[].number' /tmp/cohort-numbers.json); do
  gh api graphql -f query='
    query($owner:String!,$name:String!,$number:Int!){
      repository(owner:$owner,name:$name){
        pullRequest(number:$number){
          number
          reviewThreads(first:100){ nodes { id isResolved comments(first:1){ nodes { path body } } } }
        }
      }
    }' -F owner="${REPO%/*}" -F name="${REPO#*/}" -F number="$n"
done | jq -s '.' > /tmp/cohort-threads.json

# 2.5 Reverts on the default branch (the guardrail's first half).
git log --format=%s origin/HEAD | grep -c '^Revert' > /tmp/cohort-reverts.txt

# 2.6 Incidents (the guardrail's second half) -- from the incident tracker the repository uses,
#     e.g. issues carrying the `incident` label in the same window:
gh issue list --repo "$REPO" --label incident --state all \
  --search 'created:2026-07-01..2026-09-30' --json number | jq 'length' > /tmp/cohort-incidents.txt
```

If a repository has no incident tracker, **leave `incidents` out**. `computeMetrics` reports it as
`null` with a reason and `metrics-compare` reports the guardrail as `unknown` — which is never a
pass. Never hand-estimate it.

## 3. `metrics` — one cohort

```bash
jq -n \
  --slurpfile prs /tmp/cohort-prs.json \
  --argjson reverts "$(cat /tmp/cohort-reverts.txt)" \
  --argjson incidents "$(cat /tmp/cohort-incidents.txt)" \
  '{prs: $prs[0], revertCommitsOnDefaultBranch: $reverts, incidents: $incidents}' \
  | node packages/development/lib/pr-review-cli.js metrics > /tmp/cohort-metrics.json
```

The result reports human approvals per PR (median and p95), human comments, wait-on-human hours,
rounds-to-pass, the share of PRs needing five or more rounds, the noise rate, reverts, incidents and
a per-tier breakdown (records with no tier are grouped as `untiered`, and nothing fails).

**Noise rate** needs per-finding records of what was presented and how the author responded
(`fixed`, `wrong`, `intentional`, `unimportant`). Those come from the review ledger, passed as
`findingResponses: [{ findingId, response }]`. Historical PRs have none, so the rate is `null` with
a reason — never a hand-classified estimate.

## 4. `metrics-compare` — post-change against the baseline

```bash
jq -n \
  --slurpfile baseline docs/guides/review-baseline-2026-10-27.json \
  --slurpfile current /tmp/cohort-metrics.json \
  '{baseline: $baseline[0], current: $current[0]}' \
  | node packages/development/lib/pr-review-cli.js metrics-compare
```

Either side may be a raw `{ prs: [...] }` payload, a `metrics` result, or a committed baseline file
(`docs/guides/review-baseline-<date>.json`, captured per §6 of the pilot guide).

What the verdict means:

| Field | Reading |
|---|---|
| `insufficient` | A side under 20 PRs or 30 days. Nothing is graded; fix the cohort, not the report. |
| `targets` | Per target: `baseline`, `current`, `achievedReduction` and `met`. Rounds-to-pass must be **at least 30% lower**, PRs needing 5+ rounds **at least 50% lower**, noise **at least 30% lower**; median human approvals and p95 human wait must simply be lower. |
| `guardrail` | `failed` when reverts or incidents rose above baseline, `unknown` when a count is missing, `passed` only when every watched count is known and did not rise. |
| `met` | True only when the cohorts are big enough, **every** target is met and the guardrail passed. A guardrail breach fails the cohort regardless of the targets. |

### Baseline capture

The baseline is captured once, per §6.3 of the pilot guide, and committed as
`docs/guides/review-baseline-<date>.json` so later comparisons are against a fixed, reviewable file
rather than a re-derived number. To refresh or re-capture it, re-run §6.3 and commit the new file;
never edit an existing baseline in place — a baseline that moves proves nothing.

## 5. The reviewer eval set (REQ-020)

Cases live in `docs/review-eval/cases/<id>.json` (policy key `evalCasesDir`). Each records the
change, the bug, where the bug lived, the code owner who confirmed it, and the rules file plus its
hash at the time of confirmation.

```bash
# 5.1 Score a run: how many recorded bugs the reviewer actually found.
jq -n --slurpfile cases /tmp/eval-cases.json --slurpfile findings /tmp/eval-findings.json \
  '{cases: $cases[0], findingsByCase: $findings[0]}' \
  | node packages/development/lib/pr-review-cli.js eval-score > /tmp/eval-run-today.json

# 5.2 Compare with the previous run: a lower total is a regression, by name.
jq -n --slurpfile previous /tmp/eval-run-prev.json --slurpfile current /tmp/eval-run-today.json \
  '{previous: $previous[0], current: $current[0]}' \
  | node packages/development/lib/pr-review-cli.js eval-compare

# 5.3 Which cases need owner re-review because their rules file changed.
jq -n --slurpfile cases /tmp/eval-cases.json \
  --arg hash "$(git hash-object REVIEW.md)" \
  '{cases: $cases[0], rulesHashes: {"REVIEW.md": $hash}}' \
  | node packages/development/lib/pr-review-cli.js eval-stale
```

A case counts as found only when an **Important** finding overlaps the recorded bug location.
`eval-compare` flags a lower total as `regression` and names the cases that flipped. `eval-stale`
returns every case whose rules file changed, plus any case whose rules state it cannot read: an
unknown rules state is never read as "unchanged".

## 6. Reading the numbers honestly

- Every subcommand is JSON-in/JSON-out and exits 0 even when it refuses: read the `ok`, `met`,
  `guardrail` and `regression` fields, never the exit code alone.
- A payload the module cannot read is a refusal, not a zero. Nothing here fabricates a measure.
- Metrics describe a cohort; they do not establish cause. A change in the numbers alongside a review
  change is evidence to discuss, not proof — the same caution as §5 of the pilot guide.
