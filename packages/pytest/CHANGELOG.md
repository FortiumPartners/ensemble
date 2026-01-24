# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-12-10

### Added

- Initial release extracted from ensemble v3.x monolith
- Plugin structure created for modular installation
- **pytest Test Framework Skill** - Complete pytest testing framework integration
  - `SKILL.md` - Quick reference guide for pytest commands and patterns
  - `REFERENCE.md` - Comprehensive guide covering fixtures, parametrization, mocking, and best practices
- **Test Generation Tool** - `lib/generate-test.py` for automatic pytest test file creation
- **Test Execution Tool** - `lib/run-test.py` for structured test running with JSON output
- **Node.js Integration** - `lib/index.js` skill metadata exports for programmatic access
- **Comprehensive Documentation** - Full README with usage examples, patterns, and integration guide
- **Deep Debugger Integration** - Workflow support for test detection, generation, and validation

### Features

- Automatic pytest test file generation from source code
- Structured test execution with JSON output for CI/CD integration
- Complete fixture system documentation (function, class, module, session scopes)
- Parametrized testing patterns for data-driven tests
- pytest-mock integration examples (mocking, spying, side effects)
- Exception testing patterns and assertion examples
- Test configuration with pytest.ini examples
- Async testing support with pytest-asyncio
- Custom markers and test organization patterns
- Arrange-Act-Assert pattern examples
- Best practices and common pytest commands

### Migration Notes

- Extracted from `ensemble/skills/pytest-test/` directory
- Preserved all original functionality and file contents
- Added comprehensive REFERENCE.md with industry-standard pytest patterns
- Enhanced plugin.json with skillsMetadata registration
- Python scripts made executable with proper shebang headers

## [Unreleased]

- Future enhancements and features
