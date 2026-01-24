#!/bin/bash
# =============================================================================
# prepare-variants.test.sh - Tests for prepare-variants.sh
# =============================================================================
# Purpose: BATS-style test suite for prepare-variants.sh
# Run with: bats prepare-variants.test.sh
# =============================================================================

# BATS setup
setup() {
    SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
    SCRIPT_UNDER_TEST="$SCRIPT_DIR/prepare-variants.sh"

    # Create temp directories for testing
    TEST_TEMP_DIR="$(mktemp -d)"
    TEST_FIXTURE_DIR="$TEST_TEMP_DIR/fixture"
    TEST_OUTPUT_DIR="$TEST_TEMP_DIR/output"

    # Create a basic test fixture
    mkdir -p "$TEST_FIXTURE_DIR"
    echo "# Test Project" > "$TEST_FIXTURE_DIR/PROJECT.md"
}

# BATS teardown
teardown() {
    # Clean up test directories
    if [[ -d "$TEST_TEMP_DIR" ]]; then
        rm -rf "$TEST_TEMP_DIR"
    fi
}

# Helper: create fixture with .claude directory
create_fixture_with_claude() {
    mkdir -p "$TEST_FIXTURE_DIR/.claude/agents"
    mkdir -p "$TEST_FIXTURE_DIR/.claude/commands"
    mkdir -p "$TEST_FIXTURE_DIR/.claude/skills"
    mkdir -p "$TEST_FIXTURE_DIR/.claude/hooks"
    echo "# Agent 1" > "$TEST_FIXTURE_DIR/.claude/agents/agent1.md"
    echo "# Agent 2" > "$TEST_FIXTURE_DIR/.claude/agents/agent2.md"
    echo "# Command 1" > "$TEST_FIXTURE_DIR/.claude/commands/cmd1.md"
    echo "# Skill 1" > "$TEST_FIXTURE_DIR/.claude/skills/skill1.md"
    echo "// Hook 1" > "$TEST_FIXTURE_DIR/.claude/hooks/hook1.js"
}

# =============================================================================
# Basic Functionality Tests
# =============================================================================

@test "prepare-variants.sh exists and is executable" {
    [[ -x "$SCRIPT_UNDER_TEST" ]]
}

@test "prepare-variants.sh --help shows usage" {
    run "$SCRIPT_UNDER_TEST" --help
    [[ "$status" -eq 0 ]]
    [[ "${lines[0]}" =~ "Usage:" ]]
}

@test "prepare-variants.sh requires fixture-source argument" {
    run "$SCRIPT_UNDER_TEST"
    [[ "$status" -ne 0 ]]
    [[ "$output" =~ "Fixture source is required" ]]
}

@test "prepare-variants.sh requires output-dir argument" {
    run "$SCRIPT_UNDER_TEST" "$TEST_FIXTURE_DIR"
    [[ "$status" -ne 0 ]]
    [[ "$output" =~ "Output directory is required" ]]
}

@test "prepare-variants.sh fails on non-existent fixture" {
    run "$SCRIPT_UNDER_TEST" "/nonexistent/path" "$TEST_OUTPUT_DIR"
    [[ "$status" -ne 0 ]]
    [[ "$output" =~ "Fixture source directory not found" ]]
}

# =============================================================================
# Dry Run Tests
# =============================================================================

@test "prepare-variants.sh --dry-run shows planned operations" {
    run "$SCRIPT_UNDER_TEST" --dry-run "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "DRY RUN MODE" ]]
    [[ "$output" =~ "Would create:" ]]
    [[ "$output" =~ "baseline" ]]
    [[ "$output" =~ "full" ]]
    [[ "$output" =~ "without-skills" ]]
    [[ "$output" =~ "without-agents" ]]
    [[ "$output" =~ "without-commands" ]]
    [[ "$output" =~ "without-hooks" ]]
}

@test "prepare-variants.sh --dry-run does not create directories" {
    run "$SCRIPT_UNDER_TEST" --dry-run "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ ! -d "$TEST_OUTPUT_DIR/variants" ]]
}

# =============================================================================
# Variant Creation Tests (with --skip-init)
# =============================================================================

@test "prepare-variants.sh --skip-init creates baseline variant" {
    run "$SCRIPT_UNDER_TEST" --skip-init "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]
    [[ -d "$TEST_OUTPUT_DIR/variants/baseline/fixture" ]]
    [[ -f "$TEST_OUTPUT_DIR/variants/baseline/fixture/PROJECT.md" ]]
    [[ ! -d "$TEST_OUTPUT_DIR/variants/baseline/fixture/.claude" ]]
}

@test "prepare-variants.sh --skip-init creates full variant" {
    run "$SCRIPT_UNDER_TEST" --skip-init "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]
    [[ -d "$TEST_OUTPUT_DIR/variants/full/fixture" ]]
    [[ -f "$TEST_OUTPUT_DIR/variants/full/fixture/PROJECT.md" ]]
}

@test "prepare-variants.sh --skip-init creates component-removed variants" {
    create_fixture_with_claude
    run "$SCRIPT_UNDER_TEST" --skip-init "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]

    # Check without-skills variant
    [[ -d "$TEST_OUTPUT_DIR/variants/without-skills/fixture/.claude" ]]
    [[ ! -d "$TEST_OUTPUT_DIR/variants/without-skills/fixture/.claude/skills" ]]
    [[ -d "$TEST_OUTPUT_DIR/variants/without-skills/fixture/.claude/agents" ]]

    # Check without-agents variant
    [[ -d "$TEST_OUTPUT_DIR/variants/without-agents/fixture/.claude" ]]
    [[ ! -d "$TEST_OUTPUT_DIR/variants/without-agents/fixture/.claude/agents" ]]
    [[ -d "$TEST_OUTPUT_DIR/variants/without-agents/fixture/.claude/skills" ]]

    # Check without-commands variant
    [[ -d "$TEST_OUTPUT_DIR/variants/without-commands/fixture/.claude" ]]
    [[ ! -d "$TEST_OUTPUT_DIR/variants/without-commands/fixture/.claude/commands" ]]

    # Check without-hooks variant
    [[ -d "$TEST_OUTPUT_DIR/variants/without-hooks/fixture/.claude" ]]
    [[ ! -d "$TEST_OUTPUT_DIR/variants/without-hooks/fixture/.claude/hooks" ]]
}

# =============================================================================
# Option Tests
# =============================================================================

@test "prepare-variants.sh --fixture-name sets custom name" {
    run "$SCRIPT_UNDER_TEST" --skip-init --fixture-name "my-custom-name" "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]
    [[ -d "$TEST_OUTPUT_DIR/variants/baseline/my-custom-name" ]]
    [[ -d "$TEST_OUTPUT_DIR/variants/full/my-custom-name" ]]
}

@test "prepare-variants.sh fails on existing variants without --force" {
    # Create variants first
    run "$SCRIPT_UNDER_TEST" --skip-init "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]

    # Try to create again without --force
    run "$SCRIPT_UNDER_TEST" --skip-init "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -ne 0 ]]
    [[ "$output" =~ "Variants already exist" ]]
}

@test "prepare-variants.sh --force overwrites existing variants" {
    # Create variants first
    run "$SCRIPT_UNDER_TEST" --skip-init "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]

    # Try again with --force
    run "$SCRIPT_UNDER_TEST" --skip-init --force "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]
}

# =============================================================================
# Security Tests
# =============================================================================

@test "prepare-variants.sh rejects invalid fixture names" {
    run "$SCRIPT_UNDER_TEST" --skip-init --fixture-name "../escape" "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -ne 0 ]]
    [[ "$output" =~ "Invalid fixture name" ]]
}

@test "prepare-variants.sh rejects path traversal in fixture name" {
    run "$SCRIPT_UNDER_TEST" --skip-init --fixture-name "foo/bar" "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -ne 0 ]]
    [[ "$output" =~ "Invalid fixture name" ]]
}

# =============================================================================
# Validation Tests
# =============================================================================

@test "prepare-variants.sh outputs validation summary" {
    create_fixture_with_claude
    run "$SCRIPT_UNDER_TEST" --skip-init "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "Validating variants" ]]
    [[ "$output" =~ "baseline:" ]]
    [[ "$output" =~ "full:" ]]
    [[ "$output" =~ "PASS" ]]
}

@test "prepare-variants.sh shows component counts in summary" {
    create_fixture_with_claude
    run "$SCRIPT_UNDER_TEST" --skip-init "$TEST_FIXTURE_DIR" "$TEST_OUTPUT_DIR"
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "agents: 2" ]]
    [[ "$output" =~ "commands: 1" ]]
    [[ "$output" =~ "skills: 1" ]]
    [[ "$output" =~ "hooks: 1" ]]
}
