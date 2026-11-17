# On-Demand Code Sweeps (REQ-021)

How to review code that is **already merged** — the defects nobody introduced today — with the
`pr-review-sweep` skill, and how a repository that wants that on a cadence owns the schedule
itself.

This guide covers TRD-035. It assumes the review files `/ensemble:init-project` scaffolds
(`REVIEW.md`, `.github/CODEOWNERS`, the PR template) are in place; see
[`pr-review-cycle-time-pilot.md`](pr-review-cycle-time-pilot.md) for the PR-review loop those
files drive.

---

## 1. What a sweep is

A sweep is a review of existing code at one commit. There is no diff, no author to answer and
no merge to gate. Every finding it produces carries the **`Pre-existing` severity** — the third
word of the ledger's closed set (`Important`, `Nit`, `Pre-existing`), which the CLI normalises
into `preExisting: true` on the record. That is what tells a reader the defect was already
merged, and it is why a sweep finding can never block somebody else's pull request: the merge
gate counts open Important findings, and a Pre-existing one is not one of them.

A sweep uses the **same** reviewers and the **same** verification a PR gets: the depth's
reviewer and verifier bounds (`pr-review-cli.js depth`), the slice plan for large scopes
(`slices`), and the strict-majority vote before anything is reported (`votes` — 2 of 3 at
Standard, 3 of 5 at Deep). A candidate nobody verified is reported as `unverified`, never as a
defect the repository must fix and never dropped.

**Sensitive areas first.** The skill orders the sweep by the sensitivity the repository
declared (REQ-003): the `high` paths, then the `sensitive` paths, then everything else. When a
run is capped with `MAX_PATHS`, it truncates from the end of that order and names what is left
for the next run.

## 2. Running one by hand

Invoke the skill (`packages/development/skills/pr-review-sweep/SKILL.md`) from an
already-authenticated session:

```
SCOPE        = ["packages/payments", "packages/auth"]   # or ["."] for everything
SWEEP_SHA    = <git rev-parse HEAD>                     # full object id, never a bare ref
REQUESTED_BY = <your github login>
TIER         = high                                     # optional; absent means high
MAX_PATHS    = 200                                      # optional
```

It answers `SWEEP_COMPLETE` (every path examined, slices reviewed, verified findings with their
Pre-existing tag), `SWEEP_PARTIAL` (the same, but `MAX_PATHS` truncation or an uncovered slice
left paths for the next run, which it names) or `SWEEP_BLOCKED` (what could not be read or
graded — never a clean bill of health it could not justify).

The sweep **reports**. It writes no code, opens no PR, pushes nothing and resolves nobody's
review thread. What becomes work is a person's decision.

## 3. Recurrence is the host repository's, never ensemble's

Ensemble runs no recurring job (Constitution Rule 4). Its own `.github/workflows` carry no
`schedule:` trigger, the skill holds no timer, watcher or background poll, and nothing in the
review path waits for a clock. A repository that wants a weekly sweep owns that schedule — in
its own workflow, or in Foreman.

**Recommended cadence: weekly**, sensitive areas first (the skill does the ordering for you).

### The opt-in workflow template

`/ensemble:init-project` **offers** to scaffold `.github/workflows/review-sweep.yml` and writes
it only on an explicit yes. Everything about it is then the host repository's:

| | |
|---|---|
| **Opt-in** | Never written unless the user asks. Declining is recorded in the init report as "no recurring job was added". |
| **Yours once written** | The cron (`0 7 * * 1` by default), the scope, the runner and the agent invocation are all yours to change. |
| **Inert until enabled** | The job is guarded by `vars.ENSEMBLE_SWEEP_ENABLED == 'true'` and its agent step exits non-zero until you replace it with your agent's CLI, so a scaffolded template cannot start burning credits quietly. |
| **Needs your agent credentials** | The template drives a coding agent in CI, so it needs that agent's API key as a repository secret (`AGENT_API_KEY` in the template — rename it to whatever your agent expects). |

### The core review needs no new CI secret

This is the important asymmetry:

- **`pr-review-cycle`, `/ensemble:pr-merge` and `pr-review-sweep` run inside a session you have
  already authenticated**, with the `gh` CLI that is already logged in. They add **no new CI
  secret**, no token, no credential and no dependency.
- **Only the optional sweep workflow** needs a credential, because it runs an agent in CI with
  nobody present. If you never opt in, you never add it, and every part of the review process
  still works.

A sweep you run by hand needs nothing the PR review did not already need.

## 4. Reading a sweep report

| In the report | What it means |
|---|---|
| **Pre-existing** on every finding | The defect was already merged at `SWEEP_SHA`. Nobody introduced it in a PR under review. |
| Band (`high` / `sensitive` / other) | Which sensitivity band the path was in, so triage can start where the risk is. |
| `present` / `disputed` / `unverified` | The verification outcome. `disputed` is a critical or security-relevant finding the verifiers split on — a person decides, not a vote. |
| Left for the next run | Paths the `MAX_PATHS` cap, an uncovered slice or a missing file left unswept. A truncated sweep is never reported as a complete one. |
| Reduced-review notice | Verification could not run (no subagent capability). The findings are real candidates, but none of them was independently verified. |
