# Changelog

All notable changes to the Ensemble Plugins ecosystem will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
