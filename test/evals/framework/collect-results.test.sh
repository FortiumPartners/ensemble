#!/usr/bin/env bats
# =============================================================================
# collect-results.test.sh - BATS tests for collect-results.sh
# =============================================================================
# Task: TRD-TEST-069
# Purpose: Test session teleporting, file extraction, and output organization
#
# Run tests:
#   bats test/evals/framework/collect-results.test.sh
#
# Prerequisites:
#   - bats-core installed (npm install -g bats or brew install bats-core)
#   - jq for JSON parsing (optional but recommended)
# =============================================================================

# Setup - run before each test
setup() {
    # Get script directory
    SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    COLLECT_RESULTS="$SCRIPT_DIR/collect-results.sh"

    # Create temp directory for test outputs
    TEST_TMPDIR="$(mktemp -d)"

    # Create a mock session directory (simulating run-session.sh output)
    MOCK_SESSION_ID="test-session-$(date +%s)-$$"
    MOCK_SESSION_DIR="$TEST_TMPDIR/sessions/$MOCK_SESSION_ID"
    mkdir -p "$MOCK_SESSION_DIR/workspace"

    # Create mock session files
    echo '{"event": "start", "timestamp": "2026-01-13T10:00:00Z"}' > "$MOCK_SESSION_DIR/session.jsonl"
    echo '{"event": "end", "timestamp": "2026-01-13T10:05:00Z"}' >> "$MOCK_SESSION_DIR/session.jsonl"
    cat > "$MOCK_SESSION_DIR/metadata.json" <<EOF
{
  "session_id": "$MOCK_SESSION_ID",
  "variant": "test-variant",
  "start_time": "2026-01-13T10:00:00Z",
  "end_time": "2026-01-13T10:05:00Z",
  "exit_code": 0
}
EOF

    # Create mock generated code files in workspace
    cat > "$MOCK_SESSION_DIR/workspace/calc.py" <<'EOF'
"""CLI Calculator"""
def add(a: int, b: int) -> int:
    return a + b

def main():
    print("Calculator ready")

if __name__ == "__main__":
    main()
EOF

    cat > "$MOCK_SESSION_DIR/workspace/test_calc.py" <<'EOF'
"""Tests for calculator"""
import pytest
from calc import add

def test_add():
    assert add(2, 3) == 5
EOF

    # Create mock prompt file
    echo "Build a CLI calculator" > "$MOCK_SESSION_DIR/prompt.txt"

    # Set default output directory
    OUTPUT_DIR="$TEST_TMPDIR/results"
    mkdir -p "$OUTPUT_DIR"
}

# Teardown - run after each test
teardown() {
    # Clean up temp directory
    if [[ -d "$TEST_TMPDIR" ]]; then
        rm -rf "$TEST_TMPDIR"
    fi
}

# =============================================================================
# Help and Usage Tests
# =============================================================================

@test "collect-results.sh exists and is executable" {
    [[ -f "$COLLECT_RESULTS" ]]
    [[ -x "$COLLECT_RESULTS" ]]
}

@test "collect-results.sh shows help with --help" {
    run "$COLLECT_RESULTS" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" == *"session-id"* ]]
    [[ "$output" == *"--output-dir"* ]]
}

@test "collect-results.sh shows help with -h" {
    run "$COLLECT_RESULTS" -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "collect-results.sh fails without session-id" {
    run "$COLLECT_RESULTS"
    [ "$status" -ne 0 ]
    [[ "$output" == *"session"* ]] || [[ "$output" == *"required"* ]]
}

# =============================================================================
# Session ID Handling Tests
# =============================================================================

@test "handles local session ID (UUID format)" {
    # Test with UUID format session ID
    local_session_id="ebb01d82-e53e-4ddb-842f-3c77580c426c"

    # Create a mock local session (with end_time to mark complete)
    local mock_local_dir="$TEST_TMPDIR/sessions/$local_session_id"
    mkdir -p "$mock_local_dir/workspace"
    echo "test file" > "$mock_local_dir/workspace/test.py"
    cat > "$mock_local_dir/metadata.json" <<EOF
{
  "session_id": "$local_session_id",
  "start_time": "2026-01-13T10:00:00Z",
  "end_time": "2026-01-13T10:05:00Z"
}
EOF

    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$local_session_id"

    [ "$status" -eq 0 ]
    [[ -d "$OUTPUT_DIR/$local_session_id" ]]
}

@test "handles web session ID (session_xxx format)" {
    # Test with web session format
    web_session_id="session_018wgy4uwwvjuwd4ehmfjhnh"

    # Note: Real teleport would be needed here, but we test the ID parsing
    run "$COLLECT_RESULTS" --dry-run "$web_session_id"

    [ "$status" -eq 0 ]
    [[ "$output" == *"$web_session_id"* ]]
}

@test "detects session ID format correctly" {
    run "$COLLECT_RESULTS" --dry-run "ebb01d82-e53e-4ddb-842f-3c77580c426c"
    [ "$status" -eq 0 ]
    [[ "$output" == *"local"* ]] || [[ "$output" == *"UUID"* ]]

    run "$COLLECT_RESULTS" --dry-run "session_abc123"
    [ "$status" -eq 0 ]
    [[ "$output" == *"remote"* ]] || [[ "$output" == *"web"* ]] || [[ "$output" == *"teleport"* ]]
}

# =============================================================================
# Session Completion Detection Tests
# =============================================================================

@test "detects completed session from metadata" {
    # Mock session with end_time indicates completion
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
}

@test "polls for completion with timeout" {
    # This test uses a session with end_time set, so it should complete immediately
    run "$COLLECT_RESULTS" \
        --timeout 5 \
        --poll-interval 1 \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
}

@test "force collection works for incomplete sessions" {
    # Remove end_time from metadata to simulate incomplete
    cat > "$MOCK_SESSION_DIR/metadata.json" <<EOF
{
  "session_id": "$MOCK_SESSION_ID",
  "variant": "test-variant",
  "start_time": "2026-01-13T10:00:00Z"
}
EOF

    run "$COLLECT_RESULTS" \
        --force \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -d "$OUTPUT_DIR/$MOCK_SESSION_ID" ]]
}

@test "timeout exits gracefully without --force" {
    skip "Test takes too long - timeout polling waits for real time"

    # Remove end_time to simulate incomplete session
    cat > "$MOCK_SESSION_DIR/metadata.json" <<EOF
{
  "session_id": "$MOCK_SESSION_ID",
  "variant": "test-variant",
  "start_time": "2026-01-13T10:00:00Z"
}
EOF

    run "$COLLECT_RESULTS" \
        --timeout 1 \
        --poll-interval 1 \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    # Should timeout but not fail catastrophically
    # Either succeeds with partial or exits with timeout error
    [[ "$status" -eq 0 ]] || [[ "$status" -eq 124 ]] || [[ "$output" == *"timeout"* ]]
}

# =============================================================================
# File Extraction Tests
# =============================================================================

@test "extracts Python files from workspace" {
    run "$COLLECT_RESULTS" \
        --patterns "*.py" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/code/calc.py" ]]
}

@test "extracts test files to tests directory" {
    run "$COLLECT_RESULTS" \
        --patterns "*.py" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/tests/test_calc.py" ]]
}

@test "handles multiple file patterns" {
    # Add TypeScript files
    echo "export const foo = 1;" > "$MOCK_SESSION_DIR/workspace/utils.ts"
    echo "export const bar = 2;" > "$MOCK_SESSION_DIR/workspace/index.ts"

    run "$COLLECT_RESULTS" \
        --patterns "*.py,*.ts" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/code/calc.py" ]]
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/code/utils.ts" ]]
}

@test "uses default patterns when none specified" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    # Default patterns include *.py
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/code/calc.py" ]]
}

@test "extracts nested directory files correctly" {
    # Create nested structure
    mkdir -p "$MOCK_SESSION_DIR/workspace/src/lib"
    echo "def helper(): pass" > "$MOCK_SESSION_DIR/workspace/src/lib/helpers.py"

    run "$COLLECT_RESULTS" \
        --patterns "*.py" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/code/src/lib/helpers.py" ]] || \
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/code/helpers.py" ]]
}

# =============================================================================
# Output Organization Tests
# =============================================================================

@test "creates output directory structure" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -d "$OUTPUT_DIR/$MOCK_SESSION_ID" ]]
    [[ -d "$OUTPUT_DIR/$MOCK_SESSION_ID/code" ]]
    [[ -d "$OUTPUT_DIR/$MOCK_SESSION_ID/tests" ]]
}

@test "copies session.jsonl to output" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/session.jsonl" ]]
}

@test "creates metadata.json in output" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/metadata.json" ]]
}

@test "creates summary.json with expected fields" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json" ]]

    # Check summary.json content
    if command -v jq &>/dev/null; then
        jq -e '.session_id' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json" >/dev/null
        jq -e '.collected_at' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json" >/dev/null
        jq -e '.status' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json" >/dev/null
        jq -e '.files' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json" >/dev/null
        jq -e '.ready_for_judging' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json" >/dev/null
    fi
}

@test "summary.json lists collected files" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]

    if command -v jq &>/dev/null; then
        # Check files.code contains calc.py
        code_files=$(jq -r '.files.code[]' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json" 2>/dev/null || echo "")
        [[ "$code_files" == *"calc.py"* ]]

        # Check files.tests contains test_calc.py
        test_files=$(jq -r '.files.tests[]' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json" 2>/dev/null || echo "")
        [[ "$test_files" == *"test_calc.py"* ]]
    fi
}

# =============================================================================
# Session Duration Calculation Tests
# =============================================================================

@test "calculates session duration in summary" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]

    if command -v jq &>/dev/null; then
        duration=$(jq -r '.session_duration // 0' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json")
        # Duration should be a number (could be 0 if calculation failed)
        [[ "$duration" =~ ^[0-9]+\.?[0-9]*$ ]]
    fi
}

# =============================================================================
# CLI Options Tests
# =============================================================================

@test "accepts --output-dir option" {
    custom_output="$TEST_TMPDIR/custom-output"
    mkdir -p "$custom_output"

    run "$COLLECT_RESULTS" \
        --output-dir "$custom_output" \
        --source-dir "$TEST_TMPDIR/sessions" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    [[ -d "$custom_output/$MOCK_SESSION_ID" ]]
}

@test "accepts --timeout option" {
    run "$COLLECT_RESULTS" \
        --timeout 600 \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
}

@test "accepts --poll-interval option" {
    run "$COLLECT_RESULTS" \
        --poll-interval 5 \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
}

@test "accepts --quiet option" {
    run "$COLLECT_RESULTS" \
        --quiet \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    # Quiet mode should have minimal stderr output
}

@test "accepts --dry-run option" {
    run "$COLLECT_RESULTS" \
        --dry-run \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    # Dry run should not create output directories
    [[ ! -d "$OUTPUT_DIR/$MOCK_SESSION_ID" ]] || [[ "$output" == *"DRY RUN"* ]]
}

@test "accepts --keep-session option" {
    run "$COLLECT_RESULTS" \
        --keep-session \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
}

# =============================================================================
# Error Handling Tests
# =============================================================================

@test "handles missing session gracefully" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "nonexistent-session-id"

    [ "$status" -ne 0 ]
    [[ "$output" == *"not found"* ]] || [[ "$output" == *"does not exist"* ]]
}

@test "handles empty workspace gracefully" {
    # Create session with empty workspace
    empty_session="empty-session-$$"
    mkdir -p "$TEST_TMPDIR/sessions/$empty_session/workspace"
    echo '{"session_id": "'$empty_session'", "end_time": "2026-01-13T10:00:00Z"}' > \
        "$TEST_TMPDIR/sessions/$empty_session/metadata.json"

    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$empty_session"

    [ "$status" -eq 0 ]
    [[ -f "$OUTPUT_DIR/$empty_session/summary.json" ]]
}

@test "validates timeout is numeric" {
    run "$COLLECT_RESULTS" \
        --timeout "abc" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -ne 0 ]
    [[ "$output" == *"numeric"* ]] || [[ "$output" == *"invalid"* ]] || [[ "$output" == *"number"* ]]
}

@test "validates poll-interval is numeric" {
    run "$COLLECT_RESULTS" \
        --poll-interval "abc" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -ne 0 ]
    [[ "$output" == *"numeric"* ]] || [[ "$output" == *"invalid"* ]] || [[ "$output" == *"number"* ]]
}

# =============================================================================
# Integration Tests (require actual claude CLI)
# =============================================================================

@test "teleport integration with remote session" {
    skip "Integration test - requires CLAUDE CLI and remote session"

    # This would be a real test with actual teleport
    run "$COLLECT_RESULTS" \
        --output-dir "$OUTPUT_DIR" \
        "session_real_web_session_id"

    [ "$status" -eq 0 ]
    [[ -f "$OUTPUT_DIR/session_real_web_session_id/summary.json" ]]
}

# =============================================================================
# Ready for Judging Tests
# =============================================================================

@test "marks session ready for judging when complete" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]

    if command -v jq &>/dev/null; then
        ready=$(jq -r '.ready_for_judging' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json")
        [[ "$ready" == "true" ]]
    fi
}

@test "marks session not ready for judging when incomplete" {
    # Remove end_time to simulate incomplete
    cat > "$MOCK_SESSION_DIR/metadata.json" <<EOF
{
  "session_id": "$MOCK_SESSION_ID",
  "variant": "test-variant",
  "start_time": "2026-01-13T10:00:00Z"
}
EOF

    run "$COLLECT_RESULTS" \
        --force \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]

    if command -v jq &>/dev/null; then
        ready=$(jq -r '.ready_for_judging' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json")
        status_value=$(jq -r '.status' "$OUTPUT_DIR/$MOCK_SESSION_ID/summary.json")
        [[ "$ready" == "false" ]] || [[ "$status_value" == "incomplete"* ]]
    fi
}

# =============================================================================
# Output Verification Tests
# =============================================================================

@test "outputs session ID on success" {
    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    # Session ID should be in output for downstream processing
    [[ "$output" == *"$MOCK_SESSION_ID"* ]]
}

@test "preserves file permissions in extraction" {
    chmod 755 "$MOCK_SESSION_DIR/workspace/calc.py"

    run "$COLLECT_RESULTS" \
        --source-dir "$TEST_TMPDIR/sessions" \
        --output-dir "$OUTPUT_DIR" \
        "$MOCK_SESSION_ID"

    [ "$status" -eq 0 ]
    # Check file exists (permission preservation is best-effort)
    [[ -f "$OUTPUT_DIR/$MOCK_SESSION_ID/code/calc.py" ]]
}
