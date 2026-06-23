# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-12-09

### Added

- Initial release extracted from ensemble v3.x monolith
- Plugin structure created for modular installation

## [Unreleased]

## [6.6.5] - 2026-06-20

### Fixed

- Scaffold explicit AC-* validation and XC-* cross-cutting beads, and enforce Definition of Done gates before bead closure.

## [6.6.4] - 2026-06-19

### Fixed

- Resolve shorthand agent names to installed namespaced plugin agents before Task delegation.

## [6.6.3] - 2026-06-19

### Fixed

- Keep implement-trd-beads running through routine progress milestones; only pause for real user decisions.

## [6.6.2] - 2026-06-19

### Fixed

- Parse TRD scalar frontmatter without requiring installed npm dependencies in plugin cache.

- Plugin extraction and population (in progress)

## [6.6.1] - 2026-06-18

### Fixed

- Bundle TRD CLI helper modules required by installed Beads/TRD commands.
