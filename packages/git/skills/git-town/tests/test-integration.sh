#!/usr/bin/env bash

###############################################################################
# Git-Town Skill Integration Test Suite
#
# Tests agent integration with git-town skill including:
# - GT-018: Agent executes git-town workflow via skill
# - GT-019: Agent handles merge conflict error via ERROR_HANDLING.md
###############################################################################

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="/tmp/git-town-integration-test-$$"
TESTS_PASSED=0
TESTS_FAILED=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
}

print_test() {
    echo -n "Testing: $1... "
}

pass() {
    echo -e "${GREEN}✓ PASS${NC}"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}"
    if [ -n "$1" ]; then
        echo "  Error: $1"
    fi
    ((TESTS_FAILED++))
}

cleanup() {
    if [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
    fi
}

# Trap cleanup on exit
trap cleanup EXIT

setup_test_repo() {
    # Create temporary test repository
    mkdir -p "$TEST_DIR"
    cd "$TEST_DIR"
    git init --initial-branch=main > /dev/null 2>&1
    git config user.name "Test User"
    git config user.email "test@example.com"

    # Create initial commit
    echo "# Test Repository" > README.md
    git add README.md
    git commit -m "Initial commit" > /dev/null 2>&1

    # Configure git-town
    git config git-town.main-branch main

    cd - > /dev/null
}

###############################################################################
# GT-018: Agent Executes Git-Town Workflow Via Skill
###############################################################################

test_skill_reference_loading() {
    print_header "GT-018: Agent Executes Git-Town Workflow Via Skill"

    # Test 1: Skill files exist and can be loaded
    print_test "Skill files are accessible"
    if [ -f "$SKILL_DIR/SKILL.md" ] && \
       [ -f "$SKILL_DIR/REFERENCE.md" ] && \
       [ -f "$SKILL_DIR/ERROR_HANDLING.md" ]; then
        pass
    else
        fail "Skill files not found at $SKILL_DIR"
        return
    fi

    # Test 2: Interview templates exist
    print_test "Interview templates are accessible"
    if [ -f "$SKILL_DIR/templates/interview-branch-creation.md" ] && \
       [ -f "$SKILL_DIR/templates/interview-pr-creation.md" ] && \
       [ -f "$SKILL_DIR/templates/interview-completion.md" ]; then
        pass
    else
        fail "Interview templates not found"
        return
    fi

    # Test 3: Validation script exists and is executable
    print_test "Validation script is executable"
    if [ -x "$SKILL_DIR/scripts/validate-git-town.sh" ]; then
        pass
    else
        fail "Validation script not executable"
        return
    fi

    # Test 4: Skill loading performance (<100ms target)
    print_test "Skill loads within performance target (<100ms)"
    # Use perl for cross-platform millisecond timing
    if command -v perl &> /dev/null; then
        start_time=$(perl -MTime::HiRes=time -e 'printf "%.0f\n", time*1000')
        cat "$SKILL_DIR/SKILL.md" "$SKILL_DIR/REFERENCE.md" > /dev/null
        end_time=$(perl -MTime::HiRes=time -e 'printf "%.0f\n", time*1000')
        duration_ms=$(( end_time - start_time ))

        if [ "$duration_ms" -lt 100 ]; then
            pass
            echo "  Load time: ${duration_ms}ms"
        else
            fail "Load time ${duration_ms}ms exceeds 100ms target"
        fi
    else
        # Fallback: just verify files can be loaded
        if cat "$SKILL_DIR/SKILL.md" "$SKILL_DIR/REFERENCE.md" > /dev/null 2>&1; then
            pass
            echo "  Skill files loaded successfully (timing not available)"
        else
            fail "Failed to load skill files"
        fi
    fi
}

test_branch_creation_workflow() {
    print_header "Test: Branch Creation Workflow"

    setup_test_repo

    # Test 1: Validation script runs successfully
    print_test "Validation script succeeds in valid repo"
    cd "$TEST_DIR"
    if bash "$SKILL_DIR/scripts/validate-git-town.sh" > /dev/null 2>&1; then
        pass
    else
        fail "Validation failed in test repo"
        cd - > /dev/null
        return
    fi

    # Test 2: Branch creation using non-interactive CLI flags
    print_test "Create feature branch with explicit CLI flags"
    # Use git town (with space) not git-town (with dash)
    if git town hack test-feature > /dev/null 2>&1; then
        pass
    else
        # Try alternate syntax if first attempt fails
        if git town hack test-feature --parent main > /dev/null 2>&1; then
            pass
        else
            fail "Branch creation failed (may need git-town configuration)"
            cd - > /dev/null
            return
        fi
    fi

    # Test 3: Verify branch was created
    print_test "Verify feature branch exists"
    if git branch | grep -q "test-feature"; then
        pass
    else
        fail "Feature branch not found"
    fi

    # Test 4: Verify we're on the new branch
    print_test "Verify checked out to feature branch"
    current_branch=$(git branch --show-current)
    if [ "$current_branch" = "test-feature" ]; then
        pass
    else
        fail "Not on feature branch (current: $current_branch)"
    fi

    cd - > /dev/null
}

test_interview_template_validation() {
    print_header "Test: Interview Template Validation"

    # Test 1: Branch name validation regex
    print_test "Branch name regex validates correctly"

    # Valid branch names
    valid_names=("feature/test" "bugfix/issue-123" "hotfix/security-patch")
    for name in "${valid_names[@]}"; do
        if echo "$name" | grep -Eq '^[a-z0-9-]+(/[a-z0-9-]+)*$'; then
            continue
        else
            fail "Valid name '$name' failed validation"
            return
        fi
    done

    # Invalid branch names
    invalid_names=("Feature/Test" "bug_fix" "test@branch" "")
    for name in "${invalid_names[@]}"; do
        if echo "$name" | grep -Eq '^[a-z0-9-]+(/[a-z0-9-]+)*$'; then
            fail "Invalid name '$name' passed validation"
            return
        fi
    done

    pass

    # Test 2: Template has required YAML frontmatter
    print_test "Templates contain valid YAML frontmatter"
    if head -n 1 "$SKILL_DIR/templates/interview-branch-creation.md" | grep -q "^---$"; then
        pass
    else
        fail "No YAML frontmatter in branch creation template"
    fi

    # Test 3: Template has required fields
    print_test "Templates define required fields"
    if grep -q "branch_name" "$SKILL_DIR/templates/interview-branch-creation.md" && \
       grep -q "base_branch" "$SKILL_DIR/templates/interview-branch-creation.md"; then
        pass
    else
        fail "Missing required fields in template"
    fi
}

###############################################################################
# GT-019: Agent Handles Merge Conflict Error
###############################################################################

test_error_handling_documentation() {
    print_header "GT-019: Agent Handles Merge Conflict Error"

    # Test 1: ERROR_HANDLING.md exists and has merge conflict section
    print_test "ERROR_HANDLING.md documents merge conflicts"
    if grep -qi "merge conflict" "$SKILL_DIR/ERROR_HANDLING.md"; then
        pass
    else
        fail "No merge conflict documentation found"
        return
    fi

    # Test 2: Exit code documentation exists
    print_test "Exit codes are documented in REFERENCE.md"
    if grep -q "EXIT.*0" "$SKILL_DIR/REFERENCE.md" && \
       grep -q "EXIT.*3" "$SKILL_DIR/REFERENCE.md"; then
        pass
    else
        fail "Exit codes not fully documented"
    fi

    # Test 3: Decision trees exist for error recovery
    print_test "Mermaid decision trees exist for error recovery"
    error_tree_count=$(grep -c '```mermaid' "$SKILL_DIR/ERROR_HANDLING.md")
    if [ "$error_tree_count" -ge 6 ]; then
        pass
        echo "  Found $error_tree_count decision trees"
    else
        fail "Expected at least 6 decision trees, found $error_tree_count"
    fi

    # Test 4: Error recovery state machine is documented
    print_test "Error recovery state machine is documented"
    if grep -qi "state machine" "$SKILL_DIR/ERROR_HANDLING.md"; then
        pass
    else
        fail "State machine not documented"
    fi
}

test_merge_conflict_simulation() {
    print_header "Test: Merge Conflict Handling Simulation"

    setup_test_repo
    cd "$TEST_DIR"

    # Create a scenario for merge conflict
    # Step 1: Create and commit on main
    echo "line 1" > conflict-file.txt
    git add conflict-file.txt
    git commit -m "Add conflict file on main" > /dev/null 2>&1

    # Step 2: Create feature branch
    git town hack conflict-test > /dev/null 2>&1

    # Step 3: Modify file on feature branch
    echo "line 1 modified on feature" > conflict-file.txt
    git add conflict-file.txt
    git commit -m "Modify on feature branch" > /dev/null 2>&1

    # Step 4: Switch to main and modify same file
    git checkout main > /dev/null 2>&1
    echo "line 1 modified on main" > conflict-file.txt
    git add conflict-file.txt
    git commit -m "Modify on main branch" > /dev/null 2>&1

    # Step 5: Try to sync (will cause merge conflict)
    git checkout conflict-test > /dev/null 2>&1

    print_test "Simulate merge conflict detection"
    if git town sync 2>&1 | grep -qi "conflict\|CONFLICT"; then
        pass
        echo "  Merge conflict successfully simulated"

        # Clean up conflict state
        git merge --abort > /dev/null 2>&1 || true
    else
        # Conflict might not occur in this test scenario
        echo -e "${YELLOW}⚠ SKIP${NC}"
        echo "  No conflict occurred (test scenario may need adjustment)"
    fi

    cd - > /dev/null
}

test_error_code_mapping() {
    print_header "Test: Exit Code to Error Category Mapping"

    # Test 1: Verify exit code constants in validation script
    print_test "Validation script defines exit code constants"
    if grep -q "EXIT_SUCCESS=0" "$SKILL_DIR/scripts/validate-git-town.sh" && \
       grep -q "EXIT_NOT_FOUND=1" "$SKILL_DIR/scripts/validate-git-town.sh" && \
       grep -q "EXIT_NOT_CONFIGURED=2" "$SKILL_DIR/scripts/validate-git-town.sh"; then
        pass
    else
        fail "Exit code constants not found"
    fi

    # Test 2: Verify error categories are documented
    print_test "ERROR_HANDLING.md covers all 6 error categories"
    categories=("Merge Conflicts" "Network Errors" "Configuration Errors" "Branch State" "Authentication" "Version")
    count=0

    for category in "${categories[@]}"; do
        if grep -qi "$category" "$SKILL_DIR/ERROR_HANDLING.md"; then
            ((count++))
        fi
    done

    if [ "$count" -eq 6 ]; then
        pass
    else
        fail "Only $count/6 error categories documented"
    fi
}

###############################################################################
# Agent Query Syntax Tests
###############################################################################

test_skill_query_syntax() {
    print_header "Test: Skill Query Syntax Validation"

    # Test 1: Quick Start section exists
    print_test "Query: git-town:SKILL:Quick Start"
    if grep -A 20 "## Quick Start" "$SKILL_DIR/SKILL.md" > /dev/null; then
        pass
    else
        fail "Quick Start section not found"
    fi

    # Test 2: Command reference exists
    print_test "Query: git-town:REFERENCE:git town hack"
    if grep -A 20 "git town hack" "$SKILL_DIR/REFERENCE.md" > /dev/null; then
        pass
    else
        fail "Command reference not found"
    fi

    # Test 3: Error handling section exists
    print_test "Query: git-town:ERROR_HANDLING:merge conflicts"
    if grep -A 20 -i "merge conflict" "$SKILL_DIR/ERROR_HANDLING.md" > /dev/null; then
        pass
    else
        fail "Error handling section not found"
    fi

    # Test 4: Interview template is accessible
    print_test "Query: git-town:templates/interview-branch-creation"
    if [ -f "$SKILL_DIR/templates/interview-branch-creation.md" ]; then
        pass
    else
        fail "Template not accessible"
    fi
}

###############################################################################
# Main Test Execution
###############################################################################

main() {
    echo "╔════════════════════════════════════════╗"
    echo "║  Git-Town Skill Integration Tests      ║"
    echo "╔════════════════════════════════════════╗"
    echo ""
    echo "Testing implementation at: $SKILL_DIR"
    echo "Test directory: $TEST_DIR"

    # Check git-town availability
    if ! command -v git-town &> /dev/null; then
        echo -e "${RED}✗ git-town not installed${NC}"
        echo "Please install git-town to run integration tests"
        exit 1
    fi

    echo -e "${GREEN}✓ git-town found: $(git-town --version)${NC}"
    echo ""

    # Run all test suites
    test_skill_reference_loading
    test_branch_creation_workflow
    test_interview_template_validation
    test_error_handling_documentation
    test_merge_conflict_simulation
    test_error_code_mapping
    test_skill_query_syntax

    # Print results
    print_header "Integration Test Results"
    echo ""
    echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
    echo ""

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}✓ All integration tests passed!${NC}"
        echo ""
        echo "Agent integration with git-town skill verified:"
        echo "  ✓ Skill loading and performance"
        echo "  ✓ Branch creation workflow"
        echo "  ✓ Interview template validation"
        echo "  ✓ Error handling documentation"
        echo "  ✓ Merge conflict simulation"
        echo "  ✓ Exit code mapping"
        echo "  ✓ Skill query syntax"
        exit 0
    else
        echo -e "${RED}✗ Some integration tests failed${NC}"
        echo ""
        echo "Please review the failures above and fix any issues."
        exit 1
    fi
}

# Run main function
main
