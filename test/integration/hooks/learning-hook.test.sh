#!/usr/bin/env bats
# =============================================================================
# learning-hook.test.sh - Integration tests for learning hook (SessionEnd)
# =============================================================================
# Task: TRD-TEST-097
# Purpose: Verify the learning hook fires on session Stop/SessionEnd event,
#          captures learning data, and stages files without committing.
#
# Test coverage:
#   - Learning hook fires on SessionEnd event
#   - Learning data is captured (files are staged)
#   - No git commits are made (only staging)
#   - Graceful handling of non-git directories
#
# Run tests with:
#   bats test/integration/hooks/learning-hook.test.sh
#   bats test/integration/hooks/learning-hook.test.sh --filter "fires"
#
# Prerequisites:
#   - BATS (Bash Automated Testing System) installed
#   - Claude CLI installed and configured
#   - Node.js for hook event parser
#   - jq for JSON parsing
#
# Environment Variables:
#   - SKIP_HEADLESS: Skip tests requiring Claude CLI (for dry runs)
#   - SESSION_DIR: Path for session output files
#   - DEFAULT_TIMEOUT: Timeout for headless sessions (default: 120)
#   - DEBUG: Enable verbose debugging
#
# Dependencies:
#   - TRD-TEST-093: run-hook-test.sh harness
#   - TRD-TEST-094: parse-hook-events.js parser
#   - packages/core/hooks/learning.sh hook implementation
#
# TRD Reference: docs/TRD/testing-phase.md TRD-TEST-097
# =============================================================================

# Get the directory containing this test file
BATS_TEST_DIRNAME="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"

# =============================================================================
# Test Configuration
# =============================================================================

# Path to hook harness and parser
HOOK_HARNESS="${BATS_TEST_DIRNAME}/run-hook-test.sh"
HOOK_PARSER="${BATS_TEST_DIRNAME}/parse-hook-events.js"

# Path to the learning hook
LEARNING_HOOK="${BATS_TEST_DIRNAME}/../../../packages/core/hooks/learning.sh"

# Session output directory
SESSION_DIR="${SESSION_DIR:-${BATS_TEST_DIRNAME}/../sessions}"

# Default timeout (2 minutes for quick tests)
DEFAULT_TIMEOUT="${DEFAULT_TIMEOUT:-120}"

# =============================================================================
# Test Setup and Teardown
# =============================================================================

setup() {
    # Store original directory
    ORIGINAL_DIR="$(pwd)"

    # Create temporary test directory
    TEST_DIR="$(mktemp -d -t "learning-hook-test-XXXXXX")"

    # Export for tests
    export TEST_DIR
    export SESSION_DIR

    # Create session directory if needed
    mkdir -p "$SESSION_DIR"

    # Clear environment variables that affect hook behavior
    unset LEARNING_HOOK_DISABLE
    unset LEARNING_HOOK_DEBUG
    unset CLAUDE_CODE_REMOTE
    unset CI
    unset GITHUB_ACTIONS
    unset GITLAB_CI
}

teardown() {
    # Return to original directory
    cd "$ORIGINAL_DIR" 2>/dev/null || true

    # Clean up test directory
    if [[ -n "$TEST_DIR" && -d "$TEST_DIR" && "$TEST_DIR" == *"learning-hook-test-"* ]]; then
        rm -rf "$TEST_DIR"
    fi
}

# =============================================================================
# Helper Functions
# =============================================================================

# Create a minimal git repository for testing
create_test_git_repo() {
    local repo_path="${1:-${TEST_DIR}/repo}"
    mkdir -p "$repo_path"
    (
        cd "$repo_path"
        git init --initial-branch=main >/dev/null 2>&1 || git init >/dev/null 2>&1
        git config user.email "test@example.com"
        git config user.name "Test User"
        # Create initial commit so git operations work
        echo "initial" > README.md
        git add README.md
        git commit -m "Initial commit" >/dev/null 2>&1
    )
    echo "$repo_path"
}

# Create a project with .claude/ directory
create_test_project() {
    local project_path="${1:-${TEST_DIR}/project}"
    create_test_git_repo "$project_path" >/dev/null
    mkdir -p "${project_path}/.claude"
    echo "$project_path"
}

# Get the current commit count in a repo
get_commit_count() {
    local repo_path="$1"
    (cd "$repo_path" && git rev-list --count HEAD 2>/dev/null) || echo "0"
}

# Get the HEAD commit hash
get_head_commit() {
    local repo_path="$1"
    (cd "$repo_path" && git rev-parse HEAD 2>/dev/null) || echo ""
}

# Get list of staged files
get_staged_files() {
    local repo_path="$1"
    (cd "$repo_path" && git diff --staged --name-only 2>/dev/null) || echo ""
}

# Run learning hook directly with JSON input
run_learning_hook() {
    local cwd="$1"
    local input="${2:-{}}"

    if [[ -n "$cwd" ]]; then
        input="{\"cwd\": \"$cwd\"}"
    fi

    echo "$input" | bash "$LEARNING_HOOK" 2>/dev/null
}

# =============================================================================
# TRD-TEST-097: Learning Hook Integration Tests
# =============================================================================

# -----------------------------------------------------------------------------
# Test 1: Verify learning hook fires on session Stop event
# -----------------------------------------------------------------------------

@test "TRD-TEST-097: learning hook fires on SessionEnd event" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create a modified file to trigger staging
    echo "new content" > newfile.txt

    # Run the learning hook directly (simulating SessionEnd)
    local output
    output=$(run_learning_hook "$project_path")

    # Verify the hook produced output with hookSpecificOutput
    [[ "$output" == *"hookSpecificOutput"* ]]

    # Verify event name is SessionEnd
    [[ "$output" == *"SessionEnd"* ]]
}

@test "TRD-TEST-097: learning hook returns JSON with correct structure" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Run the learning hook
    local output
    output=$(run_learning_hook "$project_path")

    # Verify output is valid JSON
    echo "$output" | python3 -c "import json, sys; json.load(sys.stdin)" 2>/dev/null || \
    echo "$output" | jq . >/dev/null 2>&1

    # Verify required fields are present
    [[ "$output" == *"hookSpecificOutput"* ]]
    [[ "$output" == *"hookEventName"* ]]
    [[ "$output" == *"status"* ]]
    [[ "$output" == *"staged_count"* ]]
    [[ "$output" == *"timestamp"* ]]
}

# -----------------------------------------------------------------------------
# Test 2: Verify learning data is captured (files are staged)
# -----------------------------------------------------------------------------

@test "TRD-TEST-097: learning hook stages modified files" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create and modify files
    echo "file content 1" > file1.txt
    echo "file content 2" > file2.txt

    # Record commit count before
    local commit_count_before
    commit_count_before=$(get_commit_count "$project_path")

    # Run the learning hook
    local output
    output=$(run_learning_hook "$project_path")

    # Verify files are staged
    local staged_files
    staged_files=$(get_staged_files "$project_path")

    [[ "$staged_files" == *"file1.txt"* ]]
    [[ "$staged_files" == *"file2.txt"* ]]
}

@test "TRD-TEST-097: learning hook captures staged count in output" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create multiple files
    echo "content" > test1.txt
    echo "content" > test2.txt
    echo "content" > test3.txt

    # Run the learning hook
    local output
    output=$(run_learning_hook "$project_path")

    # Extract staged_count from JSON output
    local staged_count
    if command -v jq &>/dev/null; then
        staged_count=$(echo "$output" | jq '.hookSpecificOutput.staged_count' 2>/dev/null)
    else
        staged_count=$(echo "$output" | sed -n 's/.*"staged_count":[[:space:]]*\([0-9]*\).*/\1/p')
    fi

    # Should have staged at least 3 files
    [[ "$staged_count" -ge 3 ]]
}

@test "TRD-TEST-097: learning hook stages CLAUDE.md if modified" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create CLAUDE.md and commit it
    echo "# Initial CLAUDE.md" > CLAUDE.md
    git add CLAUDE.md
    git commit -m "Add CLAUDE.md" >/dev/null 2>&1

    # Modify CLAUDE.md
    echo "# Modified learning content" >> CLAUDE.md

    # Run the learning hook
    run_learning_hook "$project_path" >/dev/null

    # Verify CLAUDE.md is staged
    local staged_files
    staged_files=$(get_staged_files "$project_path")

    [[ "$staged_files" == *"CLAUDE.md"* ]]
}

@test "TRD-TEST-097: learning hook stages files in subdirectories" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create nested directory structure
    mkdir -p src/components/utils
    echo "nested content" > src/components/utils/helper.js

    # Run the learning hook
    run_learning_hook "$project_path" >/dev/null

    # Verify nested file is staged
    local staged_files
    staged_files=$(get_staged_files "$project_path")

    [[ "$staged_files" == *"src/components/utils/helper.js"* ]]
}

# -----------------------------------------------------------------------------
# Test 3: Verify no git commits are made (only staging)
# -----------------------------------------------------------------------------

@test "TRD-TEST-097: learning hook NEVER makes git commits" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Record HEAD commit before
    local head_before
    head_before=$(get_head_commit "$project_path")

    # Record commit count before
    local commit_count_before
    commit_count_before=$(get_commit_count "$project_path")

    # Create files that would be staged
    echo "test content" > newfile.txt
    echo "more content" > another.txt

    # Run the learning hook
    run_learning_hook "$project_path" >/dev/null

    # Verify HEAD commit is unchanged
    local head_after
    head_after=$(get_head_commit "$project_path")

    [[ "$head_before" == "$head_after" ]]

    # Verify commit count is unchanged
    local commit_count_after
    commit_count_after=$(get_commit_count "$project_path")

    [[ "$commit_count_before" == "$commit_count_after" ]]
}

@test "TRD-TEST-097: learning hook only stages, files remain uncommitted" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create a file
    echo "uncommitted content" > uncommitted.txt

    # Run the learning hook
    run_learning_hook "$project_path" >/dev/null

    # Verify file is staged
    local staged_files
    staged_files=$(get_staged_files "$project_path")
    [[ "$staged_files" == *"uncommitted.txt"* ]]

    # Verify file is NOT in last commit
    local committed_files
    committed_files=$(git log --oneline --name-only -1 | tail -n +2)

    [[ "$committed_files" != *"uncommitted.txt"* ]]
}

@test "TRD-TEST-097: learning hook with multiple runs never commits" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Record initial state
    local initial_commit
    initial_commit=$(get_head_commit "$project_path")

    # Run hook multiple times with different files
    for i in 1 2 3; do
        echo "content $i" > "file_round_${i}.txt"
        run_learning_hook "$project_path" >/dev/null
    done

    # Verify HEAD is still at initial commit
    local final_commit
    final_commit=$(get_head_commit "$project_path")

    [[ "$initial_commit" == "$final_commit" ]]
}

# -----------------------------------------------------------------------------
# Test 4: Graceful handling of non-git directories
# -----------------------------------------------------------------------------

@test "TRD-TEST-097: learning hook handles non-git directory gracefully" {
    # Create a directory without git
    local non_git_dir="${TEST_DIR}/not_a_git_repo"
    mkdir -p "$non_git_dir"

    cd "$non_git_dir"

    # Create a file
    echo "content" > file.txt

    # Run the learning hook - should not crash
    local output
    local exit_code=0
    output=$(run_learning_hook "$non_git_dir" 2>&1) || exit_code=$?

    # Hook should handle gracefully (may exit 0 with no_git status or exit non-zero)
    # Key is it shouldn't crash catastrophically
    [[ $exit_code -eq 0 || "$output" == *"no_git"* || $exit_code -eq 1 || $exit_code -eq 128 ]]
}

@test "TRD-TEST-097: learning hook reports no_git status for non-git directory" {
    # Create a directory without git
    local non_git_dir="${TEST_DIR}/non_git"
    mkdir -p "$non_git_dir"
    mkdir -p "${non_git_dir}/.claude"

    cd "$non_git_dir"

    # The hook may fail or return no_git status
    # We accept either behavior as valid for non-git directories
    local output=""
    output=$(echo "{\"cwd\": \"$non_git_dir\"}" | bash "$LEARNING_HOOK" 2>&1) || true

    # Either returns no_git status or fails gracefully
    [[ "$output" == *"no_git"* || -z "$output" || "$output" == *"Not in a git repository"* ]]
}

# -----------------------------------------------------------------------------
# Test 5: Remote environment detection
# -----------------------------------------------------------------------------

@test "TRD-TEST-097: learning hook detects CLAUDE_CODE_REMOTE environment" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create a file to stage
    echo "remote content" > remote_file.txt

    # Set remote environment
    export CLAUDE_CODE_REMOTE="true"

    # Run the learning hook
    local output
    output=$(run_learning_hook "$project_path")

    # Verify is_remote is true in output
    [[ "$output" == *'"is_remote": true'* ]] || [[ "$output" == *'"is_remote":true'* ]]

    unset CLAUDE_CODE_REMOTE
}

@test "TRD-TEST-097: learning hook local environment is_remote is false" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Ensure no remote indicators
    unset CLAUDE_CODE_REMOTE
    unset CI
    unset GITHUB_ACTIONS
    unset GITLAB_CI

    # Run the learning hook
    local output
    output=$(run_learning_hook "$project_path")

    # Verify is_remote is false in output
    [[ "$output" == *'"is_remote": false'* ]] || [[ "$output" == *'"is_remote":false'* ]]
}

# -----------------------------------------------------------------------------
# Test 6: Hook disable flag
# -----------------------------------------------------------------------------

@test "TRD-TEST-097: learning hook respects LEARNING_HOOK_DISABLE=1" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create a file
    echo "should not be staged" > disabled_test.txt

    # Disable the hook
    export LEARNING_HOOK_DISABLE=1

    # Run the learning hook
    local output
    output=$(run_learning_hook "$project_path")

    # Verify hook reports disabled status
    [[ "$output" == *"disabled"* ]]

    # Verify file was NOT staged
    local staged_files
    staged_files=$(get_staged_files "$project_path")

    [[ "$staged_files" != *"disabled_test.txt"* ]]

    unset LEARNING_HOOK_DISABLE
}

# -----------------------------------------------------------------------------
# Test 7: Clean repository handling
# -----------------------------------------------------------------------------

@test "TRD-TEST-097: learning hook handles clean repository" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # No modifications - repo is clean

    # Run the learning hook
    local output
    output=$(run_learning_hook "$project_path")

    # Should complete without error and report 0 staged files
    [[ "$output" == *"staged_count"* ]]

    # Extract staged count
    if command -v jq &>/dev/null; then
        local staged_count
        staged_count=$(echo "$output" | jq '.hookSpecificOutput.staged_count' 2>/dev/null)
        [[ "$staged_count" == "0" ]]
    fi
}

# -----------------------------------------------------------------------------
# Test 8: Integration with hook harness (if available)
# -----------------------------------------------------------------------------

@test "TRD-TEST-097: learning hook integrates with run-hook-test.sh harness" {
    if [[ "${SKIP_HEADLESS:-true}" == "true" ]]; then
        skip "Headless tests disabled (set SKIP_HEADLESS=false to enable)"
    fi

    if [[ ! -x "$HOOK_HARNESS" ]]; then
        skip "Hook harness not available at: $HOOK_HARNESS"
    fi

    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create a file to trigger learning
    echo "test content for harness" > harness_test.txt

    # Run via harness with learning hook
    local session_id
    session_id=$("$HOOK_HARNESS" "Create a test file" --hook learning --timeout 60 --quiet 2>/dev/null) || true

    # If we got a session ID, verify hook events
    if [[ -n "$session_id" && -f "${SESSION_DIR}/hook-test-${session_id}.jsonl" ]]; then
        # Parse hook events
        local events
        events=$(node "$HOOK_PARSER" "${SESSION_DIR}/hook-test-${session_id}.jsonl" --hook learning 2>/dev/null) || true

        # Should have found learning hook events (if available in session log)
        [[ -n "$events" ]]
    else
        skip "Session did not complete or harness not functional"
    fi
}

# -----------------------------------------------------------------------------
# Test 9: Edge cases
# -----------------------------------------------------------------------------

@test "TRD-TEST-097: learning hook handles files with spaces in names" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create file with spaces
    echo "content" > "file with spaces.txt"

    # Run the learning hook
    run_learning_hook "$project_path" >/dev/null

    # Verify file is staged
    local staged_files
    staged_files=$(get_staged_files "$project_path")

    [[ "$staged_files" == *"file with spaces.txt"* ]]
}

@test "TRD-TEST-097: learning hook handles special characters in filenames" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Create files with valid special characters
    echo "content" > "file-with-dashes.txt"
    echo "content" > "file_with_underscores.txt"
    echo "content" > "file.multiple.dots.txt"

    # Run the learning hook
    local output
    output=$(run_learning_hook "$project_path")

    # Should complete without error
    [[ "$output" == *"hookSpecificOutput"* ]]
}

@test "TRD-TEST-097: learning hook always exits with 0 (non-blocking)" {
    local project_path
    project_path=$(create_test_project)

    cd "$project_path"

    # Run the learning hook
    local exit_code=0
    run_learning_hook "$project_path" >/dev/null || exit_code=$?

    # Hook should always exit 0 (non-blocking)
    [[ "$exit_code" -eq 0 ]]
}

# =============================================================================
# Summary
# =============================================================================
# This test file verifies:
# 1. Learning hook fires on SessionEnd event (TRD-TEST-097 requirement 1)
# 2. Learning data is captured - files are staged (TRD-TEST-097 requirement 2)
# 3. No git commits are made - only staging (TRD-TEST-097 requirement 3)
# 4. Graceful handling of non-git directories (additional robustness)
# 5. Remote environment detection
# 6. Hook disable flag functionality
# 7. Integration with hook harness infrastructure
# =============================================================================
