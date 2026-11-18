# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-12-09

### Added

- Initial release extracted from ensemble v3.x monolith
- Plugin structure created for modular installation

## [Unreleased]

### Changed

- **Breaking:** the bundle no longer ships the skill-backed command stubs (`commands/{core,product,development,git,e2e-testing,assessment}` and the `commands` list in `plugin.json`), which duplicated each skill in the slash menu. Invoke commands as `/ensemble-full:ensemble-<name>` instead of `/ensemble:<name>`.

### Added

- Direct entries in `packages/full/skills/` for the ten command skills the bundle lost when it stopped shipping command stubs, so `/ensemble-full:ensemble-pr-merge`, `-release`, `-assess`, `-standards`, `-discover-standards`, `-inject-standards`, `-fold-prompt`, `-reinstall-plugins`, `-sessionlog` and `-author-playwright-tests` exist again. A whole-package mirror such as `git -> ../../git/skills` keeps paths resolvable but registers no skill. `npm run validate` now fails when a command skill of a source package has no direct entry.
- Mirror the `pr-review-*.js` libraries (`pr-review-policy`, `pr-review-rules`, `pr-review-paths`, `pr-review-description`, `pr-review-scope`, `pr-review-state`, `pr-review-status`, `pr-review-ledger`, `pr-review-remote`, `pr-review-cli`) under `packages/full/lib/`, matching `packages/development/lib/`, so the `pr-review-cycle` skill resolves its libraries from the `ensemble-full` install.

## [6.9.2] - 2026-06-23

### Fixed

- Preserve verbatim source TRD task markdown in generated workstream tasks so deterministic parsing does not discard semantic detail.

## [6.9.1] - 2026-06-23

### Fixed

- Decompose workstream TRD acceptance criteria into AC-level implementation, test, and validation tasks.

## [6.9.0] - 2026-06-20

### Added

- Add `beads-scaffold-specialist` for Beads hierarchy/dependency graph scaffolding and repair without product-code implementation.

## [6.8.1] - 2026-06-20

### Fixed

- Reuse the source PRD micro UUID for generated TRD IDs; workstream TRDs still generate their own micro UUID.

## [6.8.0] - 2026-06-20

### Added

- Use micro UUID document IDs for generated PRD/TRD/workstream artifact filenames to avoid sequence-number collisions across large teams.

## [6.7.0] - 2026-06-20

### Added

- Add `/ensemble:create-workstream-trd` to generate a single executable workstream TRD from multiple source TRDs while preserving provenance.
- Deprecate direct multi-TRD `/ensemble:implement-trd-beads` execution; require generated workstream TRDs by default.

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
