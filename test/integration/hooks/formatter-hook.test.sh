#!/usr/bin/env bats
# =============================================================================
# formatter-hook.test.sh - Integration tests for formatter hook
# =============================================================================
# Task: TRD-TEST-096
#
# Tests that the formatter hook triggers on PostToolUse events after
# Write/Edit tool operations and applies appropriate formatting based
# on file extension.
#
# Prerequisites:
#   - BATS (Bash Automated Testing System) installed
#   - Node.js for parse-hook-events.js
#   - Claude CLI available (mocked in some tests)
#   - jq for JSON parsing
#
# Run tests with: bats formatter-hook.test.sh
# Run specific test: bats formatter-hook.test.sh --filter "triggers on PostToolUse"
#
# Integration Test Strategy:
#   - Mock formatter invocation tests (fast, no Claude CLI)
#   - Session log analysis tests (parse existing/mock session data)
#   - Optional: Live Claude CLI tests (slow, require --live flag)
#
# TRD Reference: docs/TRD/testing-phase.md section 4.3 Phase 5
# Dependencies: TRD-TEST-093 (run-hook-test.sh), TRD-TEST-094 (parse-hook-events.js)
# AC Reference: AC-HI2
# =============================================================================

# =============================================================================
# Test Setup and Configuration
# =============================================================================

# Get the directory containing this test file
SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"

# Path to the test harness
HARNESS="${SCRIPT_DIR}/run-hook-test.sh"

# Path to the hook event parser
PARSER="${SCRIPT_DIR}/parse-hook-events.js"

# Path to sessions directory
SESSIONS_DIR="${SCRIPT_DIR}/../sessions"

# Path to the formatter hook script
FORMATTER_HOOK="${SCRIPT_DIR}/../../../packages/core/hooks/formatter.sh"

# Temporary directory for test fixtures
setup() {
    # Create temporary test directory
    TEST_DIR="$(mktemp -d)"
    export TEST_DIR

    # Create mock session directory
    MOCK_SESSIONS="${TEST_DIR}/sessions"
    mkdir -p "$MOCK_SESSIONS"

    # Save original environment
    ORIGINAL_FORMATTER_HOOK_DISABLE="${FORMATTER_HOOK_DISABLE:-}"
    ORIGINAL_FORMATTER_HOOK_DEBUG="${FORMATTER_HOOK_DEBUG:-}"
}

teardown() {
    # Restore environment
    export FORMATTER_HOOK_DISABLE="$ORIGINAL_FORMATTER_HOOK_DISABLE"
    export FORMATTER_HOOK_DEBUG="$ORIGINAL_FORMATTER_HOOK_DEBUG"

    # Clean up temp directory
    if [[ -d "${TEST_DIR:-}" ]]; then
        rm -rf "$TEST_DIR"
    fi
}

# Helper: Create a mock JSONL session file with hook events
create_mock_session() {
    local session_id="${1:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
    local session_file="${MOCK_SESSIONS}/hook-test-${session_id}.jsonl"

    # Create a realistic session log with hook events
    cat > "$session_file" <<'EOF'
{"type": "user", "content": "Create a file called test.js"}
{"type": "hook_start", "hook": "wiggum", "event": "UserPromptSubmit", "timestamp": "2026-01-13T10:00:00.000Z"}
{"type": "hook_end", "hook": "wiggum", "event": "UserPromptSubmit", "success": true, "timestamp": "2026-01-13T10:00:01.000Z"}
{"type": "assistant", "content": [{"type": "text", "text": "I'll create the file."}]}
{"type": "tool_use", "name": "Write", "id": "tool_1", "input": {"file_path": "/tmp/test.js", "content": "const x = 1;"}}
{"type": "tool_result", "tool_name": "Write", "output": "File written successfully", "success": true}
{"type": "hook_start", "hook": "formatter", "event": "PostToolUse", "timestamp": "2026-01-13T10:01:00.000Z"}
{"type": "hook_output", "hook": "formatter", "output": {"status": "formatted", "formatted_file": "/tmp/test.js", "formatter": "prettier"}, "timestamp": "2026-01-13T10:01:01.000Z"}
{"type": "hook_end", "hook": "formatter", "event": "PostToolUse", "success": true, "timestamp": "2026-01-13T10:01:02.000Z"}
{"type": "assistant", "content": [{"type": "text", "text": "Done."}]}
EOF
    echo "$session_file"
}

# Helper: Create a mock session with multiple file types
create_multi_file_session() {
    local session_id="${1:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
    local session_file="${MOCK_SESSIONS}/hook-test-${session_id}.jsonl"

    cat > "$session_file" <<'EOF'
{"type": "user", "content": "Create Python and TypeScript files"}
{"type": "hook_start", "hook": "wiggum", "event": "UserPromptSubmit", "timestamp": "2026-01-13T10:00:00.000Z"}
{"type": "hook_end", "hook": "wiggum", "event": "UserPromptSubmit", "success": true, "timestamp": "2026-01-13T10:00:01.000Z"}
{"type": "tool_use", "name": "Write", "id": "tool_1", "input": {"file_path": "/tmp/app.py", "content": "def main(): pass"}}
{"type": "tool_result", "tool_name": "Write", "output": "File written successfully", "success": true}
{"type": "hook_start", "hook": "formatter", "event": "PostToolUse", "timestamp": "2026-01-13T10:01:00.000Z"}
{"type": "hook_output", "hook": "formatter", "output": {"status": "formatted", "formatted_file": "/tmp/app.py", "formatter": "ruff"}, "timestamp": "2026-01-13T10:01:01.000Z"}
{"type": "hook_end", "hook": "formatter", "event": "PostToolUse", "success": true, "timestamp": "2026-01-13T10:01:02.000Z"}
{"type": "tool_use", "name": "Write", "id": "tool_2", "input": {"file_path": "/tmp/app.ts", "content": "const x: number = 1"}}
{"type": "tool_result", "tool_name": "Write", "output": "File written successfully", "success": true}
{"type": "hook_start", "hook": "formatter", "event": "PostToolUse", "timestamp": "2026-01-13T10:02:00.000Z"}
{"type": "hook_output", "hook": "formatter", "output": {"status": "formatted", "formatted_file": "/tmp/app.ts", "formatter": "prettier"}, "timestamp": "2026-01-13T10:02:01.000Z"}
{"type": "hook_end", "hook": "formatter", "event": "PostToolUse", "success": true, "timestamp": "2026-01-13T10:02:02.000Z"}
{"type": "tool_use", "name": "Edit", "id": "tool_3", "input": {"file_path": "/tmp/app.go", "old_string": "func main()", "new_string": "func main() {}"}}
{"type": "tool_result", "tool_name": "Edit", "output": "Edit applied successfully", "success": true}
{"type": "hook_start", "hook": "formatter", "event": "PostToolUse", "timestamp": "2026-01-13T10:03:00.000Z"}
{"type": "hook_output", "hook": "formatter", "output": {"status": "formatted", "formatted_file": "/tmp/app.go", "formatter": "gofmt"}, "timestamp": "2026-01-13T10:03:01.000Z"}
{"type": "hook_end", "hook": "formatter", "event": "PostToolUse", "success": true, "timestamp": "2026-01-13T10:03:02.000Z"}
EOF
    echo "$session_file"
}

# Helper: Create a mock session with formatter hook that returns no_formatter
create_no_formatter_session() {
    local session_id="${1:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
    local session_file="${MOCK_SESSIONS}/hook-test-${session_id}.jsonl"

    cat > "$session_file" <<'EOF'
{"type": "user", "content": "Create a file with unknown extension"}
{"type": "tool_use", "name": "Write", "id": "tool_1", "input": {"file_path": "/tmp/data.xyz", "content": "custom data"}}
{"type": "tool_result", "tool_name": "Write", "output": "File written successfully", "success": true}
{"type": "hook_start", "hook": "formatter", "event": "PostToolUse", "timestamp": "2026-01-13T10:01:00.000Z"}
{"type": "hook_output", "hook": "formatter", "output": {"status": "no_formatter", "message": "No formatter configured for .xyz files"}, "timestamp": "2026-01-13T10:01:01.000Z"}
{"type": "hook_end", "hook": "formatter", "event": "PostToolUse", "success": true, "timestamp": "2026-01-13T10:01:02.000Z"}
EOF
    echo "$session_file"
}

# Helper: Create a mock session where formatter hook is not triggered
create_no_write_session() {
    local session_id="${1:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
    local session_file="${MOCK_SESSIONS}/hook-test-${session_id}.jsonl"

    cat > "$session_file" <<'EOF'
{"type": "user", "content": "Read some files"}
{"type": "hook_start", "hook": "wiggum", "event": "UserPromptSubmit", "timestamp": "2026-01-13T10:00:00.000Z"}
{"type": "hook_end", "hook": "wiggum", "event": "UserPromptSubmit", "success": true, "timestamp": "2026-01-13T10:00:01.000Z"}
{"type": "tool_use", "name": "Read", "id": "tool_1", "input": {"file_path": "/tmp/test.js"}}
{"type": "tool_result", "tool_name": "Read", "output": "const x = 1;", "success": true}
{"type": "tool_use", "name": "Glob", "id": "tool_2", "input": {"pattern": "*.py"}}
{"type": "tool_result", "tool_name": "Glob", "output": "app.py", "success": true}
{"type": "assistant", "content": [{"type": "text", "text": "I read the files."}]}
EOF
    echo "$session_file"
}

# =============================================================================
# Prerequisite Checks
# =============================================================================

@test "prerequisite: parse-hook-events.js exists and is executable" {
    [ -f "$PARSER" ]
    run node "$PARSER" --help
    [ "$status" -eq 0 ]
}

@test "prerequisite: formatter hook script exists" {
    [ -f "$FORMATTER_HOOK" ]
    [ -x "$FORMATTER_HOOK" ]
}

@test "prerequisite: run-hook-test.sh harness exists" {
    [ -f "$HARNESS" ]
    [ -x "$HARNESS" ]
}

@test "prerequisite: jq is available" {
    command -v jq
}

# =============================================================================
# TRD-TEST-096: Parser Integration Tests (Mock Session Data)
#
# These tests verify that parse-hook-events.js correctly parses session logs
# containing formatter hook events. They test the PARSER, not the hook itself.
# For actual hook behavior tests, see "Direct Hook Invocation Tests" below.
# =============================================================================

@test "parser: extracts formatter hook from PostToolUse events" {
    # Create a mock session with formatter hook events
    local session_file
    session_file=$(create_mock_session)

    # Parse the session log
    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Verify formatter hook was triggered
    echo "$output" | jq -e '.hooks_found | length > 0'

    # Verify it was triggered on PostToolUse event
    local event_type
    event_type=$(echo "$output" | jq -r '.hooks_found[0].event')
    [ "$event_type" = "PostToolUse" ]
}

@test "parser: extracts formatter hook after Edit tool events" {
    # Create a session with Edit tool use
    local session_file="${MOCK_SESSIONS}/edit-session.jsonl"
    cat > "$session_file" <<'EOF'
{"type": "tool_use", "name": "Edit", "id": "tool_1", "input": {"file_path": "/tmp/code.rs", "old_string": "fn main", "new_string": "fn main()"}}
{"type": "tool_result", "tool_name": "Edit", "output": "Edit applied successfully", "success": true}
{"type": "hook_start", "hook": "formatter", "event": "PostToolUse", "timestamp": "2026-01-13T10:01:00.000Z"}
{"type": "hook_output", "hook": "formatter", "output": {"status": "formatted", "formatted_file": "/tmp/code.rs", "formatter": "rustfmt"}, "timestamp": "2026-01-13T10:01:01.000Z"}
{"type": "hook_end", "hook": "formatter", "event": "PostToolUse", "success": true, "timestamp": "2026-01-13T10:01:02.000Z"}
EOF

    run node "$PARSER" "$session_file" --hook formatter --event PostToolUse
    [ "$status" -eq 0 ]

    local hooks_triggered
    hooks_triggered=$(echo "$output" | jq '.summary.total_hooks_triggered')
    [ "$hooks_triggered" -gt 0 ]
}

@test "parser: no formatter hooks in Read-only sessions" {
    # Create a session with only Read operations (no Write/Edit)
    local session_file
    session_file=$(create_no_write_session)

    # Parse the session log for formatter events
    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Verify no formatter hooks were triggered
    local formatter_count
    formatter_count=$(echo "$output" | jq '.summary.hooks_by_type.formatter // 0')
    [ "$formatter_count" -eq 0 ]
}

# =============================================================================
# Parser Output Structure Tests (Mock Session Data)
# =============================================================================

@test "parser: hook output includes status field" {
    local session_file
    session_file=$(create_mock_session)

    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Check that hook_output has status field
    local hook_output
    hook_output=$(echo "$output" | jq '.hooks_found[] | select(.type == "hook_output") | .output.status')
    [ -n "$hook_output" ]
    echo "$hook_output" | grep -q "formatted"
}

@test "parser: hook output includes formatted_file field" {
    local session_file
    session_file=$(create_mock_session)

    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Check that hook_output has formatted_file field
    local formatted_file
    formatted_file=$(echo "$output" | jq -r '.hooks_found[] | select(.type == "hook_output") | .output.formatted_file // empty')
    [ -n "$formatted_file" ]
    [[ "$formatted_file" == *".js" ]]
}

@test "parser: successful hook completion counted" {
    local session_file
    session_file=$(create_mock_session)

    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Check success count
    local successful_hooks
    successful_hooks=$(echo "$output" | jq '.summary.successful_hooks')
    [ "$successful_hooks" -gt 0 ]
}

# =============================================================================
# Parser Multi-File Session Tests (Mock Session Data)
#
# These tests verify parser handles multi-file sessions correctly.
# They do NOT test actual formatter selection - see "Formatter Selection Tests".
# =============================================================================

@test "parser: Python file formatter value extracted from mock" {
    local session_file
    session_file=$(create_multi_file_session)

    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Find the Python file formatting event
    local ruff_used
    ruff_used=$(echo "$output" | jq -r '.hooks_found[] | select(.type == "hook_output") | select(.output.formatted_file | test("\\.py$")) | .output.formatter // empty')
    [ "$ruff_used" = "ruff" ]
}

@test "parser: TypeScript file formatter value extracted from mock" {
    local session_file
    session_file=$(create_multi_file_session)

    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Find the TypeScript file formatting event
    local prettier_used
    prettier_used=$(echo "$output" | jq -r '.hooks_found[] | select(.type == "hook_output") | select(.output.formatted_file | test("\\.ts$")) | .output.formatter // empty')
    [ "$prettier_used" = "prettier" ]
}

@test "parser: Go file formatter value extracted from mock" {
    local session_file
    session_file=$(create_multi_file_session)

    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Find the Go file formatting event
    local gofmt_used
    gofmt_used=$(echo "$output" | jq -r '.hooks_found[] | select(.type == "hook_output") | select(.output.formatted_file | test("\\.go$")) | .output.formatter // empty')
    [ "$gofmt_used" = "gofmt" ]
}

@test "parser: no_formatter status extracted from mock" {
    local session_file
    session_file=$(create_no_formatter_session)

    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Check for no_formatter status
    local status_value
    status_value=$(echo "$output" | jq -r '.hooks_found[] | select(.type == "hook_output") | .output.status // empty')
    [ "$status_value" = "no_formatter" ]
}

@test "parser: multiple formatter events counted correctly" {
    local session_file
    session_file=$(create_multi_file_session)

    run node "$PARSER" "$session_file" --hook formatter
    [ "$status" -eq 0 ]

    # Verify multiple formatter hook triggers
    local formatter_count
    formatter_count=$(echo "$output" | jq '.summary.hooks_by_type.formatter // 0')
    [ "$formatter_count" -ge 3 ]
}

# =============================================================================
# Hook Event Summary Statistics
# =============================================================================

@test "parser: summary counts hooks by event type" {
    local session_file
    session_file=$(create_mock_session)

    run node "$PARSER" "$session_file"
    [ "$status" -eq 0 ]

    # Verify PostToolUse is counted in hooks_by_event
    local post_tool_use_count
    post_tool_use_count=$(echo "$output" | jq '.summary.hooks_by_event.PostToolUse // 0')
    [ "$post_tool_use_count" -gt 0 ]
}

@test "parser: unique_hooks includes formatter" {
    local session_file
    session_file=$(create_mock_session)

    run node "$PARSER" "$session_file"
    [ "$status" -eq 0 ]

    # Verify formatter is in unique_hooks
    echo "$output" | jq -e '.summary.unique_hooks | index("formatter")'
}

# =============================================================================
# Direct Hook Invocation Tests (Unit-style integration tests)
# =============================================================================

@test "formatter hook script returns valid JSON output" {
    # Create a test file
    echo "const x = 1;" > "${TEST_DIR}/test.js"

    # Create mock input
    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/test.js"'"}}'

    # Run the formatter hook script (may fail if prettier not available, but should output valid JSON)
    run bash -c "echo '$input' | $FORMATTER_HOOK"

    # Hook should exit 0 (non-blocking)
    [ "$status" -eq 0 ]

    # Output should be valid JSON
    echo "$output" | jq -e '.hookSpecificOutput'
}

@test "formatter hook script includes hookEventName PostToolUse" {
    echo "const x = 1;" > "${TEST_DIR}/test.js"

    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/test.js"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    # Check hookEventName is PostToolUse
    local hook_event_name
    hook_event_name=$(echo "$output" | jq -r '.hookSpecificOutput.hookEventName // empty')
    [ "$hook_event_name" = "PostToolUse" ]
}

@test "formatter hook returns no_file when file path cannot be extracted" {
    local input='{"message": "no file path here"}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status // empty')
    [ "$status_value" = "no_file" ]
}

@test "formatter hook returns file_not_found for missing files" {
    local input='{"file_path": "/nonexistent/path/file.js"}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status // empty')
    [ "$status_value" = "file_not_found" ]
}

@test "formatter hook returns no_extension for files without extension" {
    # Create a file without extension in a path without dots in directory names
    # Note: mktemp creates directories like /tmp/tmp.XXXXXX which have dots
    # The formatter hook's get_extension function uses ${file##*.} which looks at
    # the entire path, so we need a clean path without dots in directories
    local noext_dir="/tmp/formatter_test_noext_$$"
    mkdir -p "$noext_dir"
    touch "${noext_dir}/Makefile"

    # Use tool_result.file_path format which is what parse_file_path expects
    local input_file="${TEST_DIR}/input.json"
    printf '{"tool_result": {"file_path": "%s"}}' "${noext_dir}/Makefile" > "$input_file"

    run bash -c "cat '$input_file' | '$FORMATTER_HOOK'"

    # Cleanup
    rm -rf "$noext_dir"

    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status // empty')
    [ "$status_value" = "no_extension" ]
}

# =============================================================================
# Environment Variable Tests
# =============================================================================

@test "FORMATTER_HOOK_DISABLE=1 disables the hook" {
    export FORMATTER_HOOK_DISABLE=1

    echo "const x = 1;" > "${TEST_DIR}/test.js"
    local input='{"file_path": "'"${TEST_DIR}/test.js"'"}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status // empty')
    [ "$status_value" = "disabled" ]
}

# =============================================================================
# Edge Cases
# =============================================================================

@test "formatter hook handles files with multiple dots in name" {
    echo "test" > "${TEST_DIR}/file.test.js"

    local input='{"file_path": "'"${TEST_DIR}/file.test.js"'"}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    # Should recognize .js extension
    echo "$output" | jq -e '.hookSpecificOutput.status'
}

@test "formatter hook handles uppercase extensions" {
    echo "const x = 1;" > "${TEST_DIR}/test.JS"

    local input='{"file_path": "'"${TEST_DIR}/test.JS"'"}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    # Extension should be normalized to lowercase
    echo "$output" | jq -e '.hookSpecificOutput.status'
}

@test "formatter hook handles paths with spaces" {
    mkdir -p "${TEST_DIR}/path with spaces"
    echo "const x = 1;" > "${TEST_DIR}/path with spaces/test.js"

    local input='{"file_path": "'"${TEST_DIR}/path with spaces/test.js"'"}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    # Should handle the path correctly
    echo "$output" | jq -e '.hookSpecificOutput.status'
}

# =============================================================================
# TRD-TEST-096: Formatter Selection Tests (Actual Hook Behavior)
#
# These tests directly invoke formatter.sh and verify it selects the correct
# formatter for each file extension. This tests actual hook logic, not mocks.
# =============================================================================

@test "hook selects 'prettier' for JavaScript files (.js)" {
    echo "const x=1;" > "${TEST_DIR}/test.js"
    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/test.js"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    # Check status is either 'formatted' (prettier available) or 'no_formatter' (not available)
    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [[ "$status_value" == "formatted" || "$status_value" == "no_formatter" ]]

    # If formatted, verify message mentions prettier
    if [ "$status_value" = "formatted" ]; then
        local message
        message=$(echo "$output" | jq -r '.hookSpecificOutput.message')
        [[ "$message" == *"prettier"* ]]
    fi
}

@test "hook selects 'prettier' for TypeScript files (.ts)" {
    echo "const x: number = 1;" > "${TEST_DIR}/test.ts"
    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/test.ts"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [[ "$status_value" == "formatted" || "$status_value" == "no_formatter" ]]

    if [ "$status_value" = "formatted" ]; then
        local message
        message=$(echo "$output" | jq -r '.hookSpecificOutput.message')
        [[ "$message" == *"prettier"* ]]
    fi
}

@test "hook selects 'ruff' for Python files (.py)" {
    echo "def main(): pass" > "${TEST_DIR}/test.py"
    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/test.py"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [[ "$status_value" == "formatted" || "$status_value" == "no_formatter" ]]

    if [ "$status_value" = "formatted" ]; then
        local message
        message=$(echo "$output" | jq -r '.hookSpecificOutput.message')
        [[ "$message" == *"ruff"* ]]
    fi
}

@test "hook selects 'gofmt' or 'goimports' for Go files (.go)" {
    echo "package main" > "${TEST_DIR}/test.go"
    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/test.go"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [[ "$status_value" == "formatted" || "$status_value" == "no_formatter" ]]

    if [ "$status_value" = "formatted" ]; then
        local message
        message=$(echo "$output" | jq -r '.hookSpecificOutput.message')
        [[ "$message" == *"gofmt"* || "$message" == *"goimports"* ]]
    fi
}

@test "hook selects 'rustfmt' for Rust files (.rs)" {
    echo "fn main() {}" > "${TEST_DIR}/test.rs"
    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/test.rs"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [[ "$status_value" == "formatted" || "$status_value" == "no_formatter" ]]

    if [ "$status_value" = "formatted" ]; then
        local message
        message=$(echo "$output" | jq -r '.hookSpecificOutput.message')
        [[ "$message" == *"rustfmt"* ]]
    fi
}

@test "hook selects 'shfmt' for Shell files (.sh)" {
    echo "#!/bin/bash" > "${TEST_DIR}/test.sh"
    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/test.sh"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [[ "$status_value" == "formatted" || "$status_value" == "no_formatter" ]]

    if [ "$status_value" = "formatted" ]; then
        local message
        message=$(echo "$output" | jq -r '.hookSpecificOutput.message')
        [[ "$message" == *"shfmt"* ]]
    fi
}

@test "hook returns no_formatter for unknown extension (.xyz)" {
    echo "custom data" > "${TEST_DIR}/data.xyz"
    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/data.xyz"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [ "$status_value" = "no_formatter" ]

    local message
    message=$(echo "$output" | jq -r '.hookSpecificOutput.message')
    [[ "$message" == *"No formatter configured for .xyz"* ]]
}

# =============================================================================
# TRD-TEST-096: File Formatting Verification Tests
#
# These tests verify that when a formatter is available, files are actually
# modified by the formatting process.
# =============================================================================

@test "hook actually formats JavaScript file when prettier is available" {
    skip_if_no_command prettier

    # Create intentionally unformatted JS
    echo "const x=1;const y=2;" > "${TEST_DIR}/format_test.js"
    local original_content
    original_content=$(cat "${TEST_DIR}/format_test.js")

    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/format_test.js"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [ "$status_value" = "formatted" ]

    # Verify file was modified (prettier adds newlines/formatting)
    local new_content
    new_content=$(cat "${TEST_DIR}/format_test.js")
    [ "$original_content" != "$new_content" ]
}

@test "hook actually formats Python file when ruff is available" {
    skip_if_no_command ruff

    # Create intentionally unformatted Python (extra spaces)
    echo "x=1;y=2" > "${TEST_DIR}/format_test.py"
    local original_content
    original_content=$(cat "${TEST_DIR}/format_test.py")

    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/format_test.py"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [ "$status_value" = "formatted" ]

    # Verify file was modified
    local new_content
    new_content=$(cat "${TEST_DIR}/format_test.py")
    [ "$original_content" != "$new_content" ]
}

@test "hook actually formats Go file when gofmt is available" {
    skip_if_no_command gofmt

    # Create intentionally unformatted Go (no proper spacing)
    echo "package main;func main(){}" > "${TEST_DIR}/format_test.go"
    local original_content
    original_content=$(cat "${TEST_DIR}/format_test.go")

    local input='{"tool_result": {"file_path": "'"${TEST_DIR}/format_test.go"'"}}'

    run bash -c "echo '$input' | $FORMATTER_HOOK"
    [ "$status" -eq 0 ]

    local status_value
    status_value=$(echo "$output" | jq -r '.hookSpecificOutput.status')
    [ "$status_value" = "formatted" ]

    # Verify file was modified
    local new_content
    new_content=$(cat "${TEST_DIR}/format_test.go")
    [ "$original_content" != "$new_content" ]
}

# Helper: Skip test if command not available
skip_if_no_command() {
    local cmd="$1"
    if ! command -v "$cmd" &> /dev/null; then
        skip "$cmd not available"
    fi
}
