#!/usr/bin/env bash
# Test suite for validate-git-town.sh
# RED PHASE: Tests written first to define expected behavior

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test helper functions
assert_equals() {
    local expected="$1"
    local actual="$2"
    local message="$3"

    TESTS_RUN=$((TESTS_RUN + 1))

    if [ "$expected" = "$actual" ]; then
        echo -e "${GREEN}✓${NC} $message"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}✗${NC} $message"
        echo -e "  Expected: $expected"
        echo -e "  Actual:   $actual"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

assert_exit_code() {
    local expected_code="$1"
    local command="$2"
    local message="$3"

    TESTS_RUN=$((TESTS_RUN + 1))

    set +e
    eval "$command" > /dev/null 2>&1
    local actual_code=$?
    set -e

    if [ "$expected_code" = "$actual_code" ]; then
        echo -e "${GREEN}✓${NC} $message"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}✗${NC} $message"
        echo -e "  Expected exit code: $expected_code"
        echo -e "  Actual exit code:   $actual_code"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local message="$3"

    TESTS_RUN=$((TESTS_RUN + 1))

    if echo "$haystack" | grep -q "$needle"; then
        echo -e "${GREEN}✓${NC} $message"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}✗${NC} $message"
        echo -e "  Expected to contain: $needle"
        echo -e "  In: $haystack"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Source the validation script (will be created)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/validate-git-town.sh" ]; then
    # Source it without executing main logic
    source "$SCRIPT_DIR/validate-git-town.sh" 2>/dev/null || true
else
    echo -e "${YELLOW}Warning: validate-git-town.sh not found. Tests will fail.${NC}"
fi

echo "========================================"
echo "Git-Town Validation Script Test Suite"
echo "========================================"
echo ""

# Test 1: detect_platform function exists
echo "Test Suite: detect_platform()"
echo "----------------------------"
if type detect_platform > /dev/null 2>&1; then
    # Test platform detection returns valid value
    PLATFORM=$(detect_platform)
    assert_contains "$PLATFORM" "macos\|linux\|windows\|unknown" "detect_platform returns valid platform"
else
    echo -e "${RED}✗${NC} detect_platform function not found"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 2: check_git_town_installed function
echo "Test Suite: check_git_town_installed()"
echo "---------------------------------------"
if type check_git_town_installed > /dev/null 2>&1; then
    # Should return 0 if git-town is in PATH, 1 otherwise
    if command -v git-town > /dev/null 2>&1; then
        assert_exit_code "0" "check_git_town_installed" "check_git_town_installed returns 0 when git-town is installed"
    else
        assert_exit_code "1" "check_git_town_installed" "check_git_town_installed returns 1 when git-town is not installed"
    fi
else
    echo -e "${RED}✗${NC} check_git_town_installed function not found"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 3: check_git_town_version function
echo "Test Suite: check_git_town_version()"
echo "------------------------------------"
if type check_git_town_version > /dev/null 2>&1; then
    # Should return 0 for version >= 14.0.0, 3 for older versions
    if command -v git-town > /dev/null 2>&1; then
        VERSION=$(git-town --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
        MAJOR=$(echo "$VERSION" | cut -d. -f1)

        if [ "$MAJOR" -ge 14 ]; then
            assert_exit_code "0" "check_git_town_version" "check_git_town_version returns 0 for version >= 14.0.0"
        else
            assert_exit_code "3" "check_git_town_version" "check_git_town_version returns 3 for version < 14.0.0"
        fi
    fi
else
    echo -e "${RED}✗${NC} check_git_town_version function not found"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 4: check_git_repository function
echo "Test Suite: check_git_repository()"
echo "----------------------------------"
if type check_git_repository > /dev/null 2>&1; then
    # Should return 0 in git repo, 4 outside
    if git rev-parse --git-dir > /dev/null 2>&1; then
        assert_exit_code "0" "check_git_repository" "check_git_repository returns 0 inside git repository"
    else
        assert_exit_code "4" "check_git_repository" "check_git_repository returns 4 outside git repository"
    fi
else
    echo -e "${RED}✗${NC} check_git_repository function not found"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 5: check_git_town_config function
echo "Test Suite: check_git_town_config()"
echo "-----------------------------------"
if type check_git_town_config > /dev/null 2>&1; then
    # Should return 0 if main branch configured, 2 otherwise
    if git config --get git-town.main-branch > /dev/null 2>&1; then
        assert_exit_code "0" "check_git_town_config" "check_git_town_config returns 0 when main branch configured"
    else
        # In an unconfigured repo, should return 2
        assert_exit_code "2" "check_git_town_config" "check_git_town_config returns 2 when not configured"
    fi
else
    echo -e "${RED}✗${NC} check_git_town_config function not found"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 6: Exit codes are properly defined
echo "Test Suite: Exit Code Constants"
echo "-------------------------------"
if [ -n "${EXIT_SUCCESS:-}" ]; then
    assert_equals "0" "$EXIT_SUCCESS" "EXIT_SUCCESS is defined as 0"
else
    echo -e "${RED}✗${NC} EXIT_SUCCESS not defined"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if [ -n "${EXIT_NOT_FOUND:-}" ]; then
    assert_equals "1" "$EXIT_NOT_FOUND" "EXIT_NOT_FOUND is defined as 1"
else
    echo -e "${RED}✗${NC} EXIT_NOT_FOUND not defined"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if [ -n "${EXIT_NOT_CONFIGURED:-}" ]; then
    assert_equals "2" "$EXIT_NOT_CONFIGURED" "EXIT_NOT_CONFIGURED is defined as 2"
else
    echo -e "${RED}✗${NC} EXIT_NOT_CONFIGURED not defined"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if [ -n "${EXIT_OLD_VERSION:-}" ]; then
    assert_equals "3" "$EXIT_OLD_VERSION" "EXIT_OLD_VERSION is defined as 3"
else
    echo -e "${RED}✗${NC} EXIT_OLD_VERSION not defined"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if [ -n "${EXIT_NOT_GIT_REPO:-}" ]; then
    assert_equals "4" "$EXIT_NOT_GIT_REPO" "EXIT_NOT_GIT_REPO is defined as 4"
else
    echo -e "${RED}✗${NC} EXIT_NOT_GIT_REPO not defined"
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Summary
echo "========================================"
echo "Test Results"
echo "========================================"
echo "Tests run:    $TESTS_RUN"
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi
