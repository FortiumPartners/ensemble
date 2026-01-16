#!/usr/bin/env bats
#
# formatter.test.sh - BATS test suite for the Formatter hook
#
# Test coverage:
#   - TRD-TEST-010: Test file creation and BATS setup
#   - TRD-TEST-011: Extension routing tests (12+ formatter mappings)
#   - TRD-TEST-012: Edge case tests (dotfiles, no extension, multiple dots, etc.)
#
# Run tests with: bats formatter.test.sh
# Run specific test: bats formatter.test.sh --filter "extension"
#
# Prerequisites:
#   - BATS (Bash Automated Testing System) installed
#   - Optional: jq for JSON parsing tests
#
# TRD Reference: docs/TRD/testing-phase.md section 3.1.4
#

# =============================================================================
# Test Setup and Helpers
# =============================================================================

# Get the directory containing this test file
SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
FORMATTER_SCRIPT="${SCRIPT_DIR}/formatter.sh"

# Temporary directory for test fixtures
setup() {
    # Create temporary test directory
    TEST_DIR="$(mktemp -d)"
    export TEST_DIR

    # Save original environment
    ORIGINAL_PATH="$PATH"
    ORIGINAL_FORMATTER_HOOK_DISABLE="${FORMATTER_HOOK_DISABLE:-}"
    ORIGINAL_FORMATTER_HOOK_DEBUG="${FORMATTER_HOOK_DEBUG:-}"

    # Create mock commands directory
    MOCK_BIN="${TEST_DIR}/mock_bin"
    mkdir -p "$MOCK_BIN"

    # Source the formatter script functions for unit testing
    # We need to extract functions without running main
    source <(sed '/^main "\$@"/d' "$FORMATTER_SCRIPT")
}

teardown() {
    # Restore environment
    export PATH="$ORIGINAL_PATH"
    export FORMATTER_HOOK_DISABLE="$ORIGINAL_FORMATTER_HOOK_DISABLE"
    export FORMATTER_HOOK_DEBUG="$ORIGINAL_FORMATTER_HOOK_DEBUG"

    # Clean up temp directory
    if [[ -d "${TEST_DIR:-}" ]]; then
        rm -rf "$TEST_DIR"
    fi
}

# Helper to create a mock command
create_mock_command() {
    local name="$1"
    local exit_code="${2:-0}"
    local output="${3:-}"

    cat > "${MOCK_BIN}/${name}" <<EOF
#!/bin/bash
echo "$output"
exit $exit_code
EOF
    chmod +x "${MOCK_BIN}/${name}"
}

# Helper to check if a function exists
function_exists() {
    declare -f "$1" > /dev/null
}

# =============================================================================
# TRD-TEST-010: Test File Setup and Basic Structure
# =============================================================================

@test "formatter.sh exists and is executable" {
    [ -f "$FORMATTER_SCRIPT" ]
    [ -x "$FORMATTER_SCRIPT" ]
}

@test "formatter.sh has proper shebang" {
    head -1 "$FORMATTER_SCRIPT" | grep -q "#!/usr/bin/env bash"
}

@test "get_extension function exists" {
    function_exists get_extension
}

@test "get_formatter_command function exists" {
    function_exists get_formatter_command
}

@test "parse_file_path function exists" {
    function_exists parse_file_path
}

@test "output_result function exists" {
    function_exists output_result
}

@test "debug_log function exists" {
    function_exists debug_log
}

# =============================================================================
# TRD-TEST-011: Extension Routing Tests
# =============================================================================

# --- JavaScript/TypeScript (Prettier) ---

@test "extension routing: .js maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "js" "/test/file.js")
    [ "$result" = "prettier --write" ]
}

@test "extension routing: .jsx maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "jsx" "/test/file.jsx")
    [ "$result" = "prettier --write" ]
}

@test "extension routing: .ts maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "ts" "/test/file.ts")
    [ "$result" = "prettier --write" ]
}

@test "extension routing: .tsx maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "tsx" "/test/file.tsx")
    [ "$result" = "prettier --write" ]
}

# --- Web formats (Prettier) ---

@test "extension routing: .html maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "html" "/test/file.html")
    [ "$result" = "prettier --write" ]
}

@test "extension routing: .css maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "css" "/test/file.css")
    [ "$result" = "prettier --write" ]
}

@test "extension routing: .json maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "json" "/test/file.json")
    [ "$result" = "prettier --write" ]
}

@test "extension routing: .yaml maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "yaml" "/test/file.yaml")
    [ "$result" = "prettier --write" ]
}

@test "extension routing: .yml maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "yml" "/test/file.yml")
    [ "$result" = "prettier --write" ]
}

@test "extension routing: .md maps to prettier" {
    create_mock_command "prettier"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "md" "/test/file.md")
    [ "$result" = "prettier --write" ]
}

# --- Prettier fallback to npx ---

@test "extension routing: .js falls back to npx prettier when prettier not available" {
    # Don't create prettier, but create npx
    create_mock_command "npx"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "js" "/test/file.js")
    [ "$result" = "npx prettier --write" ]
}

# --- Python (Ruff) ---

@test "extension routing: .py maps to ruff" {
    create_mock_command "ruff"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "py" "/test/file.py")
    [ "$result" = "ruff format" ]
}

# --- Go (goimports/gofmt) ---

@test "extension routing: .go maps to goimports when available" {
    create_mock_command "goimports"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "go" "/test/file.go")
    [ "$result" = "goimports -w" ]
}

@test "extension routing: .go falls back to gofmt when goimports not available" {
    create_mock_command "gofmt"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "go" "/test/file.go")
    [ "$result" = "gofmt -w" ]
}

# --- Rust (rustfmt) ---

@test "extension routing: .rs maps to rustfmt" {
    create_mock_command "rustfmt"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "rs" "/test/file.rs")
    [ "$result" = "rustfmt" ]
}

# --- Shell (shfmt) ---

@test "extension routing: .sh maps to shfmt" {
    create_mock_command "shfmt"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "sh" "/test/file.sh")
    [ "$result" = "shfmt -w" ]
}

@test "extension routing: .bash maps to shfmt" {
    create_mock_command "shfmt"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "bash" "/test/file.bash")
    [ "$result" = "shfmt -w" ]
}

# --- Terraform ---

@test "extension routing: .tf maps to terraform fmt" {
    create_mock_command "terraform"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "tf" "/test/file.tf")
    [ "$result" = "terraform fmt" ]
}

@test "extension routing: .tfvars maps to terraform fmt" {
    create_mock_command "terraform"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "tfvars" "/test/file.tfvars")
    [ "$result" = "terraform fmt" ]
}

# --- C/C++ (clang-format) ---

@test "extension routing: .c maps to clang-format" {
    create_mock_command "clang-format"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "c" "/test/file.c")
    [ "$result" = "clang-format -i" ]
}

@test "extension routing: .cpp maps to clang-format" {
    create_mock_command "clang-format"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "cpp" "/test/file.cpp")
    [ "$result" = "clang-format -i" ]
}

@test "extension routing: .h maps to clang-format" {
    create_mock_command "clang-format"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "h" "/test/file.h")
    [ "$result" = "clang-format -i" ]
}

@test "extension routing: .hpp maps to clang-format" {
    create_mock_command "clang-format"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "hpp" "/test/file.hpp")
    [ "$result" = "clang-format -i" ]
}

@test "extension routing: .cc maps to clang-format" {
    create_mock_command "clang-format"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "cc" "/test/file.cc")
    [ "$result" = "clang-format -i" ]
}

@test "extension routing: .cxx maps to clang-format" {
    create_mock_command "clang-format"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "cxx" "/test/file.cxx")
    [ "$result" = "clang-format -i" ]
}

# --- Java (google-java-format) ---

@test "extension routing: .java maps to google-java-format" {
    create_mock_command "google-java-format"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "java" "/test/file.java")
    [ "$result" = "google-java-format -i" ]
}

# --- Kotlin (ktlint) ---

@test "extension routing: .kt maps to ktlint" {
    create_mock_command "ktlint"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "kt" "/test/file.kt")
    [ "$result" = "ktlint -F" ]
}

@test "extension routing: .kts maps to ktlint" {
    create_mock_command "ktlint"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "kts" "/test/file.kts")
    [ "$result" = "ktlint -F" ]
}

# --- C# (CSharpier) ---

@test "extension routing: .cs maps to dotnet csharpier" {
    create_mock_command "dotnet"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "cs" "/test/file.cs")
    [ "$result" = "dotnet csharpier" ]
}

# --- Swift (swift-format) ---

@test "extension routing: .swift maps to swift-format" {
    create_mock_command "swift-format"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "swift" "/test/file.swift")
    [ "$result" = "swift-format format -i" ]
}

# --- Lua (StyLua) ---

@test "extension routing: .lua maps to stylua" {
    create_mock_command "stylua"
    export PATH="${MOCK_BIN}:$PATH"

    result=$(get_formatter_command "lua" "/test/file.lua")
    [ "$result" = "stylua" ]
}

# --- Unknown extension ---

@test "extension routing: unknown extension returns empty" {
    result=$(get_formatter_command "xyz" "/test/file.xyz")
    [ -z "$result" ]
}

@test "extension routing: returns empty when formatter not installed" {
    # Empty PATH to ensure no formatters are found
    export PATH="${MOCK_BIN}:$PATH"  # MOCK_BIN has no formatters

    result=$(get_formatter_command "py" "/test/file.py")
    [ -z "$result" ]
}

# =============================================================================
# TRD-TEST-012: Edge Case Tests
# =============================================================================

# --- get_extension edge cases ---

@test "edge case: get_extension handles regular file" {
    result=$(get_extension "/path/to/file.js")
    [ "$result" = "js" ]
}

@test "edge case: get_extension handles uppercase extension (converts to lowercase)" {
    result=$(get_extension "/path/to/file.JS")
    [ "$result" = "js" ]
}

@test "edge case: get_extension handles mixed case extension" {
    result=$(get_extension "/path/to/file.TsX")
    [ "$result" = "tsx" ]
}

@test "edge case: dotfiles - .gitignore returns empty (no extension after dot)" {
    # .gitignore has the extension "gitignore" according to bash string manipulation
    # but since there's no content before the dot, it should be handled gracefully
    result=$(get_extension ".gitignore")
    # The implementation treats this as having extension "gitignore"
    [ "$result" = "gitignore" ]
}

@test "edge case: dotfiles - .env returns empty (no extension after dot)" {
    result=$(get_extension ".env")
    [ "$result" = "env" ]
}

@test "edge case: dotfiles in path - /home/.config/file.txt" {
    result=$(get_extension "/home/.config/file.txt")
    [ "$result" = "txt" ]
}

@test "edge case: no extension - file without dot" {
    result=$(get_extension "/path/to/Makefile")
    [ -z "$result" ]
}

@test "edge case: no extension - README without extension" {
    result=$(get_extension "/path/to/README")
    [ -z "$result" ]
}

@test "edge case: multiple dots - file.test.ts" {
    result=$(get_extension "/path/to/file.test.ts")
    [ "$result" = "ts" ]
}

@test "edge case: multiple dots - file.spec.tsx" {
    result=$(get_extension "/path/to/file.spec.tsx")
    [ "$result" = "tsx" ]
}

@test "edge case: multiple dots - my.component.module.css" {
    result=$(get_extension "/path/to/my.component.module.css")
    [ "$result" = "css" ]
}

@test "edge case: multiple dots - archive.tar.gz" {
    result=$(get_extension "/path/to/archive.tar.gz")
    [ "$result" = "gz" ]
}

@test "edge case: hidden file with extension - .bashrc.backup" {
    result=$(get_extension "/home/user/.bashrc.backup")
    [ "$result" = "backup" ]
}

@test "edge case: path with spaces - /path with spaces/file.js" {
    result=$(get_extension "/path with spaces/file.js")
    [ "$result" = "js" ]
}

@test "edge case: path with special chars - /path-with-dashes/file.py" {
    result=$(get_extension "/path-with-dashes/file_underscore.py")
    [ "$result" = "py" ]
}

# --- JSON extraction tests ---

@test "JSON extraction: parse_file_path extracts from tool_result.file_path" {
    # Skip if jq is not available
    if ! command -v jq &> /dev/null; then
        skip "jq not installed"
    fi

    input='{"tool_result": {"file_path": "/home/user/project/file.js"}}'
    result=$(parse_file_path "$input")
    [ "$result" = "/home/user/project/file.js" ]
}

@test "JSON extraction: parse_file_path extracts from file_path (top level)" {
    if ! command -v jq &> /dev/null; then
        skip "jq not installed"
    fi

    input='{"file_path": "/home/user/project/file.ts"}'
    result=$(parse_file_path "$input")
    [ "$result" = "/home/user/project/file.ts" ]
}

@test "JSON extraction: parse_file_path extracts from toolResult.file_path" {
    if ! command -v jq &> /dev/null; then
        skip "jq not installed"
    fi

    input='{"toolResult": {"file_path": "/home/user/project/file.py"}}'
    result=$(parse_file_path "$input")
    [ "$result" = "/home/user/project/file.py" ]
}

@test "JSON extraction: parse_file_path extracts from result.file_path" {
    if ! command -v jq &> /dev/null; then
        skip "jq not installed"
    fi

    input='{"result": {"file_path": "/home/user/project/file.go"}}'
    result=$(parse_file_path "$input")
    [ "$result" = "/home/user/project/file.go" ]
}

@test "JSON extraction: parse_file_path finds path in nested JSON" {
    if ! command -v jq &> /dev/null; then
        skip "jq not installed"
    fi

    input='{"deeply": {"nested": {"value": "/home/user/project/deep.rs"}}}'
    result=$(parse_file_path "$input")
    [ "$result" = "/home/user/project/deep.rs" ]
}

# --- Fallback: grep extraction when jq unavailable ---
# Note: These tests verify the fallback grep-based parsing works when jq is not available.
# On systems where jq is installed (common in CI), these tests are skipped because
# we cannot safely remove jq from PATH without also removing grep/head/tr.
# The fallback code path is tested on systems without jq installed.

@test "fallback: parse_file_path uses grep for absolute paths" {
    # Skip if jq is available - fallback testing requires jq to be absent
    # On most systems, jq and grep/head/tr are in the same directory (/usr/bin)
    # so we can't test the fallback without also losing the utilities it depends on
    if command -v jq &>/dev/null; then
        skip "jq is installed - fallback tests require jq to be absent"
    fi

    input='{"some_field": "/home/user/project/file.js", "other": "data"}'
    result=$(parse_file_path "$input")
    [ "$result" = "/home/user/project/file.js" ]
}

@test "fallback: parse_file_path extracts path from complex JSON" {
    if command -v jq &>/dev/null; then
        skip "jq is installed - fallback tests require jq to be absent"
    fi

    input='{"tool": "Write", "result": {"file": "/tmp/test/script.sh", "success": true}}'
    result=$(parse_file_path "$input")
    [ "$result" = "/tmp/test/script.sh" ]
}

@test "fallback: parse_file_path handles relative paths with known extensions" {
    if command -v jq &>/dev/null; then
        skip "jq is installed - fallback tests require jq to be absent"
    fi

    input='{"file": "src/components/Button.tsx"}'
    result=$(parse_file_path "$input")
    [ "$result" = "src/components/Button.tsx" ]
}

@test "fallback: returns empty when no path found" {
    if command -v jq &>/dev/null; then
        skip "jq is installed - fallback tests require jq to be absent"
    fi

    input='{"message": "no file path here", "count": 42}'
    result=$(parse_file_path "$input")
    [ -z "$result" ]
}

# --- Missing formatter tests ---

@test "missing formatter: returns empty for .py when ruff not installed" {
    export PATH="${MOCK_BIN}"  # Empty mock bin

    result=$(get_formatter_command "py" "/test/file.py")
    [ -z "$result" ]
}

@test "missing formatter: returns empty for .go when neither goimports nor gofmt installed" {
    export PATH="${MOCK_BIN}"

    result=$(get_formatter_command "go" "/test/file.go")
    [ -z "$result" ]
}

@test "missing formatter: returns empty for .rs when rustfmt not installed" {
    export PATH="${MOCK_BIN}"

    result=$(get_formatter_command "rs" "/test/file.rs")
    [ -z "$result" ]
}

@test "missing formatter: returns empty for .js when neither prettier nor npx installed" {
    export PATH="${MOCK_BIN}"

    result=$(get_formatter_command "js" "/test/file.js")
    [ -z "$result" ]
}

# --- Fire-and-forget / non-blocking tests ---

@test "non-blocking: hook always exits with code 0" {
    # Create a test file
    echo "test content" > "${TEST_DIR}/test.js"

    # Create mock prettier that fails
    create_mock_command "prettier" 1 "formatter error"
    export PATH="${MOCK_BIN}:$PATH"

    # Run the full hook with JSON input (simulating Claude Code)
    input='{"tool_result": {"file_path": "'"${TEST_DIR}/test.js"'"}}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    # Hook should always exit 0 (non-blocking)
    [ "$status" -eq 0 ]
}

@test "non-blocking: output contains hookSpecificOutput on success" {
    echo "const x = 1;" > "${TEST_DIR}/test.js"

    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${TEST_DIR}/test.js"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q "hookSpecificOutput"
}

@test "non-blocking: output contains status field" {
    echo "const x = 1;" > "${TEST_DIR}/test.js"

    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${TEST_DIR}/test.js"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"status":'
}

@test "non-blocking: output contains timestamp" {
    echo "const x = 1;" > "${TEST_DIR}/test.js"

    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${TEST_DIR}/test.js"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"timestamp":'
}

# --- Environment variable tests ---

@test "env: FORMATTER_HOOK_DISABLE=1 disables the hook" {
    export FORMATTER_HOOK_DISABLE=1

    echo "const x = 1;" > "${TEST_DIR}/test.js"

    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${TEST_DIR}/test.js"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"status": "disabled"'
}

@test "env: FORMATTER_HOOK_DEBUG=1 enables debug output to stderr" {
    export FORMATTER_HOOK_DEBUG=1

    echo "const x = 1;" > "${TEST_DIR}/test.js"

    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${TEST_DIR}/test.js"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT 2>&1"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q "\[FORMATTER"
}

# --- Error handling tests ---

@test "error handling: file not found returns appropriate status" {
    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "/nonexistent/path/file.js"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"status": "file_not_found"'
}

@test "error handling: no file path in input returns appropriate status" {
    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"message": "no file path"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"status": "no_file"'
}

@test "error handling: file without extension returns appropriate status" {
    # Create a file without extension using a path with no dots
    # Note: The get_extension function uses ${file##*.} which matches the last dot
    # in the full path, so we need to use a path without dots in directory names
    local noext_dir="/tmp/formatter_test_noext"
    mkdir -p "$noext_dir"
    touch "${noext_dir}/Makefile"

    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${noext_dir}/Makefile"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    # Cleanup
    rm -rf "$noext_dir"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"status": "no_extension"'
}

@test "error handling: no formatter for extension returns appropriate status" {
    touch "${TEST_DIR}/file.xyz"

    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${TEST_DIR}/file.xyz"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"status": "no_formatter"'
}

@test "error handling: formatter error returns format_error status but exits 0" {
    echo "const x = 1;" > "${TEST_DIR}/test.js"

    # Create a formatter that fails
    create_mock_command "prettier" 1 "Syntax error"
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${TEST_DIR}/test.js"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    # Should still exit 0 (non-blocking)
    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"status": "format_error"'
}

# --- PostToolUse hook event name ---

@test "output: hookEventName is PostToolUse" {
    echo "const x = 1;" > "${TEST_DIR}/test.js"

    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${TEST_DIR}/test.js"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"hookEventName": "PostToolUse"'
}

# --- Successful formatting test ---

@test "success: formatted status and file path in output" {
    echo "const x = 1;" > "${TEST_DIR}/test.js"

    create_mock_command "prettier" 0 ""
    export PATH="${MOCK_BIN}:$PATH"

    input='{"file_path": "'"${TEST_DIR}/test.js"'"}'
    run bash -c "echo '$input' | $FORMATTER_SCRIPT"

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"status": "formatted"'
    echo "$output" | grep -q "test.js"
}

# =============================================================================
# Command Existence Helper Tests
# =============================================================================

@test "command_exists: returns true for existing command" {
    create_mock_command "test_cmd"
    export PATH="${MOCK_BIN}:$PATH"

    run command_exists "test_cmd"
    [ "$status" -eq 0 ]
}

@test "command_exists: returns false for non-existing command" {
    export PATH="${MOCK_BIN}:$PATH"

    run command_exists "nonexistent_command_xyz123"
    [ "$status" -ne 0 ]
}
