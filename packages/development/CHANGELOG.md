# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-12-09

### Added

- Initial release extracted from ensemble v3.x monolith
- Plugin structure created for modular installation

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
