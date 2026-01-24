#!/usr/bin/env bats
#
# validate-init.test.sh - BATS tests for validate-init.sh
#
# Tests validation logic for Ensemble vNext project initialization.
# Covers positive tests (valid structure) and negative tests (missing components).
#
# TRD Reference: TRD-TEST-017, TRD-TEST-018, TRD-TEST-019
#
# Usage:
#   bats validate-init.test.sh
#

# Setup: Create a fresh temp directory for each test
setup() {
    # Create temporary directory for test isolation
    TEST_DIR="$(mktemp -d)"
    export TEST_DIR

    # Path to the script under test
    SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    VALIDATE_SCRIPT="$SCRIPT_DIR/validate-init.sh"
    SCAFFOLD_SCRIPT="$SCRIPT_DIR/scaffold-project.sh"

    # Verify scripts exist
    if [[ ! -f "$VALIDATE_SCRIPT" ]]; then
        skip "validate-init.sh not found at $VALIDATE_SCRIPT"
    fi
}

# Teardown: Clean up temp directory after each test
teardown() {
    if [[ -d "$TEST_DIR" ]]; then
        rm -rf "$TEST_DIR"
    fi
}

# Helper: Create minimal valid project structure
create_valid_structure() {
    local dir="$1"

    # Create .claude directories
    mkdir -p "$dir/.claude/agents"
    mkdir -p "$dir/.claude/rules"
    mkdir -p "$dir/.claude/skills"
    mkdir -p "$dir/.claude/commands"
    mkdir -p "$dir/.claude/hooks"

    # Create docs directories
    mkdir -p "$dir/docs/PRD"
    mkdir -p "$dir/docs/TRD"

    # Create .trd-state directory
    mkdir -p "$dir/.trd-state"

    # Create required agent files (12 total)
    local agents=(
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
    for agent in "${agents[@]}"; do
        echo "# Agent: ${agent%.md}" > "$dir/.claude/agents/$agent"
    done

    # Create governance files
    echo "# Constitution" > "$dir/.claude/rules/constitution.md"
    echo "# Stack" > "$dir/.claude/rules/stack.md"
    echo "# Process" > "$dir/.claude/rules/process.md"

    # Create required hook files
    echo "// Permitter hook" > "$dir/.claude/hooks/permitter.js"
    echo "# Router hook" > "$dir/.claude/hooks/router.py"
    echo "// Status hook" > "$dir/.claude/hooks/status.js"

    # Create optional hook files
    echo "#!/bin/bash" > "$dir/.claude/hooks/formatter.sh"
    chmod +x "$dir/.claude/hooks/formatter.sh"
    echo "// Learning hook" > "$dir/.claude/hooks/learning.js"

    # Create JSON config files (valid JSON)
    echo '{"version": "1.0.0"}' > "$dir/.claude/settings.json"
    echo '{"rules": []}' > "$dir/.claude/router-rules.json"
    echo '{"branch": null, "prd": null, "trd": null}' > "$dir/.trd-state/current.json"

    # Create .gitignore
    cat > "$dir/.gitignore" << 'EOF'
settings.local.json
.env
.env.local
EOF

    # Create CLAUDE.md
    echo "# CLAUDE.md" > "$dir/CLAUDE.md"
}

# ============================================
# TRD-TEST-018: Positive Tests
# ============================================

@test "TRD-TEST-018: Valid structure passes validation" {
    create_valid_structure "$TEST_DIR"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    # Should exit with 0 (success)
    [ "$status" -eq 0 ]

    # Output should contain "Validation PASSED"
    [[ "$output" == *"Validation PASSED"* ]]
}

@test "TRD-TEST-018: Complete project structure is recognized" {
    create_valid_structure "$TEST_DIR"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    # Should report all 12 agents present
    [[ "$output" == *"All 12 subagents present"* ]]

    # Should report governance files exist
    [[ "$output" == *"constitution.md exists"* ]]
    [[ "$output" == *"stack.md exists"* ]]
    [[ "$output" == *"process.md exists"* ]]
}

@test "TRD-TEST-018: Valid JSON files pass validation" {
    create_valid_structure "$TEST_DIR"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    # Should report valid JSON for config files
    [[ "$output" == *"settings.json is valid JSON"* ]]
    [[ "$output" == *"router-rules.json is valid JSON"* ]]
    [[ "$output" == *"current.json is valid JSON"* ]]
}

@test "TRD-TEST-018: Required hooks are validated" {
    create_valid_structure "$TEST_DIR"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    # Should report required hooks exist
    [[ "$output" == *"permitter.js exists"* ]]
    [[ "$output" == *"router.py exists"* ]]
    [[ "$output" == *"status.js exists"* ]]
}

# ============================================
# TRD-TEST-019: Negative Tests - Missing Directories
# ============================================

@test "TRD-TEST-019: Missing .claude/agents/ gives specific error" {
    create_valid_structure "$TEST_DIR"
    rm -rf "$TEST_DIR/.claude/agents"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    # Should exit with non-zero (failure)
    [ "$status" -ne 0 ]

    # Should report specific error
    [[ "$output" == *".claude/agents/"*"missing"* ]]
    [[ "$output" == *"Validation FAILED"* ]]
}

@test "TRD-TEST-019: Missing .claude/rules/ gives specific error" {
    create_valid_structure "$TEST_DIR"
    rm -rf "$TEST_DIR/.claude/rules"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *".claude/rules/"*"missing"* ]]
    [[ "$output" == *"Validation FAILED"* ]]
}

@test "TRD-TEST-019: Missing .claude/hooks/ gives specific error" {
    create_valid_structure "$TEST_DIR"
    rm -rf "$TEST_DIR/.claude/hooks"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *".claude/hooks/"*"missing"* ]]
    [[ "$output" == *"Validation FAILED"* ]]
}

@test "TRD-TEST-019: Missing .claude/skills/ gives specific error" {
    create_valid_structure "$TEST_DIR"
    rm -rf "$TEST_DIR/.claude/skills"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *".claude/skills/"*"missing"* ]]
    [[ "$output" == *"Validation FAILED"* ]]
}

@test "TRD-TEST-019: Missing CLAUDE.md gives warning (optional)" {
    create_valid_structure "$TEST_DIR"
    rm -f "$TEST_DIR/CLAUDE.md"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    # Should pass (CLAUDE.md is optional)
    [ "$status" -eq 0 ]

    # Should report warning for missing CLAUDE.md
    [[ "$output" == *"CLAUDE.md"*"not found"* ]] || [[ "$output" == *"CLAUDE.md"*"optional"* ]]
}

@test "TRD-TEST-019: Invalid JSON in settings.json gives error" {
    create_valid_structure "$TEST_DIR"

    # Write invalid JSON
    echo '{invalid json' > "$TEST_DIR/.claude/settings.json"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"settings.json"*"invalid JSON"* ]]
    [[ "$output" == *"Validation FAILED"* ]]
}

@test "TRD-TEST-019: Missing required agent files fails validation" {
    create_valid_structure "$TEST_DIR"

    # Remove some agent files
    rm -f "$TEST_DIR/.claude/agents/product-manager.md"
    rm -f "$TEST_DIR/.claude/agents/technical-architect.md"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"Missing agent: product-manager.md"* ]]
    [[ "$output" == *"Missing agent: technical-architect.md"* ]]
}

@test "TRD-TEST-019: Missing governance files (constitution) fails validation" {
    create_valid_structure "$TEST_DIR"
    rm -f "$TEST_DIR/.claude/rules/constitution.md"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"constitution.md"*"missing"* ]]
}

@test "TRD-TEST-019: Missing governance files (stack) fails validation" {
    create_valid_structure "$TEST_DIR"
    rm -f "$TEST_DIR/.claude/rules/stack.md"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"stack.md"*"missing"* ]]
}

@test "TRD-TEST-019: Missing governance files (process) fails validation" {
    create_valid_structure "$TEST_DIR"
    rm -f "$TEST_DIR/.claude/rules/process.md"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"process.md"*"missing"* ]]
}

@test "TRD-TEST-019: Missing required hook (permitter.js) fails validation" {
    create_valid_structure "$TEST_DIR"
    rm -f "$TEST_DIR/.claude/hooks/permitter.js"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"permitter.js"* ]]
}

@test "TRD-TEST-019: Missing required hook (router.py) fails validation" {
    create_valid_structure "$TEST_DIR"
    rm -f "$TEST_DIR/.claude/hooks/router.py"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"router.py"* ]]
}

@test "TRD-TEST-019: Missing .trd-state/current.json fails validation" {
    create_valid_structure "$TEST_DIR"
    rm -f "$TEST_DIR/.trd-state/current.json"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"current.json"*"missing"* ]]
}

@test "TRD-TEST-019: Invalid JSON in router-rules.json gives error" {
    create_valid_structure "$TEST_DIR"
    echo 'not valid json at all' > "$TEST_DIR/.claude/router-rules.json"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"router-rules.json"*"invalid JSON"* ]]
}

@test "TRD-TEST-019: Invalid JSON in current.json gives error" {
    create_valid_structure "$TEST_DIR"
    echo '{"broken": }' > "$TEST_DIR/.trd-state/current.json"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *"current.json"*"invalid JSON"* ]]
}

# ============================================
# Edge Cases
# ============================================

@test "Edge case: Non-existent project directory fails gracefully" {
    run "$VALIDATE_SCRIPT" "/nonexistent/path/to/project"

    [ "$status" -ne 0 ]
}

@test "Edge case: Empty directory fails validation" {
    # TEST_DIR is empty by default after setup

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    [ "$status" -ne 0 ]
    [[ "$output" == *".claude/"*"missing"* ]]
}

@test "Edge case: .gitignore missing local settings pattern warns" {
    create_valid_structure "$TEST_DIR"

    # Create .gitignore without required patterns
    echo "node_modules/" > "$TEST_DIR/.gitignore"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    # Should still pass but with warnings
    # (gitignore patterns are warnings, not failures)
    [[ "$output" == *"Warnings:"* ]]
}

@test "Edge case: Empty governance files warns" {
    create_valid_structure "$TEST_DIR"

    # Make constitution.md empty
    > "$TEST_DIR/.claude/rules/constitution.md"

    run "$VALIDATE_SCRIPT" "$TEST_DIR"

    # Should warn about empty files
    [[ "$output" == *"empty"* ]] || [[ "$output" == *"WARN"* ]]
}
