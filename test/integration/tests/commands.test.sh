#!/usr/bin/env bats
# =============================================================================
# commands.test.sh - Integration tests for /init-project command
# =============================================================================
# Task: TRD-TEST-054, 055 (Phase 4A)
# Purpose: Verify /init-project creates correct project structure
#
# Test coverage:
#   - TRD-TEST-054, 055: /init-project command flow
#
# Note: Tests for /create-prd, /create-trd, and /implement-trd have been
# migrated to Phase 4B eval framework for quality assessment:
#   - create-prd.yaml  (replaces TRD-TEST-056, 057)
#   - create-trd.yaml  (replaces TRD-TEST-058, 059)
#   - implement-trd.yaml (replaces TRD-TEST-060, 061)
#
# Run tests with:
#   bats commands.test.sh
#   bats commands.test.sh --filter "init-project"
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

# Shared state across tests (stored in state file for BATS compatibility)
PERSISTENT_PROJECT_DIR=""
INIT_SESSION_ID=""

# Helper to get persistent state file path
_state_file() {
    echo "${BATS_FILE_TMPDIR:-/tmp}/commands-test-state"
}

setup_file() {
    # Setup that runs once before all tests in the file
    export QUIET="true"

    if ! command -v claude &>/dev/null; then
        if [[ "${SKIP_HEADLESS:-false}" != "true" ]]; then
            echo "WARNING: Claude CLI not found. Set SKIP_HEADLESS=true to run non-headless tests only." >&2
        fi
    fi

    # For headless tests, create fixture and run init-project once
    if [[ "${SKIP_HEADLESS:-false}" != "true" ]]; then
        # Use taskflow-api fixture for the init-project test
        local persistent_dir
        persistent_dir=$(setup_from_fixture "taskflow-api")

        # Verify we have a PROJECT.md to work with
        if [[ -f "${persistent_dir}/PROJECT.md" ]]; then
            echo "Using fixture with PROJECT.md: $persistent_dir" >&2
        else
            echo "ERROR: Fixture missing PROJECT.md" >&2
            return 1
        fi

        # Commands are invoked without plugin prefix (prefix only needed for disambiguation)
        # Run init-project once for all headless tests
        local prompt="/init-project

Read the PROJECT.md file and initialize this project with the appropriate structure, skills, and agent configurations based on the tech stack defined there."

        echo "Running /init-project in: $persistent_dir" >&2
        local result session_id
        result=$(run_headless_session "$prompt" "$persistent_dir" 600 2>&1) || true
        session_id=$(echo "$result" | tail -1)
        echo "Session ID: $session_id" >&2

        # Store state in file for tests to read (BATS doesn't share vars between setup_file and tests)
        cat > "$(_state_file)" <<EOF
PERSISTENT_PROJECT_DIR="$persistent_dir"
INIT_SESSION_ID="$session_id"
EOF
        echo "State saved to: $(_state_file)" >&2
    fi
}

teardown_file() {
    # Cleanup that runs once after all tests
    # Read and clean up the persistent directory for headless tests
    # Set PRESERVE_TEST_DIR=true to keep the directory for further analysis
    if [[ -f "$(_state_file)" ]]; then
        # shellcheck source=/dev/null
        source "$(_state_file)"
        if [[ -n "${PERSISTENT_PROJECT_DIR:-}" ]]; then
            if [[ "${PRESERVE_TEST_DIR:-false}" == "true" ]]; then
                echo "# Preserved test directory: $PERSISTENT_PROJECT_DIR" >&3
            else
                cleanup_temp_dir "$PERSISTENT_PROJECT_DIR" 2>/dev/null || true
            fi
        fi
        rm -f "$(_state_file)"
    fi
}

setup() {
    # Per-test setup: load state from file
    if [[ "${SKIP_HEADLESS:-false}" != "true" && -f "$(_state_file)" ]]; then
        # shellcheck source=/dev/null
        source "$(_state_file)"
    fi
    export PERSISTENT_PROJECT_DIR
    export INIT_SESSION_ID
}

teardown() {
    # Per-test cleanup (if needed)
    :
}

# =============================================================================
# TRD-TEST-054, 055: /init-project command flow
# =============================================================================

@test "TRD-TEST-054: /init-project command creates complete structure" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled (set SKIP_HEADLESS=false to enable)"
    fi

    # Session was run in setup_file()
    # Verify the persistent project directory was set up
    [[ -n "$PERSISTENT_PROJECT_DIR" ]]
    [[ -d "$PERSISTENT_PROJECT_DIR" ]]

    # Verify fixture had PROJECT.md
    [[ -f "${PERSISTENT_PROJECT_DIR}/PROJECT.md" ]]

    # Verify session ID was captured
    [[ -n "$INIT_SESSION_ID" ]]
}

@test "TRD-TEST-055: /init-project artifacts - .claude directory exists" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${PERSISTENT_PROJECT_DIR}/.claude"
}

@test "TRD-TEST-055: /init-project artifacts - agents directory exists" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${PERSISTENT_PROJECT_DIR}/.claude/agents"
}

@test "TRD-TEST-055: /init-project artifacts - rules directory exists" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${PERSISTENT_PROJECT_DIR}/.claude/rules"
}

@test "TRD-TEST-055: /init-project artifacts - docs directory exists" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${PERSISTENT_PROJECT_DIR}/docs"
}

@test "TRD-TEST-055: /init-project artifacts - docs/PRD directory exists" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${PERSISTENT_PROJECT_DIR}/docs/PRD"
}

@test "TRD-TEST-055: /init-project artifacts - docs/TRD directory exists" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_dir_exists "${PERSISTENT_PROJECT_DIR}/docs/TRD"
}

@test "TRD-TEST-055: /init-project artifacts - CLAUDE.md exists" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    check_file_exists "${PERSISTENT_PROJECT_DIR}/CLAUDE.md"
}

@test "TRD-TEST-055: /init-project full structure verification" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    run verify_vendored_structure "$PERSISTENT_PROJECT_DIR"
    [[ "$status" -eq 0 ]]
}

@test "TRD-TEST-055: /init-project creates router-rules.json" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    # Verify router rules file exists (created by generate-project-router-rules)
    check_file_exists "${PERSISTENT_PROJECT_DIR}/.claude/router-rules.json"
}

@test "TRD-TEST-055: /init-project router-rules.json is valid" {
    if [[ "${SKIP_HEADLESS:-false}" == "true" ]]; then
        skip "Headless tests disabled"
    fi

    # Verify router rules has valid structure
    run verify_router_rules "$PERSISTENT_PROJECT_DIR"
    [[ "$status" -eq 0 ]]
}

# =============================================================================
# Function Verification Tests (Non-Headless)
# =============================================================================
# These tests verify helper functions without requiring Claude CLI

@test "functions: find_prd_files function exists" {
    declare -f find_prd_files > /dev/null
}

@test "functions: find_trd_files function exists" {
    declare -f find_trd_files > /dev/null
}

@test "functions: verify_prd_structure function exists" {
    declare -f verify_prd_structure > /dev/null
}

@test "functions: verify_trd_structure function exists" {
    declare -f verify_trd_structure > /dev/null
}

@test "functions: check_implement_state function exists" {
    declare -f check_implement_state > /dev/null
}

@test "functions: verify_router_rules function exists" {
    declare -f verify_router_rules > /dev/null
}

@test "functions: run_headless_session function exists" {
    declare -f run_headless_session > /dev/null
}

@test "functions: get_plugin_name returns plugin name" {
    local name
    name=$(get_plugin_name)
    [[ "$name" == "ensemble-vnext" ]]
}

@test "functions: PLUGIN_NAME environment variable is set" {
    [[ -n "$PLUGIN_NAME" ]]
    [[ "$PLUGIN_NAME" == "ensemble-vnext" ]]
}

@test "functions: PLUGIN_VERSION environment variable is set" {
    [[ -n "$PLUGIN_VERSION" ]]
    [[ "$PLUGIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

@test "functions: get_session_file returns correct path" {
    local result
    result=$(get_session_file "test-uuid-123")

    [[ "$result" == *"session-test-uuid-123.jsonl" ]]
}

@test "functions: check_file_matches works with regex" {
    local temp_file
    temp_file=$(mktemp)
    echo "# Overview" > "$temp_file"
    echo "Some content here" >> "$temp_file"

    run check_file_matches "$temp_file" "^#.*[Oo]verview"
    rm -f "$temp_file"

    [[ "$status" -eq 0 ]]
}

@test "functions: check_file_matches fails for non-matching regex" {
    local temp_file
    temp_file=$(mktemp)
    echo "# Introduction" > "$temp_file"

    run check_file_matches "$temp_file" "^#.*[Oo]verview"
    rm -f "$temp_file"

    [[ "$status" -eq 1 ]]
}
