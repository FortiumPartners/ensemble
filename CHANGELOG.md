# Changelog

All notable changes to the Ensemble Plugins ecosystem will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **build:** `scripts/validate-peer-deps.js`, wired into `npm run validate` and into `validate.yml` so it gates pull requests, fails when any intra-workspace dependency range cannot be resolved locally, and names the offending file and the range it should carry. It refuses to report success on an empty scan.

### Fixed

- **build:** widen 34 intra-workspace `peerDependencies` ranges that were still pinned at `^4.0.0` while the packages they point at had moved to 5.x. npm links a workspace in place only when the declared range matches the local version, so each stale range sent npm to the public registry — where these packages are not published — and `npm ci` failed with a 404. Plain `npm ci` now works; the `--legacy-peer-deps` workaround has been dropped from all seven workflows, where it had been suppressing this since 2025-12-14.

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
- Plugin names now use the `ensemble-` prefix and `@fortium/` npm scope.
- Installation size and plugin load time were significantly reduced through modularization.

## [3.6.5]

### Changed

- Last release before the v4 plugin architecture migration.
- See the v3.x branch for the pre-plugin changelog history.
