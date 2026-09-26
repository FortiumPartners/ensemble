---
name: ensemble-implement-trd-beads
description: Implement TRD with beads project management — persistent bead hierarchy, dependency-aware execution via br/bv, and cross-session resumability (Codex skill for /ensemble:implement-trd-beads)
user-invocable: true
argument-hint: '[trd-path] [--plan] [--execute] [--branch=<name>] [--use-current-branch] [--status] [--reset-task TRD-XXX] [--list] [max parallel N] [--foreman]'
model: gpt-5.1-codex
---

# Ensemble Command: /ensemble:implement-trd-beads

This Codex skill mirrors the Ensemble slash command `/ensemble:implement-trd-beads`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from implement-trd-beads.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Parse a TRD and create a beads hierarchy (epic -> stories -> tasks) before
any implementation begins. Drive execution order through bv --robot-plan
(the only scheduler) rather than TRD re-parsing. bv --robot-plan partitions
the TRD-scoped bead subgraph into parallel tracks (up to max_parallel) and
the build pipeline dispatches each track concurrently. Record all state
transitions in br beads so the implementation is resumable across sessions
without access to local state files.

This command wraps the implement-trd-enhanced execution model with a full
beads project management layer powered by br (beads_rust) and bv (beads_viewer).
It transforms TRD-structured work into a persistent, queryable beads hierarchy
and drives execution order through bv --robot-plan — enabling cross-session
resumability, graph-aware triage, and parallel execution planning.

Key behaviors:
- Scaffold: epic -> stories -> tasks created in br before first line of code
- Idempotency: existing scaffolds detected via title-prefix matching; partial scaffolds resumed safely
- Execution: bv --robot-plan is the only scheduler; tracks partitioned and dispatched concurrently (max N parallel); br sync --flush-only before every bv call; barrier-and-replan between waves
- Quality gates: phase completion triggers test delegation; results recorded as br comments
- Sync: br sync --flush-only exports JSONL before every bv call
- Hard requirement: bv is required. There is no graceful-degradation path — if bv is missing, installation is a precondition. br ready is never a fallback dispatcher; bv --robot-plan is the only scheduler.
- Quickstart generation: beads-backed quickstart.md generation is unsupported in v1; use standard /ensemble:implement-trd when a v1 quickstart.md validation artifact is required.
- --foreman forces non-interactive mode without changing safety HALT behavior (branch-intent-required, PR-backend-unresolved, and completion-verification-failed still HALT unchanged).
- When --foreman is present and FOREMAN_ARTIFACT_PATH is set and non-empty, write the phase report to that exact path (creating parent directories as needed) IN ADDITION TO any repo-local report this command already writes -- Foreman computes that path and reads it back to confirm the phase produced an artifact. Never invent, alter, or relocate the path, and never treat an unset FOREMAN_ARTIFACT_PATH as an error (outside Foreman dispatch it is simply absent and behavior is unchanged).

## Workflow

### Phase 1: Preflight

**1. Define trd_progress() helper**
   Define trd_progress(TRD_SLUG) as a shell function available to every subsequent phase.
Derives counts directly from `br` (no dependency on Scaffold-built TASK_TRACEABILITY)
so the helper is callable from --status (Preflight step 2), Resume Detection (Preflight
step 7), and Completion Report (Completion step 3) regardless of phase ordering.
Uses `node` (already required by the TRD CLI check in Tool Availability) to parse br's
JSON output — avoids a jq dependency.


   - # Define trd_progress(TRD_SLUG). Counts beads whose title contains
# the literal token "[trd:<slug>:" (matches task and story beads
# created by Scaffold). Prints a TRD-scoped progress summary.
trd_progress() {
  local slug="$1"
  local issues_json
  issues_json=$(mktemp)
  if ! br list --all --limit 0 --json > "$issues_json" 2>/dev/null; then
    echo "ERROR: trd_progress() — br list failed"
    rm -f "$issues_json"
    return 1
  fi
  local counts
  counts=$(node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const slug = process.argv[2];
    const needle = "[trd:" + slug + ":";
    const matches = data.filter(b => (b.title || "").includes(needle));
    const total = matches.length;
    const closed = matches.filter(b => b.status === "closed").length;
    const in_progress = matches.filter(b => b.status === "in_progress").length;
    const open = matches.filter(b => b.status === "open").length;
    const pct = total > 0 ? ((closed / total) * 100).toFixed(1) : "0.0";
    process.stdout.write(total + " " + closed + " " + in_progress + " " + open + " " + pct);
  ' "$issues_json" "$slug") || { echo "ERROR: trd_progress() — node parse failed"; rm -f "$issues_json"; return 1; }
  rm -f "$issues_json"
  local total closed in_progress open pct
  read -r total closed in_progress open pct <<< "$counts"
  echo "=== TRD PROGRESS: $slug ==="
  echo "Tasks: $closed/$total complete (${pct}%)"
  echo "In progress: $in_progress | Open: $open"
  echo "================================"
}
# Note: trd_progress() is the single source of truth for TRD-scoped
# progress reporting. Replaces the previous Execute phase order 10
# definition that became unreachable after the Execute -> beads-build
# delegation.


**2. Handle Special Arguments**
   Process --status and --reset-task arguments for early exit paths

   - If $ARGUMENTS contains '--plan' AND $ARGUMENTS contains '--execute': print 'ERROR: --plan and --execute are mutually exclusive.' and EXIT
   - Parse $ARGUMENTS for .md paths. Initialize COMBINED_WORKSTREAM_MODE=false before branching. If two or more TRD paths are present without '--workstream' or '--legacy-multi': print 'ERROR: Multiple TRDs passed directly. Direct multi-TRD execution is deprecated because it can lose fidelity across parser/runtime merge boundaries. Run /ensemble:create-workstream-trd <trd1> <trd2> ... then /ensemble:implement-trd-beads <generated-workstream-trd>, or rerun with --workstream to generate first.' and HALT before any br/git/scaffold side effects. If two or more TRD paths are present with '--workstream': resolve TRD_CLI and run node "$TRD_CLI" create-workstream-trd <TRD_PATHS...>; parse {ok,path}. If ok is false or JSON malformed, print errors and HALT. Replace TRD path list with the generated single workstream TRD path and continue normal single-TRD behavior. If two or more TRD paths are present with '--legacy-multi': set COMBINED_WORKSTREAM_MODE=true, set SOURCE_TRD_PATHS to the ordered path list, print 'DEPRECATED: direct multi-TRD mode; prefer /ensemble:create-workstream-trd then implement the generated workstream TRD', and list every source TRD. If exactly one TRD path is present: keep COMBINED_WORKSTREAM_MODE=false and preserve existing single-TRD behavior exactly. If zero TRD paths are present: keep COMBINED_WORKSTREAM_MODE=false and defer to normal single-TRD selection in Preflight step 4.
   - If $ARGUMENTS contains '--plan': set PLAN_ONLY=true (scaffold phase runs, Execute phase is skipped — print wheel instructions and exit after scaffold completes)
   - If $ARGUMENTS contains '--execute': set EXECUTE_ONLY=true (scaffold phase is skipped — resume detection runs, Execute phase runs against existing beads)
   - If $ARGUMENTS contains '--use-current-branch': set USE_CURRENT_BRANCH_REQUESTED=true; if $ARGUMENTS also contains '--branch=<name>': print 'ERROR: --use-current-branch and --branch=<name> are mutually exclusive.' and HALT before any git side effects. If flag absent: set USE_CURRENT_BRANCH_REQUESTED=false. If $ARGUMENTS contains '--branch=<name>': extract the branch name after '=' and store it as BRANCH_REQUESTED; if --use-current-branch is also present this is already caught and HALTed above.
   - If $ARGUMENTS contains '--status' AND COMBINED_WORKSTREAM_MODE=true: capture all issues with explicit file redirection, e.g. ISSUES_JSON=$(mktemp); br list --all --limit 0 --json > "$ISSUES_JSON". If the user supplied --workstream <slug>, run node "$TRD_CLI" workstream-status --issues-json "$ISSUES_JSON" --workstream <slug>; otherwise omit --workstream and print all detected workstreams. Parse {ok,workstreams,trds,blocked,ready,parallelSafeStreams}; if ok is false, process exits non-zero, or JSON is malformed, print the error and HALT. Print release train progress, each TRD epic progress, blocked items, ready items, and parallel-safe streams; EXIT
   - If $ARGUMENTS contains '--status' AND COMBINED_WORKSTREAM_MODE=false: derive TRD_SLUG (same derivation as Preflight step 5 TRD Selection — lowercase, non-alphanumeric → '-', strip leading/trailing '-'), then call trd_progress() (Preflight step 1) with TRD_SLUG to print the TRD-scoped progress summary, EXIT
   - If $ARGUMENTS contains '--reset-task': derive TRD_SLUG (same derivation as Preflight step 5), extract TASK_ID from argument, run br list --status=open --json OR br list --status=in_progress --json (capture both via --all), filter JSON for entry whose title contains the literal token [trd:<TRD_SLUG>:task:<TASK_ID>]; if exactly one bead matches, run br update <BEAD_ID> --status=open and EXIT; if zero match, print 'ERROR: No bead found for TASK_ID=<TASK_ID> with TRD_SLUG=<TRD_SLUG>' and EXIT 1; if multiple match, print 'ERROR: Multiple beads match — ambiguous TASK_ID, please be more specific' and EXIT 1

**3. Tool Availability Check**
   Verify br is installed and functional, detect bv availability

   - which br || { echo 'ERROR: br (beads_rust) not installed. Install from https://github.com/Dicklesworthstone/beads_rust'; exit 1; }
   - br list --status=open > /dev/null 2>&1 || { echo 'ERROR: br not functional'; exit 1; }
   - which bv >/dev/null 2>&1 && BV_AVAILABLE=true || { echo 'ERROR: bv (beads_viewer) is required (contract: bv is required, line 122 of this skill; installation is a precondition, no graceful-degradation path). Install bv from https://github.com/Dicklesworthstone/beads_viewer and retry.'; exit 1; }
   - Resolve TRD_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/trd-cli.js. If none of the 4 tiers resolve OR 'which node' fails: print 'ERROR: Node.js and the TRD CLI (lib/trd-cli.js) are required for deterministic TRD parsing. Ensure Node.js is installed and the ensemble-development plugin is present.' and exit 1. Smoke-check: node "$TRD_CLI" parse "<any TRD path once known>" is used later; for now just confirm the file exists and node runs.
   - If BV_AVAILABLE=false: print 'ERROR: bv (beads_viewer) is required for graph-aware task scheduling in all modes (--plan, --execute, full). Install bv from https://github.com/Dicklesworthstone/beads_viewer and retry.' and exit 1

**4. Git-Town and Working Directory Verification**
   Verify git-town installed and working directory is clean; resolve branching strategy and PR backend via resolve-sdlc

   - Resolve VALIDATE_GIT_TOWN_SH per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/git/skills/git-town/scripts/validate-git-town.sh. If none resolve, HALT with 'ERROR: validate-git-town.sh not found at the monorepo root, CWD, Claude Code plugin root, or the Pi/OMP plugin install path — the ensemble-git plugin's git-town skill scripts appear to be missing from this install.'
   - Run: bash "$VALIDATE_GIT_TOWN_SH"; capture its exit code as GIT_TOWN_EXIT_CODE (0-4). Exit codes 3 (version mismatch) and 4 (not a git repo) are unaffected by this feature — HALT on those exactly as before. Exit codes 0 (ok), 1 (not installed), and 2 (not configured) no longer HALT here — they are passed to resolve-sdlc below.
   - If the --foreman flag is present in arguments, set INTERACTIVE=false unconditionally (skip availability detection). Otherwise, detect AskUserQuestion availability: set INTERACTIVE=true if available, INTERACTIVE=false otherwise (reuses the same detection this file performs again later in Feature Branch Creation).
   - Run: REMOTE_URL=$(git remote get-url origin 2>/dev/null); if REMOTE_URL is empty (no origin configured), set REMOTE_URL to the literal string 'none' — resolve-sdlc requires a non-empty --remote-url, and any non-URL string is treated as 'no unsupported host detected'.
   - Run: node "$TRD_CLI" resolve-sdlc --git-town-exit-code "$GIT_TOWN_EXIT_CODE" --remote-url "$REMOTE_URL"; parse the single JSON object from stdout as RESOLVE_SDLC_RESULT.
   - If RESOLVE_SDLC_RESULT has an 'error' key (trd-cli.js's shared failure contract — a thrown Error caught by main(), printed as {"error":"<msg>"} with exit 1; NOT {ok:false,error:...}): print the error and HALT. This should not normally happen since GIT_TOWN_EXIT_CODE and REMOTE_URL are always well-formed here, but never swallow it.
   - If RESOLVE_SDLC_RESULT.branchingStrategy.action == 'halt': print RESOLVE_SDLC_RESULT.branchingStrategy.message and HALT.
   - If RESOLVE_SDLC_RESULT.prBackend.needsResolution == true: If INTERACTIVE=true, call AskUserQuestion with id='pr_backend', question='This repository's remote is not supported by git-town's PR automation. How should pull requests be created?', options=[{label:'ado',description:'Use the azure-devops MCP tool to create the PR (falls back to printing manual az repos/portal steps if the MCP tool is not connected)',preview:'ENSEMBLE_PR_BACKEND=ado'},{label:'manual',description:'Always print manual PR-creation steps instead of automating PR creation',preview:'ENSEMBLE_PR_BACKEND=manual'},{label:'proceed with gh anyway (not recommended)',description:'Use the gh CLI even though the remote host is not GitHub — will likely fail',preview:'ENSEMBLE_PR_BACKEND=gh'},{label:'abort',description:'Stop without resolving a PR backend',preview:'Abort'}], multi=false, recommended=0. Parse the answer: 'ado' -> PR_BACKEND=ado; 'manual' -> PR_BACKEND=manual; 'proceed with gh anyway (not recommended)' -> PR_BACKEND=gh; 'abort' -> print 'Aborted — no git side effects.' and HALT. If INTERACTIVE=false, or INTERACTIVE detection is itself uncertain (always default to this branch when in doubt — never risk a hung prompt): print 'PR backend could not be auto-resolved for this repository's remote. Set one of the following to proceed non-interactively:', then each of 'ENSEMBLE_PR_BACKEND=ado', 'ENSEMBLE_PR_BACKEND=manual', 'ENSEMBLE_PR_BACKEND=gh' on its own line, then the persistence hint '...set this in your shell profile/CI config to skip this prompt on future invocations.', and HALT.
   - If RESOLVE_SDLC_RESULT.prBackend.needsResolution == false: set PR_BACKEND=RESOLVE_SDLC_RESULT.prBackend.backend (no prompt, no HALT).
   - Set BRANCHING_STRATEGY=RESOLVE_SDLC_RESULT.branchingStrategy.strategy. Both BRANCHING_STRATEGY and PR_BACKEND are re-resolved fresh on every invocation, including resumed TRDs, and are read by later Preflight/Feature-Branch-Creation/Quality-Gate steps in this file — never cached across sessions.
   - If RESOLVE_SDLC_RESULT.consolidatedMessage is non-null: print it. If it is null (the pure-default case — git-town configured and remote is GitHub): print nothing new at all, matching today's exact output for existing git-town+GitHub users.
   - Run: git status --porcelain — HALT if output non-empty (dirty working directory).

**5. TRD Selection and Validation**
   Locate, validate, and detect format of the target TRD file

   - If $ARGUMENTS contains '--list': run node "$TRD_CLI" list --type trd and parse {ok,type,items}. If ok is false or JSON is malformed, print the error and HALT. Print a formatted table of TRDs (columns: ID/Name, Status, Score, Last Modified). Then call AskUserQuestion with id='trd_select', question='Select a TRD to implement:', options=items.map(i => ({id:i.slug, label:i.id||i.slug, description: 'Status: ' + i.status + (i.design_readiness_score != null ? ' | Score: ' + i.design_readiness_score : '') + (i.version ? ' | Version: ' + i.version : '') + (i.last_modified ? ' | Modified: ' + i.last_modified.split('T')[0] : '')})), multi=false, recommended=0. Parse answer id as the selected TRD_SLUG. Then derive TRD_FILE_PATH as docs/TRD/<basename matching the selected slug>.md (find by suffix/prefix match). If derived path does not exist, print 'ERROR: Could not resolve path for slug <TRD_SLUG>' and HALT.
   - Priority: $ARGUMENTS .md path(s) -> $ARGUMENTS name search in docs/TRD/ -> single in-progress TRD in docs/TRD/ -> prompt user
   - If COMBINED_WORKSTREAM_MODE=true: run node "$TRD_CLI" validate-workstream <SOURCE_TRD_PATHS...> and parse {ok,trds,errors}. This is the all-or-nothing preflight. It validates every TRD for readability, parseability, PRD reference, Master Task List, PR sections, Shippable State lines, design_readiness_score >= 4.0, and non-blocked status before any br, branch, or scaffold side effect. If ok is false, the process exits non-zero, or JSON is malformed: print every failing TRD with reason (or the raw CLI error) and HALT. No release train bead, root epic bead, story bead, task bead, dependency edge, or branch may be created.
   - Validate: file exists, contains Master Task List section, contains at least one '- [ ] **TRD-' entry
   - Derive TRD_SLUG from filename: lowercase, replace non-alphanumeric with hyphens, strip leading/trailing hyphens
   - PR format detection: scan the TRD file for '### PR ' followed by a digit within the '## Master Task List' section (from '## Master Task List' heading to the next '##' heading or EOF). If at least one such heading is found: set PR_FORMAT=true and log 'TRD format: PR-stack (shippable boundaries)'. Else: set PR_FORMAT=false and log 'TRD format: legacy phase/sprint'. PR_FORMAT is re-derived on every invocation (including cross-session resume) so the correct value is always in scope.

**6. Design Readiness Gate Verification**
   Check if the TRD passed the Design Readiness Gate from create-trd v3.0.0

   - Parse TRD frontmatter (YAML block between --- delimiters at top of file) for 'design_readiness_score' or 'Design Readiness Score' field
   - If score exists AND score >= 4.0 (PASS): print 'Design Readiness: PASS (<score>)' and continue
   - If score exists AND score >= 3.0 AND score < 4.0 (CONCERNS): print 'WARNING: TRD has Design Readiness score of <score> (CONCERNS). Consider running /ensemble:refine-trd to address issues before implementation.' Ask user to continue or abort.
   - If score exists AND score < 3.0 (FAIL): print 'ERROR: TRD has Design Readiness score of <score> (FAIL). Run /ensemble:refine-trd to improve the TRD before implementation.' and HALT
   - If no design readiness score found in frontmatter (pre-v3.0.0 TRD): print 'NOTE: No Design Readiness score found (pre-v3.0.0 TRD). Consider running /ensemble:refine-trd to generate a score.' and continue

**7. Resume Detection**
   Check for existing beads scaffold to enable cross-session resume. Config freshness:
BRANCHING_STRATEGY/PR_BACKEND were already re-resolved fresh in Preflight step 4
(Git-Town and Working Directory Verification, which always runs before this step, on
every invocation) — resuming never reuses a strategy/backend value cached from this
TRD's persisted choices-read state (branch_name/use_proposed/stacked_prs are the only
fields choices-read/choices-write ever persist; BRANCHING_STRATEGY and PR_BACKEND are
never written there and are always live-resolved).


   - If EXECUTE_ONLY=true: skip scaffold phase entirely. Run resume detection to find ROOT_EPIC_ID. If no existing scaffold found: print 'ERROR: --execute requires an existing bead scaffold. Run /ensemble:implement-trd-beads --plan first.' and EXIT.
   - Run: br list --status=open --json
   - Parse JSON output, search for entry where title matches pattern [trd:<TRD_SLUG>] with type epic
   - If found (either EXECUTE_ONLY=false or EXECUTE_ONLY=true — this is a resumed TRD): set ROOT_EPIC_ID from JSON .id field, run br sync --flush-only, then call trd_progress() (Preflight step 1) with TRD_SLUG to show resumed TRD-scoped progress, skip Scaffold phase, proceed to Execute
   - Reconciliation notice (REQ-014/REQ-015): if a resume was just detected (ROOT_EPIC_ID found above) AND RESOLVE_SDLC_RESULT.consolidatedMessage (captured fresh in Preflight step 4 for THIS invocation) is non-null: print 'NOTE: this session resolved BRANCHING_STRATEGY=<BRANCHING_STRATEGY>, PR_BACKEND=<PR_BACKEND> for a TRD that was previously scaffolded/branched in an earlier session. The prior session's resolution is not persisted anywhere, so it cannot be named exactly here — if it differed from this session's values, any branches or PRs already created under it are unaffected going forward; only branches/PRs created from this point forward use the resolution above.' This is informational only — no branch or PR created in a prior session is rewritten, re-targeted, or otherwise touched (deliberate limitation, TRD §2.4).
   - If not found: proceed to Feature Branch Creation then Scaffold

**8. TRD Staleness Gate**
   Check TRD freshness before committing to a feature branch. Skip on resume.
Algorithm defined in the staleness-gate skill. Resolve its path per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/skills/staleness-gate/SKILL.md.


   - If resume was detected in Preflight step 6 (ROOT_EPIC_ID is set / IS_RESUME=true): skip this step — staleness check does not apply to resuming an existing scaffold. Print 'Staleness check: skipped (resume detected)' and continue to Preflight step 8 (Strategy Detection).
   - If first invocation (IS_RESUME=false / no ROOT_EPIC_ID found in step 6): execute the TRD Staleness Gate using the staleness-gate skill (invoke its skill.md via the skill system), passing TRD_PATH from Preflight step 5 and IS_RESUME=false.

**9. Strategy Detection**
   Determine implementation strategy from arguments, TRD content, or auto-detection

   - Priority: $ARGUMENTS strategy=X -> TRD explicit -> constitution -> auto-detect -> default (tdd)
   - Auto-detect: legacy/brownfield/untested -> characterization; bug fix/regression -> bug-fix; refactor/tech debt -> refactor; prototype/spike/POC -> test-after; default -> tdd

**10. Feature Branch Creation**
   Create or switch to feature branch for TRD implementation

   - Run: node "$TRD_CLI" choices-read "<TRD_FILE_PATH>". Parse {ok, choices}. If ok is false: print error and HALT. Set SAVED_BRANCH_NAME=<choices.branch_name or ''>, SAVED_USE_PROPOSED=<choices.use_proposed or false>, SAVED_STACKED_PRS=<choices.stacked_prs or false>. CLI flags (--branch, --use-current-branch, ENSEMBLE_USE_STACKED_PRS) always override saved values when present.
   - Determine effective stacked flag: if ENSEMBLE_USE_STACKED_PRS is set (true/false), use it; else if SAVED_STACKED_PRS is true, use true; else use false. Call pr-plan with --stacked only when effective stacked is true: Run: node "$TRD_CLI" pr-plan "<TRD_FILE_PATH>"$( [ "<effective stacked>" = true ] && echo ' --stacked' ). Parse {ok, stacked, prFormat, branchFirst, actions}. If ok is false or the process exits non-zero: print the error and HALT. Set STACKED_PRS=stacked, PR_ACTIONS=actions.
   - Run: git branch --show-current and store the result as CURRENT_BRANCH_NAME (empty string if detached HEAD).
   - TRD Branch Auto-Detection — runs AFTER pr-plan and current-branch read, BEFORE INTERACTIVE detection / flag / AskUserQuestion processing. Priority order: explicit --branch=<name> or --use-current-branch wins over auto-detection; auto-detection wins over pr-plan's branchFirst. Only runs when no explicit branch intent was provided (USE_CURRENT_BRANCH_REQUESTED != true AND BRANCH_REQUESTED is not set); if an explicit flag is already set, skip this action entirely. Logic: list local branches: git for-each-ref --format='%(refname:short)' refs/heads/ | grep -E '(^|/)<TRD_SLUG>$' (escape TRD_SLUG for regex). This matches feature/<TRD_SLUG>, <TRD_SLUG>, and any prefix/<TRD_SLUG>. Remotes are excluded by scanning refs/heads/ only (remote-only matches are ignored). If MATCHES.length == 1: set branch_name=<single match>, USE_PROPOSED=false, BRANCH_RESOLVED_BY_AUTO_DETECT=true. If MATCHES.length >= 2: print 'WARNING: Multiple local branches match the TRD slug — cannot auto-select:', <MATCHES.join(', ')>. Unset BRANCH_RESOLVED_BY_AUTO_DETECT. If MATCHES.length == 0: unset BRANCH_RESOLVED_BY_AUTO_DETECT.
   - Detect AskUserQuestion availability: set INTERACTIVE=true if available, INTERACTIVE=false otherwise.
   - Branch intent from saved TRD choices — runs after explicit flags and auto-detection, before interactive prompt. If USE_CURRENT_BRANCH_REQUESTED != true AND BRANCH_REQUESTED is not set AND BRANCH_RESOLVED_BY_AUTO_DETECT is not true AND SAVED_BRANCH_NAME is not empty: set branch_name=<SAVED_BRANCH_NAME>, USE_PROPOSED=<SAVED_USE_PROPOSED>. Print 'Branch intent: <SAVED_USE_PROPOSED ? 'use proposed branch' : SAVED_BRANCH_NAME> (from prior TRD session)'. If USE_PROPOSED=true: set branch_name=<branchFirst>. This step is skipped if any higher-priority source has already resolved branch intent.
   - In non-interactive mode (INTERACTIVE=false): if --branch=<name> is present in arguments: set branch_name=<BRANCH_REQUESTED>, USE_PROPOSED=false, print 'Branch intent: <BRANCH_REQUESTED> (from --branch argument)'. Else if USE_CURRENT_BRANCH_REQUESTED=true: if CURRENT_BRANCH_NAME is empty: print 'ERROR: --use-current-branch requires a current branch (detached HEAD state). Switch to a branch first, or use --branch=<name> to specify a branch.' and HALT. Otherwise: set branch_name=<CURRENT_BRANCH_NAME>, USE_PROPOSED=false, print 'Branch intent: <CURRENT_BRANCH_NAME> (from --use-current-branch)'. Else if BRANCH_RESOLVED_BY_AUTO_DETECT=true: print 'Branch intent: <branch_name> (auto-detected existing equivalent branch)'. Else if SAVED_BRANCH_NAME is not empty: print 'Branch intent: <SAVED_USE_PROPOSED ? 'use proposed branch' : SAVED_BRANCH_NAME> (from prior TRD session)'. If USE_PROPOSED=true: set branch_name=<branchFirst>. Else: print 'EXECUTION PLAN (unresolved): ═══════════════════════════════════════════════ EXECUTION PLAN ═══════════════════════════════════════════════ TRD:             <TRD_FILE_PATH> Mode:            <PLAN_ONLY ? 'Plan only' : EXECUTE_ONLY ? 'Execute only' : 'Full'> Proposed branch:  <branchFirst> Current branch:  <CURRENT_BRANCH_NAME or '(none / detached)'> PR topology:     <STACKED_PRS ? 'Stacked (one PR per phase)' : 'Single PR (all phases on one branch)'> ═══════════════════════════════════════════════ ERROR: Branch intent required in non-interactive mode. Pass --branch=<name> or --use-current-branch to specify the target branch, or run interactively.' and HALT.
   - In interactive mode (INTERACTIVE=true): set BRANCH_OPTIONS=[{label:'Use proposed branch',description:'Use pr-plan generated branch: <branchFirst> (created off the base branch if needed, via git town hack or plain git checkout -b depending on BRANCHING_STRATEGY)',preview:'Proposed: <branchFirst>'},{label:'Specify existing branch',description:'Enter an existing branch name to switch to before implementation',preview:'Existing branch'},{label:'Abort',description:'Stop without any git side effects',preview:'Abort'}].
   - If INTERACTIVE=true AND CURRENT_BRANCH_NAME != '': append to BRANCH_OPTIONS: {label:'Use current branch',description:'Work on already-checked-out branch: <CURRENT_BRANCH_NAME> — no new branch created',preview:'Current: <CURRENT_BRANCH_NAME>'}.
   - Print the proposed execution plan BEFORE asking (shows recommendation so user can make an informed choice): ═══════════════════════════════════════════════ EXECUTION PLAN (proposed) ═══════════════════════════════════════════════ TRD:             <TRD_FILE_PATH> Mode:            <PLAN_ONLY ? 'Plan only' : EXECUTE_ONLY ? 'Execute only' : 'Full'> Strategy:        <STRATEGY> Proposed branch:  <branchFirst> Current branch:  <CURRENT_BRANCH_NAME or '(none / detached)'> PR topology:     <STACKED_PRS ? 'Stacked (one PR per phase)' : 'Single PR (all phases on one branch)'> ═══════════════════════════════════════════════
   - If INTERACTIVE=true AND (USE_CURRENT_BRANCH_REQUESTED=true OR BRANCH_REQUESTED is set OR BRANCH_RESOLVED_BY_AUTO_DETECT=true): if USE_CURRENT_BRANCH_REQUESTED=true AND CURRENT_BRANCH_NAME is empty: print 'ERROR: --use-current-branch requires a current branch (detached HEAD state). Switch to a branch first, or use --branch=<name> to specify a branch.' and HALT. If USE_CURRENT_BRANCH_REQUESTED=true: set branch_name=<CURRENT_BRANCH_NAME>, USE_PROPOSED=false, print 'Branch intent: <CURRENT_BRANCH_NAME> (from --use-current-branch flag)' and skip AskUserQuestion. If BRANCH_REQUESTED is set: set branch_name=<BRANCH_REQUESTED>, USE_PROPOSED=false, print 'Branch intent: <BRANCH_REQUESTED> (from --branch argument)' and skip AskUserQuestion. If BRANCH_RESOLVED_BY_AUTO_DETECT=true: print 'Branch intent: <branch_name> (auto-detected existing equivalent branch)'. If neither flag is set but SAVED_BRANCH_NAME is not empty: print 'Branch intent: <SAVED_USE_PROPOSED ? 'use proposed branch' : SAVED_BRANCH_NAME> (from prior TRD session)' and skip AskUserQuestion.
   - If INTERACTIVE=true AND USE_CURRENT_BRANCH_REQUESTED=false AND BRANCH_REQUESTED is not set AND BRANCH_RESOLVED_BY_AUTO_DETECT is not true AND SAVED_BRANCH_NAME is empty: Call AskUserQuestion with id='branch_intent', question='Which branch should this TRD implementation use?', options=BRANCH_OPTIONS, multi=false, recommended=0. Parse answer id. If answer='abort': print 'Aborted — no git side effects.' and HALT. If answer='use_proposed': set USE_PROPOSED=true. If answer='use_current': set USE_PROPOSED=false, branch_name=<CURRENT_BRANCH_NAME>. If answer='specify_existing': ask a followup with id='branch_name' question='Enter the existing branch name:' options=[], multi=false. Parse freeform answer as branch_name, set USE_PROPOSED=false.
   - If USE_PROPOSED=false (current or specified branch): print 'Branch intent: reuse mode — single-branch plan.' Transform PR_ACTIONS for single-branch operation: for every gate/append entry, set branch=<branch_name>, clear parentBranch, clear appendNextBranch, set createPr=false. For the completion entry: rebuild it as {kind:'completion', createPr:true, branch:<branch_name>, proposeTitle:'Implement <TRD_SLUG> (<TRD_FILE_PATH basename>)', summaryKind:'single', parentBranch:'', appendNextBranch:''}. Set STACKED_PRS=false, CURRENT_PHASE_BRANCH=<branch_name>, PHASE_BRANCH_MAP={1:<branch_name>}, PHASE_PR_MAP={}.
   - If USE_PROPOSED=true: set branch_name=<branchFirst>, CURRENT_PHASE_BRANCH=<branchFirst>, PHASE_BRANCH_MAP={1:<branchFirst>}, PHASE_PR_MAP={}. Print 'Branch intent: use proposed branch <branch_name>'.
   - Print the final execution plan AFTER the user's choice is resolved and intent is normalized: ═══════════════════════════════════════════════ EXECUTION PLAN (confirmed) ═══════════════════════════════════════════════ TRD:             <TRD_FILE_PATH> Mode:            <PLAN_ONLY ? 'Plan only' : EXECUTE_ONLY ? 'Execute only' : 'Full'> Strategy:        <STRATEGY> Proposed branch:  <branchFirst> Current branch:  <CURRENT_BRANCH_NAME or '(none / detached)'> PR topology:     <STACKED_PRS ? 'Stacked (one PR per phase)' : 'Single PR (all phases on one branch)'> Selected branch: <USE_PROPOSED ? branchFirst : branch_name> ═══════════════════════════════════════════════
   - If USE_PROPOSED=true: Run: git branch --list <branch_name>. If exists: git switch <branch_name>. If not exists AND BRANCHING_STRATEGY=='git-town': git town hack <branch_name> [UNCHANGED]. If not exists AND BRANCHING_STRATEGY=='plain-git': resolve BASE_BRANCH via git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null (stripping the leading 'origin/'), falling back to 'main' if that fails or is empty — the same base branch git town hack would have targeted; then run git checkout -b <branch_name> <BASE_BRANCH>. Zero git town commands are issued anywhere in this run when BRANCHING_STRATEGY=='plain-git'.
   - If USE_PROPOSED=false: Run: git branch --list <branch_name>. If exists: git switch <branch_name>. If not exists: print 'ERROR: Branch <branch_name> does not exist. Switch to an existing branch before running, or choose 'Use proposed branch' to create a new one.' and HALT.
   - Normalize choices for persist: USE_PROPOSED_NORM=<USE_PROPOSED ? 'true' : 'false'>, STACKED_PRS_NORM=<STACKED_PRS ? 'true' : 'false'>, BRANCH_NAME_NORM=<USE_PROPOSED ? branchFirst : branch_name>. Run: node "$TRD_CLI" choices-write "<TRD_FILE_PATH>" --branch-name <BRANCH_NAME_NORM>$( [ "<USE_PROPOSED_NORM>" = 'true' ] && echo ' --use-proposed' )$( [ "<STACKED_PRS_NORM>" = 'true' ] && echo ' --stacked-prs' ). If exit code != 0: print warning 'Failed to persist branch choice to TRD frontmatter — continuing without persisting' (non-fatal).

**11. Team Configuration Detection**
   Parse the TRD's explicit `team:` block when present; otherwise resolve the
always-on default 8-role roster via packages/development/lib/team-defaults.js.
Single-agent mode is removed — team mode is the execution model.


   - Read the TRD file frontmatter / body for an explicit `team:` block. If present: parse it with the shared team parser contract (lead, builder, architect, reviewer, qa, advisor, pm, documentation). Store the normalized object as TEAM_ROLES.
   - If no explicit `team:` block exists: call resolveDefaultTeamRoles using the same domain/complexity heuristics that configure-team.yaml computes. Store the returned normalized 8-role roster as TEAM_ROLES.
   - Log exactly one line: Team mode (default roster): lead=<lead>, architect=<architect>, builders=<n>, reviewer=<reviewer>, qa=<qa>, advisor=<advisor>, pm=<pm>, documentation=<documentation> when defaults are used.
   - Log exactly one line: Team mode (TRD roster): lead=<lead>, architect=<architect>, builders=<n>, reviewer=<reviewer>, qa=<qa>, advisor=<advisor>, pm=<pm>, documentation=<documentation> when an explicit TRD team block is used.

**12. Marketplace Preflight Check**
   Before execution begins, check for marketplace capability gaps that may affect
agent availability. Presents suggestions for missing agents/skills and installs approved
plugins. Builds KNOWN_AGENTS and AGENT_ALIAS_MAP from BOTH source packages/*/agents/*.yaml
AND the runtime-visible Task agent registry at '~/.omp/plugins/node_modules/@*/*/agents/*.md'
(scoped) plus '~/.omp/plugins/node_modules/*/agents/*.md' (unscoped fallback).
Re-runs agent discovery after installation to refresh both maps. AC: FR-11.1 through FR-11.6,
AC-8.1 through AC-8.6, AC-TD-2, FR-5.6


   - Step 1 — Load marketplace.json: Read marketplace.json from repository root
   - If missing or malformed: log 'marketplace.json not found -- skipping marketplace preflight'; skip remaining steps
   - Step 2 — Domain scan: identify TRD task domains using same keyword matching as /create-trd Phase 4 Step 3
   - Step 3 — Build KNOWN_AGENTS and AGENT_ALIAS_MAP (initial agent registry). This is the binding contract the executionContract.agentResolution rules refer to. Without this step the alias map is undefined and every Task() delegation fails.
   -   3a — Source packages scan: Use Glob to scan packages/*/agents/*.yaml relative to CWD. For each file extract basename without .yaml extension as the unqualified agent name.
   -   3b — Runtime plugin agent fallback (REQUIRED): Use Glob to scan BOTH '~/.omp/plugins/node_modules/@*/*/agents/*.md' (scoped npm packages, e.g. @sunstone-partners/ensemble-pi/agents/*.md) AND '~/.omp/plugins/node_modules/*/agents/*.md' (unscoped fallback). The two-pattern glob is required because the @*/agents/*.md shorthand misses the package segment; without it only the project's local agents are visible and the full team roster (tech-lead-orchestrator, code-reviewer, qa-orchestrator, test-runner, etc.) is incorrectly absent. For each discovered agent markdown file derive a runtime agent identifier of the form '<plugin>:<agent_name>' by combining the plugin directory name (e.g. ensemble-pi -> 'ensemble-full' when the plugin's marketplace name is ensemble-full, otherwise the raw plugin directory name) with the basename without .md extension. Add the runtime identifier to KNOWN_AGENTS and also add the unqualified basename as an alias.
   -   3c — Router-rules overlay: If .claude/router-rules.json exists in CWD, read it and merge any custom agent names defined there into KNOWN_AGENTS (these are user-defined aliases the runtime resolves).
   -   3d — Build KNOWN_AGENTS as a sorted set of every discovered name (both unqualified and runtime-namespaced).
   -   3e — Build AGENT_ALIAS_MAP: for every namespaced entry of the form '<plugin>:<name>' where no exact unqualified '<name>' is also present, map '<name>' to '<plugin>:<name>'. Example: if only 'ensemble-full:backend-developer' is present, AGENT_ALIAS_MAP['backend-developer'] = 'ensemble-full:backend-developer'. If 'backend-developer' is present both qualified and unqualified, the unqualified entry wins (no alias needed).
   -   3f — Store KNOWN_AGENTS and AGENT_ALIAS_MAP for the lifetime of the command. Downstream scaffolding and executionContract.agentResolution MUST look up every specialist name in AGENT_ALIAS_MAP before delegating; never pass a bare name to Task() when the runtime accepts only the namespaced form.
   - Step 4 — Installed-plugin detection: for each plugin in marketplace.json derive local path from source field; use Glob to check packages/<name>/ directory; build PREFLIGHT_INSTALLED set
   - Step 5 — Gap analysis: for each TRD domain check if the default agent exists in KNOWN_AGENTS (not in a fresh packages/*/agents/*.yaml glob — use the map built in Step 3); for framework-specific keywords check corresponding skills/ directory under packages/*/skills/ AND '~/.omp/plugins/node_modules/@*/*/skills/*/SKILL.md' plus '~/.omp/plugins/node_modules/*/skills/*/SKILL.md'. This ensures gap analysis reflects the full runtime agent and skill surface, including agents and skills installed via plugins at '~/.omp/plugins/node_modules/@*/*/'.
   - Exclude plugins already in PREFLIGHT_INSTALLED; consolidate multiple gaps pointing to same plugin
   - Context-aware filtering: generic 'test' keyword alone must NOT trigger testing framework suggestions
   - Step 6 — Track declined plugins within this session: build SESSION_DECLINED_PLUGINS set (empty at start)
   - Step 7 — For each gap suggestion (excluding SESSION_DECLINED_PLUGINS):
   -   If AskUserQuestion is available: present yes/no prompt with plugin name, description, rationale, agents/skills provided
   -   If user approves: run 'claude plugin install <plugin_name>' via Bash; verify packages/<name>/ directory created
   -   If user declines: add to SESSION_DECLINED_PLUGINS (do not re-suggest during this session)
   -   If non-interactive: log suggestion as [INFO] and skip all installations
   - Step 8 — If any plugins were installed:
   -   Re-run the full agent and skill discovery from Step 3 in order: re-glob packages/*/agents/*.yaml (3a), re-glob '~/.omp/plugins/node_modules/@*/*/agents/*.md' AND '~/.omp/plugins/node_modules/*/agents/*.md' (3b), re-merge .claude/router-rules.json (3c), re-dedupe KNOWN_AGENTS (3d), and rebuild AGENT_ALIAS_MAP (3e). Newly installed plugins expose runtime agent identifiers that source-only scanning cannot see.
   -   Log: 'Newly installed agents now available in registry: <agent names>'
   - Step 9 — If user declines all suggestions: proceed with existing KNOWN_AGENTS / AGENT_ALIAS_MAP from Step 3

**13. Traceability Validation Gate**
   Run validate-requirements as an automatic preflight gate before scaffolding begins.
Checks that PRD requirements have TRD task coverage, that [satisfies] annotations
reference real REQ-NNN IDs, and that every user-facing task has a paired -TEST task.
Errors (orphaned annotations) halt execution; warnings are printed but do not halt.
Skipped if TRD has no [satisfies] annotations (legacy TRD without traceability).


   - Step 1 — Check for traceability annotations: scan TRD content for any '[satisfies REQ-' token
   - If NO [satisfies REQ-] annotations found: print 'NOTE: TRD has no [satisfies] annotations — skipping traceability validation (legacy TRD). Run /create-trd to regenerate with traceability.'; skip remaining steps
   - Step 2 — Locate PRD reference: search TRD for PRD path using priority order: (1) docs/PRD/*.md link (most specific), (2) 'Based on PRD: <path>', (3) 'PRD: <path>'. After extracting a candidate path, verify it looks like a file path (contains '/' or ends in '.md') before setting PRD_PATH.
   - If PRD path found: set PRD_PATH to that path
   - If PRD path NOT found: print 'WARNING: No PRD reference found in TRD — skipping traceability validation. Add a PRD reference to enable this gate.'; skip remaining steps
   - Verify PRD_PATH exists on disk. If not: print 'WARNING: PRD file not found at <PRD_PATH> — skipping traceability validation. Fix the PRD path in the TRD.'; skip remaining validation steps and proceed to Scaffold.
   - Step 3 — Run validation: invoke the validate-requirements logic inline (do not spawn a new agent):
   -   a. Parse PRD_PATH for all REQ-NNN IDs and AC-NNN-M IDs — build PRD_REQUIREMENTS map
   -      If PRD_REQUIREMENTS is empty AND PRD file is non-empty: print 'WARNING: PRD parsed but no REQ-NNN headings found — PRD may use a different format. Skipping validation.' Skip remaining validation steps and proceed to Scaffold.
   -   b. Parse TRD for all [satisfies REQ-NNN], [verifies TRD-NNN], and Validates PRD ACs: fields — build TRD_TASKS map
   -      If TRD_TASKS is empty AND TRD is non-empty: print 'WARNING: TRD parsed but no [satisfies] annotations found — TRD may use a different format. Skipping validation.' Skip remaining validation steps and proceed to Scaffold.
   -   c. Check coverage: for each PRD REQ-NNN, check if any TRD task has [satisfies REQ-NNN]; collect UNCOVERED as WARNING
   -   d. Check orphans: for each [satisfies REQ-NNN] in TRD, check if REQ-NNN exists in PRD; collect ORPHANED as ERROR
   -   e. Check test pairs: for each impl task with [satisfies REQ-NNN] (not INFRA/ARCH), check if <task-id>-TEST exists; collect MISSING_TESTS as WARNING
   -   f. AC reference check: for each task in TRD with 'Validates PRD ACs:' field, check if each AC-NNN-M exists in PRD_REQUIREMENTS (i.e., in the flat set of AC-NNN-M IDs extracted from the PRD); collect INVALID_AC_REFS as WARNING
   - Step 4 — Print validation report:
   -   Print '=== TRACEABILITY VALIDATION ==='
   -   Print each WARNING (uncovered reqs, missing -TEST pairs)
   -   Print each ERROR (orphaned annotations)
   -   Print '=============================='
   - Step 5 — HALT decision: if any ERRORS (orphaned annotations) found:
   -   Print 'ERROR: Traceability validation failed. Fix orphaned [satisfies] annotations in TRD before implementing.'
   -   Print 'Run /ensemble:validate-requirements <prd-path> <trd-path> for details.'
   -   HALT
   -   Note: No beads were created. No git operations were performed. Plugin installations from this session are permanent. Re-run after fixing the TRD annotations.
   - Step 6 — If only WARNINGs (no errors): print 'Traceability warnings found but continuing. Address before closing implementation. Run /ensemble:validate-requirements <PRD_PATH> <TRD_PATH> at any time to review warnings.' and proceed to Scaffold

### Phase 2: Scaffold

**1. TRD Parsing and Scaffold Specialist Boundary**
   Parse TRD into structured phases and tasks; reserve scaffold work for beads-scaffold-specialist semantics

   - Scaffold ownership: all hierarchy/dependency planning and br/bv scaffold mutations in this phase use beads-scaffold-specialist semantics, not backend-developer. If delegating scaffold/audit/repair work to Task(), resolve and use @beads-scaffold-specialist (or namespaced equivalent such as ensemble-full:beads-scaffold-specialist). Do not delegate scaffold planning to backend-developer, and do not implement product code during Scaffold.
   - Run: node "$TRD_CLI" parse "<TRD_FILE_PATH>" and parse the JSON from stdout. This is the AUTHORITATIVE parse — do NOT hand-parse the TRD. From trd: set TRD_TITLE=trd.title, TRD_SUMMARY=trd.summary, PR_FORMAT=trd.prFormat, TRD_SLUG=trd.slug, PHASES=trd.phases (each {n,title,shippableState,taskIds}), and PHASE_SHIPPABLE_STATE[n]=phase.shippableState. Build TASK_TRACEABILITY from trd.tasksById — each task provides id, isTest (is_test_task), satisfies (satisfies_req_id = satisfies[0]), verifies (verifies_task_id), validatesAcs, dependsOn, targetFiles, actions, implementationAc, testAc, nestedSubitems, testSubitems, proofOfRequirement. Print each trd.warnings entry. If ok is false or the process exits non-zero: print the error and HALT.

**2. Idempotency Cache**
   Cache existing beads to enable partial scaffold resume via title-prefix matching

   - Run: br list --status=open --json (capture full JSON output once)
   - Parse JSON array of bead objects with .id and .title fields
   - Build EXISTING_BEADS map by matching title prefixes: [trd:<TRD_SLUG>] for epic, [trd:<TRD_SLUG>:pr:<N>] OR [trd:<TRD_SLUG>:phase:<N>] for stories (both accepted to support cross-session resume across format migrations), [trd:<TRD_SLUG>:task:<ID>] for tasks
   - Map key is the title prefix pattern, value is the bead .id
   - Use this cache for all 'already exists' checks during scaffold — do not re-query per bead

**3. Root Epic Creation**
   Create the top-level epic bead for the TRD

   - If COMBINED_WORKSTREAM_MODE=true: run node "$TRD_CLI" workstream-plan <SOURCE_TRD_PATHS...>$( [ "$ENSEMBLE_USE_STACKED_PRS" = true ] && echo ' --stacked' ) and parse {ok,workstreamSlug,releaseTrain,trdEpics,scaffoldPlans,crossTrd}. If ok is false, process exits non-zero, or JSON is malformed: print each ambiguity/conflict and HALT with instructions to edit source TRDs or rerun after choosing explicit source-qualified dependencies; do not guess or create affected dependency edges. Store WORKSTREAM_PLAN, WORKSTREAM_SLUG, RELEASE_TRAIN_ID=releaseTrain.id, RELEASE_TRAIN_TITLE=releaseTrain.title, CROSS_TRD_DEP_COUNT=crossTrd.edges.length, TRD_TASK_COUNTS={slug: plan.tasks.length + plan.synthesizedTests.length}, and initialize GLOBAL_BEAD_MAP={} for every titlePrefix -> bead ID across all TRDs. Create or reuse releaseTrain first using releaseTrain.title/type/priority/description with the same idempotency rules as normal beads. Then create/reuse one TRD root epic per trdEpics entry, then execute each scaffoldPlans[n].plan using the existing single-TRD PLAN executor while adding every created/reused epic/story/task/synth titlePrefix to GLOBAL_BEAD_MAP. Preserve each TRD-local PR/story/task hierarchy under its TRD epic.
   - If COMBINED_WORKSTREAM_MODE=false: run node "$TRD_CLI" scaffold-plan "<TRD_FILE_PATH>" and parse {ok, slug, plan}. If ok is false or the process exits non-zero: print the error and HALT (do NOT proceed to br create with an undefined PLAN). PLAN is AUTHORITATIVE for every bead's title, description, type, priority and for all dependency edges across the next steps (Root Epic, Story, Task, Synthesized Test, Dependency Encoding). Each step below EXECUTES the relevant part of PLAN via br — it must NOT re-derive titles/descriptions/prefixes. Print each PLAN.warnings entry. Idempotency: before each br create, still check EXISTING_BEADS for the bead's titlePrefix and skip if present.
   - Check EXISTING_BEADS for title prefix [trd:<TRD_SLUG>]
   - If found: ROOT_EPIC_ID = existing id; skip creation
   - If not found: run br create using PLAN.epic fields verbatim — --title='<PLAN.epic.title>' --type=<PLAN.epic.type> --priority=<PLAN.epic.priority> --description='<PLAN.epic.description>' --json. PLAN.epic.title already includes the [trd:<TRD_SLUG>] titlePrefix; do NOT re-derive or re-prefix the title/description inline; use PLAN.epic.
   - Capture ROOT_EPIC_ID by parsing .id field from JSON response
   - HALT if exit code != 0 or ROOT_EPIC_ID empty

**4. Story Bead Creation**
   Create one story bead per TRD phase under the root epic

   - For each entry in PLAN.stories (indexed by phaseN): check EXISTING_BEADS for the entry's titlePrefix (PLAN.stories[i].titlePrefix, e.g. [trd:<TRD_SLUG>:pr:<n>] or [trd:<TRD_SLUG>:phase:<n>])
   - If found: STORY_BEAD_IDs[phaseN] = existing id; skip creation
   - If not found: run br create using PLAN.stories[i] fields verbatim — --title='<PLAN.stories[i].title>' --type=<PLAN.stories[i].type> --priority=<PLAN.stories[i].priority> --description='<PLAN.stories[i].description>' --json. PLAN.stories[i].title already includes the titlePrefix and shippable state is already folded into description by PLAN; do NOT re-derive bead_prefix/label/shippable_line inline — use PLAN.stories[i].
   - Capture STORY_BEAD_ID by parsing .id from JSON response; record STORY_BEAD_IDs[PLAN.stories[i].phaseN] = STORY_BEAD_ID
   - Do NOT wire the story-blocks-epic dependency here — the story-blocks-epic edge is in PLAN.deps and is executed once in the Dependency Encoding step (avoid double-wiring).
   - HALT if any creation fails

**5. Task Bead Creation**
   Create one task bead per TRD task under its phase story with full description from TRD actions

   - For each entry in PLAN.tasks (each has id, phaseN, titlePrefix, title, type, priority, description, isTest): check EXISTING_BEADS for the entry's titlePrefix ([trd:<TRD_SLUG>:task:<id>])
   - If found: TASK_BEAD_IDs[i][j] = existing id; record in TRD_TO_BEAD_MAP; skip creation
   - If not found: run br create using PLAN.tasks[j] fields verbatim — --title='<PLAN.tasks[j].title>' --type=<PLAN.tasks[j].type> --priority=<PLAN.tasks[j].priority> --description='<PLAN.tasks[j].description>' --json. PLAN.tasks[j].title already includes the [trd:<TRD_SLUG>:task:<id>] titlePrefix, and PLAN.tasks[j].description is the AUTHORITATIVE structured description (impl vs test classification, target files, actions, AC checklists, sub-items, embedded tests, dependencies are all already folded in by PLAN). Do NOT re-derive the description/title inline — use PLAN.tasks[j].
   - BDD preservation (isTest=true tasks): PLAN.tasks[j].description for a TRD-NNN-TEST task is built by scaffold-planner.js's buildTestTaskDescription, which already serializes task.testAc verbatim under a `Test AC:` section and task.validatesAcs under `PRD ACs Proven:` -- this is how the Scenario checklist items from create-trd's BDD Test Task Generation phase (one `- [ ] Scenario: ...` per AC-NNN-M, written under the task's `Test AC:` label so the TRD parser's labeled-checklist extractor captures it) reach the bead body. Do not move Scenario content to an unparsed heading. Whichever specialist later picks up this bead must, before writing any binding: resolve REQNROLL_CLI (packages/product/lib/reqnroll-cli.js), run `generate-bindings <PRD_PATH> --out tests --sut <SUT_CSPROJ> --json` to scaffold the Test AC scenarios, confirm RED, delegate to reqnroll-binding-specialist to fill bodies test-first (packages/reqnroll/skills/reqnroll/SKILL.md), and re-confirm RED before the paired TRD-NNN implementation bead is allowed to close it to GREEN -- same contract as implement-trd-task.yaml Execute Step 1a-1c.
   - Capture TASK_BEAD_ID by parsing .id from JSON response
   - Do NOT wire the task-blocks-story dependency here — the task-blocks-story edge is in PLAN.deps and is executed once in the Dependency Encoding step (avoid double-wiring).
   - Record TRD_TO_BEAD_MAP[PLAN.tasks[j].id] = bead_id for each task
   - Record PHASE_TASK_IDS[PLAN.tasks[j].phaseN]: append PLAN.tasks[j].id to the list for that task's phase (phaseN comes from PLAN). PHASE_TASK_IDS is the AUTHORITATIVE task→phase membership for Phase Completion Detection and the phase-strict execution guard. Task bead titles carry no phase/pr segment, so membership must come from this map (or, on resume, from each story bead's dependency children).

**6. Synthesized Test Bead Creation for Nested Test Sub-items**
   Promote nested test sub-items (test checklist items lacking their own TRD-NNN-TEST id) into first-class, dependency-wired test beads so they are tracked and implemented

   - For each entry in PLAN.synthesizedTests (each has id, parentId, phaseN, titlePrefix, title, type, priority, description, verifies, satisfies):
   -   Check EXISTING_BEADS for the entry's titlePrefix ([trd:<TRD_SLUG>:task:<id>]); if found: TRD_TO_BEAD_MAP[id] = existing id; skip creation
   -   If not found: run br create using PLAN.synthesizedTests[k] fields verbatim — --title='<PLAN.synthesizedTests[k].title>' --type=<PLAN.synthesizedTests[k].type> --priority=<PLAN.synthesizedTests[k].priority> --description='<PLAN.synthesizedTests[k].description>' --json; capture SYNTH_BEAD_ID from .id. The title already includes the titlePrefix and the description is AUTHORITATIVE — do NOT re-derive synth_id/description inline; use PLAN.synthesizedTests[k].
   -   Do NOT wire the synth dependencies here — the synthtest-depends (parent impl task blocks synth) and task-blocks-story edges for synthesized tests are in PLAN.deps and are executed once in the Dependency Encoding step (avoid double-wiring).
   -   Set TASK_TRACEABILITY[PLAN.synthesizedTests[k].id] = {is_test_task: true, verifies_task_id: PLAN.synthesizedTests[k].verifies, satisfies_req_id: PLAN.synthesizedTests[k].satisfies[0], validates_acs: <parent validates_acs>, synthesized: true}
   -   Record TRD_TO_BEAD_MAP[PLAN.synthesizedTests[k].id] = SYNTH_BEAD_ID
   - Log: 'Synthesized <count> test bead(s) from nested test sub-items: <synth id list>'
   - If PLAN.synthesizedTests is empty: skip this step (no synthesized test beads created).

**7. Dependency Encoding**
   Wire explicit TRD dependencies between tasks, stories, and the epic

   - REPAIR: Remove stale inter-phase-gate edges from a previous scaffold run. These are task→task deps of the form: 'first task of phase N' depends on 'last task of phase N-1'. If PHASE_TASK_IDS is empty, rebuild it from PLAN.tasks: for each task in PLAN.tasks, append its id to PHASE_TASK_IDS[task.phaseN]; for each synth in PLAN.synthesizedTests, append its id to PHASE_TASK_IDS[synth.phaseN]. Then for each phase N >= 2: let lastPrev = last id in PHASE_TASK_IDS[N-1]; let firstCur = first id in PHASE_TASK_IDS[N]; let lastPrevBead = TRD_TO_BEAD_MAP[lastPrev]; let firstCurBead = TRD_TO_BEAD_MAP[firstCur]; if both are non-empty: run br dep remove <firstCurBead> <lastPrevBead> (suppress stderr / ignore 'edge not found'; the dep may or may not exist from the prior scaffold). Print 'Removed stale inter-phase-gate dep: <lastPrevBead> → <firstCurBead>' when removed, or 'No stale inter-phase-gate dep to remove.' when absent.
   - PLAN.deps (from the scaffold-plan call in Root Epic Creation) is the AUTHORITATIVE, complete set of dependency edges: story-blocks-epic, task-blocks-story, task-depends (explicit dependsOn), and synthtest-depends. Each edge is {type, blockerId, blockedId} where blockerId/blockedId are TITLE PREFIXES and 'blocker blocks blocked'.
   - For each edge in PLAN.deps: resolve blockerId and blockedId (title prefixes) to real bead ids — [trd:<TRD_SLUG>] -> ROOT_EPIC_ID; [trd:<TRD_SLUG>:pr:<n>] or [trd:<TRD_SLUG>:phase:<n>] -> STORY_BEAD_IDs[n]; [trd:<TRD_SLUG>:task:<id>] -> TRD_TO_BEAD_MAP[id]. Then run `br dep add <blocked_bead_id> <blocker_bead_id>` (blocker blocks blocked). If the exact edge already exists, skip as no-op. Warn and skip any edge whose blockerId or blockedId cannot be resolved to a bead id.
   - If COMBINED_WORKSTREAM_MODE=true: also execute WORKSTREAM_PLAN.deps and crossTrd.edges after local PLAN.deps. Resolve every blockerId and blockedId through GLOBAL_BEAD_MAP (populated during release-train, TRD epic, story, task, and synthesized-test creation). For each crossTrd edge, run `br dep add <blocked_bead_id> <blocker_bead_id>` and add metadata comment '<edge.metadata>' to the blocked bead. If br reports a cycle or contradictory direction, print the exact edge and ask user to choose one of: retry (rerun the same br dep add after user manually fixes graph state), skip (record a skipped-edge comment and continue), reverse (swap blocker_bead_id and blocked_bead_id, show the reversed command, require explicit confirmation, then run once), or abort.
   - Ensure PHASE_TASK_IDS is populated for the quality gate: it is built from PLAN (phaseN per task) in Task Bead Creation; if empty here (e.g. all task beads already existed), rebuild PHASE_TASK_IDS[phaseN] by appending each PLAN.tasks[j].id and each PLAN.synthesizedTests[k].id under its phaseN.

**8. BV Execution Planning**
   Run bv --robot-plan and --robot-triage for graph-aware execution planning

   - Run: br sync --flush-only (ensure JSONL is current before any bv call)
   - If BV_AVAILABLE == true:
   -   Run: PLAN_OUTPUT=$(bv --robot-plan --format toon) — capture parallel execution tracks
   -   Parse PLAN_OUTPUT to extract parallel tracks (track numbers, task lists per track)
   -   Store PARALLEL_TRACKS for use in wheel instructions
   -   On bv failure (non-zero exit OR malformed TOON output): print 'ERROR: bv --robot-plan failed' with captured diagnostics and HALT — bv is the required scheduler, there is no sequential-fallback path (contract: bv is required, line 122 of this skill; install bv from https://github.com/Dicklesworthstone/beads_viewer).
   -   Run: INSIGHTS_OUTPUT=$(bv --robot-insights --format toon) — capture graph health. Parse INSIGHTS_OUTPUT with explicit text patterns: cycles if /cycle|cycles/i and not /cycles:\s*none/i; unexpected blockers if /unexpected blocker|stale blocker|blocked by closed|missing blocker/i; priority/order mismatches if /priority.*mismatch|order.*mismatch|contradict|inversion/i. If cycles are detected: print the matching lines and HALT before execution until the user fixes dependencies or reruns refine-beads. If only unexpected blockers or priority/order mismatches are detected: print matching lines and ask user to continue, run /ensemble:refine-beads, or abort; continue only on explicit user approval. Never invoke bare bv; only --robot-* flags.
   -   Run: TRIAGE_OUTPUT=$(bv --robot-triage --format toon) — capture triage analysis
   -   Parse TRIAGE_OUTPUT to extract: quick_ref, recommendations (ranked list with scores), quick_wins, blockers_to_clear
   -   Store TRIAGE_RECOMMENDATIONS for use in wheel instructions
   -   On bv failure: echo 'WARNING: bv --robot-triage failed.'; continue without triage data
   - If BV_AVAILABLE == false: print 'ERROR: bv (beads_viewer) is required (contract: bv is required, line 122 of this skill). Install bv from https://github.com/Dicklesworthstone/beads_viewer and retry.' and HALT — the no-fallback contract forbids br-only sequential execution order.

**9. Scaffold Summary and BV Analysis**
   Print scaffolding summary with BV analysis output

   - Print scaffolding summary: epic ID, story count, task count, dep count
   - If COMBINED_WORKSTREAM_MODE=true: always print PR strategy ('Combined workstream mode: stacked PRs enabled' when STACKED_PRS=true, otherwise 'Combined workstream mode: single PR mode'). Print RELEASE_TRAIN_ID/RELEASE_TRAIN_TITLE, all source TRD epics from WORKSTREAM_PLAN.trdEpics, per-TRD task counts from TRD_TASK_COUNTS, and CROSS_TRD_DEP_COUNT.
   - Run: br list --status=open for summary overview
   - Run: br sync --flush-only (final sync after all scaffold mutations)
   - If BV_AVAILABLE == true:
   -   Print section: === BV ANALYSIS ===
   -   Print PARALLEL EXECUTION TRACKS with parsed track data from PLAN_OUTPUT
   -   Print TRIAGE RECOMMENDATIONS with top recommendations from TRIAGE_OUTPUT
   -   Print QUICK WINS from TRIAGE_OUTPUT quick_wins section
   -   Print BLOCKERS TO CLEAR from TRIAGE_OUTPUT blockers_to_clear section
   - If BV_AVAILABLE == false: print 'BV analysis unavailable. Install bv from https://github.com/Dicklesworthstone/beads_viewer — the no-fallback contract (bv is required, line 122) forbids br-only execution order.'

**10. Wheel Instructions Output**
   Print execution instructions for multi-agent parallel implementation. AC: FR-WI-1, FR-WI-2, FR-WI-3, FR-WI-4, AC-WI-1, AC-WI-2

   - Print the following execution instructions:
   -   ================================================================
   -   EXECUTION INSTRUCTIONS
   -   ================================================================
   -   Use /ensemble:implement-trd-beads --execute or bv --robot-plan to drive parallel implementation.
   -   Each bead runs through: Explorer → Developer → QA → Reviewer → Finalize
   -   ----------------------------------------------------------------
   -   PREREQUISITES (run once):
   -     br list --status=open              # Sanity check that br works
   -   ----------------------------------------------------------------
   -   RUN (dispatches agents to all ready beads):
   -     /ensemble:implement-trd-beads --execute
   -     # Or drive manually: bv --robot-plan (repeat until epic is complete)
   -     # Reads bv --robot-plan tracks, assigns to agents, runs pipeline,
   -     # merges completed branches, and closes beads automatically.
   -   ----------------------------------------------------------------
   -   MONITOR:
   -     br list --status=in_progress       # Live bead status
   -   ----------------------------------------------------------------
   -   DEBUG:
   -     br get <bead-id>                   # Inspect a specific bead
   -   ----------------------------------------------------------------
   -   MERGE:
   -     git town propose                   # Propose PR for feature branch
   -   ================================================================
   - If BV_AVAILABLE == true: also print the BV analysis from Scaffold Step 7 (parallel tracks and triage recommendations) above the execution instructions as planning context.
   - If PLAN_ONLY=true: print 'Plan complete. Bead hierarchy created. Run /ensemble:implement-trd-beads --execute to begin implementation.' and EXIT. Do not enter Execute phase.
   - TIP: You can also run /ensemble:beads-plan <ROOT_EPIC_ID> at any time to regenerate bv analysis and execution instructions without re-running TRD scaffold.

### Phase 3: Execute

**1. Delegate to beads-build**
   Run /ensemble:beads-build with the current TRD root epic and --trd flag. The standalone beads-build command implements the canonical dispatch loop (bv --robot-plan scheduler + parallel track execution + barrier-and-replan). implement-trd-beads delegates to it so there is exactly one execution engine. AC: FR-GD-1, FR-GD-2, FR-GD-3, AC-TD-3, AC-BC-1

   - TRD-019 — Debug Loop integration: any uncaught error from the delegated beads-build invocation must be surfaced back here as a Debug Loop entry. Debug Loop is the only allowed path for halting execution mid-TRD; do NOT add new halt paths.
   - Print: '=== DELEGATING EXECUTION TO BEADS-BUILD ==='
   - Print: '  TRD: <TRD_FILE_PATH>'
   - Print: '  Root epic: <ROOT_EPIC_ID>'
   - Print: '  Max parallel: <max_parallel>'
   - Determine MAX_PARALLEL: if --max-parallel was passed as an argument, use that value; else if the TRD frontmatter sets max_parallel, use that value; else default to 3.
   - Determine TEAM_ROLES_JSON: if a parsed/default teamRoles object is already in scope from Team Configuration Detection, serialize that object as compact JSON and use it; else if --builder was passed as an argument or the TRD frontmatter sets builder_agent, synthesize a DEPRECATED compatibility roster {lead:{agents:['tech-lead-orchestrator'],owns:['planning','escalation']},builder:{agents:[<builder-override-or-frontmatter>],owns:['implementation']},architect:{agents:['architect'],owns:['task-design']},documentation:{agents:['documentation-specialist'],owns:['pr-boundary-doc-maintenance']}} and serialize it; else synthesize the same compatibility roster with builder=['tech-lead-orchestrator']. This deprecated synthesis path remains for one minor version only.
   - Verify prerequisites are ready: TASK_TRACEABILITY is non-empty (built during Scaffold) and ROOT_EPIC_ID is set; if either is missing, HALT with 'ERROR: Cannot delegate to beads-build — <field> missing. Re-run from Scaffold phase or pass --trd explicitly.'
   - Run the delegated command via the agent harness: invoke /ensemble:beads-build with arguments: <ROOT_EPIC_ID> --trd <TRD_FILE_PATH> --max-parallel <MAX_PARALLEL> --team-roles '<TEAM_ROLES_JSON>' --label <TRD_LABEL>
   -   Equivalent shape for environments without native slash-command dispatch (e.g. Pi/OMP): invoke the ensemble-beads-build skill directly (it is Pi-wrapped) with the same arguments: --epic <ROOT_EPIC_ID> --trd <TRD_FILE_PATH> --max-parallel <MAX_PARALLEL> --team-roles '<TEAM_ROLES_JSON>' --label <TRD_LABEL>. Keep --builder as a deprecated fallback accepted by beads-build for one minor version; there is no standalone packages/development/bin/implement.js CLI binary — do not reference one; it has never existed in this repo.
   - If the delegated invocation returns non-zero exit code: capture stderr/stdout, surface as Debug Loop entry per TRD-019, then HALT.
   - If the delegated invocation returns zero: read its stdout for the final completion summary (bead counts, branch state, last task closed). Persist TASK_CLOSED_IDS from the summary into this command's state so Quality Gate and Completion phases can reuse it.
   - Note: bv --robot-triage may still be run separately for project-wide graph insight, but its counts are GLOBAL across all epics/TRDs and must never be presented as this TRD's progress.

### Phase 4: Quality Gate

**1. Phase Completion Detection**
   Detect when all tasks in a phase are closed

   - Run: node "$TRD_CLI" phase-status "<TRD_FILE_PATH>" --closed "<comma-joined ids of TRD tasks whose beads are closed>". Parse {ok, currentPhase, phases:[{n,complete}], phaseTaskIds}. If ok is false or the process exits non-zero: print the error and do NOT trigger the quality gate this cycle (treat as 'phase not yet complete' and continue). The phase whose entry has complete=true and equals the just-finished phase is done.
   - When phases[currentPhase] (or the phase just completed) shows complete=true: trigger the quality gate for STORY_BEAD_IDs[that phase]. Until then, do not trigger the gate. (This replaces the old PHASE_TASK_IDS title-filter prose.)

**2. Test Execution**
   Delegate test suite execution to test-runner. Single-agent mode: full unit + integration suite per phase. AC: FR-QA-7

   - Delegate to @test-runner: run full test suite (unit + integration) for files modified in this phase; report pass/fail, unit coverage %, integration coverage %, failures with file:line.
   - Parse results: gate_passed = tests_pass AND unit_cov >= target AND int_cov >= target
   - Exception: strategy=characterization or flexible -> gate_passed = true (informational only)

**3. Gate Result Recording**
   Record quality gate outcome as br comment and close story on pass. PR creation (when
due) branches on PR_BACKEND: 'gh' uses git town propose under BRANCHING_STRATEGY==git-town
(unchanged) or a standalone gh pr create under plain-git; 'ado' prefers the azure-devops
MCP tool's repo_create_pull_request when connected, else prints manual az repos pr
create/portal steps and continues (never HALTs); 'manual' always prints manual
instructions at this phase gate and never attempts automation.


   - Run: br comment add <STORY_BEAD_ID> 'Quality gate result: <PASS|FAIL> | unit: <X%> | integration: <Y%> | strategy: <strategy>'
   - Run: br sync --flush-only
   - If gate_passed: br close <STORY_BEAD_ID> --reason='<bead_label> <N> complete - quality gate passed'; br sync --flush-only; git commit -m 'chore(<bead_prefix> <N>): checkpoint (tests pass; unit <X%>, int <Y%>)'
   - PR sequencing is driven by GATE_ACTION = PR_ACTIONS[N] (the phase-gate entry for the just-completed phase N, from the pr-plan call in Feature Branch Creation). GATE_ACTION provides createPr, proposeTitle, branch, parentBranch, appendNextBranch, and shippableState. Use these instead of re-deriving branch names, titles, or the create-vs-skip decision.
   - If gate_passed AND GATE_ACTION.createPr == true: Pre-PR test gate — run 'npm run test --workspaces --if-present'. If exit code != 0: print 'ERROR: Local tests failed — PR creation blocked. Fix failing tests and re-run the quality gate to retry.' and HALT. If exit code == 0: print 'Pre-PR test gate: PASSED — proceeding with PR creation.'
   - If gate_passed AND GATE_ACTION.createPr == true: shippable = GATE_ACTION.shippableState if set else 'See TRD for scope'; PR_BODY = '<PR/Phase <N> of TRD <TRD_SLUG>.\n**Shippable:** <shippable>\nStrategy: <strategy>. Tasks: <completed_task_ids>. Unit: <X>%, Integration: <Y>%. Bead: <STORY_BEAD_ID>.>'. Branch on PR_BACKEND:
   -   PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='git-town' [UNCHANGED]: ensure currently checked out on GATE_ACTION.branch (git switch GATE_ACTION.branch if needed); run git town propose --title '<GATE_ACTION.proposeTitle>' --body '<PR_BODY>'; record PR URL from output as PHASE_PR_MAP[N]; print 'PR <N> created: <PR_URL>'.
   -   PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='plain-git': ensure currently checked out on GATE_ACTION.branch (git switch GATE_ACTION.branch if needed); run git push -u origin <GATE_ACTION.branch>, then run gh pr create --title '<GATE_ACTION.proposeTitle>' --base '<GATE_ACTION.parentBranch or main>' --body '<PR_BODY>' (a standalone gh call, not routed through any git town command); record PR URL from output as PHASE_PR_MAP[N]; print 'PR <N> created: <PR_URL>'.
   -   PR_BACKEND=='ado': ensure currently checked out on GATE_ACTION.branch (git switch GATE_ACTION.branch if needed); run git push -u origin <GATE_ACTION.branch>; scan available tool names for any name starting with 'mcp__azure-devops' (same technique as create-trd.yaml's MCP Enhancement phase, narrowed to the azure-devops server). If found: call its repo_create_pull_request tool with title='<GATE_ACTION.proposeTitle>', source branch=<GATE_ACTION.branch>, target branch=<GATE_ACTION.parentBranch or main>, description=<PR_BODY>; record the returned PR URL as PHASE_PR_MAP[N] exactly as git town propose's output is recorded above; print 'PR <N> created: <PR_URL>'. If NOT found: print 'Azure DevOps MCP tool not connected — create this PR manually:' then 'az repos pr create --source-branch <GATE_ACTION.branch> --target-branch <GATE_ACTION.parentBranch or main> --title "<GATE_ACTION.proposeTitle>"' then 'Or via the portal: Repos > Pull Requests > New Pull Request, source=<GATE_ACTION.branch>, target=<GATE_ACTION.parentBranch or main>'; do NOT HALT, do NOT attempt any other shell-out; PHASE_PR_MAP[N] remains unset; continue to the next phase's tasks.
   -   PR_BACKEND=='manual': print 'PR backend is manual — create this PR yourself:' then 'git push -u origin <GATE_ACTION.branch>' then 'gh pr create --title "<GATE_ACTION.proposeTitle>" --base <GATE_ACTION.parentBranch or main>' (or the ADO CLI/portal equivalent if the remote is Azure DevOps); do NOT push or create the PR automatically; PHASE_PR_MAP[N] remains unset; continue to the next phase's tasks. This prints at EVERY phase gate where a PR is due, not only once at Completion.
   - If gate_passed AND GATE_ACTION.createPr == true AND GATE_ACTION.appendNextBranch is set (more phases remain): NEXT_BRANCH = GATE_ACTION.appendNextBranch; ensure currently checked out on GATE_ACTION.branch (git switch GATE_ACTION.branch if needed); if BRANCHING_STRATEGY=='git-town': run git town append <NEXT_BRANCH> [UNCHANGED]; if BRANCHING_STRATEGY=='plain-git': run git checkout -b <NEXT_BRANCH> (stacked directly off the currently-checked-out GATE_ACTION.branch — the same parent-branch topology git town append would have produced; zero git town commands issued); set CURRENT_PHASE_BRANCH=NEXT_BRANCH; set PHASE_BRANCH_MAP[N+1]=NEXT_BRANCH; print 'Next branch ready: <NEXT_BRANCH> (stacked on phase <N> branch via <BRANCHING_STRATEGY=='git-town' ? 'git town append' : 'git checkout -b'>)'
   - If gate_passed AND GATE_ACTION.createPr == false (STACKED_PRS=false / single-PR mode): do NOT create a PR and do NOT append a branch for this phase. Stay on CURRENT_PHASE_BRANCH (the single TRD branch); the phase checkpoint commit above is retained. Continue to the next phase's tasks. The single PR for the entire TRD is created in the Completion phase per PR_ACTIONS' completion entry.
   - If NOT gate_passed AND blocking strategy (tdd/refactor/bug-fix): print gate failure details; PAUSE for user: fix/skip/abort

### Phase 5: Completion

**1. Completion Verification**
   Independently re-verify completion before any epic closure or completion
messaging. Invokes the completion-verification skill, located at
"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/completion-verification/SKILL.md",
with TRACKING_MODE='beads'.


   - Invoke the completion-verification skill (via the skill system) with TRD_FILE_PATH=<TRD_FILE_PATH>, TRD_SLUG=<TRD_SLUG>, TRACKING_MODE='beads', ROOT_EPIC_ID=<ROOT_EPIC_ID>, TRD_TO_BEAD_MAP=<TRD_TO_BEAD_MAP>.
   - Parse the skill's return value {verdict, gapCount, reportPath}. Store as COMPLETION_VERDICT, COMPLETION_GAP_COUNT, COMPLETION_REPORT_PATH for use by the next two steps and the Completion Report step.
   - If COMPLETION_VERDICT == 'INCOMPLETE': print 'COMPLETION VERIFICATION FAILED: <COMPLETION_GAP_COUNT> gap(s) found. Report: <COMPLETION_REPORT_PATH>'. If AskUserQuestion is available: ask 'Completion verification found <COMPLETION_GAP_COUNT> gap(s) (see <COMPLETION_REPORT_PATH>). Proceed with epic closure anyway?' with options 'Proceed anyway (override)' / 'Stop — fix gaps first'. If the user does not explicitly choose 'Proceed anyway', HALT before Epic Closure — do not close <ROOT_EPIC_ID>, do not sync TRD checkboxes as 'complete', do not print completion messaging. If AskUserQuestion is unavailable (non-interactive): HALT with the same message and require the operator to re-run with an explicit override once gaps are addressed. Set COMPLETION_OVERRIDDEN=true only if the user explicitly chose to proceed anyway.
   - If COMPLETION_VERDICT == 'COMPLETE': print 'Completion verification: PASSED (0 gaps). Report: <COMPLETION_REPORT_PATH>' and continue to Epic Closure.

**2. Epic Closure**
   Close the root epic when all children are done

   - Precondition: only proceed with epic closure if COMPLETION_VERDICT == 'COMPLETE', or COMPLETION_VERDICT == 'INCOMPLETE' AND COMPLETION_OVERRIDDEN == true (explicit user override recorded in the Completion Verification step). Otherwise this step must not run.
   - Verify: run br list --status=open --json filtered by [trd:<TRD_SLUG>:task:] prefix to catch open task beads; also run br list --status=open --json filtered by [trd:<TRD_SLUG>:story:] prefix to catch open story beads (excluding <ROOT_EPIC_ID> itself which is intentionally still open); if any task or story beads remain open, do not close the epic — investigate and resolve first (open beads at this stage indicate incomplete work or a missed Quality Gate). Only <ROOT_EPIC_ID> may remain open.
   - Run: br close <ROOT_EPIC_ID> --reason='TRD implementation complete'
   - Run: br sync --flush-only

**3. TRD Checkbox Sync**
   Update TRD file checkboxes to reflect bead closure state

   - For each task in TRD Master Task List: if TRD_TO_BEAD_MAP[task.id] exists and bead status == 'closed' -> replace '- [ ] **<task.id>**' with '- [x] **<task.id>**'
   - git commit -m 'docs(TRD): sync checkboxes to bead closure state'

**4. Completion Report**
   Print final summary with stacked PR map and next steps. The final PR(s) (single-PR or
per-phase summary) reflect whichever PR_BACKEND was resolved in Preflight: 'gh' (git town
propose under git-town, standalone gh pr create under plain-git), 'ado' (azure-devops MCP
tool when connected, else manual az repos pr create/portal steps), or 'manual' (always
manual instructions, never automated).


   - Print completion report: TRD file, branch, strategy, epic ID, task counts, coverage summary
   - Quickstart generation note: beads-backed quickstart.md generation is intentionally unsupported in v1. If a quickstart.md validation artifact is required, rerun the completed TRD through standard /ensemble:implement-trd (not /ensemble:implement-trd-beads) so the parser-backed quickstart completion hook can write and report it.
   - Print 'Completion verification report (authoritative): <COMPLETION_REPORT_PATH>' — the Requirement Satisfaction Table below is informational/supplementary; the completion-verification skill's report is the authoritative record of gaps.
   - Requirement Satisfaction Table: scan ROOT_EPIC_ID comments for req-verified: tokens
   -   Run: br comment list <ROOT_EPIC_ID>
   -   If br comment list fails or returns non-JSON: print 'WARNING: Could not read root epic comments — req-verified data unavailable. Run /ensemble:requirement-status <TRD_SLUG> to generate the report manually.' Continue with empty VERIFIED_REQS.
   -   Parse each comment for tokens: req-verified:REQ-NNN, by:TRD-NNN-TEST, reviewer:<agent>, ac-proven:AC-NNN-M,...
   -   Build VERIFIED_REQS map: REQ-NNN -> {test_task, reviewer_agent, acs_proven}
   -   If TRD has PRD reference: also load PRD REQ-NNN list for cross-reference (unverified reqs show as NOT VERIFIED)
   -   Print table:
   -     === REQUIREMENT SATISFACTION REPORT ===
   -     REQ-001: SATISFIED (TRD-001-TEST) — ACs: AC-001-1, AC-001-2
   -     REQ-002: NOT VERIFIED (TRD-002-TEST still open)
   -     REQ-003: SATISFIED (TRD-007-TEST) — ACs: AC-003-1, AC-003-2, AC-003-3
   -     TOTAL: <N> satisfied / <M> total requirements
   -     ========================================
   - Run: br sync --flush-only
   - Call trd_progress() (Preflight step 1) with TRD_SLUG for the final TRD-scoped progress summary (expect <TOTAL>/<TOTAL> complete, 100%)
   - Let COMPLETION_ACTION = the PR_ACTIONS entry with kind=='completion' (from the pr-plan call in Feature Branch Creation). If COMPLETION_ACTION.createPr == true (single-PR mode, summaryKind=='single'): Pre-PR test gate — run 'npm run test --workspaces --if-present'; if exit != 0 print 'ERROR: Local tests failed — PR creation blocked. Fix failing tests and re-run.' and HALT. COMPLETION_BODY = 'Implements TRD <TRD_SLUG>. Strategy: <strategy>. <phase_count> phases, <task_count> tasks — all complete. Bead: <ROOT_EPIC_ID>.'. Then branch on PR_BACKEND (matching Gate Result Recording's backend logic exactly):
   -   PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='git-town' [UNCHANGED]: run git town propose --title '<COMPLETION_ACTION.proposeTitle>' --body '<COMPLETION_BODY>'; record the URL as SINGLE_PR_URL.
   -   PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='plain-git': run git push -u origin <COMPLETION_ACTION.branch>, then run gh pr create --title '<COMPLETION_ACTION.proposeTitle>' --base main --body '<COMPLETION_BODY>' (a standalone gh call, not routed through any git town command); record the URL as SINGLE_PR_URL.
   -   PR_BACKEND=='ado': run git push -u origin <COMPLETION_ACTION.branch>; scan available tool names for any name starting with 'mcp__azure-devops'. If found: call its repo_create_pull_request tool with title='<COMPLETION_ACTION.proposeTitle>', source branch=<COMPLETION_ACTION.branch>, target branch=main, description=<COMPLETION_BODY>; record the returned URL as SINGLE_PR_URL. If NOT found: print 'Azure DevOps MCP tool not connected — create this PR manually:' then 'az repos pr create --source-branch <COMPLETION_ACTION.branch> --target-branch main --title "<COMPLETION_ACTION.proposeTitle>"' then 'Or via the portal: Repos > Pull Requests > New Pull Request, source=<COMPLETION_ACTION.branch>, target=main'; do NOT HALT; SINGLE_PR_URL remains unset.
   -   PR_BACKEND=='manual': print 'PR backend is manual — create this PR yourself:' then 'git push -u origin <COMPLETION_ACTION.branch>' then 'gh pr create --title "<COMPLETION_ACTION.proposeTitle>" --base main' (or the ADO CLI/portal equivalent if the remote is Azure DevOps); do NOT push or create the PR automatically; SINGLE_PR_URL remains unset.
   - If COMPLETION_ACTION.createPr == true (single-PR mode): if SINGLE_PR_URL is set: print '=== PR SUMMARY ===' then 'PR: <SINGLE_PR_URL> (branch: <COMPLETION_ACTION.branch> -> main)' then '=================='; remind the user to review and merge it. If SINGLE_PR_URL is unset (manual backend, or ado with the MCP tool absent): print '=== PR SUMMARY ===' then 'PR: not auto-created — see manual instructions printed above (branch: <COMPLETION_ACTION.branch> -> main)' then '=================='. Then SKIP the stacked PR summary below. If COMPLETION_ACTION.createPr == false (STACKED_PRS=true / stacked mode): do nothing here — no single PR applies — proceed directly to the stacked PR summary below.
   - If STACKED_PRS=true: Print stacked PR summary: '=== STACKED PR SUMMARY ===' followed by one line per entry in PHASE_BRANCH_MAP: use label='PR' if PR_FORMAT=true else 'Phase'; if PHASE_PR_MAP[N] is set, print '<label> <N>: <PHASE_PR_MAP[N]> (branch: <PHASE_BRANCH_MAP[N]> -> parent)'; else (PR_BACKEND=='manual', or 'ado' with the MCP tool absent at that phase gate) print '<label> <N>: not auto-created — see manual instructions printed at that phase gate (branch: <PHASE_BRANCH_MAP[N]> -> parent)'; if PR_FORMAT=true AND PHASE_SHIPPABLE_STATE[N] exists, print '  Shippable: <PHASE_SHIPPABLE_STATE[N]>' on the next line; end with '========================'
   - If STACKED_PRS=true: Remind user how each PR/phase was created, per PR_BACKEND: 'gh'+git-town — via git town propose (merge <label> 1 first; git-town auto-retargets subsequent PRs against main after each merge); 'gh'+plain-git — via standalone gh pr create per branch (retarget subsequent PRs manually after each merge — plain git has no auto-retarget); 'ado' — via the azure-devops MCP tool where connected, else created manually per the az repos pr create/portal instructions printed at that phase gate; 'manual' — created manually per the instructions printed at each phase gate. In every case: merge <label> 1 first (it targets main).
   - Remind user: after all PRs merge, run: mv <trd_file> docs/TRD/completed/
   - Remind user: br sync --flush-only && git add .beads/ && git commit -m 'chore: final beads sync'
   - TIP: The execution engine used here is also available standalone as /ensemble:beads-build <epic-id>. Use it to drive any bead hierarchy (not just TRD-generated ones) through the same build pipeline.

## Expected Output

**Format:** Implemented Features with Quality Gates and Beads Tracking

**Structure:**
- **Beads Hierarchy**: Epic + story + task beads in br storage with JSONL export and full dependency graph
- **Feature Branch**: Git feature branch with implementation commits and phase checkpoint commits
- **Closed Beads**: All task and story beads closed with quality gate comments recorded via br comment add
- **TRD Checkboxes**: TRD Master Task List updated with completed checkboxes synced to bead closure state
- **Wheel Instructions**: Printed agentic coding flywheel instructions with NTM spawn commands, agent self-selection loop, mail coordination, and progress monitoring commands
- **BV Analysis**: Captured bv --robot-plan parallel execution tracks and bv --robot-triage scored recommendations (when bv available)
- **Completion Report**: Summary with epic ID, coverage metrics, PR creation reminder, and v1 unsupported quickstart.md note pointing to standard implement-trd
- **Requirement Satisfaction Report**: Table of PRD REQ-NNN requirements with SATISFIED/NOT VERIFIED status, test task references, and proven AC sub-IDs (generated from root epic req-verified comments)

## Usage

```
/ensemble:implement-trd-beads [trd-path] [--plan] [--execute] [--branch=<name>] [--use-current-branch] [--status] [--reset-task TRD-XXX] [--list] [max parallel N] [--foreman]
```
