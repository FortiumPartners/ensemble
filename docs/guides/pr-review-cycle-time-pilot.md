# PR Review Cycle-Time Pilot Measurement Plan

This is the pilot measurement plan for REQ-020 (PRD ACs AC-020-1, AC-020-2) of
`TRD-2026-82b6a138-pr-review-cycle-time`. It defines the baseline and post-change cohorts,
the five cycle-time metrics, and the read-only `gh` CLI queries that produce each metric from
real PR data. No dashboard, scheduler, or new dependency is introduced — every command below is
run by hand (or from a throwaway script) against the GitHub API through the already-authenticated
`gh` CLI.

## Table of Contents

1. [Scope](#1-scope)
2. [Baseline and post-change cohorts](#2-baseline-and-post-change-cohorts)
3. [Metrics](#3-metrics)
   - [3.1 Median open-to-merge time](#31-median-open-to-merge-time)
   - [3.2 p75 open-to-merge time](#32-p75-open-to-merge-time)
   - [3.3 First-review latency](#33-first-review-latency)
   - [3.4 Review/fix rounds](#34-reviewfix-rounds)
   - [3.5 Review wait time](#35-review-wait-time)
4. [Running the pilot](#4-running-the-pilot)
5. [Current status: target not met, causality not inferred](#5-current-status-target-not-met-causality-not-inferred)

---

## 1. Scope

The pilot compares how long PRs take to go from open to merged, and how review happens along the
way, **before** the `pr-review-cycle` gate existed (baseline) and **after** it is live in both
`fix-issue` and `implement-trd-beads` (post-change). It covers only PRs created by those two
commands; manually opened PRs, dependency-bot PRs, and PRs from other automation are out of scope
because they never went through the gate being measured.

## 2. Baseline and post-change cohorts

A cohort is the set of PRs created by `fix-issue` or `implement-trd-beads` in a given window.
**Both** of the following must hold before a cohort is considered large enough to report on —
this is an AND, not an OR:

- **At least 20 PRs**, and
- **At least 30 calendar days** of span between the earliest and latest PR in the cohort.

Collection continues until **whichever of the two thresholds is reached later**. If 20 PRs
accumulate in 10 days, keep collecting until day 30. If 30 days pass with only 12 PRs, keep
collecting until the 20th PR lands. A cohort that satisfies only one threshold is not reportable.

- **Baseline cohort:** PRs created by `fix-issue` or `implement-trd-beads` **before** PR 2/PR 3 of
  this TRD ship the local/remote review gates, satisfying both thresholds above.
- **Post-change cohort:** PRs created by the same two commands **after** the gates are live,
  satisfying the same two thresholds, measured independently (not blended with baseline data).

### Identifying cohort membership with `gh`

Neither command currently tags its PRs with a label, so cohort membership is determined from the
PR body text each command already writes:

- `fix-issue.yaml` always appends `Generated with [Ensemble Fix-Issue]` to the PR body.
- `implement-trd-beads.yaml` writes one of two PR bodies. A stacked phase PR (`PR_BODY`) has a line
  ending `<N> of TRD <TRD_SLUG>.` directly followed by a `**Shippable:**` line. The single completion
  PR (`COMPLETION_BODY`) reads `Implements TRD <TRD_SLUG>. Strategy: ... <phase_count> phases,
  <task_count> tasks — all complete. Bead: <ROOT_EPIC_ID>.` and does **not** contain `of TRD`, so a
  search for that phrase alone would miss every single-PR run.

GitHub's body search is loose: it ignores punctuation and matches the words anywhere in the body, so
a PR that merely mentions "of TRD" in prose is returned too. Each search below is therefore only a
candidate list, and the `jq` filter after it keeps the PRs whose body has the exact marker. The
searches use `gh pr list --state merged` because `gh search prs` has no `mergedAt` field (asking it
for one fails with `Unknown JSON field`).

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
WINDOW="2026-01-01..2026-12-31"   # adjust to the baseline or post-change window
LIMIT=1000                        # GitHub search returns at most 1000 results per query

# fix-issue-created PRs
gh pr list --repo "$REPO" --state merged --limit "$LIMIT" \
  --search "\"Generated with [Ensemble Fix-Issue]\" in:body created:$WINDOW" \
  --json number,url,createdAt,mergedAt,body > /tmp/candidates-fix-issue.json
jq 'map(select((.body // "") | contains("Generated with [Ensemble Fix-Issue]")) | del(.body))' \
  /tmp/candidates-fix-issue.json > /tmp/cohort-fix-issue.json

# implement-trd-beads stacked phase PRs ("<N> of TRD <slug>." then a "**Shippable:**" line)
gh pr list --repo "$REPO" --state merged --limit "$LIMIT" \
  --search "\"of TRD\" in:body created:$WINDOW" \
  --json number,url,createdAt,mergedAt,body > /tmp/candidates-trd-phase.json
jq 'map(select((.body // "") | test("[0-9]+ of TRD [^*]{1,200}\\*\\*Shippable:\\*\\*")) | del(.body))' \
  /tmp/candidates-trd-phase.json > /tmp/cohort-trd-phase.json

# implement-trd-beads single completion PRs ("Implements TRD <slug>. ... <N> phases, <M> tasks")
gh pr list --repo "$REPO" --state merged --limit "$LIMIT" \
  --search "\"Implements TRD\" in:body created:$WINDOW" \
  --json number,url,createdAt,mergedAt,body > /tmp/candidates-trd-completion.json
jq 'map(select((.body // "") | test("Implements TRD [^\\n]+ [0-9]+ phases, [0-9]+ tasks")) | del(.body))' \
  /tmp/candidates-trd-completion.json > /tmp/cohort-trd-completion.json

# A candidate list as long as --limit may have been cut off: do not trust it, narrow WINDOW and re-run
for f in /tmp/candidates-fix-issue.json /tmp/candidates-trd-phase.json /tmp/candidates-trd-completion.json; do
  [ "$(jq length "$f")" -lt "$LIMIT" ] || echo "WARNING: $f reached --limit $LIMIT; the cohort may be truncated"
done

# Merge and dedupe into one cohort file
jq -s 'add | unique_by(.number) | sort_by(.createdAt)' \
  /tmp/cohort-fix-issue.json /tmp/cohort-trd-phase.json /tmp/cohort-trd-completion.json \
  > /tmp/cohort.json

# Verify BOTH thresholds before trusting this cohort
jq 'length' /tmp/cohort.json                          # must be >= 20
jq -r '[.[].createdAt] | (min, max)' /tmp/cohort.json  # span (max - min) must be >= 30 days
```

Run this once for the baseline window and once for the post-change window, writing each cohort to
its own file (e.g. `/tmp/cohort-baseline.json`, `/tmp/cohort-post.json`). If the warning fires, the
window holds at least as many PRs as `--limit` returns: split the window in two and merge the
results rather than trusting a truncated list.

## 3. Metrics

The five metrics below are reported **separately, per cohort** — they are never combined, blended,
or averaged into a single score. Each metric gets its own number for baseline and its own number
for post-change; the comparison is metric-by-metric (median vs. median, p75 vs. p75, and so on).

Every query below reads the cohort file from §2 and shares one helper file, so the definitions
cannot drift apart between metrics. Write it once:

```bash
cat > /tmp/pilot.jq <<'EOF'
# True median: the middle value, or the mean of the two middle values for an even count; null when empty.
def median:
  sort
  | if length == 0 then null
    elif length % 2 == 1 then .[(length - 1) / 2]
    else (.[length / 2 - 1] + .[length / 2]) / 2
    end;

# The reviews that count, from `gh pr view --json author,reviews`: submitted, and not written by the PR author.
def counted_reviews:
  .author.login as $author
  | [ .reviews[] | select(.submittedAt != null and ($author == null or .author.login != $author)) ];

# Hours from PR creation to the first review; no output when the PR was never reviewed.
def first_review_hours:
  (.createdAt | fromdateiso8601) as $opened
  | ([ counted_reviews[].submittedAt | fromdateiso8601 ] | min) as $first
  | if $first == null then empty else ($first - $opened) / 3600 end;

# Fix rounds: reviews followed by at least one commit before the next review (before the merge, for the last).
def fix_rounds:
  ([ counted_reviews[].submittedAt | fromdateiso8601 ] | sort) as $reviews
  | [ .commits[].committedDate | fromdateiso8601 ] as $commits
  | (if .mergedAt == null then null else .mergedAt | fromdateiso8601 end) as $merged
  | [ range(0; $reviews | length) as $i
      | $reviews[$i] as $review
      | ($reviews[$i + 1] // $merged) as $until
      | select([ $commits[] | select(. > $review and ($until == null or . < $until)) ] | length > 0) ]
  | length;

# Hours each review waited. A push is a commit made after the PR was opened. A review waited from the first
# push since the previous review (from PR creation, for the first review) until it arrived, so several pushes
# between two reviews are one wait. Pushes after the last review have no review to wait for.
def review_waits:
  (.createdAt | fromdateiso8601) as $opened
  | [ $opened, (.commits[].committedDate | fromdateiso8601 | select(. > $opened)) ] as $pushes
  | ([ counted_reviews[].submittedAt | fromdateiso8601 ] | sort) as $reviews
  | [ range(0; $reviews | length) as $i
      | $reviews[$i] as $review
      | (if $i == 0 then null else $reviews[$i - 1] end) as $previous
      | ([ $pushes[] | select(. < $review and ($previous == null or . >= $previous)) ] | min) as $start
      | select($start != null)
      | ($review - $start) / 3600 ];
EOF
```

Two definitions in that file apply to every metric:

- **Median** is the true median: the middle value, or the mean of the two middle values when the
  count is even, and `null` when there are no values. 3.1, 3.3 and 3.5 all call the same `median`.
- **A review** is an entry of `gh pr view --json reviews` that has a `submittedAt` (a draft that was
  never submitted has none) and was written by someone other than the PR author. Bots count. The
  author's own entries do not: replying in a review thread creates one, and it is not a review of
  the work. 3.3, 3.4 and 3.5 all use `counted_reviews`.

One limit of the data source applies to 3.4 and 3.5, the two metrics that read commits:
`gh pr view --json commits` returns only a PR's oldest 100 commits. On this repository PR #85 has 112
commits and returns 100; PR #118 has 259 and returns 100, all of which predate the PR itself. For a PR
with 100 or more commits the commit-based numbers are therefore unreliable: check the true count with
`gh api "repos/$REPO/pulls/$n" --jq .commits` and set such PRs aside rather than counting them.

### 3.1 Median open-to-merge time

```bash
# Elapsed hours from PR creation to merge, one line per merged PR in the cohort
jq -r '.[] | select(.mergedAt != null) |
  ((.mergedAt | fromdateiso8601) - (.createdAt | fromdateiso8601)) / 3600' \
  /tmp/cohort.json | sort -n > /tmp/open-to-merge-hours.txt

# Median (p50), in hours
jq -L /tmp -s 'include "pilot"; median' /tmp/open-to-merge-hours.txt
```

### 3.2 p75 open-to-merge time

```bash
# Reuses /tmp/open-to-merge-hours.txt from 3.1 (already sorted ascending)
awk -v p=0.75 '{a[NR]=$1} END {
  idx = int(p*NR + 0.9999); if (idx < 1) idx = 1; if (idx > NR) idx = NR; print a[idx]
}' /tmp/open-to-merge-hours.txt
```

### 3.3 First-review latency

Hours from PR creation to the earliest review (as defined above) on that PR — bots included, the PR
author's own entries excluded.

```bash
: > /tmp/first-review-latency.jsonl
for n in $(jq -r '.[].number' /tmp/cohort.json); do
  gh pr view "$n" --repo "$REPO" --json author,createdAt,reviews \
    | jq -c -L /tmp --argjson n "$n" 'include "pilot"; first_review_hours | {number: $n, hours: .}' \
    >> /tmp/first-review-latency.jsonl
done

# Median first-review latency, in hours (PRs never reviewed are excluded, not counted as zero)
jq -L /tmp -s 'include "pilot"; [.[].hours] | median' /tmp/first-review-latency.jsonl
```

### 3.4 Review/fix rounds

A **fix round** is a review that was acted on: a review (as defined above) followed by at least one
commit made after it and before the next review or, for the last review, before the merge. Reviews
nobody acted on — an approval, a bot summary, a comment answered in the thread — are not rounds,
and two reviews with no commit between them are at most one round, since only the second can be
followed by a fix. The `pr-review-cycle` skill's `MAX_AUTO_ROUNDS = 2` caps the *automatic* rounds a
PR goes through; this is the observable proxy for the rounds actually used, not a read of the
skill's own state, so it also counts rounds a human reviewer prompted.

```bash
: > /tmp/rounds.jsonl
for n in $(jq -r '.[].number' /tmp/cohort.json); do
  gh pr view "$n" --repo "$REPO" --json author,mergedAt,commits,reviews \
    | jq -c -L /tmp --argjson n "$n" 'include "pilot"; {number: $n, rounds: fix_rounds}' \
    >> /tmp/rounds.jsonl
done

# Mean fix rounds per PR in the cohort
jq -s '[.[].rounds] | if length == 0 then null else add / length end' /tmp/rounds.jsonl
```

### 3.5 Review wait time

Distinct from first-review latency (3.3), this captures *every* waiting gap in the PR's life, not
just the first: how long each review waited for a reviewer after the diff last changed.

A **push** is a commit whose `committedDate` is after the PR was opened; the commits already on the
PR when it was opened are its first diff, not pushes. A review waited from the first push since the
previous review (from PR creation, for the first review) until it arrived, so several pushes between
two reviews are one wait, measured from the earliest of them. A push after the last review has no
review to wait for and is not counted.

`committedDate` is rewritten by a rebase or an amend, so a rebase between two reviews is counted as
a push made at the time of the rebase, adding a wait that an untouched PR would not have. Before
the first review a rebase changes nothing, because the first wait always starts at PR creation.

```bash
: > /tmp/review-wait.jsonl
for n in $(jq -r '.[].number' /tmp/cohort.json); do
  gh pr view "$n" --repo "$REPO" --json author,createdAt,commits,reviews \
    | jq -c -L /tmp --argjson n "$n" 'include "pilot"; {number: $n, waits: review_waits}' \
    >> /tmp/review-wait.jsonl
done

# Median per-gap review wait time across the whole cohort, in hours
jq -L /tmp -s 'include "pilot"; [.[].waits[]] | median' /tmp/review-wait.jsonl
```

## 4. Running the pilot

1. Build the baseline cohort (§2) from PRs created before PR 2/PR 3 of this TRD shipped the review
   gates; confirm both thresholds (≥20 PRs, ≥30-day span) before trusting it.
2. Write the helper file at the top of §3, then run all five metric queries (§3) against the
   baseline cohort and record the five numbers.
3. Once the gates are live, let real usage accumulate. Build the post-change cohort the same way,
   from PRs created **after** the gates shipped, again confirming both thresholds independently —
   the post-change cohort is not allowed to borrow days or PRs from before the change.
4. Run the same five queries against the post-change cohort.
5. Compare the two cohorts metric-by-metric (baseline median vs. post-change median, baseline p75
   vs. post-change p75, etc.). Do not average the five metrics together or roll them into a single
   index.

## 5. Current status: target not met, causality not inferred

**As of this writing, no post-change cohort exists.** The `pr-review-cycle` gates this TRD adds
have not shipped yet, so there is no "after" data to compare against the baseline. Consequently:

- **The 50% median-reduction target (REQ-020) is NOT currently met.** A target expressed as a
  reduction between two cohorts cannot be satisfied, partially satisfied, or evaluated at all when
  only one of the two cohorts exists. This plan does not and cannot claim otherwise.
- **Causality is not inferred from historical durations alone.** Even once a post-change cohort
  exists, a lower median or p75 open-to-merge time in that cohort does not by itself prove the
  review gate *caused* the reduction — other explanations (different authors, different issue
  complexity, seasonal variation, repo size changes) are equally consistent with raw duration
  data. Establishing that the change caused any observed improvement requires the pilot's
  like-for-like comparison described in §4 (same cohort-definition rules, same two thresholds,
  same five metrics, applied to a genuine post-change population) — it is never inferred from
  baseline numbers in isolation, and it is never inferred from a single PR or a cohort that fails
  either threshold in §2.
