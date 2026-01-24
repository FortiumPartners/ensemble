# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-12-10

### Added

- **Jest Skill Extraction**: Complete extraction from ensemble v3.x monolith
  - `skills/SKILL.md`: Quick reference guide for Jest testing framework
  - `skills/REFERENCE.md`: Comprehensive API reference and best practices
  - `skills/templates/unit-test.template.js`: Unit test template
  - `skills/templates/integration-test.template.js`: Integration test template

- **Test Generation Utilities**:
  - `lib/generate-test.js`: Jest test file generator from templates
  - Support for unit, integration, and E2E test types
  - Framework-specific patterns (React, Node.js, Express)
  - Automatic import generation based on source files
  - Customizable test descriptions and naming

- **Test Execution Utilities**:
  - `lib/run-test.js`: Jest test runner with structured output
  - JSON output format for CI/CD integration
  - Coverage report support
  - Detailed failure reporting with file and line information
  - Test result aggregation and statistics

- **Programmatic API**:
  - `lib/index.js`: Main entry point with exports
  - `generateTest()`: Function for test generation
  - `runTest()`: Function for test execution
  - Skill metadata export for plugin ecosystem

- **Documentation**:
  - Comprehensive README with usage examples
  - Installation instructions via Claude marketplace
  - Framework-specific testing patterns
  - Error handling documentation
  - Integration guide with deep-debugger agent

### Changed

- Updated plugin structure to match ensemble monorepo standards
- Fixed template path references in `generate-test.js` to use relative paths from lib directory
- Enhanced error messages for better debugging experience

### Migration Notes

This release extracts the Jest testing skill from the ensemble monolith into a standalone plugin. The skill maintains 100% feature parity with the original implementation while providing improved modularity and maintainability.

**From ensemble v3.x**:
- Original location: `/skills/jest-test/`
- New location: `packages/jest/`
- All functionality preserved with no breaking changes

**Path Updates**:
- Templates directory: `templates/` → `skills/templates/`
- Generate test: `generate-test.js` → `lib/generate-test.js`
- Run test: `run-test.js` → `lib/run-test.js`

## [Unreleased]

### Planned

- Agent definitions for test-runner and test-generator
- Command definitions for `/generate-test` and `/run-test`
- Additional templates for E2E testing
- TypeScript type definitions
- Enhanced framework detection
- Test debugging utilities

---

## [4.0.0-beta] - 2025-12-09

### Added

- Initial plugin structure created
- Plugin extraction framework established

---

**Note**: Version 4.0.0 aligns with the ensemble monorepo versioning scheme. Previous versions (1.x-3.x) were part of the ensemble monolith.
