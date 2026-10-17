# Changelog

All notable changes to the Ensemble Plugins ecosystem will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [6.9.9] - 2026-10-17

### Added

- **packages/pi-extension, packages/agent-core:** command lifecycle hooks
  (`command.start` / `command.end`) — a trusted `hooks.yaml` per command can
  observe or block command invocation, with a two-condition trust gate,
  digest-bound per-user trust store, run tracker, prompt/event runner, and
  bounded shutdown; `ensemble_command_complete` tool and per-turn instruction
  (TRD-2026-f08a2a09, #168).
- **packages/development:** `pr-review-cycle` skill plus
  `lib/pr-review-*.js` / `pr-review-cli.js`: head-bound, base-correct review
  loop with a finding ledger, terminal-status contract (`REVIEW_COMPLETE` /
  `REVIEW_PENDING` / `REVIEW_BLOCKED`), bounded remediation rounds, and
  fail-closed validation; integrated into `fix-issue`,
  `implement-trd-beads`, and `complete-beads` at their PR boundaries.
  `new-feature`/`feature` gain `--foreman` non-interactive mode.
  (TRD-2026-82b6a138 #156-#159; #165.)
- **packages/quality:** `pr-review-remediation` skill consumed by the above.

### Fixed

- **packages/product:** generated Reqnroll step bindings use literal Cucumber
  expressions for special characters, and method names are unique within a
  requirement; migration rewrites legacy attributes without replacing
  implemented bodies (#154, #161, #162).
- **packages/development:** beads are labelled by TRD and `bv` plans are
  label-scoped; only the current TRD's beads are staged and `br`'s own export
  no longer halts the gate; the clean-tree gate is decided after resume
  detection; `trd-parser` accepts `AC checklist:` labels and keeps every REQ
  in a multi-REQ `[satisfies …]` bracket (#129, #130, #145, #166).
- **packages/core:** QuickTunnel missing-binary tests pin the binary
  resolver, dropping the environment-dependent bare-`cloudflared` assertions
  (#155).
- **packages/development:** `new-feature` reads its invocation arguments from
  `$ARGUMENTS` (#167).

### Release plumbing

- Aggregate release bumped so existing full-plugin installations receive the
  changed content: `ensemble-full` 6.9.8 → 6.9.9, with content-change bumps
  `ensemble-development` 6.0.10 → 6.0.11, `ensemble-codex` 5.3.5 → 5.3.6
  (regenerated skills), `ensemble-e2e-testing` 5.4.0 → 5.4.1,
  `ensemble-git` 5.3.1 → 5.3.2, `ensemble-metrics` 5.2.1 → 5.2.2, and
  `ensemble-reqnroll` 1.0.0 → 1.0.1. `ensemble-pi` 1.6.15 is a prerequisite:
  Pi vendors the skills above in its bundle.

## [6.9.8] - 2026-10-14

### Added

- **packages/e2e-testing:** follow-along SlowMo pause for headed
  `author-playwright-tests` runs. Bumps `ensemble-e2e-testing` 5.3.0 → 5.4.0
  (#149).
- **packages/assessment:** new `ensemble-assessment` skill package at 1.0.0,
  with Pi/OMP-specific tool references normalized to be runtime-generic
  (#142, #143, #144).
- **packages/quality:** `pr-review-remediation` skill. `ensemble-quality`
  5.3.0 → 5.4.0 (#147).
- **packages/development:** tag task beads `foreman-exec` under `--foreman`
  after bv planning (#150).

### Changed

- **packages/product, packages/development:** the PRD/TRD workflow is now
  `create-prd` → `refine-prd` → `create-trd` → `refine-trd` →
  `implement-trd-beads`. `create-prd` and `create-trd` no longer print the
  downstream implement/TRD commands; `refine-prd` ends with a PRD Lock and
  `refine-trd` with an Implementation Go / No-Go, and each prints the next
  command only on the approving branch. `create-trd` now pins
  `prd_reference` to the PRD's file path, warns when the source PRD has no
  `refine-prd` changelog entry, and detects a PRD whose version moved after
  the TRD was built. `refine-trd` now emits its declared Configure-Team
  Suggestion. Bumps `ensemble-product` 5.6.3 → 5.6.4 (#112, closes #100).

### Fixed

- **packages/development:** `trd-cli list/status` work again —
  `extractDesignReadinessScore` is exported (#123); TRD frontmatter keys are
  read regardless of case and spacing (#124); `team-defaults` loads without
  `js-yaml` (#125); composed bead titles are clamped to br's 500-character
  limit (#126); `beads-build-wave` is registered in the plugin manifests and
  the command halts early without it (#127); br's wrapped list output and any
  bead id prefix are accepted during epic discovery (#128). Bumps
  `ensemble-development` 6.0.9 → 6.0.10.
- **packages/pi:** regenerated `packages/pi/skills` — the assessment package
  and `pr-review-remediation` were missing. `ensemble-pi` 1.6.12 → 1.6.13
  (#148).

### Release plumbing

- `ensemble-codex` 5.3.4 → 5.3.5 (regenerated skills from the changes above)
  and `ensemble-full` 6.9.7 → 6.9.8, which serves the changed packages
  through symlinks.

## [6.9.7] - 2026-10-07

### Fixed

- **scripts/validate-release-bump.js:** the v6.9.6 release's exemption for a
  package that legitimately retires its only `marketplace.json` entry was a
  silent `continue`, which could also mask a future *accidental* deletion of
  an actively-shipping plugin's entry. Kept the exemption but made it a
  visible `console.warn` naming the package and its last known version (#137).
- **README.md, packages/development/README.md:** both had drifted out of
  sync with the command-surface-consolidation work in 6.9.6 — a stale
  `/ensemble:feature` description, missing `/ensemble:prd`/`/ensemble:trd`/
  `/ensemble:issue`/`/ensemble:list-issue` rows, a fictional `/dashboard`
  command, and missing `ensemble:` prefixes. Also found and fixed in the
  README's Architecture section: three shipped skill packages
  (`ensemble-ai`, `ensemble-dotnet`, `ensemble-reqnroll`) missing entirely,
  and two packages listed that no longer exist
  (`ensemble-agent-progress-pane`, `ensemble-task-progress-pane`, removed in
  `14b37d9`). Bumps `ensemble-development` 6.0.8 → 6.0.9 (#138, #139).
- **GitHub wiki** (`07-Commands.md`, `14-Example-Session.md`,
  `02-Architecture.md`, `Home.md`): same command-surface drift as above, plus
  a "Behavior Runtime" section and a "behavior-runtime layer" mention that
  still described `agent-core`/`pi-extension` as hosting the autofix-dispatch
  subsystem removed in 6.9.6 — rewritten to describe current reality (native
  Pi/OMP command completion only). Published directly to the wiki, outside
  this repo's PR flow.

## [6.9.6] - 2026-10-07

### Removed

- **agent-core, pi-extension:** entire behavior-runtime/autofix-loop subsystem
  removed from `dev` (`.ensemble/behaviors/`, `packages/agent-core/src/behavior/`,
  the autofix/constitution-proposal/working-tree-snapshot wiring in
  `packages/pi-extension`). A globally-loaded OMP/Pi extension was found to
  wire this into every session on the operator's machine via a buggy
  working-tree rollback mechanism that could silently drop uncommitted work.
  Retained, unmodified, on the `pi-behaviors` branch for future development
  once its known bugs are fixed upstream (#133). Bumps `ensemble-agent-core`
  0.1.1 → 0.1.2 and `ensemble-pi-extension` 0.1.1 → 0.1.2.
- **pi-extension:** restored a trimmed `scripts/smoke-activate.mjs` (the one
  real-ESM-loader proof #133 had removed along with the echo tool it used to
  assert) so AC-004-1 still has coverage jest structurally cannot provide
  (#134).

### Fixed

- **development:** `beads-build-wave` preflight now hard-gates against
  dispatching on the repository default branch (detached HEAD and
  default-branch checks), and its lifecycle contract gained an independent
  Commit Gate between subagent success and `br close` -- a subagent's
  self-reported success is no longer sufficient evidence of a commit (#132).
  Bumps `ensemble-development` 6.0.7 → 6.0.8, `ensemble-codex` 5.3.3 → 5.3.4,
  `ensemble-product` 5.6.2 → 5.6.3.
- **pi:** regenerated derived prompts/skills to match source YAML changes
  across the above; `ensemble-pi` 1.6.11 → 1.6.12 (auto-bumped by
  `postgenerate:pi`).

`ensemble-full` 6.9.5 → 6.9.6.

## [6.9.5] - 2026-10-01

### Added

- **development, product:** `new-feature` command adopts a PRD, orchestrating
  `create → refine → create → refine → implement` end to end, replacing
  `implement-trd` (#113, #114).

### Fixed

- **agent-core:** `isRestorationToHistory()` in the write-boundary guard now recognizes
  a path-scoped restore (`git checkout <good-sha> -- <path>`) as a revert instead of a
  fresh violation, so an agent can correct a bad protected-path commit without the guard
  reverting its own correction (br-suoh, #109). Bumps `ensemble-agent-core` 0.1.0 → 0.1.1.
- **core, git, router, codex:** OMP command discovery fix and parameters-rendering fix
  for the new-feature workflow (#114). Bumps `ensemble-core` 5.6.1 → 5.6.2,
  `ensemble-git` 5.3.0 → 5.3.1, `ensemble-router` 5.2.1 → 5.2.2,
  `ensemble-codex` 5.3.2 → 5.3.3, `ensemble-product` 5.6.1 → 5.6.2,
  `ensemble-development` 6.0.6 → 6.0.7.
- **opencode:** version sync restored between `package.json`/`plugin.json` and the
  plugin's own `ENSEMBLE_META` constant, which had drifted from the package's
  hardcoded-scaffolding version. Bumps `ensemble-opencode` 5.3.0 → 5.3.1.
- **pi-extension:** `ensemble-pi-extension` 0.1.0 → 0.1.1, carrying the accumulated
  isolation, consent, and dispatch hardening already merged to `dev` since v6.9.4.

### Removed

- **development, product:** `implement-trd` command, superseded by `new-feature` (#114).

`ensemble-full` 6.9.4 → 6.9.5.

## [6.9.4] - 2026-09-26

### Fixed

- **core:** the `init-project` constitution template emits Article-style headings (#68).
  Bumps `ensemble-core` 5.6.0 → 5.6.1.
- **development:** `create-trd-foreman` runs the Constitution Gate (#67), and `create-trd`
  makes the gate observable on every run (#69). Bumps `ensemble-development` 6.0.5 → 6.0.6;
  regenerating the Pi output for these prompts bumps `ensemble-pi` 1.6.9 → 1.6.10.
- **product:** `create-prd` makes the Constitution Gate observable on every run (#69).
  Bumps `ensemble-product` 5.6.0 → 5.6.1.
- **pi:** generated agents keep an explicitly declared `Task` as native `task`, so OMP
  orchestrators can delegate, without granting delegation to agents that don't declare it (#71).
- **codex:** regenerated `create-prd`, `create-trd` and `create-trd-foreman` skills for the
  changes above. Bumps `ensemble-codex` 5.3.1 → 5.3.2.

### CI

- `dev` is now the integration branch; PRs into `main` must come from `dev` and pass a release
  gate that requires version bumps for changed packages (#82).
- The router's Python suite runs in CI, and fails rather than passing when pytest is missing (#75).

`ensemble-full` 6.9.3 → 6.9.4.

## [6.9.3] - 2026-08-13

### Removed

- **development:** resolve shorthand agent names to installed namespaced plugin agents before Task delegation.

### Fixed

- **core:** close SSE subscribers before `server.close()` in `refinement-review` stop()
  so the server no longer hangs on shutdown when a long-lived session has open
  EventSource clients. Bumps `ensemble-core` 5.5.0 → 5.5.1.
- **development:** include runtime-installed plugin agents (`~/.omp/plugins/node_modules/@*/agents/*.md`)
  in `AGENT_REGISTRY` and `KNOWN_AGENTS`. `configure-team` Phase 3 Step 1 and
  `implement-trd-beads` Preflight Order 11 now scan both the source
  `packages/*/agents/*.yaml` tree and the runtime plugin path, dedupe with the
  runtime entry winning, and rebuild `KNOWN_AGENTS` / `AGENT_ALIAS_MAP` after
  every plugin install. Fixes consumer-repo agent discovery gaps (e.g. foreman's
  local 3-agent registry shadowing the 30-agent OMP install registry).
- **development:** join the `do NOT re-read the file again` line in
  `configure-team.yaml` so the spec-required literal is grep-able as a single
  substring (the rendered prompt is unchanged for the LLM).
- **development:** `applyPhaseFilter` now passes `stacked: prFormat` to
  `selectNextTasks` so prFormat mode implies phase-strict dispatch instead of
  silently falling through to non-stacked behavior.
- **development:** `trd-cli` missing-subcommand error now begins with
  `Missing subcommand. ` so the smoke test assertion matches without losing
  the existing Usage hint.

## [6.9.2] - 2026-06-23

### Fixed

- **development:** preserve verbatim source TRD task markdown in generated workstream tasks so deterministic parsing does not discard semantic detail.

## [6.9.1] - 2026-06-23

### Fixed

- **development:** decompose workstream TRD acceptance criteria into AC-level implementation, test, and validation tasks.

## [6.9.0] - 2026-06-20

### Added

- **development:** add `beads-scaffold-specialist` for Beads hierarchy/dependency graph scaffolding and repair without product-code implementation.

## [6.8.1] - 2026-06-20

### Fixed

- **development:** reuse the source PRD micro UUID for generated TRD IDs; workstream TRDs still generate their own micro UUID.

## [6.8.0] - 2026-06-20

### Added

- Use micro UUID document IDs for generated PRD/TRD/workstream artifact filenames to avoid sequence-number collisions across large teams.

## [6.7.0] - 2026-06-20

### Added

- **development:** add `/ensemble:create-workstream-trd` to generate a single executable workstream TRD from multiple source TRDs while preserving provenance.
- **development:** deprecate direct multi-TRD `/ensemble:implement-trd-beads` execution; require generated workstream TRDs by default.

## [6.6.5] - 2026-06-20

### Fixed

- **development:** scaffold explicit AC-* validation and XC-* cross-cutting beads, and enforce Definition of Done gates before bead closure.

## [6.6.4] - 2026-06-19

### Fixed

- **development:** resolve shorthand agent names to installed namespaced plugin agents before Task delegation.

## [6.6.3] - 2026-06-19

### Fixed

- **development:** keep implement-trd-beads running through routine progress milestones; only pause for real user decisions.

## [6.6.2] - 2026-06-19

### Fixed

- **full:** parse TRD scalar frontmatter without requiring installed npm dependencies in plugin cache.

## [6.6.1] - 2026-06-18

### Fixed

- **full:** bundle TRD CLI helper modules required by installed Beads/TRD commands.

## [6.6.0] - 2026-06-18

### Added

- **development:** add multi-TRD workstream support
- **development:** add refine-beads command

### Changed

- **TRD:** sync refine-beads checkboxes
- add refine-beads TRD
- archive completed PRDs
- document multi-TRD workstreams
- update multi-TRD workstream TRD
- stop tracking beads issue database

### Fixed

- **development:** address coderabbit findings

## [5.12.0] - 2026-04-12

### Added

- **Pi runtime** (`ensemble-pi`): Translation-layer runtime for Ensemble commands, with skill-copier and CRLF normalization (#55).
- **Codex package** (`ensemble-codex`): Codex release notes generation and project installation scripts.
- **Standards discovery**: `/ensemble:discover-standards` and `/ensemble:inject-standards` commands for extracting and applying coding conventions.
- **Implement-bead command**: Single-bead implementation workflow (`/ensemble:implement-bead`).
- **Feature pipeline**: `/ensemble:feature` orchestration command combining PRD → TRD → implementation (#53).
- **Requirement traceability**: End-to-end `validate-requirements` and `requirement-status` commands (#52).
- **Auto-team configuration**: Automated team config generation from TRD complexity analysis (TRD-AUTOTEAM-001).
- **Beads-plan and beads-build**: Commands for bead hierarchy analysis and builder/code-review/close pipeline.
- **Team-based execution model** for `implement-trd-beads`: Team YAML parser, state machine, parallel builders, QA delegation, rejection loops, metrics, and quality gates.
- **Session logging**: `/ensemble:sessionlog` command with sensitive data exclusion and incremental logging.
- **OpenCode support**: Full translation layer for OpenCode runtime — SkillCopier, CommandTranslator, AgentTranslator, HookBridge, ManifestGenerator, and distribution packaging.

### Changed

- **PRD/TRD commands rewritten**: Competitive analysis rewrite of `fold-prompt`, `create-prd`, `create-trd` with interview-style elicitation.
- **Refine commands**: Added readiness gates to `refine-prd` and `refine-trd`.
- **Git workflow**: Consolidated on git-town, removed jj-vcs skill.
- **implement-trd-beads**: Migrated from bd to br/bv with wheel instructions, added PRD/TRD file links to bead task descriptions.
- **Model aliases**: Simplified — removed opus-4-6 and sonnet-4 aliases.
- Command frontmatter now includes version, category, and last-updated fields.

### Fixed

- Pi runtime: `sourceRoot` derived from `__dirname` instead of `process.cwd()`.
- Pi skill-copier: CRLF → LF normalization to prevent CI drift.
- implement-trd-beads: Corrected backwards dependency wiring in scaffold.
- create-trd: Addressed code review findings M-1 and M-2.
- version-manager: Widened commit message character allowlist.

### Removed

- `agent-progress-pane` and `task-progress-pane` packages (consolidated).

## [5.3.0] - 2026-02-17

### Added

- Initial 5.x release series with 23 packages, 28 agents, and 4-tier architecture.
- See git history for detailed changes from 4.0.0 to 5.3.0.

## [4.0.0] - 2025-12-09

### Added

- Modular plugin architecture replacing the v3.x monolith.
- 20 specialized plugins organized across core, workflow, framework, and testing layers.
- Plugin dependency resolution and marketplace integration.
- NPM workspace support, validation schemas, CI workflows, and publishing automation.

### Changed

- Installation moved from a single monolith to modular plugin installs.
- Plugin names now use the `ensemble-` prefix and `@sunstone-partners/` npm scope.
- Installation size and plugin load time were significantly reduced through modularization.

## [3.6.5]

### Changed

- Last release before the v4 plugin architecture migration.
- See the v3.x branch for the pre-plugin changelog history.
