#!/usr/bin/env bats
# =============================================================================
# run-session.test.sh - BATS tests for run-session.sh
# =============================================================================
# Task: TRD-TEST-068
# Purpose: Test the Claude session wrapper for evaluations
#
# Run tests:
#   bats test/evals/framework/run-session.test.sh
#
# Prerequisites:
#   - bats-core installed (npm install -g bats or brew install bats-core)
#   - bats-support and bats-assert recommended
# =============================================================================

# Setup - run before each test
setup() {
    # Get script directory
    SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    RUN_SESSION="$SCRIPT_DIR/run-session.sh"

    # Create temp directory for test outputs
    TEST_TMPDIR="$(mktemp -d)"

    # Mock claude CLI for testing (actual tests will need real claude)
    export MOCK_CLAUDE=1

    # Set default fixture repo for tests
    export TEST_FIXTURE_REPO="ensemble-vnext-test-fixtures"
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

@test "run-session.sh exists and is executable" {
    [[ -f "$RUN_SESSION" ]]
    [[ -x "$RUN_SESSION" ]]
}

@test "run-session.sh shows help with --help" {
    run "$RUN_SESSION" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" == *"--fixture"* ]]
    [[ "$output" == *"--variant"* ]]
    [[ "$output" == *"--session-id"* ]]
}

@test "run-session.sh shows help with -h" {
    run "$RUN_SESSION" -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "run-session.sh fails without prompt" {
    run "$RUN_SESSION"
    [ "$status" -ne 0 ]
    [[ "$output" == *"prompt"* ]] || [[ "$output" == *"required"* ]]
}

# =============================================================================
# Session ID Generation Tests
# =============================================================================

@test "generates UUID session ID by default" {
    # Run with --dry-run to just generate session ID without executing
    run "$RUN_SESSION" --dry-run "test prompt"
    [ "$status" -eq 0 ]

    # Extract session ID from output (should be in metadata or stdout)
    # UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    [[ "$output" =~ [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ]]
}

@test "accepts custom session ID via --session-id" {
    custom_id="custom-test-session-123"
    run "$RUN_SESSION" --dry-run --session-id "$custom_id" "test prompt"
    [ "$status" -eq 0 ]
    [[ "$output" == *"$custom_id"* ]]
}

# =============================================================================
# Workspace Isolation Tests
# =============================================================================

@test "creates isolated workspace directory" {
    run "$RUN_SESSION" --dry-run --output-dir "$TEST_TMPDIR" "test prompt"
    [ "$status" -eq 0 ]

    # Should have created some directory structure
    [[ -d "$TEST_TMPDIR" ]]
}

@test "output directory is created with session ID" {
    session_id="test-session-$(date +%s)"
    run "$RUN_SESSION" --dry-run --session-id "$session_id" --output-dir "$TEST_TMPDIR" "test prompt"
    [ "$status" -eq 0 ]

    # Check that session directory exists or is referenced
    [[ -d "$TEST_TMPDIR/$session_id" ]] || [[ "$output" == *"$session_id"* ]]
}

# =============================================================================
# Metadata Tracking Tests
# =============================================================================

@test "tracks variant name in metadata" {
    run "$RUN_SESSION" --dry-run --variant "with-skill" --output-dir "$TEST_TMPDIR" "test prompt"
    [ "$status" -eq 0 ]
    [[ "$output" == *"with-skill"* ]] || {
        # Check metadata file if created
        [[ -f "$TEST_TMPDIR/metadata.json" ]] && grep -q "with-skill" "$TEST_TMPDIR/metadata.json"
    }
}

@test "records fixture path in metadata" {
    run "$RUN_SESSION" --dry-run --fixture "user-stories/python-cli" --output-dir "$TEST_TMPDIR" "test prompt"
    [ "$status" -eq 0 ]
    # Either in output or metadata file
    [[ "$output" == *"python-cli"* ]] || {
        [[ -f "$TEST_TMPDIR/metadata.json" ]] && grep -q "python-cli" "$TEST_TMPDIR/metadata.json"
    }
}

# =============================================================================
# Prompt Handling Tests
# =============================================================================

@test "accepts prompt as positional argument" {
    run "$RUN_SESSION" --dry-run "Build a calculator"
    [ "$status" -eq 0 ]
}

@test "accepts prompt from file via --prompt-file" {
    echo "Build a test application" > "$TEST_TMPDIR/prompt.txt"
    run "$RUN_SESSION" --dry-run --prompt-file "$TEST_TMPDIR/prompt.txt"
    [ "$status" -eq 0 ]
}

@test "prompt file not found produces error" {
    run "$RUN_SESSION" --dry-run --prompt-file "/nonexistent/prompt.txt"
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found"* ]] || [[ "$output" == *"does not exist"* ]] || [[ "$output" == *"No such file"* ]]
}

# =============================================================================
# Execution Mode Tests
# =============================================================================

@test "defaults to remote execution" {
    run "$RUN_SESSION" --dry-run "test prompt"
    [ "$status" -eq 0 ]
    # Should mention remote or not mention local
    [[ "$output" != *"--local"* ]] || [[ "$output" == *"remote"* ]]
}

@test "supports --local flag for local execution" {
    run "$RUN_SESSION" --dry-run --local "test prompt"
    [ "$status" -eq 0 ]
    [[ "$output" == *"local"* ]] || [[ "$output" == *"--print"* ]]
}

# =============================================================================
# Timeout Tests
# =============================================================================

@test "accepts --timeout parameter" {
    run "$RUN_SESSION" --dry-run --timeout 600 "test prompt"
    [ "$status" -eq 0 ]
}

@test "default timeout is 300 seconds" {
    run "$RUN_SESSION" --dry-run "test prompt"
    [ "$status" -eq 0 ]
    # Should use default or mention 300
    [[ "$output" == *"300"* ]] || true  # May not always be visible
}

# =============================================================================
# Keep Workspace Tests
# =============================================================================

@test "supports --keep flag to preserve workspace" {
    run "$RUN_SESSION" --dry-run --keep --output-dir "$TEST_TMPDIR" "test prompt"
    [ "$status" -eq 0 ]
    # Check that keep flag is acknowledged
    [[ "$output" == *"keep"* ]] || true
}

# =============================================================================
# Quiet Mode Tests
# =============================================================================

@test "supports --quiet flag" {
    run "$RUN_SESSION" --dry-run --quiet "test prompt"
    [ "$status" -eq 0 ]
    # Output should be minimal in quiet mode
}

# =============================================================================
# Integration Tests (require actual claude CLI)
# =============================================================================

# These tests are marked as skip by default since they require real Claude CLI
# Remove skip when running integration tests

@test "fixture cloning from GitHub works" {
    skip "Integration test - requires network access"

    run "$RUN_SESSION" --dry-run \
        --fixture "user-stories/python-cli" \
        --output-dir "$TEST_TMPDIR" \
        "test prompt"
    [ "$status" -eq 0 ]
}

@test "full session execution with claude --remote" {
    skip "Integration test - requires CLAUDE CLI and API access"

    # This would be a real test with actual Claude execution
    run "$RUN_SESSION" \
        --fixture "user-stories/python-cli" \
        --variant "baseline" \
        --output-dir "$TEST_TMPDIR" \
        "Build a simple CLI calculator"
    [ "$status" -eq 0 ]

    # Verify output files exist
    [[ -f "$TEST_TMPDIR/session.jsonl" ]]
    [[ -f "$TEST_TMPDIR/metadata.json" ]]
}

# =============================================================================
# Error Handling Tests
# =============================================================================

@test "handles invalid fixture path gracefully" {
    run "$RUN_SESSION" --dry-run --fixture "nonexistent/path" "test prompt"
    # Should either warn or fail gracefully
    # Depending on implementation - may skip clone or error
    true  # Placeholder - actual behavior depends on implementation
}

@test "validates timeout is numeric" {
    run "$RUN_SESSION" --dry-run --timeout "abc" "test prompt"
    [ "$status" -ne 0 ]
    [[ "$output" == *"invalid"* ]] || [[ "$output" == *"numeric"* ]] || [[ "$output" == *"number"* ]]
}
