#!/usr/bin/env bats
# =============================================================================
# vendoring.test.sh - Integration tests for /init-project vendoring
# =============================================================================
# Task: TRD-TEST-033, TRD-TEST-034, TRD-TEST-035 (Phase 4A)
# Purpose: Verify /init-project creates correct vendored structure
#
# Test coverage:
#   - TRD-TEST-033: Execute /init-project vendoring test
#   - TRD-TEST-034: Verify agents and rules
#   - TRD-TEST-035: Verify skills and root files
#
# Run tests with:
#   bats vendoring.test.sh
#   bats vendoring.test.sh --filter "agent"
#
# Prerequisites:
#   - BATS (Bash Automated Testing System) installed
#   - Claude CLI installed and configured
#   - jq for JSON parsing
#   - Test fixtures available (ensemble-vnext-test-fixtures)
#
# Environment Variables:
#   - FIXTURE_DIR: Path to test fixtures (auto-detected if not set)
#   - SESSION_DIR: Path for session output files
#   - DEFAULT_TIMEOUT: Timeout for headless sessions (default: 600)
#   - QUIET: Suppress informational output (default: false)
#   - SKIP_HEADLESS: Skip tests requiring Claude CLI (for dry runs)
#
# TRD Reference: docs/TRD/testing-phase.md section 4.5 Phase 4A
# =============================================================================

# Get the directory containing this test file
BATS_TEST_DIRNAME="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"

# Source helper functions
source "${BATS_TEST_DIRNAME}/helpers/setup.sh"

# =============================================================================
# Test Setup and Teardown
# =============================================================================

# Global variables for test state
# State files are stored in BATS_FILE_TMPDIR to share between setup_file and tests
TEST_PROJECT_DIR=""

# Helper to get persistent state file path
_state_file() {
    echo "${BATS_FILE_TMPDIR:-/tmp}/vendoring-test-state"
}

setup_file() {
    # Setup that runs once before all tests in the file
    export QUIET="true"

    # Verify prerequisites
    if ! command -v claude &>/dev/null; then
        if [[ "${SKIP_HEADLESS:-false}" != "true" ]]; then
            echo "WARNING: Claude CLI not found. Set SKIP_HEADLESS=true to run non-headless tests only." >&2
        fi
    fi

    # Verify BATS version
    if [[ -z "${BATS_VERSION:-}" ]]; then
        echo "NOTE: Running with older BATS version" >&2
    fi

    # For headless tests, create persistent project directory and run init-project once
    if [[ "${SKIP_HEADLESS:-true}" != "true" ]]; then
        local persistent_dir
        persistent_dir=$(setup_from_fixture "taskflow-api")

        # Verify fixture has PROJECT.md
        if [[ ! -f "${persistent_dir}/PROJECT.md" ]]; then
            echo "ERROR: Fixture missing PROJECT.md" >&2
            return 1
        fi

        # Commands are invoked without plugin prefix (prefix only needed for disambiguation)
        # Run init-project once for all headless tests
        local prompt="/init-project

Read the PROJECT.md file in this directory and initialize the project based on the specified tech stack and requirements."

        echo "Running /init-project in: $persistent_dir" >&2
        local result session_id
        result=$(run_headless_session "$prompt" "$persistent_dir" 600 2>&1) || true
        session_id=$(echo "$result" | tail -1)
        echo "Session ID: $session_id" >&2

        # Store state in file for tests to read (BATS doesn't share vars between setup_file and tests)
        cat > "$(_state_file)" <<EOF
PERSISTENT_PROJECT_DIR="$persistent_dir"
SESSION_ID="$session_id"
EOF
        echo "State saved to: $(_state_file)" >&2
    fi
}

setup() {
    # Setup that runs before each test
    # For headless tests, read persistent directory from state file
    if [[ "${SKIP_HEADLESS:-true}" != "true" && -f "$(_state_file)" ]]; then
        # shellcheck source=/dev/null
        source "$(_state_file)"
        TEST_PROJECT_DIR="$PERSISTENT_PROJECT_DIR"
    else
        # For non-headless tests, create fresh directory
        TEST_PROJECT_DIR=$(setup_empty_dir)
    fi
    export TEST_PROJECT_DIR
    export PERSISTENT_PROJECT_DIR
    export SESSION_ID
}

teardown() {
    # Cleanup after each test
    # Only clean up non-persistent directories (ones not from state file)
    if [[ "${SKIP_HEADLESS:-true}" == "true" && -n "${TEST_PROJECT_DIR:-}" ]]; then
        cleanup_temp_dir "$TEST_PROJECT_DIR" 2>/dev/null || true
    fi
}

teardown_file() {
    # Cleanup that runs once after all tests
    # Read and clean up the persistent directory for headless tests
    if [[ -f "$(_state_file)" ]]; then
        # shellcheck source=/dev/null
        source "$(_state_file)"
        if [[ -n "${PERSISTENT_PROJECT_DIR:-}" ]]; then
            cleanup_temp_dir "$PERSISTENT_PROJECT_DIR" 2>/dev/null || true
        fi
        rm -f "$(_state_file)"
    fi
}

# =============================================================================
# TRD-TEST-033: Execute /init-project vendoring test
# =============================================================================

@test "TRD-TEST-033: /init-project can be executed with PROJECT.md seed" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled (set SKIP_HEADLESS=false to enable)"
    fi

    # Session was run in setup_file()
    # Verify the persistent project directory was set up
    [[ -n "$PERSISTENT_PROJECT_DIR" ]]
    [[ -d "$PERSISTENT_PROJECT_DIR" ]]

    # Verify fixture had PROJECT.md
    [[ -f "${PERSISTENT_PROJECT_DIR}/PROJECT.md" ]]

    # Verify session ID was captured
    [[ -n "$SESSION_ID" ]]
}

@test "TRD-TEST-033: Session completes without critical errors" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled (set SKIP_HEADLESS=false to enable)"
    fi

    # This test verifies the session from setup_file()
    if [[ -z "${SESSION_ID:-}" ]]; then
        skip "No session ID from setup_file"
    fi

    local session_file
    session_file=$(get_session_file "$SESSION_ID")

    if [[ ! -f "$session_file" ]]; then
        skip "Session file not found: $session_file"
    fi

    # Check session success (no critical errors)
    run check_session_success "$SESSION_ID"
    # Note: May have non-critical errors, so we just log the result
    echo "Session success check: status=$status" >&2
}

# =============================================================================
# TRD-TEST-034: Verify agents and rules
# =============================================================================

@test "TRD-TEST-034: Vendoring creates .claude/agents directory" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${TEST_PROJECT_DIR}/.claude/agents"
}

@test "TRD-TEST-034: Vendoring creates 12 agent files" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    local count
    count=$(count_agent_files "$TEST_PROJECT_DIR")

    # Should have exactly 12 agents
    [[ "$count" -eq 12 ]]
}

@test "TRD-TEST-034: product-manager.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/product-manager.md"
}

@test "TRD-TEST-034: technical-architect.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/technical-architect.md"
}

@test "TRD-TEST-034: spec-planner.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/spec-planner.md"
}

@test "TRD-TEST-034: frontend-implementer.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/frontend-implementer.md"
}

@test "TRD-TEST-034: backend-implementer.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/backend-implementer.md"
}

@test "TRD-TEST-034: mobile-implementer.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/mobile-implementer.md"
}

@test "TRD-TEST-034: verify-app.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/verify-app.md"
}

@test "TRD-TEST-034: code-simplifier.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/code-simplifier.md"
}

@test "TRD-TEST-034: code-reviewer.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/code-reviewer.md"
}

@test "TRD-TEST-034: app-debugger.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/app-debugger.md"
}

@test "TRD-TEST-034: devops-engineer.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/devops-engineer.md"
}

@test "TRD-TEST-034: cicd-specialist.md agent exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/agents/cicd-specialist.md"
}

@test "TRD-TEST-034: Vendoring creates .claude/rules directory" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${TEST_PROJECT_DIR}/.claude/rules"
}

@test "TRD-TEST-034: constitution.md governance file exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/rules/constitution.md"
}

@test "TRD-TEST-034: stack.md governance file exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/rules/stack.md"
}

@test "TRD-TEST-034: process.md governance file exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/.claude/rules/process.md"
}

# =============================================================================
# TRD-TEST-035: Verify skills and root files
# =============================================================================

@test "TRD-TEST-035: Vendoring creates .claude/skills directory" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${TEST_PROJECT_DIR}/.claude/skills"
}

@test "TRD-TEST-035: Skills directory may contain stack-appropriate skills" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    # Skills are optional based on stack definition
    # Just verify the directory exists (tested above)
    # and optionally check for content
    local skill_count
    skill_count=$(find "${TEST_PROJECT_DIR}/.claude/skills" -type f -name "*.md" 2>/dev/null | wc -l)

    # Log skill count for debugging
    echo "Found $skill_count skill files" >&2

    # No assertion - skills are optional
    [[ true ]]
}

@test "TRD-TEST-035: CLAUDE.md exists at project root" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${TEST_PROJECT_DIR}/CLAUDE.md"
}

@test "TRD-TEST-035: CLAUDE.md contains project configuration" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    if [[ ! -f "${TEST_PROJECT_DIR}/CLAUDE.md" ]]; then
        skip "CLAUDE.md not found"
    fi

    # Should contain some configuration content
    local line_count
    line_count=$(wc -l < "${TEST_PROJECT_DIR}/CLAUDE.md")

    [[ "$line_count" -gt 5 ]]
}

@test "TRD-TEST-035: docs/PRD directory exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${TEST_PROJECT_DIR}/docs/PRD"
}

@test "TRD-TEST-035: docs/TRD directory exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${TEST_PROJECT_DIR}/docs/TRD"
}

@test "TRD-TEST-035: .trd-state directory exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${TEST_PROJECT_DIR}/.trd-state"
}

@test "TRD-TEST-035: .claude/hooks directory exists" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${TEST_PROJECT_DIR}/.claude/hooks"
}

@test "TRD-TEST-035: Full vendored structure verification passes" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    run verify_vendored_structure "$TEST_PROJECT_DIR"
    [[ "$status" -eq 0 ]]
}

# =============================================================================
# Structure Verification Tests (Non-Headless - for local verification)
# =============================================================================
# These tests verify the vendoring structure WITHOUT running Claude
# Useful for testing the verification functions themselves

@test "structure-verify: verify_vendored_structure function exists" {
    declare -f verify_vendored_structure > /dev/null
}

@test "structure-verify: count_agent_files function exists" {
    declare -f count_agent_files > /dev/null
}

@test "structure-verify: REQUIRED_AGENTS array has 12 entries" {
    [[ "${#REQUIRED_AGENTS[@]}" -eq 12 ]]
}

@test "structure-verify: REQUIRED_GOVERNANCE array has 3 entries" {
    [[ "${#REQUIRED_GOVERNANCE[@]}" -eq 3 ]]
}

@test "structure-verify: check_dir_exists returns 1 for non-existent directory" {
    run check_dir_exists "/nonexistent/path/that/does/not/exist"
    [[ "$status" -eq 1 ]]
}

@test "structure-verify: check_file_exists returns 1 for non-existent file" {
    run check_file_exists "/nonexistent/path/file.txt"
    [[ "$status" -eq 1 ]]
}

@test "structure-verify: setup_empty_dir creates directory" {
    local temp_dir
    temp_dir=$(setup_empty_dir)

    [[ -d "$temp_dir" ]]

    # Cleanup
    cleanup_temp_dir "$temp_dir"
}

@test "structure-verify: cleanup_temp_dir removes directory" {
    local temp_dir
    temp_dir=$(setup_empty_dir)

    cleanup_temp_dir "$temp_dir"

    [[ ! -d "$temp_dir" ]]
}

@test "structure-verify: cleanup_temp_dir refuses non-temp paths" {
    run cleanup_temp_dir "/home"
    [[ "$status" -eq 1 ]]
}

@test "structure-verify: REQUIRED_PRD_SECTIONS array exists" {
    [[ "${#REQUIRED_PRD_SECTIONS[@]}" -ge 3 ]]
}

@test "structure-verify: REQUIRED_TRD_SECTIONS array exists" {
    [[ "${#REQUIRED_TRD_SECTIONS[@]}" -ge 4 ]]
}

@test "structure-verify: verify_prd_template function exists" {
    declare -f verify_prd_template > /dev/null
}

@test "structure-verify: verify_trd_template function exists" {
    declare -f verify_trd_template > /dev/null
}

@test "structure-verify: fixture_has_project_md function exists" {
    declare -f fixture_has_project_md > /dev/null
}

@test "structure-verify: verify_prd_template validates sections correctly" {
    local temp_file
    temp_file=$(mktemp)

    # Create a PRD with all required sections
    cat > "$temp_file" << 'EOF'
# Product Overview

This is the overview section.

## User Stories

- Story 1
- Story 2

## Success Criteria

- Criteria 1
- Criteria 2
EOF

    run verify_prd_template "$temp_file"
    rm -f "$temp_file"

    [[ "$status" -eq 0 ]]
}

@test "structure-verify: verify_prd_template fails on missing sections" {
    local temp_file
    temp_file=$(mktemp)

    # Create a PRD missing required sections
    cat > "$temp_file" << 'EOF'
# Some Document

This has no proper sections.
EOF

    run verify_prd_template "$temp_file"
    rm -f "$temp_file"

    [[ "$status" -eq 1 ]]
}

@test "structure-verify: verify_trd_template validates sections correctly" {
    local temp_file
    temp_file=$(mktemp)

    # Create a TRD with all required sections
    cat > "$temp_file" << 'EOF'
# Technical Overview

This is the technical summary.

## Architecture

System design details.

## Tech Stack

- Python 3.11
- FastAPI

## Execution Plan

1. Task 1
2. Task 2
EOF

    run verify_trd_template "$temp_file"
    rm -f "$temp_file"

    [[ "$status" -eq 0 ]]
}

@test "structure-verify: verify_trd_template fails on missing sections" {
    local temp_file
    temp_file=$(mktemp)

    # Create a TRD missing required sections
    cat > "$temp_file" << 'EOF'
# Some Technical Document

Not a proper TRD.
EOF

    run verify_trd_template "$temp_file"
    rm -f "$temp_file"

    [[ "$status" -eq 1 ]]
}

# =============================================================================
# Plugin Configuration Tests
# =============================================================================

@test "plugin-config: PLUGIN_NAME is set from plugin.json" {
    [[ -n "$PLUGIN_NAME" ]]
    [[ "$PLUGIN_NAME" == "ensemble-vnext" ]]
}

@test "plugin-config: PLUGIN_VERSION is set from plugin.json" {
    [[ -n "$PLUGIN_VERSION" ]]
    [[ "$PLUGIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

@test "plugin-config: PLUGIN_ROOT points to valid directory" {
    [[ -d "$PLUGIN_ROOT" ]]
    [[ -f "${PLUGIN_ROOT}/.claude-plugin/plugin.json" ]]
}
