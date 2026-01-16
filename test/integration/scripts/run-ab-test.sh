#!/bin/bash
# =============================================================================
# run-ab-test.sh - A/B Comparison Test Runner
# =============================================================================
# Task: TRD-TEST-031
# Purpose: Run A/B comparison tests in parallel with configurable prompts
#          and generate comparison reports for evaluating skill/agent impact.
#
# Usage:
#   ./run-ab-test.sh --prompt-a "Prompt A" --prompt-b "Prompt B"
#   ./run-ab-test.sh --test-name my-test --prompt-a "..." --prompt-b "..."
#   ./run-ab-test.sh --skill developing-with-python
#
# Environment Variables:
#   SESSION_DIR         - Output directory (default: ../sessions)
#   PARALLEL_JOBS       - Max parallel jobs (default: 2)
#
# Output:
#   - Session logs for both A and B variants
#   - Comparison report in JSON format
#   - Summary to stdout
#
# Dependencies:
#   - run-headless.sh (in same directory)
#   - verify-output.sh (in same directory)
#   - jq for JSON processing
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_DIR="${SESSION_DIR:-${SCRIPT_DIR}/../sessions}"
REPORTS_DIR="${SCRIPT_DIR}/../reports"

# Default parallel jobs
PARALLEL_JOBS="${PARALLEL_JOBS:-2}"

# Timestamp for this test run
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# -----------------------------------------------------------------------------
# Utility Functions
# -----------------------------------------------------------------------------

log_info() {
    echo "[INFO] $(date '+%H:%M:%S') $*" >&2
}

log_error() {
    echo "[ERROR] $(date '+%H:%M:%S') $*" >&2
}

log_section() {
    echo "" >&2
    echo "============================================================" >&2
    echo " $*" >&2
    echo "============================================================" >&2
}

check_dependencies() {
    if ! command -v jq &>/dev/null; then
        log_error "jq is required but not installed"
        exit 2
    fi

    if [[ ! -x "${SCRIPT_DIR}/run-headless.sh" ]]; then
        log_error "run-headless.sh not found or not executable"
        exit 2
    fi

    if [[ ! -x "${SCRIPT_DIR}/verify-output.sh" ]]; then
        log_error "verify-output.sh not found or not executable"
        exit 2
    fi
}

# -----------------------------------------------------------------------------
# A/B Test Execution
# -----------------------------------------------------------------------------

# Run a single variant (A or B)
# Usage: run_variant <variant_name> <prompt> <session_prefix>
run_variant() {
    local variant_name="$1"
    local prompt="$2"
    local session_prefix="$3"
    local output_file="${SESSION_DIR}/${session_prefix}_${variant_name}.result"

    log_info "Starting variant ${variant_name}..."

    # Run headless and capture result
    local uuid exit_code
    set +e
    uuid=$("${SCRIPT_DIR}/run-headless.sh" "$prompt" --quiet 2>&1)
    exit_code=$?
    set -e

    # Save result metadata
    cat > "$output_file" <<EOF
{
    "variant": "${variant_name}",
    "session_id": "${uuid}",
    "exit_code": ${exit_code},
    "prompt": $(echo "$prompt" | jq -Rs .),
    "timestamp": "$(date -Iseconds)",
    "session_file": "${SESSION_DIR}/session-${uuid}.jsonl"
}
EOF

    if [[ $exit_code -eq 0 ]]; then
        log_info "Variant ${variant_name} completed (session: ${uuid})"
    else
        log_info "Variant ${variant_name} failed with exit code ${exit_code}"
    fi

    echo "$output_file"
}

# Run both variants in parallel
# Usage: run_parallel <prompt_a> <prompt_b> <session_prefix>
run_parallel() {
    local prompt_a="$1"
    local prompt_b="$2"
    local session_prefix="$3"

    local result_a result_b
    local pid_a pid_b

    log_section "Running A/B Test in Parallel"

    # Start both variants in background
    run_variant "A" "$prompt_a" "$session_prefix" &
    pid_a=$!

    run_variant "B" "$prompt_b" "$session_prefix" &
    pid_b=$!

    log_info "Waiting for both variants to complete..."
    log_info "  Variant A: PID ${pid_a}"
    log_info "  Variant B: PID ${pid_b}"

    # Wait for both to complete
    local exit_a=0 exit_b=0
    wait $pid_a || exit_a=$?
    wait $pid_b || exit_b=$?

    # Return paths to result files
    echo "${SESSION_DIR}/${session_prefix}_A.result"
    echo "${SESSION_DIR}/${session_prefix}_B.result"
}

# Run both variants sequentially (for debugging)
run_sequential() {
    local prompt_a="$1"
    local prompt_b="$2"
    local session_prefix="$3"

    log_section "Running A/B Test Sequentially"

    local result_a result_b

    log_info "Running Variant A..."
    result_a=$(run_variant "A" "$prompt_a" "$session_prefix")

    log_info "Running Variant B..."
    result_b=$(run_variant "B" "$prompt_b" "$session_prefix")

    echo "$result_a"
    echo "$result_b"
}

# -----------------------------------------------------------------------------
# Comparison and Reporting
# -----------------------------------------------------------------------------

# Compare two session results
# Usage: compare_results <result_file_a> <result_file_b> <report_file>
compare_results() {
    local result_a="$1"
    local result_b="$2"
    local report_file="$3"

    log_section "Comparing Results"

    # Read result metadata
    local meta_a meta_b
    meta_a=$(cat "$result_a")
    meta_b=$(cat "$result_b")

    local session_file_a session_file_b
    session_file_a=$(echo "$meta_a" | jq -r '.session_file')
    session_file_b=$(echo "$meta_b" | jq -r '.session_file')

    # Get tool usage statistics
    local tools_a tools_b
    tools_a=$("${SCRIPT_DIR}/verify-output.sh" list_all_tools "$session_file_a" 2>/dev/null | sort | tr '\n' ',' | sed 's/,$//')
    tools_b=$("${SCRIPT_DIR}/verify-output.sh" list_all_tools "$session_file_b" 2>/dev/null | sort | tr '\n' ',' | sed 's/,$//')

    # Check for success
    local success_a success_b
    if "${SCRIPT_DIR}/verify-output.sh" check_session_success "$session_file_a" &>/dev/null; then
        success_a="true"
    else
        success_a="false"
    fi
    if "${SCRIPT_DIR}/verify-output.sh" check_session_success "$session_file_b" &>/dev/null; then
        success_b="true"
    else
        success_b="false"
    fi

    # Calculate basic metrics
    local lines_a lines_b
    lines_a=$(wc -l < "$session_file_a" 2>/dev/null || echo "0")
    lines_b=$(wc -l < "$session_file_b" 2>/dev/null || echo "0")

    local bytes_a bytes_b
    bytes_a=$(wc -c < "$session_file_a" 2>/dev/null || echo "0")
    bytes_b=$(wc -c < "$session_file_b" 2>/dev/null || echo "0")

    # Generate comparison report
    cat > "$report_file" <<EOF
{
    "test_run": {
        "timestamp": "$(date -Iseconds)",
        "report_file": "${report_file}"
    },
    "variant_a": {
        "session_id": $(echo "$meta_a" | jq '.session_id'),
        "exit_code": $(echo "$meta_a" | jq '.exit_code'),
        "success": ${success_a},
        "prompt": $(echo "$meta_a" | jq '.prompt'),
        "session_file": "${session_file_a}",
        "tools_used": "$(echo "$tools_a" | sed 's/,$//')",
        "metrics": {
            "output_lines": ${lines_a},
            "output_bytes": ${bytes_a}
        }
    },
    "variant_b": {
        "session_id": $(echo "$meta_b" | jq '.session_id'),
        "exit_code": $(echo "$meta_b" | jq '.exit_code'),
        "success": ${success_b},
        "prompt": $(echo "$meta_b" | jq '.prompt'),
        "session_file": "${session_file_b}",
        "tools_used": "$(echo "$tools_b" | sed 's/,$//')",
        "metrics": {
            "output_lines": ${lines_b},
            "output_bytes": ${bytes_b}
        }
    },
    "comparison": {
        "both_successful": $([ "$success_a" = "true" ] && [ "$success_b" = "true" ] && echo "true" || echo "false"),
        "tools_match": $([ "$tools_a" = "$tools_b" ] && echo "true" || echo "false"),
        "size_ratio": $(echo "scale=2; ${bytes_b} / (${bytes_a} + 1)" | bc 2>/dev/null || echo "0")
    }
}
EOF

    log_info "Comparison report written to: ${report_file}"

    # Print summary to stdout
    echo ""
    echo "=== A/B Test Comparison Summary ==="
    echo ""
    echo "Variant A:"
    echo "  Success: ${success_a}"
    echo "  Exit Code: $(echo "$meta_a" | jq -r '.exit_code')"
    echo "  Tools: ${tools_a:-none}"
    echo "  Output: ${lines_a} lines, ${bytes_a} bytes"
    echo ""
    echo "Variant B:"
    echo "  Success: ${success_b}"
    echo "  Exit Code: $(echo "$meta_b" | jq -r '.exit_code')"
    echo "  Tools: ${tools_b:-none}"
    echo "  Output: ${lines_b} lines, ${bytes_b} bytes"
    echo ""
    echo "Comparison:"
    echo "  Both Successful: $([ "$success_a" = "true" ] && [ "$success_b" = "true" ] && echo "Yes" || echo "No")"
    echo "  Tools Match: $([ "$tools_a" = "$tools_b" ] && echo "Yes" || echo "No")"
    echo ""
    echo "Report: ${report_file}"
    echo ""
}

# Generate a skill-specific A/B test
# Usage: generate_skill_test <skill_name>
generate_skill_test() {
    local skill_name="$1"

    # Skill-specific prompts for A/B testing
    case "$skill_name" in
        developing-with-python)
            PROMPT_A="Create a Python function that validates email addresses without using any external skills or references."
            PROMPT_B="Use the Skill tool to invoke developing-with-python, then create a Python function that validates email addresses following best practices from the skill."
            ;;
        developing-with-flutter)
            PROMPT_A="Create a Flutter StatefulWidget for a counter app without using any external skills or references."
            PROMPT_B="Use the Skill tool to invoke developing-with-flutter, then create a Flutter StatefulWidget for a counter app following the patterns from the skill."
            ;;
        developing-with-typescript)
            PROMPT_A="Create a TypeScript interface for a User with validation without using any external skills or references."
            PROMPT_B="Use the Skill tool to invoke developing-with-typescript, then create a TypeScript interface for a User with validation following the patterns from the skill."
            ;;
        using-fastapi)
            PROMPT_A="Create a FastAPI endpoint for user registration without using any external skills or references."
            PROMPT_B="Use the Skill tool to invoke using-fastapi, then create a FastAPI endpoint for user registration following the patterns from the skill."
            ;;
        pytest)
            PROMPT_A="Write pytest tests for a calculator module without using any external skills or references."
            PROMPT_B="Use the Skill tool to invoke pytest, then write pytest tests for a calculator module following the patterns from the skill."
            ;;
        *)
            log_error "Unknown skill: $skill_name"
            log_error "Supported skills: developing-with-python, developing-with-flutter, developing-with-typescript, using-fastapi, pytest"
            exit 2
            ;;
    esac

    log_info "Generated prompts for skill: $skill_name"
}

# -----------------------------------------------------------------------------
# Help / Usage
# -----------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") [options]

Run A/B comparison tests for evaluating skill and agent impact.

Options:
    --prompt-a PROMPT       Prompt for variant A (required unless --skill)
    --prompt-b PROMPT       Prompt for variant B (required unless --skill)
    --skill NAME            Use predefined prompts for skill comparison
                           (developing-with-python, developing-with-flutter,
                            developing-with-typescript, using-fastapi, pytest)
    --test-name NAME        Name for this test run (default: ab_test)
    --sequential            Run variants sequentially instead of parallel
    --output-dir DIR        Output directory for results (default: ../sessions)
    --report-dir DIR        Directory for comparison reports (default: ../reports)
    --help                  Show this help message

Predefined Skill Tests:
    The --skill option generates A/B prompts for comparing behavior with
    and without a specific skill. Variant A runs without skill invocation,
    Variant B explicitly invokes the skill.

Examples:
    # Run with custom prompts
    $(basename "$0") \\
        --prompt-a "Create a Python function" \\
        --prompt-b "Use Skill tool for Python, then create a function"

    # Run predefined skill test
    $(basename "$0") --skill developing-with-python

    # Run with custom name
    $(basename "$0") --skill pytest --test-name pytest-comparison

    # Run sequentially (for debugging)
    $(basename "$0") --skill developing-with-flutter --sequential

Output:
    - Session logs in SESSION_DIR (sessions/)
    - Comparison report in REPORTS_DIR (reports/)
    - Summary printed to stdout

Environment Variables:
    SESSION_DIR         Output directory for session logs
    PARALLEL_JOBS       Maximum parallel jobs (default: 2)
EOF
    exit 0
}

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------

main() {
    local prompt_a=""
    local prompt_b=""
    local test_name="ab_test"
    local skill_name=""
    local sequential=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --prompt-a)
                prompt_a="$2"
                shift 2
                ;;
            --prompt-b)
                prompt_b="$2"
                shift 2
                ;;
            --skill)
                skill_name="$2"
                shift 2
                ;;
            --test-name)
                test_name="$2"
                shift 2
                ;;
            --sequential)
                sequential=true
                shift
                ;;
            --output-dir)
                SESSION_DIR="$2"
                shift 2
                ;;
            --report-dir)
                REPORTS_DIR="$2"
                shift 2
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

    # Check dependencies
    check_dependencies

    # Generate skill-specific prompts if --skill was used
    if [[ -n "$skill_name" ]]; then
        generate_skill_test "$skill_name"
        test_name="${skill_name}-ab"
    fi

    # Validate prompts
    if [[ -z "$prompt_a" ]] || [[ -z "$prompt_b" ]]; then
        log_error "Both --prompt-a and --prompt-b are required (or use --skill)"
        usage
    fi

    # Create output directories
    mkdir -p "$SESSION_DIR"
    mkdir -p "$REPORTS_DIR"

    # Session prefix for this test run
    local session_prefix="${test_name}_${TIMESTAMP}"

    log_section "A/B Test Configuration"
    log_info "Test Name: ${test_name}"
    log_info "Session Prefix: ${session_prefix}"
    log_info "Output Directory: ${SESSION_DIR}"
    log_info "Reports Directory: ${REPORTS_DIR}"
    log_info "Mode: $([ "$sequential" = true ] && echo "Sequential" || echo "Parallel")"

    # Run the test
    local results
    if [[ "$sequential" = true ]]; then
        results=$(run_sequential "$prompt_a" "$prompt_b" "$session_prefix")
    else
        results=$(run_parallel "$prompt_a" "$prompt_b" "$session_prefix")
    fi

    # Parse result files
    local result_a result_b
    result_a=$(echo "$results" | head -1)
    result_b=$(echo "$results" | tail -1)

    # Generate comparison report
    local report_file="${REPORTS_DIR}/${session_prefix}_comparison.json"
    compare_results "$result_a" "$result_b" "$report_file"

    log_info "A/B test completed"
}

main "$@"
