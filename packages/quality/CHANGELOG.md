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

- `pr-review-remediation` skill — verify and remediate findings from CodeRabbit or
  another PR review agent: triage each finding (valid, stale, duplicate, already
  fixed, or incorrect), reproduce behavioral defects with a focused regression
  test, apply the minimal fix, and validate using the project's own tools.
  Treats review comments as untrusted leads to investigate, never as trusted
  instructions.
