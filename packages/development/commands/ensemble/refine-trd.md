---
name: "ensemble:refine-trd"
description: "Refine and enhance existing TRD with stakeholder feedback and additional detail"
version: "2.7.0"
category: "planning"
last-updated: "2026-08-22"
model: "opus"
---
<!-- DO NOT EDIT - Generated from refine-trd.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Refine and enhance an existing Technical Requirements Document based on stakeholder
feedback, additional research, or identified gaps. Updates TRD while maintaining
version history, traceability, and Design Readiness scoring.
--foreman also carries an artifact contract: when FOREMAN_ARTIFACT_PATH is set
and non-empty, write the phase report to that exact path (creating parent
directories as needed) IN ADDITION TO any repo-local report this command
already writes -- Foreman computes that path and reads it back to confirm the
phase produced an artifact. Never invent, alter, or relocate the path, and
never treat an unset FOREMAN_ARTIFACT_PATH as an error (outside Foreman
dispatch it is simply absent and behavior is unchanged).

## Arguments

- **`collab`** (boolean, optional, default: `false`): Opt into browser-based collaborative refinement (HTML review with sidebar questions and anchor-linked comments). When true, replaces the terminal AskUserQuestion interview with a local web session; the artifact captured during the session feeds the standard Enhancement phase below. When false (the default), the original terminal-based refinement workflow runs unchanged.
- **`tunnel`** (string, optional, default: `""`): When set to `quick`, exposes the local refinement-review server over a Cloudflare Quick Tunnel (`*.trycloudflare.com`) so a reviewer on a different network can reach the share URL without any account, API token, or DNS change. Requires the `cloudflared` binary on `PATH` (or set `CLOUDFLARED_PATH` to its absolute path). The bootstrap launches `cloudflared` after the local server binds, captures the ephemeral `*.trycloudflare.com` URL, re-mints the share nonce against the tunnel origin, and tears down the tunnel on exit. When empty (the default), the share URL points at the local server and is reachable only from the same machine.
- **`reviewers`** (integer, optional, default: `1`): Number of independent reviewer share URLs to mint for this session. Each URL carries its own single-use 10-minute exchange nonce and authenticates to the same underlying session/document, so multiple stakeholders can open the session simultaneously without colliding. `1` (the default) reproduces the original behavior: a single share URL on the public origin (or local origin when `--tunnel` is not set). Values greater than `1` add `(N - 1)` URLs minted via `server.createShareUrl()`, each bound to the same `publicUrl`. The bootstrap prints one URL per line, numbered `#1` (the original) through `#N` (the additional fan-out URLs). Each reviewer redeems exactly once; the server burns the nonce atomically on first use, so a leaked `#k` URL cannot be replayed by a second reviewer. Typical use: a Tech Lead invites 3-5 reviewers (architect, security, SRE, on-call) to the same refinement session in parallel.
- **`long-lived`** (boolean, optional, default: `false`): Long-lived review session: a single invite URL with a 6-hour TTL that any number of reviewers can exchange (no nonce burn, no fan-out). QuickTunnel is implicit — `cloudflared` is launched automatically so the invite URL works across networks without a Cloudflare account. Reviewers identify themselves with a display name (no uniqueness check, no provider login) before the document UI is served. Presence (who is currently viewing) is surfaced to other reviewers in real time. Completion terminates the listener so the port does not stay bound. Mutually exclusive with `--reviewers N` (a long-lived session already accepts arbitrary reviewers via one reusable invite URL). `--long-lived` implies `--tunnel=quick`; do not pass a separate `--tunnel` value with this flag.
- **`ttl`** (string, optional, default: `"6h"`): Long-lived session lifetime as a duration string (e.g. `6h`, `12h`, `1d`). Parsed by the bootstrap to milliseconds; the minimum accepted value is `6h` and the default is `6h`. Only used when `--long-lived` is set; ignored otherwise.
- **`foreman`** (boolean, optional, default: `false`): Run in Foreman-native non-interactive mode -- skip the terminal interview/Synthesis selection step and automatically apply all findings/[NEEDS CLARIFICATION: ...] resolutions using best-effort defaults instead of waiting for the user to select which findings to apply. Mutually exclusive with --collab (which requires a human reviewer) -- passing both HALTs with an error. For automated Foreman orchestration. When --foreman is present and the FOREMAN_ARTIFACT_PATH environment variable is set and non-empty, write the phase report to that exact path (creating parent directories as needed) IN ADDITION TO any repo-local report this command already writes. Foreman computes that path and reads it back to confirm the phase produced an artifact; writing only to a repo-local convention leaves Foreman with no artifact. Never invent, alter, or relocate the path. Never treat an unset FOREMAN_ARTIFACT_PATH as an error — outside Foreman dispatch it is simply absent, and behavior must be unchanged.

## Workflow

### Phase 1: Collaborative Review

**1. Session Bootstrap**
   GUARD: If BOTH `--collab` and `--long-lived` are absent from
$ARGUMENTS, skip this entire step and proceed directly to Phase 2
(TRD Review). Do not bootstrap a session, do not start a server,
do not block on an artifact. All other steps in this phase are
likewise skipped because the phase contains only this step.
Bootstrap a refinement-review session for collaborative editing of
the TRD, then wait for the reviewer to mark it complete in the
browser. The resulting artifact is the input to Enhancement.

1. Resolve the TRD path from $ARGUMENTS (first non-flag token).
2. Generate 5–10 refinement questions drawn from the TRD content.
   Each question MUST have this shape:
   ```js
   {
     id: 'q-<short-kebab>',
     prompt: '<multi-line question shown to reviewer>',
     context: '<why this question matters, cited from TRD>',
     targetAnchor: { lineStart: <1-based>, lineEnd: <1-based, inclusive> },
     options: [
       { id: '<option-kebab>', label: '<short verb phrase>',
         description: '<one-sentence clarification>' },
       // 2–5 total, mutually exclusive
     ],
     recommendedOptionId: '<one of the option ids>',
   }
   ```
   - For each `[NEEDS CLARIFICATION]` marker present, add a question
     whose `context` quotes the marker text verbatim.
   - Add a "top N gaps" question inferred from the Design Readiness
     summary (missing AC traceability, missing [satisfies REQ-NNN],
     orphan hour estimates, forward dependencies in PR stack, etc.).
   - `targetAnchor.lineStart`/`lineEnd` MUST point at the smallest
     line range in the TRD that the reviewer should focus on. For
     metadata-level questions (frontmatter, Design Readiness Score),
     use `{lineStart: 1, lineEnd: <first heading> + 1}`.
   - `options` is REQUIRED for collab. Provide 2–5 mutually
     exclusive options. Always include an option labeled
     "Skip — leave as-is" / "No — leave unchanged" as the last
     choice so the reviewer can opt out per question.
   - `recommendedOptionId` MUST be the `id` of the option you
     want to default-select. Always pick the option you would
     apply if the reviewer hit Save immediately.
3. Pick a session file path under a cache directory returned by
   `getLogsPath()` or equivalent (gitignored). The bootstrap script
   is generated outside the PI package's install directory, so plain
   `require('@sunstone-partners/ensemble-core')` will fail with
   `Cannot find module` — Node's caller-relative `node_modules`
   search does not walk back to the PI package's `node_modules`.
   **Anchor all package imports to the installed PI package's
   `package.json` via `createRequire`.** The bootstrap script
   resolves the PI package at runtime from well-known install
   locations (an explicit `ENSEMBLE_PI_INSTALL_ROOT` env var is
   honored for the packed-install test; the OMP plugin root and
   the current working directory are the production fallbacks):
   ```js
   const { createRequire } = require('module');
   const path = require('path');
   const os = require('os');
   const PI_PKG_JSON = require.resolve(
     '@sunstone-partners/ensemble-pi/package.json',
     {
       paths: [
         process.env.ENSEMBLE_PI_INSTALL_ROOT,
         path.join(os.homedir(), '.omp', 'plugins'),
         process.cwd(),
       ].filter(Boolean),
     },
   );
   const piRequire = createRequire(PI_PKG_JSON);
   const { refinementReview } = piRequire('@sunstone-partners/ensemble-core');
   ```
   Call
   `refinementReview.session.migrateOrCreate({ sessionPath, kind: 'trd', sourcePath, questions, reopen: true })`,
   where `migrateOrCreate` returns `{ session, token }` synchronously.
   It loads any prior session file at `sessionPath`; if the prior
   session was already completed (frozen by a prior `/api/complete`
   call), `reopen: true` clears `completedAt`/`completedBy` and
   bumps the revision so the iterative refinement loop can
   revisit the same sessionPath. User answers, comments, and
   `selectedOptionId` survive reopen. Without `reopen: true`,
   completed sessions throw `SESSION_COMPLETED` (preserving the
   prior guard behavior). It uses `mutateSession` to merge in
   new additive metadata (`options`, `recommendedOptionId`,
   missing `targetAnchor`) while preserving user-entered
   `answer`, `comments`, `selectedOptionId`, and revision
   history; falls back to `createSession` when no prior file
   is present.
4. Resolve the static UI directory by deriving it from the PI
   package's `node_modules` (where core actually resolves):
   ```js
   const corePkgJson = piRequire.resolve('@sunstone-partners/ensemble-core/package.json');
   const uiDir = path.join(path.dirname(corePkgJson), 'lib/refinement-review/ui');
   ```
   Compute the open intent once as
   `shouldOpen = !$ARGUMENTS.contains('--no-open') && process.env.CI !== 'true'`,
   and pass `open = shouldOpen && tunnel !== 'quick'` to
   `startServer`. Auto-open is deferred when `--tunnel=quick`
   is set because the opener should fire on the public URL
   (post-tunnel), not the local URL; the bootstrap fires the
   opener itself (using `shouldOpen`, not `open`) once
   `setTunnelUrl` has rewritten the review URL.
   **DO NOT gate on `process.stdout.isTTY`** — the bootstrap is
   typically launched from a process supervisor (hub, nohup,
   background shell) whose captured stdout is not a TTY, but the
   host GUI is fully functional. TTY is not a valid open-gate.
   The right opt-outs are `--no-open` and `CI=true`. The server binds 127.0.0.1 with an OS-assigned port. The
   `open` flag opts into auto-launching the reviewer's browser
   via the per-platform opener (`open` / `xdg-open` /
   `rundll32 url.dll,FileProtocolHandler`); it auto-suppresses
  (CI, piped logs) and on `--no-open`.
  **Long-lived mode (`--long-lived`):** before calling
  `startServer`, validate that `--reviewers` is NOT also
  present in $ARGUMENTS — the two modes are mutually
  exclusive and the bootstrap MUST abort with a clear
  error if both are supplied. Force `tunnel = 'quick'`
  regardless of any explicit `--tunnel` value (long-lived
  implies QuickTunnel). Parse `--ttl <duration>` (default
  `6h`); reject durations that parse to less than 6h with
  a clear error. Call `startServer({ sessionPath, token,
  uiDir, longLived: true, ttlMs: <ms>, port: 0, log,
  logError, open: false })`. `port: 0` lets the OS pick
  the actual port (the server result fills in `url`/
  `port`); `open: false` because the bootstrap fires the
  opener itself on the tunneled invite URL after step 5.
5. If `tunnel === 'quick'`: instantiate
   `new refinementReview.tunnel.QuickTunnel({ targetUrl: server.url })`,
   `await tunnel.start()`, then call
   `server.setTunnelUrl(tunnel.url)` which re-mints the share
   credential against the tunnel origin and rewrites
   `reviewUrl`/`publicUrl` on the server result. The minted
   field is `shareInvite` when `opts.longLived === true`
   and `shareNonce` otherwise; the URL shape is
   `<origin>/api/exchange?invite=<id>` for long-lived and
   `<origin>/api/exchange?nonce=<id>` for the default flow.
   Then (if `shouldOpen` is truthy) fire
   `refinementReview.opener.openUrl(tunneled.reviewUrl, {})`.
   The share URL never carries the bearer token. **Do not
   print the URL here** — step 6 owns the consolidated print
   so the listing reflects any mode-specific shape.
6. **If `$ARGUMENTS` contains `--long-lived`:** skip the fan-out
   logic below entirely. After step 5 (tunnel setup),
   `server.reviewUrl` already carries the invite URL of the form
   `<origin>/api/exchange?invite=<id>`. Print the URL listing:
   `Local: <url>`, `Public: <publicUrl>`, `URL: <reviewUrl>`
   (same format as the tunnel+single-reviewer case). The invite
   is multi-use and any reviewer self-identifies through the
   form at `/api/exchange?invite=<id>`; there is no per-reviewer
   nonce to mint. `server.createShareUrl()` is undefined in this
   mode and MUST NOT be called.
   Parse `--reviewers <N>` from $ARGUMENTS otherwise: extract
   `N` as a positive integer in `[1, 50]`.
   Default to `1` when
   the flag is absent. Validate strictly: a non-integer,
   a value `< 1`, or a value `> 50` MUST cause the
   bootstrap to abort with a clear error message rather
   than silently truncate to `1`. When `N > 1`, mint
   `(N - 1)` additional share URLs by calling
   `server.createShareUrl()` `N - 1` times — each call
   returns an independent `{ reviewUrl, shareNonce,
   publicUrl }` triple bound to the current public origin
   (tunnel origin when `--tunnel=quick`, local origin
   otherwise). Print the final URL listing to the user:
   - When `N === 1` (the default): print the original
     additive flow — `URL: <reviewUrl>` for the no-tunnel
     case, or `Local: <url>`, `Public: <publicUrl>`,
     `URL: <reviewUrl>` for the tunnel case. This format
     is preserved verbatim from the pre-fan-out behavior.
   - When `N > 1`: print `Local: <url>` and `Public:
     <publicUrl>` headers (tunnel case only) followed
     by `URL #1: <original reviewUrl>` through
     `URL #N: <(N-1)th createShareUrl().reviewUrl>`.
   Each reviewer redeems their own nonce independently
   through `/api/exchange`; the server burns the nonce
   atomically on first use, so a leaked `#k` URL cannot
   be replayed by a second reviewer, and all reviewers
   authenticate to the same session (same document, same
   answer set). The `--reviewers` flag is independent of
   `--tunnel`; both apply, and the fan-out URLs all share
   the same `publicUrl` (local origin when no tunnel,
   tunnel origin when `--tunnel=quick`).
7. **Run startServer in the foreground and `await` its
   `completed` promise** (returned alongside `url`, `port`,
   `reviewUrl`, `openResult`, and `stop`). This promise resolves
   with `{ artifactPath, session }` when the reviewer hits
   Complete in the UI — there is no need to poll or watch the
   artifact file. Do not background or detach the server: the
   bootstrap script must keep the request alive until the UI
   session ends so the next workflow step can continue
   automatically. Wrap the body in `try { ... } finally
   { await server.stop(); if (tunnel) await tunnel.stop(); }`
   so the HTTP listener and the cloudflared process are closed
   even if reading or recap throws — an open listener would
   keep the foreground Node process alive and block the
   workflow.
8. Once `completed` resolves, the artifact is already on disk at
   `artifactPath`. Read it and initialize `SELECTED_ITEMS` to the
   union of every question with `status === 'answered'` and every
   comment whose anchor is non-null. Map each comment to a finding
   against its anchor's section.
9. Print a session recap: answered count, comment count, artifact
   path. Carry `SELECTED_ITEMS` into the Enhancement phase. The
   TRD Review phase below will short-circuit on its Synthesis,
   Interview, and Feedback Integration steps.


### Phase 2: TRD Review

**1. Current TRD Analysis**
   Review existing TRD content and extract structural metadata

   - Read the TRD file from the path provided in $ARGUMENTS
   - Parse frontmatter for Document ID (TRD-YYYY-NNN), Version, PRD reference, Design Readiness Score
   - Count total tasks (TRD-NNN pattern), total test tasks (TRD-NNN-TEST), total hours estimated
   - Build dependency graph from [depends: TRD-NNN] annotations
   - Check if Acceptance Criteria Traceability matrix exists
   - Note current version number for bumping later
   - PR format detection: scan TRD for '### PR ' followed by a digit within the '## Master Task List' section (from '## Master Task List' heading to the next '##' heading or EOF). If found: set PR_FORMAT=true and log 'TRD format: PR-stack'. Else: set PR_FORMAT=false and log 'TRD format: legacy phase/sprint'.
   - If PR_FORMAT=true: count PR boundary sections; for each ### PR N: heading check whether a **Shippable State:** line immediately follows it; record MISSING_SHIPPABLE[N] for any that don't; record INFRA_ONLY_SHIPPABLE[N] for any whose Shippable State text contains only infrastructure language (e.g., 'scaffolding', 'setup done', 'infrastructure complete') with no user-observable capability.

**2. Synthesis (skip when --collab or --long-lived in $ARGUMENTS)**
   If `--collab` or `--long-lived` is present in $ARGUMENTS, SKIP this
step entirely — the Collaborative Review phase has already collected
the findings and populated `SELECTED_ITEMS` from answered questions
and comments. Otherwise, perform the original synthesis below.

After reviewing the TRD, generate a numbered list of findings — do NOT make
any edits yet.

IF `--foreman` is present (guaranteed not combined with --collab or
--long-lived per the HALT check above): still generate the full
numbered findings list below, but SKIP the AskUserQuestion call
entirely — do not pause for a human reply. Auto-select EVERY
finding as SELECTED_ITEMS (equivalent to a user reply of "all")
and log: "Foreman mode: auto-applying <N> findings:" followed by
the numbered list. Proceed directly to the Interview step, which
resolves each finding with a best-effort default instead of an
interactive question.

Scan the TRD for the following categories of issues:
- Implementation tasks missing a [satisfies REQ-NNN] annotation
- User-facing implementation tasks missing a paired TRD-NNN-TEST task
- Missing or incorrect "Validates PRD ACs:" fields (must reference real AC-NNN-M sub-IDs)
- [satisfies] annotations that reference non-existent PRD REQ-NNN IDs
- Unclear or underspecified implementation details
- Missing error handling or recovery mechanism descriptions
- Missing performance targets or non-functional requirements
- Architecture decisions that are not justified or explained
- Integration points or external dependencies that are not fully specified
- Tasks with hour estimates >= 8h that should be broken into smaller tasks
- Long dependency chains (3+ sequential [depends: TRD-NNN] hops) that create execution bottlenecks
- Circular dependencies between tasks
- Missing or incomplete Architecture Decision section (should include alternatives with justification)
- Missing or outdated Acceptance Criteria Traceability matrix
- Missing Design Readiness Gate scorecard in frontmatter
- Tasks missing hour estimates entirely
- Stale references to files, APIs, or components that no longer exist in the codebase
- "(PR_FORMAT=true only) PR sections missing **Shippable State:** annotation — list each ### PR N: heading that lacks an immediately-following **Shippable State:** line"
- "(PR_FORMAT=true only) PR sections whose Shippable State describes only infrastructure or scaffolding with no user-observable capability — these must be rewritten or the PR must be split to deliver visible value"
- "(PR_FORMAT=true only) Tasks in PR N that [depends: TRD-XXX] where TRD-XXX belongs to PR N+1 or later — forward dependency violates the shippability guarantee of PR N"
- "(PR_FORMAT=false only) TRD uses legacy ### Phase N: or ### Sprint N: headings — offer optional conversion to ### PR N: format with Shippable State annotations to enable implement-trd-beads PR-stack mode (present as a low-priority suggestion, not an error)"

Use the AskUserQuestion tool to present a consolidated findings list and capture
the user's selection. Format the question body exactly as follows:

```
Based on my review of <TRD filename>, here are the areas I suggest improving:

1. [issue description — e.g., "TRD-005 is missing [satisfies REQ-NNN] annotation"]
2. [issue description]
...N. [issue description]

Which would you like to address? Reply with: all, a comma-separated list of numbers (e.g. 1,3), or skip to exit without changes.
```

Store the user's reply as SELECTED_ITEMS.

- If the user replies "skip" or provides no selection, exit immediately without
  making any changes to the TRD (the workflow is complete).
- If the user replies "all", treat every numbered finding as selected.
- Otherwise, parse the comma-separated numbers to determine which findings are selected.


**3. Interview (skip when --collab or --long-lived in $ARGUMENTS)**
   If `--collab` or `--long-lived` is present in $ARGUMENTS, SKIP this
step entirely — the Collaborative Review phase already collected
interactive answers. Otherwise, run the original interview below.

IF `--foreman` is present: SKIP the entire interactive
AskUserQuestion loop below — there is no human present to answer
in Foreman-native automated execution. Instead, for each
SELECTED_ITEM, apply a best-effort default resolution inline
using the same guidance listed below as a guide to what a good
answer looks like (e.g. infer the nearest plausible REQ-NNN from
surrounding context, infer a reasonable performance target from
sibling requirements, infer natural task-split boundaries from
existing subtask structure, etc.). Where no confident default can
be inferred, do NOT pause — instead insert an inline
`[NEEDS CLARIFICATION: <specific question>]` marker at the
relevant location in the TRD, reusing the same question text that
would otherwise have been asked. Log one line per finding:
either "Foreman default applied: <finding> -> <default>" or
"Foreman: inserted [NEEDS CLARIFICATION: ...] for <finding>".
Then proceed to Feedback Integration using these defaults/markers
in place of interview answers.

Conduct a focused follow-up interview ONLY about the SELECTED_ITEMS from the
Synthesis step. Skip any topic the user did not select.

Use the AskUserQuestion tool to present questions interactively:
- Ask questions ONE AT A TIME (not all at once)
- Wait for the user's answer before asking the next question
- Do NOT just write questions in your response text
- The user should see interactive question UI prompts

For each selected finding, ask targeted follow-up questions such as:
- For missing [satisfies] annotations: "Which PRD REQ-NNN ID does TRD-XXX satisfy?"
- For missing TRD-NNN-TEST tasks: "What acceptance criteria should the test task validate?"
- For missing "Validates PRD ACs:" fields: "Which PRD AC sub-IDs does this task validate?"
- For unclear implementation details: "Can you clarify how [component] should behave when [scenario]?"
- For missing error handling: "What should the system do when [error condition] occurs?"
- For missing performance targets: "What is the acceptable latency / throughput / SLA for [operation]?"
- For unjustified architecture decisions: "What drove the choice of [technology/pattern]?"
- For unspecified integration points: "What contract / protocol / schema does [integration] use?"
- For oversized tasks: "TRD-NNN is estimated at Xh. Can we split it into smaller pieces? What are the natural boundaries?"
- For dependency chains: "Tasks TRD-AAA -> TRD-BBB -> TRD-CCC -> TRD-DDD form a N-task chain. Can any of these run in parallel?"
- For missing architecture decisions: "What alternatives were considered for [component] and why was this approach chosen?"
- For stale references: "TRD-NNN references [path/file] which no longer exists. Should this task be updated or removed?"
- "For missing Shippable State (PR_FORMAT=true): 'PR N has no Shippable State annotation. In one sentence, what user-observable capability exists after this PR merges? (not infrastructure — a feature, endpoint, or UI state a user can interact with)'"
- "For infrastructure-only Shippable State (PR_FORMAT=true): 'The current Shippable State for PR N reads: \"<current text>\". This describes infrastructure, not user-observable behaviour. What does a user gain when this PR is live?'"
- "For forward dependency violations (PR_FORMAT=true): 'TRD-XXX in PR N depends on TRD-YYY in PR N+1. This breaks PR N shippability. Should we move TRD-XXX to PR N+1, or can TRD-YYY be moved to PR N?'"
- "For legacy format conversion offer (PR_FORMAT=false): 'This TRD uses ### Phase N: headings. Would you like to convert the Master Task List to ### PR N: format with Shippable State annotations? This enables implement-trd-beads PR-stack mode (feature/<slug>-pr-N branches, per-PR git town propose). The ## Sprint Planning section would remain unchanged.'"


**4. Feedback Integration (artifact when --collab or --long-lived in $ARGUMENTS)**
   If `--collab` or `--long-lived` is present in $ARGUMENTS, source the
answers and comments from the artifact written by the Collaborative
Review phase (path printed by that phase); the Interview step is
bypassed. If `--foreman` is present, source the answers from the
best-effort defaults and/or inline `[NEEDS CLARIFICATION: ...]`
markers produced during the Interview step above -- treat those
exactly as if a human had supplied them. Otherwise, perform the
original feedback integration below.

Incorporate stakeholder feedback collected during the interview into a change plan


   - Apply interview answers to the relevant findings in SELECTED_ITEMS only
   - For new tasks added, assign next sequential TRD-NNN ID
   - For split tasks, preserve original [satisfies] annotations on child tasks
   - For dependency changes, update the dependency graph and check for new circular deps
   - Compile a change plan summarizing all modifications to be applied

### Phase 3: Enhancement

**1. List Available TRDs**
   If --list is passed, show available TRDs and exit

   - If $ARGUMENTS contains '--list': Resolve TRD_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/trd-cli.js. If none of the 4 tiers resolve OR 'which node' fails: print 'ERROR: Node.js and the TRD CLI (lib/trd-cli.js) are required. Ensure Node.js is installed and the ensemble-development or ensemble-pi plugin bundle is present.' and HALT.
   - If $ARGUMENTS contains '--list': run node "$TRD_CLI" list --type trd and parse {ok,type,items}. If ok is false or JSON is malformed, print the error and HALT. Print a formatted table of TRDs (columns: ID/Name, Status, Score, Last Modified). If $ARGUMENTS also contains '--foreman': skip the AskUserQuestion prompt below entirely -- auto-select the item with the highest design_readiness_score (fallback: most recently modified when scores are absent or tied), log 'Foreman mode: auto-selected <TRD_SLUG> (score: <score>)', and proceed directly to path derivation. Otherwise, call AskUserQuestion with id='trd_select', question='Select a TRD to refine:', options=items.map(i => ({id:i.slug, label:i.id||i.slug, description: 'Status: ' + i.status + (i.design_readiness_score != null ? ' | Score: ' + i.design_readiness_score : '') + (i.version ? ' | Version: ' + i.version : '') + (i.last_modified ? ' | Modified: ' + i.last_modified.split('T')[0] : '')})), multi=false, recommended=0. Parse answer id as the selected TRD_SLUG. Then derive TRD_FILE_PATH as docs/TRD/<basename matching the selected slug>.md (find by suffix/prefix match). If derived path does not exist, print 'ERROR: Could not resolve path for slug <TRD_SLUG>' and HALT. Set the derived path as the $ARGUMENTS positional and continue.

**2. Content Refinement**
   Apply changes ONLY for the SELECTED_ITEMS identified in the Synthesis step.
Do not alter sections that were not selected by the user.

Enhancements to apply (scoped to selected findings):
- Add [satisfies REQ-NNN] annotations to implementation tasks that lack them
- Add missing TRD-NNN-TEST paired tasks for user-facing implementation tasks
- Validate and correct "Validates PRD ACs:" fields to reference real PRD AC sub-IDs (AC-NNN-M)
- Ensure all [satisfies] annotations reference real PRD REQ-NNN IDs
- Expand unclear implementation details with specifics gathered during the interview
- Add error handling and recovery mechanism descriptions where missing
- Add performance targets and non-functional requirement entries where missing
- Document justifications for architecture decisions
- Specify integration contracts, protocols, and schemas for external dependencies
- Break oversized tasks (>= 8h) into smaller subtasks per interview guidance
- Restructure dependency chains to enable parallel execution where possible
- Remove or update stale file/API/component references
- Add or complete Architecture Decision section with alternatives and justification
- "(PR_FORMAT=true) Add missing **Shippable State:** lines: insert immediately after each ### PR N: heading that lacks one, using the user's interview answer"
- "(PR_FORMAT=true) Rewrite infrastructure-only Shippable State lines with user-observable capability from interview answers"
- "(PR_FORMAT=true) Resolve forward dependency violations: move affected tasks to the correct PR section per interview guidance; re-verify ordering after moving"
- "(PR_FORMAT=true) When inserting new tasks, place them inside the correct ### PR N: section based on their dependencies — do not add tasks between PR sections or above the first ### PR N: heading"
- "(PR_FORMAT=false, user confirmed conversion) Convert ### Phase N: / ### Sprint N: headings in the Master Task List to ### PR N: format; add a **Shippable State:** line for each (gathered via interview); leave ## Sprint Planning section unchanged — it uses H2 headings and is informational only"


**3. Validation**
   Verify structural integrity of the refined TRD before writing

   - Verify all TRD-NNN IDs are unique and sequential
   - Verify all [satisfies REQ-NNN] annotations reference valid PRD requirements
   - Verify all [depends: TRD-NNN] annotations reference existing tasks
   - Check no circular dependencies were introduced
   - Verify all user-facing implementation tasks have paired TRD-NNN-TEST tasks
   - Count tasks and hours to verify they haven't drifted from the Master Task List summary
   - If PR_FORMAT=true: verify every ### PR N: heading in the Master Task List has an immediately-following **Shippable State:** line
   - If PR_FORMAT=true: verify no task has a [depends: TRD-XXX] where TRD-XXX belongs to a later PR section (no forward dependencies across PR boundaries)
   - If PR_FORMAT=true: verify the Master Task List section contains only ### PR N: headings (no mixed ### Phase N: or ### Sprint N: headings)

### Phase 4: Design Readiness Gate Re-Score

**1. Re-Score Readiness Dimensions**
   Re-evaluate the Design Readiness Gate after refinement changes

   - Score architecture completeness (1-5): are all components, interfaces, and data flows defined?
   - Score task coverage (1-5): does every REQ-NNN have implementation and test tasks?
   - Score dependency clarity (1-5): are dependencies explicit and acyclic?
   - Score estimate confidence (1-5): are estimates consistent, reasonable, and granular enough?
   - Compute overall score: average of all four dimensions

**2. Compare With Previous Score**
   Compare new readiness score against the previous score from frontmatter

   - Read previous Design Readiness Score from TRD frontmatter
   - Print delta: 'Design Readiness: X.X -> Y.Y (improved/declined/unchanged)'
   - If score dropped, warn the user and explain which dimensions declined
   - If no previous readiness score exists, offer to run the gate for the first time

**3. Assess Team Impact**
   Determine whether task changes warrant team reconfiguration

   - Calculate task count delta (original vs refined)
   - Calculate hour estimate delta (original vs refined)
   - If task count changed by >20%, suggest: '/ensemble:configure-team <trd-path> to re-configure the team'
   - Update the readiness score in frontmatter

### Phase 5: Output Management

**1. TRD Update**
   Write the refined TRD with version history and changelog

   - Bump version in frontmatter (increment patch: e.g. 1.0.0 -> 1.0.1)
   - Preserve the Document ID and Label frontmatter fields unchanged -- never regenerate them on refine (beads and PRD/TRD correlation depend on the stable micro UUID id)
   - Refresh the Acceptance Criteria Traceability matrix (recalculate from current task annotations)
   - Add changelog entry at the bottom: date, version, list of changes made
   - Save the updated TRD to the same file path (overwrite)
   - Print summary: changes made, new version, task count delta, hour estimate delta
   - If the task count changed by more than 20%, include a line recommending /ensemble:configure-team be re-run. This is the only place that recommendation is emitted; expectedOutput declares it, so it has to come from somewhere.

**2. Implementation Go / No-Go**
   Close the refinement with an explicit go/no-go decision on implementing the TRD

   - This step ALWAYS runs, and it is the last thing this command does. The run does not end on a printed summary.
   - Before asking, confirm the TRD's source PRD is locked: read the PRD at this TRD's `prd_reference` and check its frontmatter `status`. If it is not Locked, say so in the question body -- implementing against an unlocked PRD means the requirements can still move underneath the build.
   - If the source PRD's `version` is higher than the version this TRD was refined against, do NOT offer implementation at all. Report that the PRD moved and that the correct action is /ensemble:create-trd to re-create this TRD from the current PRD. A TRD refined against a PRD that has since changed is a refined copy of the wrong document.
   - Present the close-out through AskUserQuestion, not prose. Put the design readiness score, its delta, the task count and the hour estimate in the question body, plus any genuine open question the refinement could not settle. A few lines: the person answering has not read the TRD and is not going to.
   - Option 1, and the recommendation: GO. Print the next step as '/ensemble:implement-trd-beads <trd path>'. Cost: the full build. Risk: whatever the open questions above carry.
   - Option 2: another refine pass. Cost: one more run. Risk: none beyond time. Offer this first when the design readiness score fell.
   - Option 3: NO-GO, stop here. Cost: none. Risk: none.
   - Do NOT print any implement command before this question is answered, and print it only on the GO branch.
   - Prefer implement-trd-beads over implement-trd. They are separate commands, not a flag: implement-trd makes no beads calls and tracks progress in the TRD's own checkboxes, so it cannot resume across sessions. Name plain implement-trd only when the whole TRD lands as one PR in one sitting.
   - Ask genuine open questions ONLY. Anything the TRD or the constitution already contains a rule for is a finding, and findings were applied during Synthesis, not asked about here.
   - If --foreman is set, skip the question, record GO, and log the decision.

## Expected Output

**Format:** Refined Technical Requirements Document (TRD)

**Structure:**
- **Updated TRD**: Enhanced TRD with feedback incorporated
- **Version History**: Changelog of updates and refinements
- **Acceptance Criteria Traceability**: Updated matrix linking PRD requirements to TRD implementation and test tasks
- **Design Readiness Scorecard**: Re-scored readiness dimensions with delta comparison (if applicable)
- **Changelog Entry**: Dated version entry listing all changes made during refinement
- **Configure-Team Suggestion**: Recommendation to re-run /ensemble:configure-team if task changes exceed 20% delta

## Usage

```
/ensemble:refine-trd
```
