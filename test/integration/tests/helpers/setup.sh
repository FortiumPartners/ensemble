#!/bin/bash
# =============================================================================
# setup.sh - Shared helper functions for integration tests
# =============================================================================
# Task: TRD-TEST-033 through TRD-TEST-061 (Phase 4A)
# Purpose: Provide reusable test setup, teardown, and verification functions
#          for BATS integration tests.
#
# Usage:
#   In your BATS test file:
#     source "${BATS_TEST_DIRNAME}/helpers/setup.sh"
#
# Functions:
#   - setup_from_fixture   : Copy fixture to temp directory
#   - run_headless_session : Execute Claude CLI in headless mode
#   - cleanup_temp_dir     : Remove temporary test directory
#   - check_file_exists    : Verify file existence
#   - check_dir_exists     : Verify directory existence
#   - count_files          : Count files matching pattern
#   - check_file_contains  : Verify file contains text
#   - get_session_file     : Get path to session JSONL file
#   - wait_for_session     : Wait for session to complete
#
# Dependencies:
#   - BATS (Bash Automated Testing System)
#   - jq for JSON parsing
#   - Claude CLI installed
#
# TRD Reference: docs/TRD/testing-phase.md section 4.5 Phase 4A
# =============================================================================

set -euo pipefail

# ShellCheck directives for intentional patterns
# shellcheck disable=SC2034  # Variables used by BATS via export

# =============================================================================
# Configuration
# =============================================================================

# Get the directory containing this script
HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Integration test scripts directory
SCRIPT_DIR="$(cd "${HELPER_DIR}/../../scripts" && pwd)"

# Project root directory
PROJECT_ROOT="$(cd "${HELPER_DIR}/../../../.." && pwd)"

# Plugin root directory (packages/full)
PLUGIN_ROOT="${PROJECT_ROOT}/packages/full"

# =============================================================================
# Plugin Configuration (Single Source of Truth)
# =============================================================================

# Source plugin configuration from plugin.json
PLUGIN_CONFIG_PATH="${PLUGIN_ROOT}/lib/plugin-config.sh"
if [[ -f "$PLUGIN_CONFIG_PATH" ]]; then
    # shellcheck source=../../../../packages/full/lib/plugin-config.sh
    source "$PLUGIN_CONFIG_PATH"
else
    # Fallback defaults if plugin-config.sh not available
    PLUGIN_NAME="${PLUGIN_NAME:-ensemble-vnext}"
    PLUGIN_VERSION="${PLUGIN_VERSION:-1.0.0}"

    # Define fallback functions
    get_plugin_name() { echo "$PLUGIN_NAME"; }
    get_plugin_version() { echo "$PLUGIN_VERSION"; }
    get_command_prefix() { echo "${PLUGIN_NAME}:"; }
    format_command() { echo "${PLUGIN_NAME}:$1"; }
    get_command_invoke() { echo "/${PLUGIN_NAME}:$1"; }
fi

export PLUGIN_NAME
export PLUGIN_VERSION
export PROJECT_ROOT
export PLUGIN_ROOT

# Environment variables for init-project plugin path resolution
# These allow the scaffold script to find the plugin directory in test mode
export ENSEMBLE_TEST_MODE=true
export ENSEMBLE_PLUGIN_DIR="${PLUGIN_ROOT}"

# Test fixtures directory (can be overridden via environment)
FIXTURE_DIR="${FIXTURE_DIR:-$(cd "${HELPER_DIR}/../../../ensemble-vnext-test-fixtures/fixtures" 2>/dev/null && pwd || echo "")}"
if [[ -z "$FIXTURE_DIR" || ! -d "$FIXTURE_DIR" ]]; then
    # Try alternative location (submodule or local)
    if [[ -d "${HELPER_DIR}/../../../../ensemble-vnext-test-fixtures/fixtures" ]]; then
        FIXTURE_DIR="$(cd "${HELPER_DIR}/../../../../ensemble-vnext-test-fixtures/fixtures" && pwd)"
    fi
fi

# Session output directory
SESSION_DIR="${SESSION_DIR:-${HELPER_DIR}/../../sessions}"

# Default timeout for headless sessions (10 minutes for complex operations)
DEFAULT_TIMEOUT="${DEFAULT_TIMEOUT:-600}"

# Quiet mode (suppress informational messages)
QUIET="${QUIET:-false}"

# =============================================================================
# Logging Helpers
# =============================================================================

log_info() {
    if [[ "${QUIET}" != "true" ]]; then
        echo "[INFO] $*" >&2
    fi
}

log_error() {
    echo "[ERROR] $*" >&2
}

log_debug() {
    if [[ "${DEBUG:-false}" == "true" ]]; then
        echo "[DEBUG] $*" >&2
    fi
}

# =============================================================================
# Fixture Management
# =============================================================================

# Create temp test directory from fixture
# Usage: setup_from_fixture <fixture_name>
# Returns: Path to temp directory (echo'd to stdout)
setup_from_fixture() {
    local fixture_name="$1"
    local temp_dir

    if [[ -z "$fixture_name" ]]; then
        log_error "Fixture name is required"
        return 1
    fi

    if [[ -z "$FIXTURE_DIR" || ! -d "$FIXTURE_DIR" ]]; then
        log_error "Fixture directory not found: $FIXTURE_DIR"
        log_error "Set FIXTURE_DIR environment variable to point to fixtures location"
        return 1
    fi

    local fixture_path="${FIXTURE_DIR}/${fixture_name}"
    if [[ ! -d "$fixture_path" ]]; then
        log_error "Fixture not found: $fixture_path"
        return 1
    fi

    # Create temporary directory
    temp_dir=$(mktemp -d -t "ensemble-test-XXXXXX")
    log_debug "Created temp directory: $temp_dir"

    # Copy fixture contents to temp directory
    # Use cp -a to preserve all attributes
    cp -a "${fixture_path}/." "${temp_dir}/" 2>/dev/null || true

    # Initialize as git repo if not already (some commands require it)
    if [[ ! -d "${temp_dir}/.git" ]]; then
        (cd "$temp_dir" && git init -q && git config user.email "test@example.com" && git config user.name "Test" && git add -A && git commit -q -m "Initial commit" 2>/dev/null) || true
    fi

    log_info "Set up test directory from fixture '$fixture_name': $temp_dir"
    echo "$temp_dir"
}

# Create empty temp directory (not from fixture)
# Returns: Path to temp directory (echo'd to stdout)
setup_empty_dir() {
    local temp_dir
    temp_dir=$(mktemp -d -t "ensemble-test-XXXXXX")

    # Initialize as git repo
    (cd "$temp_dir" && git init -q && git config user.email "test@example.com" && git config user.name "Test") || true

    log_debug "Created empty temp directory: $temp_dir"
    echo "$temp_dir"
}

# Cleanup temp directories
# Usage: cleanup_temp_dir <path>
cleanup_temp_dir() {
    local dir="$1"
    local tmp_base="${TMPDIR:-/tmp}"
    # Only clean directories that look like our temp dirs
    if [[ -d "$dir" && "$dir" == *"ensemble-test-"* && ( "$dir" == /tmp/* || "$dir" == "$tmp_base"/* ) ]]; then
        log_debug "Cleaning up temp directory: $dir"
        rm -rf "$dir"
    else
        log_error "Refusing to delete non-temp directory: $dir"
        return 1
    fi
}

# =============================================================================
# Session Execution
# =============================================================================

# Run headless session and return session ID
# Usage: run_headless_session <prompt> <work_dir> [timeout]
# Returns: Session UUID (echo'd to stdout)
run_headless_session() {
    local prompt="$1"
    local work_dir="$2"
    local timeout="${3:-$DEFAULT_TIMEOUT}"

    if [[ -z "$prompt" ]]; then
        log_error "Prompt is required"
        return 1
    fi

    if [[ -z "$work_dir" || ! -d "$work_dir" ]]; then
        log_error "Work directory is required and must exist: $work_dir"
        return 1
    fi

    # Validate timeout is a positive integer
    if ! [[ "$timeout" =~ ^[0-9]+$ ]] || [[ "$timeout" -le 0 ]]; then
        log_error "Timeout must be a positive integer: $timeout"
        return 1
    fi

    # Ensure scripts are available
    if [[ ! -x "${SCRIPT_DIR}/run-headless.sh" ]]; then
        log_error "run-headless.sh not found or not executable: ${SCRIPT_DIR}/run-headless.sh"
        return 1
    fi

    # Create session directory if needed
    mkdir -p "$SESSION_DIR"

    log_info "Starting headless session in: $work_dir"
    log_info "Prompt: ${prompt:0:100}..."
    log_info "Timeout: ${timeout}s"
    log_info "Plugin: ${PLUGIN_ROOT}"

    # Run headless session from the work directory
    local quiet_flag=""
    if [[ "${QUIET}" == "true" ]]; then
        quiet_flag="--quiet"
    fi

    # Use temp file to capture output while preserving exit code
    local output_file
    output_file=$(mktemp)

    local exit_code=0
    (cd "$work_dir" && \
        "${SCRIPT_DIR}/run-headless.sh" "$prompt" \
            --timeout "$timeout" \
            --output-dir "$SESSION_DIR" \
            --plugin-dir "$PLUGIN_ROOT" \
            ${quiet_flag:+"$quiet_flag"} 2>&1) > "$output_file" || exit_code=$?

    local session_id
    session_id=$(tail -1 "$output_file")
    rm -f "$output_file"

    if [[ $exit_code -ne 0 ]]; then
        log_error "Headless session failed with exit code: $exit_code"
        log_error "Session ID (partial): $session_id"
        # Still return the session ID so logs can be inspected
        echo "$session_id"
        return $exit_code
    fi

    log_info "Session completed: $session_id"
    echo "$session_id"
}

# Get session file path from session ID
# Usage: get_session_file <session_id>
# Returns: Full path to session JSONL file
get_session_file() {
    local session_id="$1"
    echo "${SESSION_DIR}/session-${session_id}.jsonl"
}

# Wait for session file to be created and have content
# Usage: wait_for_session <session_id> [timeout_seconds]
wait_for_session() {
    local session_id="$1"
    local timeout="${2:-60}"
    local session_file
    session_file=$(get_session_file "$session_id")

    local elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if [[ -f "$session_file" && -s "$session_file" ]]; then
            log_debug "Session file ready: $session_file"
            return 0
        fi
        sleep 1
        ((elapsed++))
    done

    log_error "Timeout waiting for session file: $session_file"
    return 1
}

# =============================================================================
# File System Verification
# =============================================================================

# Check if file exists
# Usage: check_file_exists <path>
# Returns: 0 if exists, 1 if not
check_file_exists() {
    local path="$1"
    if [[ -f "$path" ]]; then
        log_debug "File exists: $path"
        return 0
    else
        log_info "File not found: $path"
        return 1
    fi
}

# Check if directory exists
# Usage: check_dir_exists <path>
# Returns: 0 if exists, 1 if not
check_dir_exists() {
    local path="$1"
    if [[ -d "$path" ]]; then
        log_debug "Directory exists: $path"
        return 0
    else
        log_info "Directory not found: $path"
        return 1
    fi
}

# Count files matching pattern in directory
# Usage: count_files <directory> <pattern>
# Returns: Count (echo'd to stdout)
count_files() {
    local directory="$1"
    local pattern="$2"

    if [[ ! -d "$directory" ]]; then
        echo "0"
        return
    fi

    local count
    count=$(find "$directory" -maxdepth 1 -name "$pattern" -type f 2>/dev/null | wc -l)
    echo "$count"
}

# Check if file contains specific text
# Usage: check_file_contains <file_path> <text>
# Returns: 0 if contains, 1 if not
check_file_contains() {
    local file_path="$1"
    local text="$2"

    if [[ ! -f "$file_path" ]]; then
        log_info "File not found: $file_path"
        return 1
    fi

    if grep -q "$text" "$file_path" 2>/dev/null; then
        log_debug "File contains text: $text"
        return 0
    else
        log_info "File does not contain: $text"
        return 1
    fi
}

# Check if file matches regex pattern
# Usage: check_file_matches <file_path> <pattern>
# Returns: 0 if matches, 1 if not
check_file_matches() {
    local file_path="$1"
    local pattern="$2"

    if [[ ! -f "$file_path" ]]; then
        log_info "File not found: $file_path"
        return 1
    fi

    if grep -qE "$pattern" "$file_path" 2>/dev/null; then
        log_debug "File matches pattern: $pattern"
        return 0
    else
        log_info "File does not match pattern: $pattern"
        return 1
    fi
}

# =============================================================================
# Session Verification (using verify-output.sh)
# =============================================================================

# Check if a tool was invoked during session
# Usage: check_tool_invoked <session_id> <tool_name>
check_tool_invoked() {
    local session_id="$1"
    local tool_name="$2"
    local session_file
    session_file=$(get_session_file "$session_id")

    "${SCRIPT_DIR}/verify-output.sh" check_tool_invoked "$session_file" "$tool_name"
}

# Check if a file was created during session
# Usage: check_file_created_in_session <session_id> <file_path>
check_file_created_in_session() {
    local session_id="$1"
    local file_path="$2"
    local session_file
    session_file=$(get_session_file "$session_id")

    "${SCRIPT_DIR}/verify-output.sh" check_file_created "$session_file" "$file_path"
}

# List all tools used in session
# Usage: list_session_tools <session_id>
list_session_tools() {
    local session_id="$1"
    local session_file
    session_file=$(get_session_file "$session_id")

    "${SCRIPT_DIR}/verify-output.sh" list_all_tools "$session_file"
}

# Check if session completed successfully (no errors)
# Usage: check_session_success <session_id>
check_session_success() {
    local session_id="$1"
    local session_file
    session_file=$(get_session_file "$session_id")

    "${SCRIPT_DIR}/verify-output.sh" check_session_success "$session_file"
}

# =============================================================================
# Vendoring Structure Verification
# =============================================================================

# List of required agent files (12 agents)
REQUIRED_AGENTS=(
    "product-manager.md"
    "technical-architect.md"
    "spec-planner.md"
    "frontend-implementer.md"
    "backend-implementer.md"
    "mobile-implementer.md"
    "verify-app.md"
    "code-simplifier.md"
    "code-reviewer.md"
    "app-debugger.md"
    "devops-engineer.md"
    "cicd-specialist.md"
)

# =============================================================================
# Template Section Definitions
# =============================================================================
# These define required sections for PRD and TRD templates
# Used for deterministic structural compliance verification (Phase 4A)
# Quality assessment of content belongs in Phase 4B evals

# Required PRD sections (from PRD template)
REQUIRED_PRD_SECTIONS=(
    "Overview|Summary|Introduction"
    "User Stories|Features|Requirements"
    "Success Criteria|Success Metrics|Acceptance Criteria"
)

# Required TRD sections (from TRD template)
REQUIRED_TRD_SECTIONS=(
    "Overview|Summary|Technical Summary"
    "Architecture|System Design|Technical Design"
    "Tech.*Stack|Technology|Stack"
    "Execution Plan|Implementation Plan|Task List|Master Task"
)

# List of required governance files
REQUIRED_GOVERNANCE=(
    "constitution.md"
    "stack.md"
    "process.md"
)

# Verify vendored structure after /init-project
# Usage: verify_vendored_structure <project_dir>
# Returns: 0 if complete, 1 if missing components
verify_vendored_structure() {
    local project_dir="$1"
    local errors=0

    log_info "Verifying vendored structure in: $project_dir"

    # Check .claude directory structure
    check_dir_exists "${project_dir}/.claude" || ((errors++))
    check_dir_exists "${project_dir}/.claude/agents" || ((errors++))
    check_dir_exists "${project_dir}/.claude/rules" || ((errors++))
    check_dir_exists "${project_dir}/.claude/hooks" || ((errors++))
    check_dir_exists "${project_dir}/.claude/skills" || ((errors++))

    # Check all 12 agents
    for agent in "${REQUIRED_AGENTS[@]}"; do
        check_file_exists "${project_dir}/.claude/agents/${agent}" || ((errors++))
    done

    # Check governance files
    for gov_file in "${REQUIRED_GOVERNANCE[@]}"; do
        check_file_exists "${project_dir}/.claude/rules/${gov_file}" || ((errors++))
    done

    # Check docs directories
    check_dir_exists "${project_dir}/docs/PRD" || ((errors++))
    check_dir_exists "${project_dir}/docs/TRD" || ((errors++))

    # Check .trd-state directory
    check_dir_exists "${project_dir}/.trd-state" || ((errors++))

    # Check CLAUDE.md at root
    check_file_exists "${project_dir}/CLAUDE.md" || ((errors++))

    # Check router rules file (created by generate-project-router-rules)
    check_file_exists "${project_dir}/.claude/router-rules.json" || ((errors++))

    if [[ $errors -gt 0 ]]; then
        log_error "Vendored structure verification failed with $errors errors"
        return 1
    fi

    log_info "Vendored structure verification passed"
    return 0
}

# Verify router rules file has valid structure
# Usage: verify_router_rules <project_dir>
# Returns: 0 if valid, 1 if invalid
verify_router_rules() {
    local project_dir="$1"
    local rules_file="${project_dir}/.claude/router-rules.json"

    if [[ ! -f "$rules_file" ]]; then
        log_error "Router rules file not found: $rules_file"
        return 1
    fi

    # Check it's valid JSON
    if ! jq empty "$rules_file" 2>/dev/null; then
        log_error "Router rules file is not valid JSON"
        return 1
    fi

    # Check for expected top-level keys (version is required)
    if ! jq -e '.version' "$rules_file" >/dev/null 2>&1; then
        log_error "Router rules file missing 'version' field"
        return 1
    fi

    log_info "Router rules verification passed"
    return 0
}

# Count agent files in .claude/agents
# Usage: count_agent_files <project_dir>
count_agent_files() {
    local project_dir="$1"
    count_files "${project_dir}/.claude/agents" "*.md"
}

# =============================================================================
# PRD/TRD Verification
# =============================================================================

# Verify PRD document structure
# Usage: verify_prd_structure <prd_file>
verify_prd_structure() {
    local prd_file="$1"
    local errors=0

    if [[ ! -f "$prd_file" ]]; then
        log_error "PRD file not found: $prd_file"
        return 1
    fi

    # Check for required PRD sections (flexible matching)
    local required_sections=(
        "Overview\|Summary\|Introduction"
        "User Stories\|User Requirements\|Features"
        "Requirements\|Functional\|Specifications"
    )

    for section_pattern in "${required_sections[@]}"; do
        if ! grep -qiE "^#.*($section_pattern)" "$prd_file"; then
            log_info "PRD missing section matching: $section_pattern"
            ((errors++))
        fi
    done

    if [[ $errors -gt 0 ]]; then
        log_error "PRD structure verification failed with $errors missing sections"
        return 1
    fi

    log_info "PRD structure verification passed"
    return 0
}

# Verify TRD document structure
# Usage: verify_trd_structure <trd_file>
verify_trd_structure() {
    local trd_file="$1"
    local errors=0

    if [[ ! -f "$trd_file" ]]; then
        log_error "TRD file not found: $trd_file"
        return 1
    fi

    # Check for required TRD sections (flexible matching)
    local required_sections=(
        "Overview\|Summary\|Introduction"
        "Architecture\|System Design\|Technical"
        "Execution Plan\|Implementation\|Tasks"
    )

    for section_pattern in "${required_sections[@]}"; do
        if ! grep -qiE "^#.*($section_pattern)" "$trd_file"; then
            log_info "TRD missing section matching: $section_pattern"
            ((errors++))
        fi
    done

    # Check for parallelization recommendations
    if ! grep -qi "parallel\|concurrent\|session\|delegation" "$trd_file"; then
        log_info "TRD may be missing parallelization recommendations"
        # Not a hard error, just a warning
    fi

    if [[ $errors -gt 0 ]]; then
        log_error "TRD structure verification failed with $errors missing sections"
        return 1
    fi

    log_info "TRD structure verification passed"
    return 0
}

# Find PRD files in docs/PRD directory
# Usage: find_prd_files <project_dir>
find_prd_files() {
    local project_dir="$1"
    find "${project_dir}/docs/PRD" -name "*.md" -type f 2>/dev/null
}

# Find TRD files in docs/TRD directory
# Usage: find_trd_files <project_dir>
find_trd_files() {
    local project_dir="$1"
    find "${project_dir}/docs/TRD" -name "*.md" -type f 2>/dev/null
}

# =============================================================================
# Template Verification Functions (Phase 4A Deterministic Checks)
# =============================================================================
# These functions verify structural compliance with templates
# For quality assessment, see Phase 4B evals

# Verify PRD has required template sections
# Usage: verify_prd_template <prd_file>
# Returns: 0 if all required sections present, 1 otherwise
verify_prd_template() {
    local prd_file="$1"
    local errors=0

    if [[ ! -f "$prd_file" ]]; then
        log_error "PRD file not found: $prd_file"
        return 1
    fi

    log_info "Verifying PRD template sections in: $prd_file"

    for section_pattern in "${REQUIRED_PRD_SECTIONS[@]}"; do
        if ! grep -qiE "^#+.*($section_pattern)" "$prd_file"; then
            log_info "PRD missing required section: $section_pattern"
            ((errors++))
        fi
    done

    if [[ $errors -gt 0 ]]; then
        log_error "PRD template verification failed: $errors missing sections"
        return 1
    fi

    log_info "PRD template verification passed"
    return 0
}

# Verify TRD has required template sections
# Usage: verify_trd_template <trd_file>
# Returns: 0 if all required sections present, 1 otherwise
verify_trd_template() {
    local trd_file="$1"
    local errors=0

    if [[ ! -f "$trd_file" ]]; then
        log_error "TRD file not found: $trd_file"
        return 1
    fi

    log_info "Verifying TRD template sections in: $trd_file"

    for section_pattern in "${REQUIRED_TRD_SECTIONS[@]}"; do
        if ! grep -qiE "^#+.*($section_pattern)" "$trd_file"; then
            log_info "TRD missing required section: $section_pattern"
            ((errors++))
        fi
    done

    if [[ $errors -gt 0 ]]; then
        log_error "TRD template verification failed: $errors missing sections"
        return 1
    fi

    log_info "TRD template verification passed"
    return 0
}

# Check if fixture has PROJECT.md
# Usage: fixture_has_project_md <fixture_dir>
# Returns: 0 if PROJECT.md exists, 1 otherwise
fixture_has_project_md() {
    local fixture_dir="$1"
    [[ -f "${fixture_dir}/PROJECT.md" ]]
}

# =============================================================================
# Implementation State Verification
# =============================================================================

# Check for .trd-state/*/implement.json
# Usage: check_implement_state <project_dir>
check_implement_state() {
    local project_dir="$1"
    local state_files
    state_files=$(find "${project_dir}/.trd-state" -name "implement.json" -type f 2>/dev/null | wc -l)

    if [[ "$state_files" -gt 0 ]]; then
        log_info "Found $state_files implement.json file(s)"
        return 0
    else
        log_info "No implement.json files found in .trd-state"
        return 1
    fi
}

# =============================================================================
# Test Result Helpers
# =============================================================================

# Print test result summary
# Usage: print_test_summary <test_name> <passed> <failed>
print_test_summary() {
    local test_name="$1"
    local passed="$2"
    local failed="$3"
    local total=$((passed + failed))

    echo ""
    echo "========================================"
    echo "Test Summary: $test_name"
    echo "========================================"
    echo "Total:  $total"
    echo "Passed: $passed"
    echo "Failed: $failed"

    if [[ $failed -eq 0 ]]; then
        echo "Status: ALL TESTS PASSED"
        return 0
    else
        echo "Status: SOME TESTS FAILED"
        return 1
    fi
}

# =============================================================================
# Session ID Validation
# =============================================================================

# Validate session ID looks like a UUID
# Usage: validate_session_id <session_id>
# Returns: 0 if valid, 1 if invalid
validate_session_id() {
    local session_id="$1"
    # UUID format: 8-4-4-4-12 hex characters
    if [[ "$session_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
        return 0
    else
        log_debug "Session ID does not match UUID format: $session_id"
        return 1
    fi
}

# =============================================================================
# Exports for BATS
# =============================================================================

export -f validate_session_id
export -f setup_from_fixture
export -f setup_empty_dir
export -f cleanup_temp_dir
export -f run_headless_session
export -f get_session_file
export -f wait_for_session
export -f check_file_exists
export -f check_dir_exists
export -f count_files
export -f check_file_contains
export -f check_file_matches
export -f check_tool_invoked
export -f check_file_created_in_session
export -f list_session_tools
export -f check_session_success
export -f verify_vendored_structure
export -f verify_router_rules
export -f count_agent_files
export -f verify_prd_structure
export -f verify_trd_structure
export -f find_prd_files
export -f find_trd_files
export -f verify_prd_template
export -f verify_trd_template
export -f fixture_has_project_md
export -f check_implement_state
export -f print_test_summary
export -f log_info
export -f log_error
export -f log_debug

export HELPER_DIR
export SCRIPT_DIR
export FIXTURE_DIR
export SESSION_DIR
export DEFAULT_TIMEOUT
export REQUIRED_AGENTS
export REQUIRED_GOVERNANCE
export REQUIRED_PRD_SECTIONS
export REQUIRED_TRD_SECTIONS
export PROJECT_ROOT
export PLUGIN_ROOT
export PLUGIN_NAME
export PLUGIN_VERSION
export PLUGIN_CONFIG_PATH

# Export plugin config functions (if not already exported by plugin-config.sh)
export -f get_plugin_name 2>/dev/null || true
export -f get_plugin_version 2>/dev/null || true
export -f get_command_prefix 2>/dev/null || true
export -f format_command 2>/dev/null || true
export -f get_command_invoke 2>/dev/null || true
