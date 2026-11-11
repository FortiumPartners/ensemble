---
name: ensemble-refine-prd
description: "Refine and enhance existing PRD with stakeholder feedback and additional detail, or from a meeting summary with --from-meeting"
disable-model-invocation: true
metadata:
  version: "2.9.0"
  category: planning
---

Refine and enhance an existing Product Requirements Document based on stakeholder
feedback, additional research, or identified gaps. Updates PRD while maintaining
version history, traceability, and alignment with the create-prd v2.2.0 format
including PRD Health summaries, MoSCoW priorities, and Implementation Readiness Gate
scoring.
Meeting-summary mode (--from-meeting): refine the PRD using a meeting summary as the
source of stakeholder feedback, rather than a live interactive interview -- the
asynchronous counterpart to the default mode. Runs the same Synthesis findings scan,
but instead of interviewing the user about each finding, checks whether the meeting
summary already answers it. Applies what it can directly from the summary and leaves
everything else as an open finding for a later human-run refine-prd pass, rather than
guessing. It never locks the PRD and never changes its Status field. --from-meeting is
mutually exclusive with --collab, --long-lived and --foreman.

## Constraints

- DO NOT implement, build, or execute any work described in the PRD
- This command ONLY refines the PRD document itself
- The arguments describe what should be improved in the document, not what should be built
- After refining the PRD, stop and wait for user approval before any implementation
- DO NOT make any edits to the PRD during the Synthesis step — findings are presented first, edits happen only after the user selects items
- --collab requires a human reviewer and cannot be combined with --foreman (non-interactive mode) -- HALT if both are passed
- When --foreman is set, skip the Synthesis selection prompt and Interview questions -- auto-apply all findings and [NEEDS CLARIFICATION: ...] resolutions using best-effort defaults (falling back to an inline [NEEDS CLARIFICATION: ...] marker when no safe default exists) and log what was auto-applied; the "stop and wait for user approval before implementation" constraint above is unaffected
- --from-meeting requires TWO distinct inputs in $ARGUMENTS: a PRD file path AND a meeting summary (inline text or a path to one) -- not one input
- --from-meeting: DO NOT invent answers to findings the meeting summary does not actually address -- leave those findings and their [NEEDS CLARIFICATION] markers untouched for a later live /ensemble:refine-prd pass, do not guess
- --from-meeting: DO NOT make any edits to the PRD during the Synthesis step or the finding classification -- findings are classified first, edits happen only after
- --from-meeting: the meeting-summary input contract is source-agnostic, same as create-prd --from-meeting -- any adapter that normalizes into the expected shape (see the Parse Meeting Summary step) can feed this command
- --from-meeting cannot be combined with --collab, --long-lived or --foreman -- HALT if --from-meeting is passed together with any of them. It never changes the PRD's Status field and never runs the PRD Lock step

## Arguments

- **`collab`** (boolean, optional, default: `false`): Opt into browser-based collaborative refinement (HTML review with sidebar questions and anchor-linked comments). When true, replaces the terminal AskUserQuestion interview with a local web session; the artifact captured during the session feeds the standard Enhancement phase below. When false (the default), the original terminal-based refinement workflow runs unchanged.
- **`tunnel`** (string, optional, default: `""`): When set to `quick`, exposes the local refinement-review server over a Cloudflare Quick Tunnel (`*.trycloudflare.com`) so a reviewer on a different network can reach the share URL without any account, API token, or DNS change. Requires the `cloudflared` binary on `PATH` (or set `CLOUDFLARED_PATH` to its absolute path). The bootstrap launches `cloudflared` after the local server binds, captures the ephemeral `*.trycloudflare.com` URL, re-mints the share nonce against the tunnel origin, and tears down the tunnel on exit. When empty (the default), the share URL points at the local server and is reachable only from the same machine.
- **`reviewers`** (integer, optional, default: `1`): Number of independent reviewer share URLs to mint for this session. Each URL carries its own single-use 10-minute exchange nonce and authenticates to the same underlying session/document, so multiple stakeholders can open the session simultaneously without colliding. `1` (the default) reproduces the original behavior: a single share URL on the public origin (or local origin when `--tunnel` is not set). Values greater than `1` add `(N - 1)` URLs minted via `server.createShareUrl()`, each bound to the same `publicUrl`. The bootstrap prints one URL per line, numbered `#1` (the original) through `#N` (the additional fan-out URLs). Each reviewer redeems exactly once; the server burns the nonce atomically on first use, so a leaked `#k` URL cannot be replayed by a second reviewer. Typical use: a Product Manager invites 3-5 stakeholders (security, design, ops, legal) to the same refinement session in parallel.
- **`long-lived`** (boolean, optional, default: `false`): Long-lived review session: a single invite URL with a 6-hour TTL that any number of reviewers can exchange (no nonce burn, no fan-out). QuickTunnel is implicit — `cloudflared` is launched automatically so the invite URL works across networks without a Cloudflare account. Reviewers identify themselves with a display name (no uniqueness check, no provider login) before the document UI is served. Presence (who is currently viewing) is surfaced to other reviewers in real time. Completion terminates the listener so the port does not stay bound. Mutually exclusive with `--reviewers N` (a long-lived session already accepts arbitrary reviewers via one reusable invite URL). `--long-lived` implies `--tunnel=quick`; do not pass a separate `--tunnel` value with this flag.
- **`ttl`** (string, optional, default: `"6h"`): Long-lived session lifetime as a duration string (e.g. `6h`, `12h`, `1d`). Parsed by the bootstrap to milliseconds; the minimum accepted value is `6h` and the default is `6h`. Only used when `--long-lived` is set; ignored otherwise.
- **`foreman`** (boolean, optional, default: `false`): Run in Foreman-native non-interactive mode -- skip the terminal interview/Synthesis selection step and automatically apply all findings/[NEEDS CLARIFICATION: ...] resolutions using best-effort defaults instead of waiting for the user to select which findings to apply. Mutually exclusive with --collab (which requires a human reviewer) -- passing both HALTs with an error. For automated Foreman orchestration.
- **`from-meeting`** (boolean, optional, default: `false`): Refine the PRD using a meeting summary as the source of stakeholder feedback instead of a live interview -- the asynchronous counterpart to the default mode. $ARGUMENTS (with this flag removed) must carry TWO distinct inputs: the PRD file path (the first non-flag token, as everywhere in this command) and, after it, a meeting summary -- inline text or a path to one. Runs the same Synthesis findings scan as the default mode, but instead of interviewing the user about each finding, checks whether the meeting summary already answers it: findings the summary answers (RESOLVABLE_FROM_MEETING) are applied, citing the part of the summary that grounded each change; findings it does not address (STILL_OPEN) and their [NEEDS CLARIFICATION] markers are left untouched for a later live refine-prd pass rather than guessed at. Never changes the PRD's Status field and skips the PRD Lock step. Mutually exclusive with --collab, --long-lived and --foreman (passing any of them together with --from-meeting HALTs with an error).

## Workflow

Work through the phases in numbered order. Each phase's full instructions are in its own file under `references/`, in this skill's directory: open the file with your file-reading tool (not a shell command) when you reach that phase and follow it exactly. Resolve the paths below relative to this SKILL.md.

| Phase | Instructions | Steps |
|---|---|---|
| 1. Collaborative Review (--collab / --long-lived only) | `references/phase-1-collaborative-review.md` | Session Bootstrap |
| 2. PRD Review | `references/phase-2-prd-review.md` | Current PRD Analysis; Synthesis; Interview; Feedback Integration |
| 3. Meeting-Sourced Review (--from-meeting only) | `references/phase-3-meeting-sourced-review.md` | Parse Meeting Summary; Synthesis; Feedback Integration |
| 4. Enhancement | `references/phase-4-enhancement.md` | Content Refinement; Validation |
| 5. Readiness Gate Re-Score | `references/phase-5-readiness-gate-re-score.md` | Readiness Assessment |
| 6. Output Management | `references/phase-6-output-management.md` | PRD Update; PRD Lock |

## Expected Output

**Format:** Refined Product Requirements Document (PRD)

**Structure:**

- **Updated PRD**: Enhanced PRD with feedback incorporated and structural improvements (with --from-meeting, meeting-sourced feedback incorporated for RESOLVABLE_FROM_MEETING findings only)
- **Updated PRD Health Summary**: Recalculated requirement counts by priority, AC coverage percentage, risk flags, and dependency count
- **Updated Readiness Scorecard**: Re-scored Implementation Readiness Gate with comparison to previous score (if applicable)
- **Version History**: Changelog entry documenting refinement date, version, and list of changes
- **Remaining Findings Report (--from-meeting only)**: STILL_OPEN findings not addressed by the meeting summary, left for a live /ensemble:refine-prd pass
