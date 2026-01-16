#!/bin/bash
# =============================================================================
# run-all-hook-tests.sh - Run all hook integration tests
# =============================================================================
# TRD-TEST-100: Hook integration test suite runner
# Purpose: Execute all hook integration tests (TRD-TEST-095-099) and generate
#          a summary report with coverage information.
#
# Usage:
#   ./run-all-hook-tests.sh                    # Run all tests
#   ./run-all-hook-tests.sh --verbose          # Detailed output
#   ./run-all-hook-tests.sh --junit            # Generate JUnit XML report
#   ./run-all-hook-tests.sh --specific wiggum  # Run only wiggum tests
#
# Exit Codes:
#   0 - All tests passed
#   1 - One or more tests failed
#
# Prerequisites:
#   - BATS (Bash Automated Testing System) >= 1.9.0
#   - jq for JSON parsing (optional, for report formatting)
#
# TRD Reference: docs/TRD/testing-phase.md TRD-TEST-100
# AC Reference: AC-HI1, AC-HI2, AC-HI3, AC-HI4
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Test files to run (ordered by task number)
declare -A HOOK_TESTS=(
    ["wiggum"]="wiggum-hook.test.sh"
    ["formatter"]="formatter-hook.test.sh"
    ["learning"]="learning-hook.test.sh"
    ["status"]="status-hook.test.sh"
    ["permitter"]="permitter-hook.test.sh"
)

# Expected test counts (from TRD)
declare -A EXPECTED_COUNTS=(
    ["wiggum"]=36
    ["formatter"]=26
    ["learning"]=19
    ["status"]=28
    ["permitter"]=18
)

# Report output directory
REPORT_DIR="${SCRIPT_DIR}/../reports"

# =============================================================================
# CLI Options
# =============================================================================

VERBOSE=false
JUNIT=false
SPECIFIC_HOOK=""
PARALLEL=false
JOBS=1

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Run all hook integration tests and generate a summary report.

Options:
    --verbose, -v       Detailed output during test execution
    --junit, -j         Generate JUnit XML report
    --specific <hook>   Run only tests for specified hook
                        Valid hooks: wiggum, formatter, learning, status, permitter
    --parallel, -p      Run tests in parallel (requires GNU parallel)
    --jobs <n>          Number of parallel jobs (default: 1)
    --help, -h          Show this help message

Examples:
    $(basename "$0")                      # Run all tests
    $(basename "$0") --verbose            # Verbose output
    $(basename "$0") --junit              # Generate JUnit report
    $(basename "$0") --specific wiggum    # Run wiggum tests only
    $(basename "$0") --parallel --jobs 4  # Parallel execution

Report Output:
    Console summary with pass/fail counts per hook
    JUnit XML (optional): ${REPORT_DIR}/hook-tests-junit.xml
EOF
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --junit|-j)
            JUNIT=true
            shift
            ;;
        --specific)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --specific requires a hook name" >&2
                exit 1
            fi
            SPECIFIC_HOOK="$2"
            shift 2
            ;;
        --parallel|-p)
            PARALLEL=true
            shift
            ;;
        --jobs)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --jobs requires a number" >&2
                exit 1
            fi
            JOBS="$2"
            shift 2
            ;;
        --help|-h)
            usage
            ;;
        *)
            echo "Error: Unknown option: $1" >&2
            echo "Use --help for usage information" >&2
            exit 1
            ;;
    esac
done

# Validate hook name format (alphanumeric and hyphens only)
if [[ -n "$SPECIFIC_HOOK" ]]; then
    if [[ ! "$SPECIFIC_HOOK" =~ ^[a-z][a-z0-9-]*$ ]]; then
        echo "[ERROR] Invalid hook name format: $SPECIFIC_HOOK" >&2
        echo "        Hook names must start with a letter and contain only lowercase letters, numbers, and hyphens" >&2
        exit 1
    fi
fi

# Validate specific hook if provided
if [[ -n "$SPECIFIC_HOOK" ]] && [[ ! -v "HOOK_TESTS[$SPECIFIC_HOOK]" ]]; then
    echo "Error: Unknown hook '$SPECIFIC_HOOK'" >&2
    echo "Valid hooks: ${!HOOK_TESTS[*]}" >&2
    exit 1
fi

# =============================================================================
# Prerequisites Check
# =============================================================================

check_prerequisites() {
    local errors=0

    # Check for BATS
    if ! command -v bats &>/dev/null; then
        echo "Error: BATS (Bash Automated Testing System) not found" >&2
        echo "Install: npm install -g bats or brew install bats-core" >&2
        errors=$((errors + 1))
    else
        local bats_version
        bats_version=$(bats --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")
        if [[ "$VERBOSE" == "true" ]]; then
            echo "[INFO] BATS version: $bats_version"
        fi
    fi

    # Check for jq (optional but recommended)
    if ! command -v jq &>/dev/null && [[ "$VERBOSE" == "true" ]]; then
        echo "[WARN] jq not found - some report features may be limited"
    fi

    # Check for GNU parallel if parallel mode requested
    if [[ "$PARALLEL" == "true" ]] && ! command -v parallel &>/dev/null; then
        echo "[WARN] GNU parallel not found - falling back to sequential execution"
        PARALLEL=false
    fi

    # Verify test files exist
    local hooks_to_check
    if [[ -n "$SPECIFIC_HOOK" ]]; then
        hooks_to_check=("$SPECIFIC_HOOK")
    else
        hooks_to_check=("${!HOOK_TESTS[@]}")
    fi

    for hook in "${hooks_to_check[@]}"; do
        local test_file="${SCRIPT_DIR}/${HOOK_TESTS[$hook]}"
        if [[ ! -f "$test_file" ]]; then
            echo "Error: Test file not found: $test_file" >&2
            errors=$((errors + 1))
        fi
    done

    if [[ $errors -gt 0 ]]; then
        exit 1
    fi
}

# =============================================================================
# Test Execution
# =============================================================================

declare -A RESULTS_PASSED
declare -A RESULTS_FAILED
declare -A RESULTS_SKIPPED
declare -A RESULTS_TIME
TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0
TOTAL_TIME=0
OVERALL_EXIT_CODE=0

run_hook_tests() {
    local hook="$1"
    local test_file="${SCRIPT_DIR}/${HOOK_TESTS[$hook]}"
    local temp_output
    temp_output=$(mktemp)

    if [[ "$VERBOSE" == "true" ]]; then
        echo ""
        echo "Running ${hook} hook tests..."
        echo "  File: ${HOOK_TESTS[$hook]}"
        echo "  Expected tests: ${EXPECTED_COUNTS[$hook]}"
    fi

    # Build BATS command
    local bats_args=()
    if [[ "$JUNIT" == "true" ]]; then
        mkdir -p "$REPORT_DIR"
        bats_args+=("--formatter" "junit")
    else
        bats_args+=("--formatter" "tap")
    fi

    # Capture start time
    local start_time
    start_time=$(date +%s.%N)

    # Run tests and capture output
    local exit_code=0
    if [[ "$VERBOSE" == "true" ]]; then
        bats "${bats_args[@]}" "$test_file" 2>&1 | tee "$temp_output" || exit_code=$?
    else
        bats "${bats_args[@]}" "$test_file" > "$temp_output" 2>&1 || exit_code=$?
    fi

    # Capture end time
    local end_time
    end_time=$(date +%s.%N)
    local duration
    duration=$(echo "$end_time - $start_time" | bc 2>/dev/null || echo "0")

    # Parse TAP output to extract counts
    local passed=0
    local failed=0
    local skipped=0

    if [[ "$JUNIT" != "true" ]]; then
        # Parse TAP format
        while IFS= read -r line; do
            if [[ "$line" =~ ^ok\ [0-9]+ ]]; then
                if [[ "$line" =~ \#\ skip ]]; then
                    skipped=$((skipped + 1))
                else
                    passed=$((passed + 1))
                fi
            elif [[ "$line" =~ ^not\ ok\ [0-9]+ ]]; then
                failed=$((failed + 1))
            fi
        done < "$temp_output"
    else
        # Parse JUnit XML format for counts
        # BATS JUnit output has testcase elements with failures/skipped children
        local testcase_count
        local failure_count
        local skipped_count

        testcase_count=$(grep -c '<testcase' "$temp_output" 2>/dev/null) || testcase_count=0
        failure_count=$(grep -c '<failure' "$temp_output" 2>/dev/null) || failure_count=0
        skipped_count=$(grep -c '<skipped' "$temp_output" 2>/dev/null) || skipped_count=0

        # Calculate passed as total minus failures and skipped
        passed=$((testcase_count - failure_count - skipped_count))
        failed=$failure_count
        skipped=$skipped_count

        # Handle edge case where passed could go negative
        if [[ $passed -lt 0 ]]; then
            passed=0
        fi

        # Save JUnit XML for specific hook
        cp "$temp_output" "${REPORT_DIR}/${hook}-hook-junit.xml"
    fi

    # Store results
    RESULTS_PASSED[$hook]=$passed
    RESULTS_FAILED[$hook]=$failed
    RESULTS_SKIPPED[$hook]=$skipped
    RESULTS_TIME[$hook]=$(printf "%.1f" "$duration")

    # Update totals
    TOTAL_PASSED=$((TOTAL_PASSED + passed))
    TOTAL_FAILED=$((TOTAL_FAILED + failed))
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + skipped))
    TOTAL_TIME=$(echo "$TOTAL_TIME + $duration" | bc 2>/dev/null || echo "$TOTAL_TIME")

    # Track overall exit code
    if [[ $exit_code -ne 0 ]]; then
        OVERALL_EXIT_CODE=1
    fi

    # Cleanup
    rm -f "$temp_output"

    return $exit_code
}

# =============================================================================
# Report Generation
# =============================================================================

print_summary_report() {
    local hooks_tested=0
    local hooks_passed=0

    echo ""
    echo "$(printf '%0.s=' {1..59})"
    echo "Hook Integration Test Suite - Summary"
    echo "$(printf '%0.s=' {1..59})"
    echo ""
    printf "%-14s | %6s | %6s | %7s | %s\n" "Hook" "Passed" "Failed" "Skipped" "Time"
    echo "$(printf '%0.s-' {1..59})"

    local hooks_to_report
    if [[ -n "$SPECIFIC_HOOK" ]]; then
        hooks_to_report=("$SPECIFIC_HOOK")
    else
        # Maintain order: wiggum, formatter, learning, status, permitter
        hooks_to_report=("wiggum" "formatter" "learning" "status" "permitter")
    fi

    for hook in "${hooks_to_report[@]}"; do
        if [[ -v "RESULTS_PASSED[$hook]" ]]; then
            hooks_tested=$((hooks_tested + 1))
            local passed="${RESULTS_PASSED[$hook]}"
            local failed="${RESULTS_FAILED[$hook]}"
            local skipped="${RESULTS_SKIPPED[$hook]}"
            local time="${RESULTS_TIME[$hook]}s"

            # Check if all tests passed for this hook
            if [[ "$failed" -eq 0 ]]; then
                hooks_passed=$((hooks_passed + 1))
            fi

            printf "%-14s | %6d | %6d | %7d | %s\n" "$hook" "$passed" "$failed" "$skipped" "$time"
        fi
    done

    echo "$(printf '%0.s-' {1..59})"
    local formatted_time
    formatted_time=$(printf "%.1f" "$TOTAL_TIME")
    printf "%-14s | %6d | %6d | %7d | %ss\n" "TOTAL" "$TOTAL_PASSED" "$TOTAL_FAILED" "$TOTAL_SKIPPED" "$formatted_time"
    echo ""

    # Calculate pass rate
    local total_tests=$((TOTAL_PASSED + TOTAL_FAILED))
    local pass_rate=0
    if [[ $total_tests -gt 0 ]]; then
        pass_rate=$(echo "scale=0; ($TOTAL_PASSED * 100) / $total_tests" | bc 2>/dev/null || echo "0")
    fi

    echo "Overall Pass Rate: ${pass_rate}%"

    # Hook coverage
    local total_hooks=${#HOOK_TESTS[@]}
    if [[ -n "$SPECIFIC_HOOK" ]]; then
        echo "Hook Coverage: 1/1 hooks tested (100%)"
    else
        local coverage_pct=$((hooks_tested * 100 / total_hooks))
        echo "Hook Coverage: ${hooks_tested}/${total_hooks} hooks tested (${coverage_pct}%)"
    fi

    echo "AC Reference: AC-HI1, AC-HI2, AC-HI3, AC-HI4"
    echo ""

    # Result indicator
    if [[ $TOTAL_FAILED -eq 0 ]]; then
        echo "Result: [PASS] ALL TESTS PASSED"
    else
        echo "Result: [FAIL] ${TOTAL_FAILED} TEST(S) FAILED"
    fi

    echo "$(printf '%0.s=' {1..59})"
}

generate_junit_summary() {
    if [[ "$JUNIT" != "true" ]]; then
        return
    fi

    mkdir -p "$REPORT_DIR"
    local summary_file="${REPORT_DIR}/hook-tests-summary.xml"

    local total_tests=$((TOTAL_PASSED + TOTAL_FAILED + TOTAL_SKIPPED))
    local formatted_time
    formatted_time=$(printf "%.3f" "$TOTAL_TIME")

    cat > "$summary_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Hook Integration Tests" tests="$total_tests" failures="$TOTAL_FAILED" skipped="$TOTAL_SKIPPED" time="$formatted_time">
EOF

    local hooks_to_report
    if [[ -n "$SPECIFIC_HOOK" ]]; then
        hooks_to_report=("$SPECIFIC_HOOK")
    else
        hooks_to_report=("wiggum" "formatter" "learning" "status" "permitter")
    fi

    for hook in "${hooks_to_report[@]}"; do
        if [[ -v "RESULTS_PASSED[$hook]" ]]; then
            local passed="${RESULTS_PASSED[$hook]}"
            local failed="${RESULTS_FAILED[$hook]}"
            local skipped="${RESULTS_SKIPPED[$hook]}"
            local time="${RESULTS_TIME[$hook]}"
            local tests=$((passed + failed + skipped))

            cat >> "$summary_file" <<EOF
  <testsuite name="${hook}-hook" tests="$tests" failures="$failed" skipped="$skipped" time="$time">
    <properties>
      <property name="hook" value="$hook"/>
      <property name="testFile" value="${HOOK_TESTS[$hook]}"/>
    </properties>
  </testsuite>
EOF
        fi
    done

    echo "</testsuites>" >> "$summary_file"

    if [[ "$VERBOSE" == "true" ]]; then
        echo "[INFO] JUnit summary written to: $summary_file"
    fi
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    echo "Hook Integration Test Suite Runner"
    echo "TRD-TEST-100 | Ensemble vNext"
    echo ""

    # Check prerequisites
    check_prerequisites

    # Determine which hooks to test
    local hooks_to_test
    if [[ -n "$SPECIFIC_HOOK" ]]; then
        hooks_to_test=("$SPECIFIC_HOOK")
    else
        # Maintain consistent order
        hooks_to_test=("wiggum" "formatter" "learning" "status" "permitter")
    fi

    echo "Testing ${#hooks_to_test[@]} hook(s)..."

    # Run tests
    if [[ "$PARALLEL" == "true" && "$JOBS" -gt 1 ]]; then
        # Parallel execution
        if [[ "$VERBOSE" == "true" ]]; then
            echo "[INFO] Running tests in parallel with $JOBS jobs"
        fi
        for hook in "${hooks_to_test[@]}"; do
            run_hook_tests "$hook" &
        done
        wait
    else
        # Sequential execution
        for hook in "${hooks_to_test[@]}"; do
            run_hook_tests "$hook" || true
        done
    fi

    # Generate reports
    print_summary_report

    if [[ "$JUNIT" == "true" ]]; then
        generate_junit_summary
    fi

    # Return appropriate exit code
    exit $OVERALL_EXIT_CODE
}

# Run main
main "$@"
