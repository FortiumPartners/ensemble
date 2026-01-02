#!/usr/bin/env bash

###############################################################################
# Git-Town Skill Test Suite
#
# Tests the git-town skill implementation for correctness and completeness.
# Run this script to validate Phase 1 and Phase 2 deliverables.
###############################################################################

set -e

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_PASSED=0
TESTS_FAILED=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

###############################################################################
# Test 1: File Existence
###############################################################################

test_file_existence() {
    print_header "Test 1: File Existence"

    local files=(
        "SKILL.md"
        "REFERENCE.md"
        "ERROR_HANDLING.md"
        "scripts/validate-git-town.sh"
        "scripts/test-validate.sh"
        "templates/SKILL_TEMPLATE.md"
        "templates/interview-branch-creation.md"
        "templates/interview-pr-creation.md"
        "templates/interview-completion.md"
        "guides/agent-skill-integration.md"
    )

    for file in "${files[@]}"; do
        print_test "File exists: $file"
        if [ -f "$SKILL_DIR/$file" ]; then
            pass
        else
            fail "File not found: $SKILL_DIR/$file"
        fi
    done
}

###############################################################################
# Test 2: Validation Script
###############################################################################

test_validation_script() {
    print_header "Test 2: Validation Script Tests"

    print_test "Validation script is executable"
    if [ -x "$SKILL_DIR/scripts/validate-git-town.sh" ]; then
        pass
    else
        fail "Not executable: $SKILL_DIR/scripts/validate-git-town.sh"
        return
    fi

    print_test "Validation script runs without errors"
    if bash "$SKILL_DIR/scripts/validate-git-town.sh" &>/dev/null; then
        pass
    else
        fail "Validation script returned non-zero exit code"
    fi

    print_test "Test suite runs and passes"
    if bash "$SKILL_DIR/scripts/test-validate.sh" | grep -q "All tests passed"; then
        pass
    else
        fail "Test suite did not pass"
    fi
}

###############################################################################
# Test 3: YAML Frontmatter
###############################################################################

test_yaml_frontmatter() {
    print_header "Test 3: YAML Frontmatter Validation"

    local files=(
        "SKILL.md"
        "templates/interview-branch-creation.md"
        "templates/interview-pr-creation.md"
        "templates/interview-completion.md"
    )

    for file in "${files[@]}"; do
        print_test "Valid YAML frontmatter: $file"

        # Check if file starts with ---
        if head -n 1 "$SKILL_DIR/$file" | grep -q "^---$"; then
            # Extract frontmatter (between first two ---)
            awk '/^---$/{i++}i==1' "$SKILL_DIR/$file" | head -n -1 | tail -n +2 > /tmp/frontmatter.yml

            # Try to parse with Python (if available) or just check basic syntax
            if command -v python3 &>/dev/null; then
                if python3 -c "import yaml; yaml.safe_load(open('/tmp/frontmatter.yml'))" 2>/dev/null; then
                    pass
                else
                    fail "Invalid YAML syntax"
                fi
            else
                # Basic check: ensure has key: value pairs
                if grep -q ":" /tmp/frontmatter.yml; then
                    pass
                else
                    fail "No key-value pairs found"
                fi
            fi
        else
            fail "No YAML frontmatter found"
        fi
    done
}

###############################################################################
# Test 4: Mermaid Diagrams
###############################################################################

test_mermaid_diagrams() {
    print_header "Test 4: Mermaid Diagram Syntax"

    print_test "REFERENCE.md contains Mermaid diagrams"
    if grep -q '```mermaid' "$SKILL_DIR/REFERENCE.md"; then
        pass
    else
        fail "No Mermaid diagrams found"
    fi

    print_test "ERROR_HANDLING.md contains Mermaid diagrams"
    if grep -q '```mermaid' "$SKILL_DIR/ERROR_HANDLING.md"; then
        pass
    else
        fail "No Mermaid diagrams found"
    fi

    # Count diagrams
    local ref_count=$(grep -c '```mermaid' "$SKILL_DIR/REFERENCE.md" || echo 0)
    local err_count=$(grep -c '```mermaid' "$SKILL_DIR/ERROR_HANDLING.md" || echo 0)
    local total=$((ref_count + err_count))

    print_test "Found $total Mermaid diagrams (expected 10)"
    if [ "$total" -ge 10 ]; then
        pass
    else
        fail "Expected at least 10 diagrams, found $total"
    fi
}

###############################################################################
# Test 5: Documentation Quality
###############################################################################

test_documentation_quality() {
    print_header "Test 5: Documentation Quality"

    print_test "SKILL.md has required sections"
    local required_sections=("Mission" "Skill Loading Mechanism" "Quick Start" "Common Patterns")
    local all_found=true

    for section in "${required_sections[@]}"; do
        if ! grep -q "## $section" "$SKILL_DIR/SKILL.md"; then
            all_found=false
            break
        fi
    done

    if $all_found; then
        pass
    else
        fail "Missing required sections"
    fi

    print_test "REFERENCE.md documents core commands"
    local commands=("hack" "sync" "propose" "ship")
    local all_found=true

    for cmd in "${commands[@]}"; do
        if ! grep -qi "git-town $cmd" "$SKILL_DIR/REFERENCE.md"; then
            all_found=false
            break
        fi
    done

    if $all_found; then
        pass
    else
        fail "Missing core command documentation"
    fi

    print_test "ERROR_HANDLING.md has 6 error categories"
    local categories=("Merge Conflicts" "Network Errors" "Configuration Errors" "Branch State" "Authentication" "Version")
    local count=0

    for category in "${categories[@]}"; do
        if grep -qi "$category" "$SKILL_DIR/ERROR_HANDLING.md"; then
            ((count++))
        fi
    done

    if [ "$count" -ge 6 ]; then
        pass
    else
        fail "Expected 6 error categories, found $count"
    fi
}

###############################################################################
# Test 6: File Sizes
###############################################################################

test_file_sizes() {
    print_header "Test 6: File Size Requirements"

    print_test "SKILL.md is appropriate size (400-600 lines)"
    local lines=$(wc -l < "$SKILL_DIR/SKILL.md")
    if [ "$lines" -ge 400 ] && [ "$lines" -le 600 ]; then
        pass
    else
        fail "Size: $lines lines (expected 400-600)"
    fi

    print_test "REFERENCE.md is comprehensive (800+ lines)"
    lines=$(wc -l < "$SKILL_DIR/REFERENCE.md")
    if [ "$lines" -ge 800 ]; then
        pass
    else
        fail "Size: $lines lines (expected 800+)"
    fi

    print_test "ERROR_HANDLING.md is comprehensive (1500+ lines)"
    lines=$(wc -l < "$SKILL_DIR/ERROR_HANDLING.md")
    if [ "$lines" -ge 1500 ]; then
        pass
    else
        fail "Size: $lines lines (expected 1500+)"
    fi
}

###############################################################################
# Test 7: Exit Codes
###############################################################################

test_exit_codes() {
    print_header "Test 7: Exit Code Documentation"

    print_test "Documents exit codes 0-10"
    local all_found=true

    for code in {0..10}; do
        if ! grep -q "EXIT.*$code" "$SKILL_DIR/REFERENCE.md"; then
            all_found=false
            break
        fi
    done

    if $all_found; then
        pass
    else
        fail "Not all exit codes (0-10) documented"
    fi

    print_test "Validation script defines exit code constants"
    if grep -q "EXIT_SUCCESS=0" "$SKILL_DIR/scripts/validate-git-town.sh" && \
       grep -q "EXIT_NOT_FOUND=1" "$SKILL_DIR/scripts/validate-git-town.sh"; then
        pass
    else
        fail "Exit code constants not found in validation script"
    fi
}

###############################################################################
# Test 8: Interview Templates
###############################################################################

test_interview_templates() {
    print_header "Test 8: Interview Template Structure"

    print_test "Branch creation template has required fields"
    if grep -q "branch_name" "$SKILL_DIR/templates/interview-branch-creation.md" && \
       grep -q "base_branch" "$SKILL_DIR/templates/interview-branch-creation.md"; then
        pass
    else
        fail "Missing required fields"
    fi

    print_test "PR creation template has validation rules"
    if grep -q "validation" "$SKILL_DIR/templates/interview-pr-creation.md"; then
        pass
    else
        fail "No validation rules found"
    fi

    print_test "Completion template has confirmation field"
    if grep -q "confirm" "$SKILL_DIR/templates/interview-completion.md"; then
        pass
    else
        fail "Missing confirmation field"
    fi
}

###############################################################################
# Main Test Execution
###############################################################################

main() {
    echo "╔════════════════════════════════════════╗"
    echo "║   Git-Town Skill Test Suite            ║"
    echo "╔════════════════════════════════════════╗"
    echo ""
    echo "Testing implementation at: $SKILL_DIR"

    # Run all test suites
    test_file_existence
    test_validation_script
    test_yaml_frontmatter
    test_mermaid_diagrams
    test_documentation_quality
    test_file_sizes
    test_exit_codes
    test_interview_templates

    # Print results
    print_header "Test Results"
    echo ""
    echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
    echo ""

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}✓ All tests passed!${NC}"
        echo ""
        echo "The git-town skill implementation is ready for integration testing."
        exit 0
    else
        echo -e "${RED}✗ Some tests failed${NC}"
        echo ""
        echo "Please review the failures above and fix any issues."
        exit 1
    fi
}

# Run main function
main
