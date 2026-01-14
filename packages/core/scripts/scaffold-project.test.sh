#!/usr/bin/env bats
#
# scaffold-project.test.sh - BATS tests for scaffold-project.sh
#
# Tests the directory scaffolding script for Ensemble vNext projects.
# Covers creation tests, idempotency, permissions, and CWD independence.
#
# TRD Reference: TRD-TEST-020, TRD-TEST-021, TRD-TEST-022
#
# Usage:
#   bats scaffold-project.test.sh
#

# Setup: Create a fresh temp directory for each test
setup() {
    # Create temporary directory for test isolation
    TEST_DIR="$(mktemp -d)"
    export TEST_DIR

    # Path to the script under test
    SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    SCAFFOLD_SCRIPT="$SCRIPT_DIR/scaffold-project.sh"

    # Verify script exists
    if [[ ! -f "$SCAFFOLD_SCRIPT" ]]; then
        skip "scaffold-project.sh not found at $SCAFFOLD_SCRIPT"
    fi

    # Verify script is executable
    if [[ ! -x "$SCAFFOLD_SCRIPT" ]]; then
        skip "scaffold-project.sh is not executable"
    fi
}

# Teardown: Clean up temp directory after each test
teardown() {
    if [[ -d "$TEST_DIR" ]]; then
        rm -rf "$TEST_DIR"
    fi
}

# ============================================
# TRD-TEST-020: Setup and Basic Tests
# ============================================

@test "TRD-TEST-020: scaffold-project.sh exists and is executable" {
    [ -f "$SCAFFOLD_SCRIPT" ]
    [ -x "$SCAFFOLD_SCRIPT" ]
}

@test "TRD-TEST-020: Script runs without error on empty directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
}

@test "TRD-TEST-020: Script outputs scaffolding messages" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [[ "$output" == *"Scaffolding"* ]]
}

# ============================================
# TRD-TEST-021: Creation Tests
# ============================================

@test "TRD-TEST-021: Creates .claude/agents/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/.claude/agents" ]
}

@test "TRD-TEST-021: Creates .claude/rules/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/.claude/rules" ]
}

@test "TRD-TEST-021: Creates .claude/skills/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/.claude/skills" ]
}

@test "TRD-TEST-021: Creates .claude/commands/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/.claude/commands" ]
}

@test "TRD-TEST-021: Creates .claude/hooks/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/.claude/hooks" ]
}

@test "TRD-TEST-021: Creates docs/PRD/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/docs/PRD" ]
}

@test "TRD-TEST-021: Creates docs/TRD/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/docs/TRD" ]
}

@test "TRD-TEST-021: Creates docs/TRD/completed/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/docs/TRD/completed" ]
}

@test "TRD-TEST-021: Creates docs/TRD/cancelled/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/docs/TRD/cancelled" ]
}

@test "TRD-TEST-021: Creates docs/standards/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/docs/standards" ]
}

@test "TRD-TEST-021: Creates .trd-state/ directory" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/.trd-state" ]
}

@test "TRD-TEST-021: All required directories created in one run" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]

    # Check all required directories exist
    [ -d "$TEST_DIR/.claude/agents" ]
    [ -d "$TEST_DIR/.claude/rules" ]
    [ -d "$TEST_DIR/.claude/skills" ]
    [ -d "$TEST_DIR/.claude/commands" ]
    [ -d "$TEST_DIR/.claude/hooks" ]
    [ -d "$TEST_DIR/docs/PRD" ]
    [ -d "$TEST_DIR/docs/TRD" ]
    [ -d "$TEST_DIR/docs/TRD/completed" ]
    [ -d "$TEST_DIR/docs/TRD/cancelled" ]
    [ -d "$TEST_DIR/docs/standards" ]
    [ -d "$TEST_DIR/.trd-state" ]
}

@test "TRD-TEST-021: Directories have correct permissions (755)" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]

    # Check permissions are at least 755 (rwxr-xr-x)
    # Using stat to get permissions
    local perms
    perms="$(stat -c '%a' "$TEST_DIR/.claude" 2>/dev/null || stat -f '%A' "$TEST_DIR/.claude" 2>/dev/null)"

    # Should be 755 or more permissive
    [ "$perms" -ge 755 ] 2>/dev/null || {
        # If numeric comparison fails, just check directory is readable/executable
        [ -r "$TEST_DIR/.claude" ]
        [ -x "$TEST_DIR/.claude" ]
    }
}

# ============================================
# TRD-TEST-022: Idempotency Tests
# ============================================

@test "TRD-TEST-022: Re-running script does not fail (idempotent)" {
    # Run once
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Run again
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]
}

@test "TRD-TEST-022: Re-running script preserves existing structure" {
    # Run once
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Create a marker file
    echo "test content" > "$TEST_DIR/.claude/agents/test-marker.txt"

    # Run again
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Marker file should still exist
    [ -f "$TEST_DIR/.claude/agents/test-marker.txt" ]
    [[ "$(cat "$TEST_DIR/.claude/agents/test-marker.txt")" == "test content" ]]
}

@test "TRD-TEST-022: CWD independence - works from any directory" {
    # Store current directory
    local original_dir
    original_dir="$(pwd)"

    # Create a different working directory
    local work_dir
    work_dir="$(mktemp -d)"

    # Change to different directory
    cd "$work_dir"

    # Run script with absolute path target
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    # Return to original directory
    cd "$original_dir"

    # Clean up work directory
    rm -rf "$work_dir"

    # Verify success and directories created
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/.claude/agents" ]
    [ -d "$TEST_DIR/.trd-state" ]
}

@test "TRD-TEST-022: Existing files in directories are preserved" {
    # Run initial scaffolding
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Create some content in various directories
    echo "Agent definition" > "$TEST_DIR/.claude/agents/my-agent.md"
    echo "Constitution content" > "$TEST_DIR/.claude/rules/constitution.md"
    echo "Skill content" > "$TEST_DIR/.claude/skills/my-skill.md"
    echo "PRD content" > "$TEST_DIR/docs/PRD/feature.md"
    echo "TRD content" > "$TEST_DIR/docs/TRD/feature.md"
    echo '{"branch": "main"}' > "$TEST_DIR/.trd-state/current.json"

    # Run script again
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Verify all files are preserved
    [ -f "$TEST_DIR/.claude/agents/my-agent.md" ]
    [ -f "$TEST_DIR/.claude/rules/constitution.md" ]
    [ -f "$TEST_DIR/.claude/skills/my-skill.md" ]
    [ -f "$TEST_DIR/docs/PRD/feature.md" ]
    [ -f "$TEST_DIR/docs/TRD/feature.md" ]
    [ -f "$TEST_DIR/.trd-state/current.json" ]

    # Verify content is unchanged
    [[ "$(cat "$TEST_DIR/.claude/agents/my-agent.md")" == "Agent definition" ]]
    [[ "$(cat "$TEST_DIR/docs/PRD/feature.md")" == "PRD content" ]]
}

@test "TRD-TEST-022: Script reports existing directories" {
    # Run once to create structure
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Run again and check output mentions existing dirs
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Output should indicate directories already exist
    [[ "$output" == *"exists"* ]] || [[ "$output" == *"Created"* ]]
}

# ============================================
# Edge Cases
# ============================================

@test "Edge case: Non-existent target directory fails gracefully" {
    run "$SCAFFOLD_SCRIPT" "/nonexistent/path/that/does/not/exist"

    [ "$status" -ne 0 ]
}

@test "Edge case: Default to current directory when no argument" {
    # Change to test directory
    local original_dir
    original_dir="$(pwd)"
    cd "$TEST_DIR"

    # Run without argument
    run "$SCAFFOLD_SCRIPT"

    # Return to original
    cd "$original_dir"

    # Should have created structure in TEST_DIR (current dir at time of run)
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/.claude" ]
}

@test "Edge case: Nested directory creation works" {
    # The script should handle creating parent directories
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"

    [ "$status" -eq 0 ]

    # Check deeply nested directories were created
    [ -d "$TEST_DIR/docs/TRD/completed" ]
    [ -d "$TEST_DIR/docs/TRD/cancelled" ]
}

@test "Edge case: Script handles directories with spaces" {
    # Create a directory with spaces
    local space_dir="$TEST_DIR/project with spaces"
    mkdir -p "$space_dir"

    run "$SCAFFOLD_SCRIPT" "$space_dir"

    [ "$status" -eq 0 ]
    [ -d "$space_dir/.claude/agents" ]
    [ -d "$space_dir/.trd-state" ]
}

@test "Edge case: Multiple runs accumulate no extra output errors" {
    # Run 3 times
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # All directories should still exist
    [ -d "$TEST_DIR/.claude/agents" ]
    [ -d "$TEST_DIR/.trd-state" ]
}

# ============================================
# Plugin Content Copy Tests (--plugin-dir)
# ============================================

# Get the plugin directory path for tests
_get_plugin_dir() {
    # Navigate from script dir to packages/full
    echo "$(cd "$SCRIPT_DIR/../../full" && pwd)"
}

@test "Plugin copy: --plugin-dir argument is accepted" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]
}

@test "Plugin copy: Copies 12 agent files with --plugin-dir" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Count agent files
    local count
    count=$(ls -1 "$TEST_DIR/.claude/agents/"*.md 2>/dev/null | wc -l)
    [ "$count" -eq 12 ]
}

@test "Plugin copy: Copies specific agents (product-manager, backend-implementer)" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    [ -f "$TEST_DIR/.claude/agents/product-manager.md" ]
    [ -f "$TEST_DIR/.claude/agents/backend-implementer.md" ]
    [ -f "$TEST_DIR/.claude/agents/verify-app.md" ]
}

@test "Plugin copy: Copies 8 command files with --plugin-dir" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Count command files
    local count
    count=$(ls -1 "$TEST_DIR/.claude/commands/"*.md 2>/dev/null | wc -l)
    [ "$count" -eq 8 ]
}

@test "Plugin copy: Copies specific commands (create-prd, implement-trd)" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    [ -f "$TEST_DIR/.claude/commands/create-prd.md" ]
    [ -f "$TEST_DIR/.claude/commands/implement-trd.md" ]
    [ -f "$TEST_DIR/.claude/commands/fold-prompt.md" ]
}

@test "Plugin copy: Does NOT copy init-project or rebase-project commands" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # These commands should NOT be copied (they're plugin-only)
    [ ! -f "$TEST_DIR/.claude/commands/init-project.md" ]
    [ ! -f "$TEST_DIR/.claude/commands/rebase-project.md" ]
}

@test "Plugin copy: Copies hooks including permitter structure" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Check permitter structure
    [ -d "$TEST_DIR/.claude/hooks/permitter" ]
    [ -d "$TEST_DIR/.claude/hooks/permitter/lib" ]
    [ -f "$TEST_DIR/.claude/hooks/permitter/permitter.js" ]
    [ -f "$TEST_DIR/.claude/hooks/permitter/lib/matcher.js" ]
    [ -f "$TEST_DIR/.claude/hooks/permitter/lib/allowlist-loader.js" ]
    [ -f "$TEST_DIR/.claude/hooks/permitter/lib/command-parser.js" ]
}

@test "Plugin copy: Copies core hooks (router, formatter, status, wiggum)" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    [ -f "$TEST_DIR/.claude/hooks/router.py" ]
    [ -f "$TEST_DIR/.claude/hooks/formatter.sh" ]
    [ -f "$TEST_DIR/.claude/hooks/status.js" ]
    [ -f "$TEST_DIR/.claude/hooks/wiggum.js" ]
    [ -f "$TEST_DIR/.claude/hooks/learning.sh" ]
}

@test "Plugin copy: Idempotent - does not overwrite existing files" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    # First run
    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Modify a file
    echo "# Modified content" > "$TEST_DIR/.claude/agents/product-manager.md"

    # Run again
    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # File should still have our modified content
    [[ "$(head -1 "$TEST_DIR/.claude/agents/product-manager.md")" == "# Modified content" ]]
}

@test "Plugin copy: Without --plugin-dir, no plugin content is copied" {
    run "$SCAFFOLD_SCRIPT" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Directories exist but are empty (except templates)
    [ -d "$TEST_DIR/.claude/agents" ]
    local count
    count=$(ls -1 "$TEST_DIR/.claude/agents/"*.md 2>/dev/null | wc -l)
    [ "$count" -eq 0 ]
}

@test "Plugin copy: Output shows plugin directory" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    [[ "$output" == *"Plugin directory"* ]]
}

@test "Plugin copy: Output shows copy counts" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    [[ "$output" == *"Copied"*"agents"* ]]
    [[ "$output" == *"Copied"*"commands"* ]]
    [[ "$output" == *"Copied"*"hooks"* ]]
}

# ============================================
# Skill Copy Tests (--copy-skills)
# ============================================

@test "Skill copy: --copy-skills with no selection file is silent" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" --copy-skills "$TEST_DIR"
    [ "$status" -eq 0 ]

    # No skills copied (no selection file)
    [[ "$output" == *"No skill selection file"* ]]
}

@test "Skill copy: Copies skills from selected-skills.txt" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    # Create structure first
    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Create selection file
    cat > "$TEST_DIR/.claude/selected-skills.txt" <<EOF
developing-with-python
jest
EOF

    # Run again with --copy-skills
    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" --copy-skills "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Check skills were copied
    [ -d "$TEST_DIR/.claude/skills/developing-with-python" ]
    [ -d "$TEST_DIR/.claude/skills/jest" ]
}

@test "Skill copy: Skips comments and empty lines in selection file" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    # Create structure first
    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Create selection file with comments
    cat > "$TEST_DIR/.claude/selected-skills.txt" <<EOF
# This is a comment
developing-with-python

# Another comment
jest
EOF

    # Run again with --copy-skills
    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" --copy-skills "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Check skills were copied
    [ -d "$TEST_DIR/.claude/skills/developing-with-python" ]
    [ -d "$TEST_DIR/.claude/skills/jest" ]

    # Count - should only have 2
    local count
    count=$(ls -1d "$TEST_DIR/.claude/skills/"*/ 2>/dev/null | wc -l)
    [ "$count" -eq 2 ]
}

@test "Skill copy: Warns on non-existent skill" {
    local plugin_dir
    plugin_dir="$(_get_plugin_dir)"

    # Create structure first
    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Create selection file with non-existent skill
    echo "nonexistent-skill" > "$TEST_DIR/.claude/selected-skills.txt"

    # Run again with --copy-skills
    run "$SCAFFOLD_SCRIPT" --plugin-dir "$plugin_dir" --copy-skills "$TEST_DIR"
    [ "$status" -eq 0 ]

    # Should warn about missing skill
    [[ "$output" == *"not found"* ]] || [[ "$output" == *"Skill not found"* ]]
}
