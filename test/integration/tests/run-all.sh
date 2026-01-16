#!/bin/bash
# =============================================================================
# run-all.sh - Integration test runner for Phase 4A tests
# =============================================================================
# Task: TRD-TEST-033 through TRD-TEST-061 (Phase 4A)
# Purpose: Run all Phase 4A integration tests with BATS
#
# Usage:
#   ./run-all.sh                    # Run all tests
#   ./run-all.sh --filter "init"    # Run tests matching pattern
#   ./run-all.sh --vendoring        # Run only vendoring tests
#   ./run-all.sh --commands         # Run only command flow tests
#   ./run-all.sh --functions        # Run only function verification tests
#   ./run-all.sh --dry-run          # Skip headless tests (faster)
#   ./run-all.sh --verbose          # Verbose output
#   ./run-all.sh --help             # Show help
#
# Environment Variables:
#   SKIP_HEADLESS  - Set to 'false' to run headless tests (default: true)
#   FIXTURE_DIR    - Path to test fixtures
#   SESSION_DIR    - Path for session output files
#   DEFAULT_TIMEOUT - Timeout for headless sessions (default: 600)
#
# Exit Codes:
#   0 - All tests passed
#   1 - Some tests failed
#   2 - Invalid arguments or missing dependencies
#
# TRD Reference: docs/TRD/testing-phase.md section 4.5 Phase 4A
# =============================================================================

set -euo pipefail

# shellcheck disable=SC2034  # Variables used in test context

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Default settings
SKIP_HEADLESS="${SKIP_HEADLESS:-true}"
VERBOSE="${VERBOSE:-false}"
FILTER=""
TEST_SUITE="all"

# Test files
VENDORING_TEST="${SCRIPT_DIR}/vendoring.test.sh"
COMMANDS_TEST="${SCRIPT_DIR}/commands.test.sh"

# Colors for output (if terminal supports it)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") [options]

Phase 4A Integration Test Runner

Options:
    --vendoring       Run only vendoring tests (TRD-TEST-033-035)
    --commands        Run only command flow tests (TRD-TEST-054-061)
    --functions       Run only function verification tests (no Claude CLI)
    --all             Run all tests (default)

    --filter PATTERN  Only run tests matching PATTERN (BATS --filter)
    --dry-run         Skip headless tests (sets SKIP_HEADLESS=true)
    --live            Run headless tests (sets SKIP_HEADLESS=false)

    --verbose, -v     Verbose output
    --tap             Output in TAP format
    --help, -h        Show this help message

Examples:
    $(basename "$0")                     # Run all tests (dry run by default)
    $(basename "$0") --live              # Run all tests including headless
    $(basename "$0") --vendoring --live  # Run vendoring tests with Claude
    $(basename "$0") --functions         # Run only function tests
    $(basename "$0") --filter "agent"    # Run tests matching "agent"

Environment Variables:
    SKIP_HEADLESS   Set to 'false' to enable headless tests
    FIXTURE_DIR     Path to test fixtures directory
    SESSION_DIR     Path for session output files
    DEFAULT_TIMEOUT Timeout for headless sessions (seconds)

Test Suites:
    vendoring  - Verify /init-project creates correct structure
    commands   - Verify workflow commands produce expected artifacts
    functions  - Verify helper functions work correctly (no Claude)

Note: Headless tests are DISABLED by default. Use --live to enable them.
      Headless tests may take 5-10 minutes each due to LLM processing.
EOF
    exit 0
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $*"
}

check_dependencies() {
    local missing=()

    # Check for BATS
    if ! command -v bats &>/dev/null; then
        missing+=("bats")
    fi

    # Check for jq
    if ! command -v jq &>/dev/null; then
        missing+=("jq")
    fi

    # Check for Claude CLI (warning only)
    if ! command -v claude &>/dev/null; then
        log_warning "Claude CLI not found - headless tests will be skipped"
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing[*]}"
        echo ""
        echo "Install with:"
        echo "  BATS: npm install -g bats"
        echo "  jq:   apt-get install jq (Debian/Ubuntu) or brew install jq (macOS)"
        exit 2
    fi
}

run_bats() {
    local test_file="$1"
    local test_name="$2"
    local bats_args=()

    # Build BATS arguments
    if [[ "$VERBOSE" == "true" ]]; then
        bats_args+=("--verbose-run")
    fi

    if [[ -n "$FILTER" ]]; then
        bats_args+=("--filter" "$FILTER")
    fi

    if [[ "${TAP_OUTPUT:-false}" == "true" ]]; then
        bats_args+=("--tap")
    fi

    log_info "Running $test_name tests..."
    echo ""

    # Export environment for tests
    export SKIP_HEADLESS
    export FIXTURE_DIR="${FIXTURE_DIR:-${PROJECT_ROOT}/ensemble-vnext-test-fixtures/fixtures}"
    export SESSION_DIR="${SESSION_DIR:-${SCRIPT_DIR}/../sessions}"
    export DEFAULT_TIMEOUT="${DEFAULT_TIMEOUT:-600}"

    # Run BATS
    if bats "${bats_args[@]}" "$test_file"; then
        log_success "$test_name tests completed"
        return 0
    else
        log_error "$test_name tests failed"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vendoring)
            TEST_SUITE="vendoring"
            shift
            ;;
        --commands)
            TEST_SUITE="commands"
            shift
            ;;
        --functions)
            TEST_SUITE="functions"
            FILTER="${FILTER:-structure-verify|functions}"
            shift
            ;;
        --all)
            TEST_SUITE="all"
            shift
            ;;
        --filter)
            FILTER="$2"
            shift 2
            ;;
        --dry-run)
            SKIP_HEADLESS="true"
            shift
            ;;
        --live)
            SKIP_HEADLESS="false"
            shift
            ;;
        --verbose|-v)
            VERBOSE="true"
            shift
            ;;
        --tap)
            TAP_OUTPUT="true"
            shift
            ;;
        --help|-h)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

echo ""
echo "========================================"
echo "Phase 4A Integration Test Runner"
echo "========================================"
echo ""
echo "Configuration:"
echo "  Test Suite:     $TEST_SUITE"
echo "  Skip Headless:  $SKIP_HEADLESS"
echo "  Filter:         ${FILTER:-<none>}"
echo "  Verbose:        $VERBOSE"
echo ""

# Check dependencies
check_dependencies

# Create sessions directory
mkdir -p "${SESSION_DIR:-${SCRIPT_DIR}/../sessions}"

# Track results
TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0

run_test_suite() {
    local test_file="$1"
    local test_name="$2"

    if [[ ! -f "$test_file" ]]; then
        log_warning "Test file not found: $test_file"
        return 0
    fi

    if run_bats "$test_file" "$test_name"; then
        ((TOTAL_PASSED++)) || true
    else
        ((TOTAL_FAILED++)) || true
    fi
    echo ""
}

# Run selected test suite(s)
case "$TEST_SUITE" in
    vendoring)
        run_test_suite "$VENDORING_TEST" "Vendoring"
        ;;
    commands)
        run_test_suite "$COMMANDS_TEST" "Commands"
        ;;
    functions)
        # Run function tests from both files
        run_test_suite "$VENDORING_TEST" "Vendoring Functions"
        run_test_suite "$COMMANDS_TEST" "Commands Functions"
        ;;
    all)
        run_test_suite "$VENDORING_TEST" "Vendoring"
        run_test_suite "$COMMANDS_TEST" "Commands"
        ;;
esac

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo "Test Suites Passed: $TOTAL_PASSED"
echo "Test Suites Failed: $TOTAL_FAILED"
echo ""

if [[ "$SKIP_HEADLESS" == "true" ]]; then
    log_warning "Headless tests were SKIPPED (use --live to enable)"
fi

if [[ $TOTAL_FAILED -gt 0 ]]; then
    log_error "SOME TESTS FAILED"
    exit 1
else
    log_success "ALL TEST SUITES PASSED"
    exit 0
fi
