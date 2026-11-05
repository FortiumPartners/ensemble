# Review Rules

What a reviewer of **ensemble-plugins** should care about. This file is prose
and data a maintainer edits directly: change it and the next review reflects
the change — no code change, rebuild or release. Every review reads the copy
on the **base branch**, never the copy on a pull request's head, so a PR
cannot relax its own review by editing this file.

## What every review checks

- **Behaviour is proven, not asserted.** A fix or feature carries a test that
  fails without the change. A claim like "verified" with no command behind it
  is a finding.
- **Nothing is silently dropped.** Errors are handled where they occur;
  fail-closed paths return a named reason instead of a plausible default.
- **No new dependency** without an explicit decision (Constitution §4), and no
  secret, token or credential anywhere in the tree.
- **Editable behaviour stays editable.** Criteria a maintainer tunes belong in
  Markdown (skills, agents, this file); only code that grades a model's claim
  belongs in `packages/*/lib/`.
- **Generated artifacts match their sources.** When a command, agent or skill
  source changes, the generated output is regenerated in the same PR
  (`npm run generate`, `npm run validate`).

## Severity

A review reports findings under exactly three words. The words are a closed
set the tooling enforces; **what each one means is the prose below**, and a
maintainer changes it by editing this section — no code change, rebuild or
release.

- **Important** — the change is wrong, unsafe or unproven: a defect a user or
  another agent would hit, a security or secret exposure, a gate that cannot
  fail, a claim with no command behind it, or a generated artifact that no
  longer matches its source. An Important finding must be answered before
  merge.
- **Nit** — a preference that does not change behaviour: naming, wording,
  ordering, formatting, a comment that could be clearer. A Nit never blocks a
  merge and is never worth a review round on its own.
- **Pre-existing** — a real defect in code this pull request did not
  introduce. It is reported separately, never blocks this PR, and belongs in
  an issue rather than this review.

Older ledgers written as Critical, Major, Minor or Nitpick are read as
Important (Critical, Major) and Nit (Minor, Nitpick); nothing is lost and no
blocking outcome changes. A word outside the set is treated as Important
until a person says otherwise.

## Area rules

Any directory may carry its own `REVIEW.md`. A change is reviewed against this
root file plus the nearest area file above it — for example
`packages/development/REVIEW.md` would govern everything under
`packages/development/`. When two area files conflict, the more restrictive
instruction wins. Policy keys below are read from this **root** file only;
area files carry guidance.

## Sensitive and high-risk areas

An owner declares sensitive areas in the `sensitivePaths` list below. A pull
request touching one of them is treated as sensitive by every review and
approval rule that consults sensitivity. The declared list **adds to** the
built-in floor (CI workflows, release gates, installers, the generation
pipeline and the project constitution); it can never shrink it. The review
guards are declared here too -- the review and local-CI gate code under any
file name or extension and every copy of it (the vendored ones and the full
bundle's links), the local-CI approval set and its runner script, the whole
`pr-review-cycle` skill, which is the procedure that feeds the gate, and the
`pr-merge` command source with its generated copies -- so a change to them
always keeps two humans, whatever `soloMaintainer` says. A pattern that names
a path is matched ignoring letter case, because a case-insensitive checkout
(macOS, Windows) writes `PR-REVIEW-GATE.JS` over `pr-review-gate.js`; a bare
file name such as `REVIEW.md` is matched exactly, at any depth.

## Policy

The fenced block below is the only place policy keys are read from. The
review reads it from the base commit of the PR, and that commit is the policy's
identity. Do NOT add a `sourceSha` key: a commit cannot name itself, so a
declared `sourceSha` can never equal the base and the whole block is rejected
(`policy-not-from-base`), leaving the strict defaults in force (round cap 3,
Quick at one reviewer and no verifier, no Low waiver, no maintainer or bot
logins).

```ensemble-review-policy
{
  "roundCap": 3,
  "maintainerLogins": ["@ldangelo"],
  "botLogins": ["@coderabbitai", "@claude", "@github-actions"],
  "sensitivePaths": [
    ".github/workflows/**",
    ".github/actions/**",
    "scripts/validate-*",
    "scripts/publish-*",
    "scripts/release-*",
    "scripts/install-*",
    "scripts/generate-*",
    "scripts/generate-*/**",
    "docs/standards/constitution.md",
    "REVIEW.md",
    ".github/CODEOWNERS",
    ".github/pull_request_template.md",
    "packages/**/lib/pr-review-*",
    "packages/**/lib/local-ci-*",
    ".ensemble/local-ci.yaml",
    "scripts/ci-local.js",
    "packages/**/skills/pr-review-cycle",
    "packages/**/skills/pr-review-cycle/**",
    "packages/git/commands/pr-merge.yaml",
    "packages/**/commands/ensemble/pr-merge.md",
    "packages/**/ensemble-pr-merge.md",
    "packages/**/ensemble-pr-merge/SKILL.md",
    "packages/full/commands/git"
  ],
  "highPaths": [
    "packages/development/lib/**",
    "packages/agent-core/**",
    "packages/pi-extension/**"
  ],
  "lowWaiverEnabled": false,
  "soloMaintainer": true,
  "sliceThreshold": 1500
}
```

| Key | Meaning |
|---|---|
| `roundCap` | Review rounds before the cycle escalates (1–5; 3 here). |
| `maintainerLogins` | Logins whose approval counts for this repository. |
| `botLogins` | Review bots. A bot approval never satisfies a human-approval requirement. |
| `sensitivePaths` | Owner-declared sensitive areas, added to the built-in floor. |
| `highPaths` | Areas that start at the High risk tier. |
| `lowWaiverEnabled` | Whether a Low-risk PR may waive review with evidence (off here). |
| `soloMaintainer` | With exactly one maintainer login: a High PR that touches no sensitive path and was directed by that maintainer needs one human instead of two. If that maintainer is not the PR's author they must have approved the current head on the host; if they are the author (an agent PR committed under their own login, which the host will not let them approve) the discount rests on their own credit as author-as-director and the gate result carries the warning `solo-maintainer-self-credit`. A PR whose author cannot be read keeps two humans, and a `Directed by:` line alone never lowers the requirement for any other author. The security lane still blocks High. Sensitive-path PRs keep two humans. |
| `sliceThreshold` | Changed-line count above which a PR is reviewed in slices. |

## Ownership

`.github/CODEOWNERS` declares who owns each area. Ownership is read from the
base branch alongside this file.
