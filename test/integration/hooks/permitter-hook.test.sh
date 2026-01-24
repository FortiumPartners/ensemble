#!/usr/bin/env bats
# =============================================================================
# permitter-hook.test.sh - Integration tests for permitter hook (limited)
# =============================================================================
# Task: TRD-TEST-099
# Purpose: Verify permitter hook fires on PermissionRequest events and logs
#          execution. Actual permission blocking cannot be tested in headless
#          mode due to --dangerously-skip-permissions.
#
# Test coverage:
#   - TRD-TEST-099: Verify permitter hook fires and produces output
#   - AC Reference: AC-HI2, AC-HI3
#
# Run tests with:
#   bats permitter-hook.test.sh
#   bats permitter-hook.test.sh --filter "fires"
#
# Prerequisites:
#   - BATS (Bash Automated Testing System) installed
#   - Node.js for running hook directly
#   - jq for JSON parsing
#   - parse-hook-events.js available in the same directory
#
# IMPORTANT LIMITATIONS:
#   Since tests run with --dangerously-skip-permissions, we CANNOT verify:
#   - Actual permission blocking behavior
#   - User prompt/approval flow
#   - Deny list enforcement in real sessions
#
#   For comprehensive permitter testing, see the unit tests at:
#   packages/permitter/tests/ (485+ unit tests covering all functionality)
#
# What we CAN verify in integration tests:
#   - Hook is invoked when appropriate events occur
#   - Hook produces valid JSON output
#   - Hook handles command parsing correctly
#   - Hook logs are present (when PERMITTER_DEBUG=1)
#   - Hook does not crash on various inputs
#
# TRD Reference: docs/TRD/testing-phase.md section 4.6 Phase 5
# =============================================================================

# Get the directory containing this test file
BATS_TEST_DIRNAME="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"

# Project root
PROJECT_ROOT="$(cd "${BATS_TEST_DIRNAME}/../../.." && pwd)"

# Path to permitter hook
PERMITTER_HOOK="${PROJECT_ROOT}/packages/permitter/hooks/permitter.js"

# Path to parser utility
PARSE_HOOK_EVENTS="${BATS_TEST_DIRNAME}/parse-hook-events.js"

# Path to run-hook-test.sh
RUN_HOOK_TEST="${BATS_TEST_DIRNAME}/run-hook-test.sh"

# Session output directory
SESSION_DIR="${BATS_TEST_DIRNAME}/../sessions"

# =============================================================================
# Test Setup and Teardown
# =============================================================================

setup_file() {
    # Setup that runs once before all tests in the file
    export QUIET="true"

    # Verify prerequisites
    if ! command -v node &>/dev/null; then
        echo "ERROR: Node.js is required for permitter hook tests" >&2
        return 1
    fi

    if ! command -v jq &>/dev/null; then
        echo "ERROR: jq is required for JSON parsing" >&2
        return 1
    fi

    # Verify permitter hook exists
    if [[ ! -f "$PERMITTER_HOOK" ]]; then
        echo "ERROR: Permitter hook not found at: $PERMITTER_HOOK" >&2
        return 1
    fi

    # Create sessions directory if it doesn't exist
    mkdir -p "$SESSION_DIR"
}

setup() {
    # Setup that runs before each test
    TEST_DIR="$(mktemp -d)"
    export TEST_DIR
}

teardown() {
    # Cleanup after each test
    if [[ -n "${TEST_DIR:-}" && -d "$TEST_DIR" ]]; then
        rm -rf "$TEST_DIR"
    fi
}

teardown_file() {
    # Cleanup that runs once after all tests
    :
}

# =============================================================================
# Helper Functions
# =============================================================================

# Run permitter hook with JSON input and capture output
# Usage: run_permitter_hook <json_input>
# Returns: Hook output via $output, exit code via $status
run_permitter_hook() {
    local json_input="$1"
    echo "$json_input" | node "$PERMITTER_HOOK" 2>&1
}

# Run permitter hook with debug logging enabled
# Usage: run_permitter_hook_debug <json_input>
run_permitter_hook_debug() {
    local json_input="$1"
    export PERMITTER_DEBUG=1
    echo "$json_input" | node "$PERMITTER_HOOK" 2>&1
}

# Create a Bash tool permission request payload
# Usage: create_bash_permission_request <command>
create_bash_permission_request() {
    local command="$1"
    cat <<EOF
{
  "type": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "$command"
  }
}
EOF
}

# Create an MCP tool permission request payload
# Usage: create_mcp_permission_request <tool_name>
create_mcp_permission_request() {
    local tool_name="$1"
    cat <<EOF
{
  "type": "PermissionRequest",
  "tool_name": "$tool_name",
  "tool_input": {}
}
EOF
}

# Create a non-Bash tool permission request payload
# Usage: create_other_tool_permission_request <tool_name>
create_other_tool_permission_request() {
    local tool_name="$1"
    cat <<EOF
{
  "type": "PermissionRequest",
  "tool_name": "$tool_name",
  "tool_input": {}
}
EOF
}

# Check if output is valid JSON with expected structure
# Usage: is_valid_hook_output <output>
is_valid_hook_output() {
    local output="$1"
    # Should have hookSpecificOutput.decision.behavior
    echo "$output" | jq -e '.hookSpecificOutput.decision.behavior' >/dev/null 2>&1
}

# Extract decision behavior from hook output
# Usage: get_decision_behavior <output>
get_decision_behavior() {
    local output="$1"
    echo "$output" | jq -r '.hookSpecificOutput.decision.behavior'
}

# =============================================================================
# TRD-TEST-099: Permitter Hook Direct Invocation Tests
# =============================================================================
# These tests verify the permitter hook can be invoked directly and produces
# valid output. This tests the hook in isolation before testing integration.

@test "TRD-TEST-099: permitter hook exists and is executable" {
    [[ -f "$PERMITTER_HOOK" ]]
    [[ -r "$PERMITTER_HOOK" ]]
}

@test "TRD-TEST-099: permitter hook produces valid JSON on Bash command" {
    local input
    input=$(create_bash_permission_request "ls -la")

    run run_permitter_hook "$input"

    # Hook should exit successfully
    [[ "$status" -eq 0 ]]

    # Output should be valid JSON with correct structure
    is_valid_hook_output "$output"
}

@test "TRD-TEST-099: permitter hook returns 'ask' for unknown commands" {
    # Commands not on allowlist should result in 'ask' (not 'deny')
    # to maintain fail-closed security posture while allowing user override
    local input
    input=$(create_bash_permission_request "rm -rf /")

    run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]

    local behavior
    behavior=$(get_decision_behavior "$output")
    [[ "$behavior" == "ask" ]]
}

@test "TRD-TEST-099: permitter hook returns 'ask' for non-Bash tools" {
    # Non-Bash tools (except MCP) should just pass through to normal flow
    local input
    input=$(create_other_tool_permission_request "Read")

    run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]

    local behavior
    behavior=$(get_decision_behavior "$output")
    [[ "$behavior" == "ask" ]]
}

@test "TRD-TEST-099: permitter hook handles empty command gracefully" {
    local input
    input=$(create_bash_permission_request "")

    run run_permitter_hook "$input"

    # Should still succeed and return 'ask'
    [[ "$status" -eq 0 ]]

    local behavior
    behavior=$(get_decision_behavior "$output")
    [[ "$behavior" == "ask" ]]
}

@test "TRD-TEST-099: permitter hook handles MCP tool requests" {
    local input
    input=$(create_mcp_permission_request "mcp__playwright__navigate")

    run run_permitter_hook "$input"

    # Should succeed regardless of whether tool is on allowlist
    [[ "$status" -eq 0 ]]
    is_valid_hook_output "$output"
}

@test "TRD-TEST-099: permitter hook produces debug logs when PERMITTER_DEBUG=1" {
    local input
    input=$(create_bash_permission_request "git status")

    # Run with debug enabled directly in the command
    local result
    result=$(echo "$input" | PERMITTER_DEBUG=1 node "$PERMITTER_HOOK" 2>&1)
    local status_code=$?

    [[ $status_code -eq 0 ]]

    # Debug logs should appear in output (stderr mixed with stdout)
    [[ "$result" == *"[PERMITTER]"* ]]
}

@test "TRD-TEST-099: permitter hook handles malformed JSON gracefully" {
    # Send invalid JSON
    run run_permitter_hook "{ not valid json }"

    # Should still exit successfully (fail-closed returns 'ask')
    [[ "$status" -eq 0 ]]

    local behavior
    behavior=$(get_decision_behavior "$output")
    [[ "$behavior" == "ask" ]]
}

@test "TRD-TEST-099: permitter hook can be disabled via environment variable" {
    local input
    input=$(create_bash_permission_request "ls -la")

    # Disable the hook
    ENSEMBLE_PERMITTER_DISABLE=1 run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]

    # Should return 'ask' when disabled
    local behavior
    behavior=$(get_decision_behavior "$output")
    [[ "$behavior" == "ask" ]]
}

# =============================================================================
# Command Parsing Tests
# =============================================================================
# These tests verify the permitter correctly parses and handles various
# command formats. Full parsing tests are in unit tests; these are smoke tests.

@test "TRD-TEST-099: permitter hook parses simple command" {
    local input
    input=$(create_bash_permission_request "echo hello")

    # Run with debug enabled directly in the command
    local result
    result=$(echo "$input" | PERMITTER_DEBUG=1 node "$PERMITTER_HOOK" 2>&1)
    local status_code=$?

    [[ $status_code -eq 0 ]]
    # Debug output should show parsing
    [[ "$result" == *"Checking command"* ]] || [[ "$result" == *"Parsed"* ]]
}

@test "TRD-TEST-099: permitter hook parses piped commands" {
    local input
    input=$(create_bash_permission_request "cat file.txt | grep pattern")

    run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]
    is_valid_hook_output "$output"
}

@test "TRD-TEST-099: permitter hook parses chained commands" {
    local input
    input=$(create_bash_permission_request "cd /tmp && ls -la")

    run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]
    is_valid_hook_output "$output"
}

@test "TRD-TEST-099: permitter hook parses subshell commands" {
    local input
    input=$(create_bash_permission_request '$(which python)')

    run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]
    is_valid_hook_output "$output"
}

# =============================================================================
# Error Handling Tests
# =============================================================================
# Verify hook handles error conditions gracefully (AC-HI3)

@test "TRD-TEST-099: permitter hook handles stdin EOF gracefully" {
    # Empty stdin should result in 'ask' response
    run bash -c "echo '' | node '$PERMITTER_HOOK'"

    [[ "$status" -eq 0 ]]
}

@test "TRD-TEST-099: permitter hook handles missing tool_name field" {
    local input='{"type": "PermissionRequest", "tool_input": {"command": "ls"}}'

    run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]

    # Should return 'ask' for safety
    local behavior
    behavior=$(get_decision_behavior "$output")
    [[ "$behavior" == "ask" ]]
}

@test "TRD-TEST-099: permitter hook handles missing tool_input field" {
    local input='{"type": "PermissionRequest", "tool_name": "Bash"}'

    run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]

    # Should return 'ask' for safety
    local behavior
    behavior=$(get_decision_behavior "$output")
    [[ "$behavior" == "ask" ]]
}

# =============================================================================
# Output Format Verification
# =============================================================================
# Verify hook output matches expected PermissionRequest response format

@test "TRD-TEST-099: permitter hook output has correct hookEventName" {
    local input
    input=$(create_bash_permission_request "ls")

    run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]

    local event_name
    event_name=$(echo "$output" | jq -r '.hookSpecificOutput.hookEventName')
    [[ "$event_name" == "PermissionRequest" ]]
}

@test "TRD-TEST-099: permitter hook output behavior is valid enum" {
    local input
    input=$(create_bash_permission_request "ls")

    run run_permitter_hook "$input"

    [[ "$status" -eq 0 ]]

    local behavior
    behavior=$(get_decision_behavior "$output")
    # Behavior must be one of: allow, deny, ask
    [[ "$behavior" == "allow" || "$behavior" == "deny" || "$behavior" == "ask" ]]
}

# =============================================================================
# Unit Test Reference Note
# =============================================================================
# The following functionality is comprehensively tested in unit tests
# (packages/permitter/tests/). Integration tests here are limited to
# verifying the hook fires and produces output.
#
# Unit test coverage (485+ tests):
#   - allowlist-loader.test.js: Allowlist/denylist loading from settings
#   - command-parser.test.js: Shell command parsing (pipes, chains, subshells)
#   - matcher.test.js: Pattern matching (glob, prefix, exact)
#   - integration.test.js: End-to-end permission decisions
#   - security.test.js: Security edge cases
#   - performance.test.js: Large input handling
#   - docker-compose-command.test.js: Docker compose specific patterns
#
# =============================================================================

# =============================================================================
# Summary Note
# =============================================================================
# NOTE: Actual permission blocking cannot be tested in headless mode
# since tests must run with --dangerously-skip-permissions.
#
# The permitter hook's blocking functionality is verified via:
# 1. Extensive unit tests (packages/permitter/tests/)
# 2. Manual testing in interactive Claude sessions
# 3. Integration tests here verify only invocation and output format
#
# For production verification, manually test with:
#   - A command that should be blocked
#   - PERMITTER_DEBUG=1 to see decision logs
#   - Interactive mode (not --dangerously-skip-permissions)
# =============================================================================
