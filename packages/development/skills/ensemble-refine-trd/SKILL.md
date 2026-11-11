---
name: ensemble-refine-trd
description: "Refine and enhance existing TRD with stakeholder feedback and additional detail"
disable-model-invocation: true
metadata:
  version: "2.7.0"
  category: planning
---

Refine an existing TRD from stakeholder feedback, research, or identified gaps, preserving version history, traceability, and Design Readiness scoring.

## Constraints

- DO NOT implement, build, or execute any technical work described in the TRD; this command ONLY refines the TRD document, then stops for user approval
- DO NOT edit during Synthesis -- findings are presented first; edits happen only after the user selects items
- --collab and --long-lived are mutually exclusive with --foreman: passing both HALTs before any phase runs, with 'ERROR: --collab requires a human reviewer and cannot be combined with --foreman (non-interactive mode). Drop one of the two flags.'
- Under --foreman with no TRD path argument (or with --list), HALT: 'ERROR: --foreman requires an explicit TRD path.' Never pick a TRD by score, recency, glob, or plausibility.
- Never edit the Master Task List grammar: keep every task line as `- [ ] **TRD-NNN**` / `- [ ] **TRD-NNN-TEST**` (checkbox prefix required by trd-cli's parser) and every `### PR N:` heading followed by its `**Shippable State:**` line.

## Arguments

- **`collab`** (boolean, optional, default: `false`): Browser-based collaborative refinement (sidebar questions, anchor-linked comments) replacing the terminal interview. The session artifact feeds the Enhancement phase. Details: docs/guides/refinement-review-collab.md.
- **`tunnel`** (string, optional, default: `""`): `quick` exposes the review server over a Cloudflare Quick Tunnel (`*.trycloudflare.com`) so reviewers on other networks can reach it. Requires `cloudflared` on PATH (or CLOUDFLARED_PATH). Empty: local only.
- **`reviewers`** (integer, optional, default: `1`): Number of independent single-use reviewer share URLs to mint (1 = the original URL; N > 1 adds N-1 via `server.createShareUrl()`).
- **`long-lived`** (boolean, optional, default: `false`): One reusable invite URL with a TTL (default 6h) that any number of reviewers can open; implies `--tunnel=quick`; mutually exclusive with `--reviewers`.
- **`ttl`** (string, optional, default: `"6h"`): Long-lived session lifetime (`6h`, `12h`, `1d`); minimum and default `6h`. Only used with `--long-lived`.
- **`foreman`** (boolean, optional, default: `false`): Foreman-native non-interactive mode: skip Synthesis selection and Interview, auto-apply every finding with a best-effort default (or an inline `[NEEDS CLARIFICATION: ...]` marker), and log each choice. Requires an explicit TRD path argument (`--list` is not allowed). Mutually exclusive with --collab/--long-lived. When --foreman is present and FOREMAN_ARTIFACT_PATH is set and non-empty, write the phase report to that exact path (creating parent directories) in addition to any repo-local report. Never invent or alter the path; an unset FOREMAN_ARTIFACT_PATH is not an error.

## Workflow

Work through the phases in numbered order. Each phase's full instructions are in its own file under `references/`, in this skill's directory: open the file with your file-reading tool (not a shell command) when you reach that phase and follow it exactly. Resolve the paths below relative to this SKILL.md.

| Phase | Instructions | Steps |
|---|---|---|
| 1. Collaborative Review | `references/phase-1-collaborative-review.md` | Session Bootstrap |
| 2. TRD Review | `references/phase-2-trd-review.md` | Current TRD Analysis; Synthesis (skip when --collab or --long-lived in $ARGUMENTS); Interview (skip when --collab or --long-lived in $ARGUMENTS); Feedback Integration (artifact when --collab or --long-lived in $ARGUMENTS) |
| 3. Enhancement | `references/phase-3-enhancement.md` | List Available TRDs; Content Refinement; Validation |
| 4. Design Readiness Gate Re-Score | `references/phase-4-design-readiness-gate-re-score.md` | Re-Score Readiness Dimensions |
| 5. Output Management | `references/phase-5-output-management.md` | TRD Update; Implementation Go / No-Go |

## Expected Output

**Format:** Refined Technical Requirements Document (TRD)

**Structure:**

- **Updated TRD**: Enhanced TRD with feedback incorporated
- **Version History**: Changelog of updates and refinements
- **Acceptance Criteria Traceability**: Updated matrix linking PRD requirements to TRD implementation and test tasks
- **Design Readiness Scorecard**: Re-scored readiness dimensions with delta comparison (if applicable)
- **Changelog Entry**: Dated version entry listing all changes made during refinement
- **Configure-Team Suggestion**: Recommendation to re-run /ensemble:configure-team if task changes exceed 20% delta
