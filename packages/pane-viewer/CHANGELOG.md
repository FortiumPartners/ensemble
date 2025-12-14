# Changelog

All notable changes to the Ensemble Pane Viewer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Complete adapter implementations
- Terminal UI rendering
- Configuration management
- Hook integration
- Comprehensive test coverage

## [0.1.0] - 2025-12-04

### Added
- Initial plugin structure
- Base adapter interface
- Adapter stubs for WezTerm, Zellij, and tmux
- Multiplexer detection framework
- Pane manager with state tracking
- Configuration loader
- PreToolUse hook integration
- Agent viewer UI (stub)
- `/pane-config` command
- Comprehensive documentation
- Test suite structure
- GitHub Actions workflow
- ESLint configuration

### Infrastructure
- Node.js-based implementation
- Jest test framework
- ESLint code quality
- npm package structure

## Release Notes

### Version 0.1.0 - Initial Release

This is the initial scaffolding release of the Ensemble Pane Viewer plugin. Core structure is in place, but implementations are stubs marked with TODOs.

**Status**: Development / Not Ready for Use

**Next Steps**:
1. Implement WezTerm adapter
2. Implement Zellij adapter
3. Implement tmux adapter
4. Build terminal UI renderer
5. Complete hook integration
6. Add comprehensive tests
7. Production testing

**Target**: v1.0.0 - Full working implementation

[Unreleased]: https://github.com/FortiumPartners/ensemble-pane-viewer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/FortiumPartners/ensemble-pane-viewer/releases/tag/v0.1.0
