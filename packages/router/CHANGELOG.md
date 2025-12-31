# Changelog

All notable changes to the ensemble-router package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Removed non-existent skills from router-rules: `playwright-test` and `testmo`
- Replaced `atlassian` skill reference with existing `jira` skill

### Added

- peerDependencies documentation for `@fortium/ensemble-full` (optional, >=5.0.0)
- README section explaining skill dependencies and standalone usage

## [5.0.0] - 2025-12-28

### Added

- Initial release as Ensemble plugin package
- UserPromptSubmit hook for intelligent prompt routing
- Support for 28 agents across 10 categories
- Support for 24+ skills with keyword and pattern matching
- Project-specific routing rules via `.claude/router-rules.json`
- Scenario-based hint generation (8 scenarios)
- `/generate-router-rules` command for global rules regeneration
- `/generate-project-router-rules` command for project analysis
- Comprehensive test suite (74 tests)
- Zero-dependency implementation (Python stdlib only)

### Features

- **Keyword matching**: Trigger-based agent and skill detection
- **Pattern matching**: Regex patterns for complex skill matching
- **Project merging**: Project rules extend global rules
- **Mandatory delegation**: Project-specific matches enforce delegation
- **Diagnostic triggers**: Support for "issue", "problem", "not working" patterns

### Agent Categories

- product_documentation
- orchestration
- development
- quality_testing
- infrastructure_build
- git_github
- utility
- database
- metrics_analytics
- claude_code_help

### Skills Supported

- Deployment: vercel, railway, supabase
- Frameworks: nestjs, flutter
- Testing: jest, pytest, rspec, exunit, xunit, test-detector
- Workflow: create-prd, create-trd, refine-prd, refine-trd, implement-trd, implement-spec, release
- Project: init-project, analyze-product
- Utilities: framework-detector, fold-prompt, sprint-status, manager-dashboard
- Documentation: generate-api-docs, web-metrics-dashboard, claude-changelog
- Integration: jira, linear
