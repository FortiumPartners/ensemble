# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-09

### Added

- Initial release: 22 assessment skills covering repository assessment
  (architecture, code quality, testing, security, CI/CD, AI readiness,
  purpose inference), team assessment (commit volume/messages, code quality,
  test coverage, AI adoption, documentation, incidents, code review),
  portfolio-local configuration (`assess-config`), portfolio architecture
  synthesis (`architecture-overview-report`), scored Excel diagnostic
  reporting (`ai-readiness-diagnostic-report`), end-to-end executive package
  generation (`assessment-report-suite`), and assessment-scoring QA
  (`assessment-scoring-conflation-audit`).
- Local output paths (template/reports directories) are configurable via
  `.assessment/external-systems.yaml`'s `local_output` block instead of a
  hardcoded filesystem location.
