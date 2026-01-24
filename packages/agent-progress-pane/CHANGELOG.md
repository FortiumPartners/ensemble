# Changelog

All notable changes to the Ensemble Agent Progress Pane will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.2.0] - 2025-12-17

### Added
- **Collapsible Tool Details**: Interactive keyboard-driven expand/collapse of tool outputs
  - Tools are collapsed by default, showing only tool name with `[+]` indicator
  - Press `e` or `Enter` to expand current tool and view full output (shows `[-]`)
  - Press `a` to toggle all tools expanded/collapsed
  - Press `j/k` or arrow keys to navigate between tools
  - Press `q` to exit viewer early
  - Current tool marked with `▶` cursor
  - Footer shows available keyboard shortcuts
- State management with parallel arrays for tool tracking
- Non-blocking keyboard input handling with 100ms timeout
- Event-driven main loop with combined input/render handling
- Real-time tool updates continue during keyboard interaction

### Performance
- Keypress response time: <50ms
- Supports 50+ tools without degradation
- No screen flicker on redraw

## [5.1.0] - 2025-12-16

### Changed
- **RENAMED**: Package renamed from `ensemble-pane-viewer` to `ensemble-agent-progress-pane` for clarity and consistency with `ensemble-task-progress-pane`
- Updated all config and state paths to use `agent-progress-pane` directory name
- Added backward compatibility for existing `pane-viewer` config and state paths
- Updated migration script to handle `pane-viewer` to `agent-progress-pane` migration

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

This is the initial scaffolding release of the Ensemble Agent Progress Pane plugin (formerly Pane Viewer). Core structure is in place, but implementations are stubs marked with TODOs.

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

[Unreleased]: https://github.com/FortiumPartners/ensemble/compare/v5.2.0...HEAD
[5.2.0]: https://github.com/FortiumPartners/ensemble/releases/tag/v5.2.0
[5.1.0]: https://github.com/FortiumPartners/ensemble/releases/tag/v5.1.0
[0.1.0]: https://github.com/FortiumPartners/ensemble/releases/tag/v0.1.0
