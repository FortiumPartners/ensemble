# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-12-09

### Added

- Initial release extracted from ensemble v3.x monolith
- Plugin structure created for modular installation

## [Unreleased]

### Added

- `/ensemble:pr-merge` — resolves an open PR's CI failures and review change-requests by dispatching one subagent per finding, routed through tech-lead-orchestrator (code), qa-orchestrator (tests), build-orchestrator/infrastructure-orchestrator (pipeline/infra), or github-specialist (PR mechanics), then re-verifies against live state and merges once green. Never deletes or weakens a test to force a check green.

- Plugin extraction and population (in progress)
