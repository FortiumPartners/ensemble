# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Plugin extraction and population (in progress)

## [5.0.0] - 2026-03-07

### Added

- `implement-trd-beads` command: TRD implementation with persistent beads project management layer
  - Scaffolds epic → story → task bead hierarchy before any implementation begins
  - Drives execution order through `bd ready --parent <EPIC_ID>` rather than TRD re-parsing
  - Cross-session resumability via `--external-ref` idempotency (no `.trd-state/` files)
  - Parallel execution up to configurable limit with file-conflict detection
  - Phase quality gates recorded as bead comments via `bd comments add`
  - TRD checkbox sync to bead closure state on completion
  - `--status` flag for quick swarm status check without execution
  - `--reset-task TRD-XXX` flag for manual task retry
  - Inherits all strategy detection and specialist selection from `implement-trd-enhanced`

## [4.0.0] - 2025-12-09

### Added

- Initial release extracted from ensemble v3.x monolith
- Plugin structure created for modular installation

## [2.2.0] - 2026-03-15

### Added

- `implement-trd-beads` v2.2.0: team-based execution model with role-based handoffs
  - `team:` YAML section: optional top-level configuration for role-based execution (lead, builder, reviewer, qa roles)
  - Per-task state machine: sub-state tracking via br comments (in_progress/in_review/in_qa/closed)
  - Lead orchestration loop: tech-lead-orchestrator drives task assignment, reviewer/QA delegation
  - Reviewer delegation: code-reviewer evaluates each task implementation with APPROVED/REJECTED verdict
  - QA delegation: qa-orchestrator validates acceptance criteria and test coverage
  - Rejection loop: reviewer/QA rejections return task to builder with full context; max 2 cycles before lead escalation
  - Parallel builders: up to N concurrent builder slots with file conflict detection and sequential commits
  - Optional skip gating: lead can skip review and/or QA per task with audit trail
  - Cross-session resume: team sub-states reconstructed from br comments on resume
  - Team metrics: per-phase performance summary (builder pass rates, cycle times, rejection counts)
  - Wheel instructions: team-aware output with topology, lifecycle diagram, NTM spawn commands

### Backward Compatibility

- No breaking changes -- team mode is opt-in via `team:` section in command YAML
- Absence of `team:` section preserves identical v2.1.0 single-agent behavior
- All existing scaffolds (v2.1.0) are compatible with v2.2.0
