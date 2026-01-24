#!/usr/bin/env bats
# =============================================================================
# wiggum-hook.test.sh - Integration tests for Wiggum hook (Stop event)
# =============================================================================
# Task: TRD-TEST-095 (Phase 5)
# Purpose: Verify wiggum hook fires on Stop events and manages autonomous
#          execution mode for /implement-trd workflow.
#
# NOTE: The TRD description mentions "UserPromptSubmit" but wiggum.js is
#       actually a STOP hook. These tests verify actual wiggum behavior:
#       - Fires on Stop events when WIGGUM_ACTIVE=1
#       - Blocks exit and re-injects prompts when tasks incomplete
#       - Allows exit when tasks complete or max iterations reached
#
# Test coverage:
#   - Wiggum hook fires on Stop event with WIGGUM_ACTIVE=1
#   - Wiggum hook output is valid JSON
#   - Wiggum hook blocks exit when tasks incomplete
#   - Wiggum hook allows exit when tasks complete
#   - Wiggum hook respects max iterations limit
#   - Wiggum hook respects stop_hook_active safety flag
#
# Run tests with:
#   bats wiggum-hook.test.sh
#   bats wiggum-hook.test.sh --filter "Stop"
#
# Prerequisites:
#   - BATS (Bash Automated Testing System) installed
#   - Node.js for hook execution
#   - jq for JSON parsing
#
# Environment Variables:
#   - WIGGUM_ACTIVE=1    : Enables wiggum mode (required for hook to act)
#   - WIGGUM_DEBUG=1     : Enables debug logging to stderr
#   - WIGGUM_MAX_ITERATIONS : Maximum iterations before allowing exit (default: 50)
#
# TRD Reference: docs/TRD/testing-phase.md section 4.6 Phase 5
# =============================================================================

# Get the directory containing this test file
BATS_TEST_DIRNAME="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"

# Hook paths
WIGGUM_HOOK="${BATS_TEST_DIRNAME}/../../../packages/core/hooks/wiggum.js"
RUN_HOOK_TEST="${BATS_TEST_DIRNAME}/run-hook-test.sh"
PARSE_HOOK_EVENTS="${BATS_TEST_DIRNAME}/parse-hook-events.js"

# =============================================================================
# Test Setup and Teardown
# =============================================================================

setup() {
    # Create temporary test directory
    TEST_DIR="$(mktemp -d -t "wiggum-test-XXXXXX")"
    export TEST_DIR

    # Create mock .trd-state directory for project root detection
    mkdir -p "${TEST_DIR}/.trd-state"

    # Save original environment
    ORIGINAL_WIGGUM_ACTIVE="${WIGGUM_ACTIVE:-}"
    ORIGINAL_WIGGUM_DEBUG="${WIGGUM_DEBUG:-}"
    ORIGINAL_WIGGUM_MAX_ITERATIONS="${WIGGUM_MAX_ITERATIONS:-}"
}

teardown() {
    # Restore environment
    if [[ -n "$ORIGINAL_WIGGUM_ACTIVE" ]]; then
        export WIGGUM_ACTIVE="$ORIGINAL_WIGGUM_ACTIVE"
    else
        unset WIGGUM_ACTIVE
    fi

    if [[ -n "$ORIGINAL_WIGGUM_DEBUG" ]]; then
        export WIGGUM_DEBUG="$ORIGINAL_WIGGUM_DEBUG"
    else
        unset WIGGUM_DEBUG
    fi

    if [[ -n "$ORIGINAL_WIGGUM_MAX_ITERATIONS" ]]; then
        export WIGGUM_MAX_ITERATIONS="$ORIGINAL_WIGGUM_MAX_ITERATIONS"
    else
        unset WIGGUM_MAX_ITERATIONS
    fi

    # Clean up temp directory
    if [[ -d "${TEST_DIR:-}" ]]; then
        rm -rf "$TEST_DIR"
    fi
}

# =============================================================================
# Helper Functions
# =============================================================================

# Run wiggum hook with JSON input
# Usage: run_wiggum <json_input>
# Returns: Hook output in $output, exit code in $status
run_wiggum() {
    local json_input="$1"
    echo "$json_input" | node "$WIGGUM_HOOK"
}

# Create implement.json with specified task statuses
# Usage: create_implement_json <trd_name> <tasks_json>
create_implement_json() {
    local trd_name="$1"
    local tasks_json="$2"

    local trd_dir="${TEST_DIR}/.trd-state/${trd_name}"
    mkdir -p "$trd_dir"

    cat > "${trd_dir}/implement.json" <<EOF
{
  "trd_name": "${trd_name}",
  "phase_cursor": 1,
  "tasks": ${tasks_json}
}
EOF
}

# Create current.json pointing to active TRD
# Usage: create_current_json <trd_name>
create_current_json() {
    local trd_name="$1"

    cat > "${TEST_DIR}/.trd-state/current.json" <<EOF
{
  "active_trd": "${trd_name}",
  "status": ".trd-state/${trd_name}/implement.json"
}
EOF
}

# Create wiggum state file
# Usage: create_wiggum_state <iteration_count> <stop_hook_active>
create_wiggum_state() {
    local iteration_count="${1:-0}"
    local stop_hook_active="${2:-false}"

    cat > "${TEST_DIR}/.trd-state/wiggum-state.json" <<EOF
{
  "iteration_count": ${iteration_count},
  "stop_hook_active": ${stop_hook_active},
  "last_prompt": null,
  "started_at": null
}
EOF
}

# Read wiggum state file
# Usage: read_wiggum_state
read_wiggum_state() {
    cat "${TEST_DIR}/.trd-state/wiggum-state.json"
}

# Validate JSON output structure
# Usage: validate_hook_output <output>
validate_hook_output() {
    local output="$1"

    # Check it's valid JSON
    if ! echo "$output" | jq empty 2>/dev/null; then
        echo "Invalid JSON output"
        return 1
    fi

    # Check for hookSpecificOutput
    if ! echo "$output" | jq -e '.hookSpecificOutput' >/dev/null 2>&1; then
        echo "Missing hookSpecificOutput"
        return 1
    fi

    # Check for hookEventName
    if ! echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "Stop"' >/dev/null 2>&1; then
        echo "hookEventName should be 'Stop'"
        return 1
    fi

    # Check for continue field
    if ! echo "$output" | jq -e '.continue' >/dev/null 2>&1; then
        echo "Missing continue field"
        return 1
    fi

    return 0
}

# =============================================================================
# Test: Wiggum Hook Prerequisites
# =============================================================================

@test "wiggum.js hook file exists and is readable" {
    [[ -f "$WIGGUM_HOOK" ]]
    [[ -r "$WIGGUM_HOOK" ]]
}

@test "wiggum.js has proper shebang" {
    head -1 "$WIGGUM_HOOK" | grep -q "#!/usr/bin/env node"
}

@test "run-hook-test.sh harness exists and is executable" {
    [[ -f "$RUN_HOOK_TEST" ]]
    [[ -x "$RUN_HOOK_TEST" ]]
}

@test "parse-hook-events.js parser exists" {
    [[ -f "$PARSE_HOOK_EVENTS" ]]
}

# =============================================================================
# Test: Wiggum Hook is a Stop Hook (Not UserPromptSubmit)
# =============================================================================

@test "wiggum hook output identifies as Stop event hook" {
    export WIGGUM_ACTIVE=1

    # Create incomplete tasks
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]
    echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "Stop"' >/dev/null
}

# =============================================================================
# Test: Wiggum Hook Fires on Stop Event with WIGGUM_ACTIVE=1
# =============================================================================

@test "wiggum hook does nothing when WIGGUM_ACTIVE is not set" {
    unset WIGGUM_ACTIVE

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should allow exit (continue: true, no decision: block)
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

@test "wiggum hook does nothing when WIGGUM_ACTIVE=0" {
    export WIGGUM_ACTIVE=0

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should allow exit
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

@test "wiggum hook activates when WIGGUM_ACTIVE=1" {
    export WIGGUM_ACTIVE=1

    # Create incomplete tasks
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should block exit with decision: block
    echo "$output" | jq -e '.decision == "block"' >/dev/null
}

# =============================================================================
# Test: Wiggum Hook Output Structure
# =============================================================================

@test "wiggum hook output is valid JSON" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Validate JSON
    run validate_hook_output "$output"
    [[ "$status" -eq 0 ]]
}

@test "wiggum hook output contains hookSpecificOutput with hookEventName" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]
    echo "$output" | jq -e '.hookSpecificOutput.hookEventName' >/dev/null
}

@test "wiggum hook output contains continue field" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]
    echo "$output" | jq -e '.continue == true' >/dev/null
}

@test "wiggum hook includes reason when blocking exit" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should have reason field with re-injection prompt
    echo "$output" | jq -e '.reason' >/dev/null
    echo "$output" | jq -r '.reason' | grep -q "WIGGUM AUTONOMOUS MODE"
}

# =============================================================================
# Test: Wiggum Hook Blocks Exit When Tasks Incomplete
# =============================================================================

@test "wiggum hook blocks exit when tasks are pending" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "pending"}, "task-002": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]
    echo "$output" | jq -e '.decision == "block"' >/dev/null
}

@test "wiggum hook blocks exit when tasks are in_progress" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "in_progress"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]
    echo "$output" | jq -e '.decision == "block"' >/dev/null
}

@test "wiggum hook re-injection prompt contains task status" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "success"}, "task-002": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Check reason contains task completion info
    local reason
    reason=$(echo "$output" | jq -r '.reason')
    [[ "$reason" == *"1/2 tasks complete"* ]] || [[ "$reason" == *"remaining"* ]]
}

# =============================================================================
# Test: Wiggum Hook Allows Exit When Tasks Complete
# =============================================================================

@test "wiggum hook allows exit when all tasks have status success" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "success"}, "task-002": {"status": "success"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should NOT have decision: block
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

@test "wiggum hook allows exit when all tasks have status complete" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "complete"}, "task-002": {"status": "complete"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should allow exit
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

@test "wiggum hook allows exit when completion promise tag detected" {
    export WIGGUM_ACTIVE=1

    # Create incomplete tasks
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    # Input with completion promise in session output
    local input='{"cwd": "'"$TEST_DIR"'", "session_output": "Task complete! <promise>COMPLETE</promise>"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should allow exit despite incomplete tasks
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

# =============================================================================
# Test: Wiggum Hook Respects Max Iterations Limit
# =============================================================================

@test "wiggum hook allows exit when max iterations reached" {
    export WIGGUM_ACTIVE=1
    export WIGGUM_MAX_ITERATIONS=5

    # Create incomplete tasks
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    # Create state file at max iterations
    create_wiggum_state 5 "false"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should allow exit despite incomplete tasks
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

@test "wiggum hook increments iteration count" {
    export WIGGUM_ACTIVE=1

    # Create incomplete tasks
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    # Start with 0 iterations
    create_wiggum_state 0 "false"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Check iteration count was incremented
    local new_count
    new_count=$(jq -r '.iteration_count' < "${TEST_DIR}/.trd-state/wiggum-state.json")
    [[ "$new_count" -eq 1 ]]
}

@test "wiggum hook default max iterations is 50" {
    export WIGGUM_ACTIVE=1
    unset WIGGUM_MAX_ITERATIONS

    # Create incomplete tasks
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    # At 50 iterations, should allow exit
    create_wiggum_state 50 "false"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should allow exit
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

@test "wiggum hook caps max iterations at 1000" {
    export WIGGUM_ACTIVE=1
    export WIGGUM_MAX_ITERATIONS=9999

    # Create incomplete tasks
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    # At 1000 iterations, should allow exit (capped)
    create_wiggum_state 1000 "false"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should allow exit
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

# =============================================================================
# Test: Wiggum Hook Safety Flag (Infinite Loop Prevention)
# =============================================================================

@test "wiggum hook sets stop_hook_active when blocking" {
    export WIGGUM_ACTIVE=1

    # Create incomplete tasks
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    # Start with flag false
    create_wiggum_state 0 "false"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Flag should now be true
    local flag
    flag=$(jq -r '.stop_hook_active' < "${TEST_DIR}/.trd-state/wiggum-state.json")
    [[ "$flag" == "true" ]]
}

@test "wiggum hook allows exit and clears flag when stop_hook_active is true" {
    export WIGGUM_ACTIVE=1

    # Create incomplete tasks
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    # Start with flag true (simulating double-fire scenario)
    create_wiggum_state 1 "true"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should allow exit to prevent infinite loop
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]

    # Flag should be cleared
    local flag
    flag=$(jq -r '.stop_hook_active' < "${TEST_DIR}/.trd-state/wiggum-state.json")
    [[ "$flag" == "false" ]]
}

# =============================================================================
# Test: Wiggum Hook Project Root Detection
# =============================================================================

@test "wiggum hook finds project root with .trd-state directory" {
    export WIGGUM_ACTIVE=1

    # Create nested directory structure
    local nested_dir="${TEST_DIR}/src/deep/nested"
    mkdir -p "$nested_dir"

    # .trd-state is at TEST_DIR, not in nested
    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    # Run from nested directory
    local input='{"cwd": "'"$nested_dir"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should still find and process tasks
    echo "$output" | jq -e '.decision == "block"' >/dev/null
}

@test "wiggum hook allows exit when no .trd-state directory exists" {
    export WIGGUM_ACTIVE=1

    # Remove .trd-state directory
    rm -rf "${TEST_DIR}/.trd-state"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should allow exit (no project context)
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

# =============================================================================
# Test: Wiggum Hook Error Handling
# =============================================================================

@test "wiggum hook handles empty input gracefully" {
    export WIGGUM_ACTIVE=1

    run run_wiggum ""

    [[ "$status" -eq 0 ]]

    # Should produce valid JSON output
    echo "$output" | jq empty >/dev/null
}

@test "wiggum hook handles malformed JSON input gracefully" {
    export WIGGUM_ACTIVE=1

    run run_wiggum "not valid json"

    [[ "$status" -eq 0 ]]

    # Should produce valid JSON output (allows exit on error)
    echo "$output" | jq empty >/dev/null
}

@test "wiggum hook handles missing cwd gracefully" {
    export WIGGUM_ACTIVE=1

    # Input without cwd field
    local input='{}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should produce valid JSON output
    echo "$output" | jq empty >/dev/null
}

@test "wiggum hook handles invalid implement.json gracefully" {
    export WIGGUM_ACTIVE=1

    # Create invalid implement.json
    mkdir -p "${TEST_DIR}/.trd-state/test-trd"
    echo "not valid json" > "${TEST_DIR}/.trd-state/test-trd/implement.json"
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should produce valid JSON output (allows exit on error)
    echo "$output" | jq empty >/dev/null
}

# =============================================================================
# Test: Debug Mode
# =============================================================================

@test "wiggum hook outputs debug info to stderr when WIGGUM_DEBUG=1" {
    export WIGGUM_ACTIVE=1
    export WIGGUM_DEBUG=1

    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'

    # Capture both stdout and stderr
    local combined_output
    combined_output=$(echo "$input" | node "$WIGGUM_HOOK" 2>&1)

    # Should contain debug output
    [[ "$combined_output" == *"[WIGGUM"* ]]
}

@test "wiggum hook does not output debug info when WIGGUM_DEBUG=0" {
    export WIGGUM_ACTIVE=1
    export WIGGUM_DEBUG=0

    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'

    # Capture both stdout and stderr
    local combined_output
    combined_output=$(echo "$input" | node "$WIGGUM_HOOK" 2>&1)

    # Should not contain debug output (only valid JSON on stdout)
    [[ "$combined_output" != *"[WIGGUM"* ]] || [[ $(echo "$combined_output" | wc -l) -eq 1 ]]
}

# =============================================================================
# Test: Hook Event Parsing Integration
# =============================================================================

@test "wiggum hook output can be parsed by parse-hook-events.js" {
    if [[ ! -f "$PARSE_HOOK_EVENTS" ]]; then
        skip "parse-hook-events.js not found"
    fi

    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{"task-001": {"status": "pending"}}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # The hook output is a single JSON line that could be in a session log
    # Create a mock session log with hook event structure
    local mock_session_log
    mock_session_log=$(mktemp)

    # Wrap in hook event format
    cat > "$mock_session_log" <<EOF
{"type": "hook_start", "hook": "wiggum", "event": "Stop", "timestamp": "$(date -Iseconds)"}
{"type": "hook_output", "hook": "wiggum", "event": "Stop", "output": ${output}}
{"type": "hook_end", "hook": "wiggum", "event": "Stop", "success": true}
EOF

    # Parse the mock session log
    run node "$PARSE_HOOK_EVENTS" "$mock_session_log" --hook wiggum

    rm -f "$mock_session_log"

    [[ "$status" -eq 0 ]]
    echo "$output" | jq -e '.summary.hooks_by_type.wiggum >= 1' >/dev/null
}

# =============================================================================
# Test: Mixed Task Statuses
# =============================================================================

@test "wiggum hook handles mixed success/pending/in_progress statuses" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{
        "task-001": {"status": "success"},
        "task-002": {"status": "complete"},
        "task-003": {"status": "pending"},
        "task-004": {"status": "in_progress"}
    }'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Should block because not all tasks are complete
    echo "$output" | jq -e '.decision == "block"' >/dev/null

    # Reason should show 2/4 complete
    local reason
    reason=$(echo "$output" | jq -r '.reason')
    [[ "$reason" == *"2/4"* ]]
}

@test "wiggum hook handles empty tasks object" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{}'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Empty tasks = done, should allow exit
    local decision
    decision=$(echo "$output" | jq -r '.decision // "none"')
    [[ "$decision" == "none" || "$decision" == "null" ]]
}

@test "wiggum hook handles failed/blocked task statuses as incomplete" {
    export WIGGUM_ACTIVE=1

    create_implement_json "test-trd" '{
        "task-001": {"status": "success"},
        "task-002": {"status": "failed"},
        "task-003": {"status": "blocked"}
    }'
    create_current_json "test-trd"

    local input='{"cwd": "'"$TEST_DIR"'"}'
    run run_wiggum "$input"

    [[ "$status" -eq 0 ]]

    # Failed/blocked are not complete, should block
    echo "$output" | jq -e '.decision == "block"' >/dev/null
}
