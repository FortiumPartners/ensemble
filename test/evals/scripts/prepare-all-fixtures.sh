#!/bin/bash
# =============================================================================
# prepare-all-fixtures.sh - Batch Process All Test Fixtures with Retries
# =============================================================================
# Purpose: Process multiple fixtures from user-stories/ directory with
#          automatic retry support and detailed progress tracking.
#
# Usage:
#   ./prepare-all-fixtures.sh [options]
#
# Options:
#   --max-retries N      Maximum retry attempts per fixture (default: 3)
#   --parallel           Run fixtures in parallel (not recommended)
#   --dry-run            Show what would be done without executing
#   --output-dir DIR     Override default output directory
#   --skip-init          Skip /init-project step (for structure testing)
#   --fixtures-dir DIR   Path to fixtures directory (default: auto-detect)
#   --help               Show help
#
# Output:
#   Progress tracking for each fixture with retry status.
#   Summary report at the end.
#
# Dependencies:
#   - prepare-variants.sh (in same directory)
#   - claude CLI (unless --skip-init)
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Prepare variants script
PREPARE_VARIANTS="${SCRIPT_DIR}/prepare-variants.sh"

# Default output directory
DEFAULT_OUTPUT_DIR="/tmp/ensemble-test-fixtures"

# Default fixtures location (ensemble-vnext-test-fixtures repo)
DEFAULT_FIXTURES_DIR="${REPO_ROOT}/ensemble-vnext-test-fixtures"

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

MAX_RETRIES=3
PARALLEL_MODE=false
DRY_RUN=false
OUTPUT_DIR=""
SKIP_INIT=false
FIXTURES_DIR=""

# Tracking counters
TOTAL=0
PASSED_FIRST_TRY=0
PASSED_ON_RETRY=0
FAILED=0

# Arrays for tracking results
declare -a FIXTURE_NAMES=()
declare -a FIXTURE_PATHS=()
declare -a FIXTURE_RESULTS=()
declare -a FIXTURE_ATTEMPTS=()

# ANSI colors (disabled if not a terminal)
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
    cat <<'EOF'
Usage: prepare-all-fixtures.sh [options]

Prepare all test fixtures from user-stories/ directory with automatic retries.

Options:
    --max-retries N      Maximum retry attempts per fixture (default: 3)
    --parallel           Run fixtures in parallel (may cause race conditions)
    --dry-run            Show what would be done without executing
    --output-dir DIR     Override default output directory (/tmp/ensemble-test-fixtures)
    --skip-init          Skip /init-project step (for structure testing)
    --fixtures-dir DIR   Path to fixtures directory (default: auto-detect)
    --help               Show help

Example output:
    === Preparing Test Fixtures ===
    [1/5] fastapi-endpoint... PASS (attempt 1)
    [2/5] flutter-widget... PASS (attempt 1)
    [3/5] pytest-tests... FAIL (attempt 1), retrying... PASS (attempt 2)
    [4/5] python-cli... FAIL (attempt 1), retrying... FAIL (attempt 2), retrying... PASS (attempt 3)
    [5/5] typescript-validation... PASS (attempt 1)

    === Summary ===
    Total: 5
    Passed (first try): 3
    Passed (retry): 2
    Failed: 0

Examples:
    ./prepare-all-fixtures.sh
    ./prepare-all-fixtures.sh --max-retries 5
    ./prepare-all-fixtures.sh --dry-run
    ./prepare-all-fixtures.sh --skip-init --output-dir ./test-output
EOF
    exit 0
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*" >&2
}

# Auto-detect fixtures directory
detect_fixtures_dir() {
    # Check default location (sibling repo)
    if [[ -d "$DEFAULT_FIXTURES_DIR/user-stories" ]]; then
        echo "$DEFAULT_FIXTURES_DIR"
        return 0
    fi

    # Check inside repo
    local inside_repo="${REPO_ROOT}/ensemble-vnext-test-fixtures"
    if [[ -d "$inside_repo/user-stories" ]]; then
        echo "$inside_repo"
        return 0
    fi

    # Check parent directory
    local parent_repo="${REPO_ROOT}/../ensemble-vnext-test-fixtures"
    if [[ -d "$parent_repo/user-stories" ]]; then
        echo "$(cd "$parent_repo" && pwd)"
        return 0
    fi

    # Not found
    return 1
}

# Discover all fixtures in user-stories/
discover_fixtures() {
    local fixtures_base="$1"
    local user_stories_dir="${fixtures_base}/user-stories"

    if [[ ! -d "$user_stories_dir" ]]; then
        log_error "user-stories/ directory not found: $user_stories_dir"
        return 1
    fi

    # Find all directories in user-stories/
    while IFS= read -r -d '' fixture_path; do
        local fixture_name
        fixture_name="$(basename "$fixture_path")"

        # Skip hidden directories and non-directories
        if [[ "$fixture_name" == .* ]]; then
            continue
        fi

        FIXTURE_NAMES+=("$fixture_name")
        FIXTURE_PATHS+=("$fixture_path")
    done < <(find "$user_stories_dir" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

    TOTAL=${#FIXTURE_NAMES[@]}

    if [[ $TOTAL -eq 0 ]]; then
        log_error "No fixtures found in: $user_stories_dir"
        return 1
    fi

    return 0
}

# Process a single fixture with retries
process_fixture_with_retries() {
    local fixture_path="$1"
    local fixture_name="$2"
    local index="$3"
    local total="$4"
    local max_attempts="$5"

    local attempt=1
    local result="FAILED"
    local status_line=""

    # Print progress prefix without newline
    echo -n "[${index}/${total}] ${fixture_name}..."

    while [[ $attempt -le $max_attempts ]]; do
        if [[ "$DRY_RUN" == "true" ]]; then
            echo " PASS (attempt ${attempt}) [DRY-RUN]"
            result="PASS"
            break
        fi

        # Build command
        local cmd=("$PREPARE_VARIANTS")
        cmd+=("--force")
        cmd+=("--no-git")

        if [[ "$SKIP_INIT" == "true" ]]; then
            cmd+=("--skip-init")
        fi

        cmd+=("$fixture_path")
        cmd+=("$OUTPUT_DIR")

        # Execute and capture output
        local output=""
        local exit_code=0

        set +e
        output=$("${cmd[@]}" 2>&1)
        exit_code=$?
        set -e

        if [[ $exit_code -eq 0 ]]; then
            # Success
            if [[ $attempt -eq 1 ]]; then
                echo " PASS (attempt 1)"
                result="PASS_FIRST"
            else
                echo " PASS (attempt ${attempt})"
                result="PASS_RETRY"
            fi
            break
        else
            # Failure
            if [[ $attempt -lt $max_attempts ]]; then
                echo -n " FAIL (attempt ${attempt}), retrying..."
            else
                echo " FAIL (attempt ${attempt})"
                # Log error details for debugging
                if [[ -n "$output" ]]; then
                    log_error "  Details: $(echo "$output" | tail -3 | tr '\n' ' ')"
                fi
                result="FAILED"
            fi
        fi

        attempt=$((attempt + 1))
    done

    # Store results
    FIXTURE_RESULTS+=("$result")
    FIXTURE_ATTEMPTS+=("$((attempt > max_attempts ? max_attempts : attempt))")

    # Update counters
    case "$result" in
        PASS_FIRST)
            PASSED_FIRST_TRY=$((PASSED_FIRST_TRY + 1))
            return 0
            ;;
        PASS_RETRY|PASS)
            PASSED_ON_RETRY=$((PASSED_ON_RETRY + 1))
            return 0
            ;;
        FAILED)
            FAILED=$((FAILED + 1))
            return 1
            ;;
    esac
}

# Process all fixtures sequentially
process_fixtures_sequential() {
    local index=0
    local exit_status=0

    for i in "${!FIXTURE_NAMES[@]}"; do
        index=$((index + 1))

        set +e
        process_fixture_with_retries \
            "${FIXTURE_PATHS[$i]}" \
            "${FIXTURE_NAMES[$i]}" \
            "$index" \
            "$TOTAL" \
            "$MAX_RETRIES"
        local result=$?
        set -e

        if [[ $result -ne 0 ]]; then
            exit_status=1
        fi
    done

    return $exit_status
}

# Process all fixtures in parallel (not recommended)
process_fixtures_parallel() {
    log_warn "Parallel mode enabled - this may cause race conditions!"

    local pids=()
    local result_file
    result_file="$(mktemp)"

    trap "rm -f '$result_file'" EXIT

    local index=0
    for i in "${!FIXTURE_NAMES[@]}"; do
        index=$((index + 1))

        (
            # Redirect to subshell result capture
            local result="FAILED"
            local attempt=1

            while [[ $attempt -le $MAX_RETRIES ]]; do
                local cmd=("$PREPARE_VARIANTS")
                cmd+=("--force")
                cmd+=("--no-git")

                if [[ "$SKIP_INIT" == "true" ]]; then
                    cmd+=("--skip-init")
                fi

                cmd+=("${FIXTURE_PATHS[$i]}")
                cmd+=("$OUTPUT_DIR")

                if "${cmd[@]}" >/dev/null 2>&1; then
                    if [[ $attempt -eq 1 ]]; then
                        result="PASS_FIRST"
                    else
                        result="PASS_RETRY"
                    fi
                    break
                fi

                attempt=$((attempt + 1))
            done

            echo "${FIXTURE_NAMES[$i]}:${result}:${attempt}" >> "$result_file"
        ) &

        pids+=($!)
    done

    # Wait for all background jobs
    for pid in "${pids[@]}"; do
        wait "$pid" || true
    done

    # Parse results and display
    while IFS=: read -r name result attempts; do
        case "$result" in
            PASS_FIRST)
                echo "[?/?] ${name}... PASS (attempt 1)"
                PASSED_FIRST_TRY=$((PASSED_FIRST_TRY + 1))
                ;;
            PASS_RETRY)
                echo "[?/?] ${name}... PASS (attempt ${attempts})"
                PASSED_ON_RETRY=$((PASSED_ON_RETRY + 1))
                ;;
            FAILED)
                echo "[?/?] ${name}... FAIL (after ${MAX_RETRIES} attempts)"
                FAILED=$((FAILED + 1))
                ;;
        esac

        FIXTURE_RESULTS+=("$result")
        FIXTURE_ATTEMPTS+=("$attempts")
    done < "$result_file"

    if [[ $FAILED -gt 0 ]]; then
        return 1
    fi
    return 0
}

# Print summary report
print_summary() {
    echo ""
    echo "=== Summary ==="
    echo "Total: ${TOTAL}"
    echo "Passed (first try): ${PASSED_FIRST_TRY}"
    echo "Passed (retry): ${PASSED_ON_RETRY}"
    echo "Failed: ${FAILED}"

    if [[ $FAILED -gt 0 ]]; then
        echo ""
        echo "Failed fixtures:"
        for i in "${!FIXTURE_NAMES[@]}"; do
            if [[ "${FIXTURE_RESULTS[$i]:-}" == "FAILED" ]]; then
                echo "  - ${FIXTURE_NAMES[$i]}"
            fi
        done
    fi
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --max-retries)
            MAX_RETRIES="$2"
            if ! [[ "$MAX_RETRIES" =~ ^[0-9]+$ ]] || [[ "$MAX_RETRIES" -lt 1 ]]; then
                log_error "Invalid max-retries: $MAX_RETRIES (must be >= 1)"
                exit 1
            fi
            shift 2
            ;;
        --parallel)
            PARALLEL_MODE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --skip-init)
            SKIP_INIT=true
            shift
            ;;
        --fixtures-dir)
            FIXTURES_DIR="$2"
            shift 2
            ;;
        --help|-h)
            usage
            ;;
        -*)
            log_error "Unknown option: $1"
            echo "Use --help for usage information" >&2
            exit 1
            ;;
        *)
            log_error "Unexpected argument: $1"
            echo "Use --help for usage information" >&2
            exit 1
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

# Auto-detect fixtures directory if not provided
if [[ -z "$FIXTURES_DIR" ]]; then
    if ! FIXTURES_DIR=$(detect_fixtures_dir); then
        log_error "Could not auto-detect fixtures directory"
        log_error "Use --fixtures-dir to specify the path"
        log_error "Expected: ensemble-vnext-test-fixtures/user-stories/"
        exit 1
    fi
fi

# Resolve to absolute path
if [[ -d "$FIXTURES_DIR" ]]; then
    FIXTURES_DIR="$(cd "$FIXTURES_DIR" && pwd)"
else
    log_error "Fixtures directory not found: $FIXTURES_DIR"
    exit 1
fi

# Set default output directory if not specified
if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
fi

# Resolve output directory (create if needed)
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

# Validate prepare-variants script exists
if [[ ! -x "$PREPARE_VARIANTS" ]]; then
    log_error "prepare-variants.sh not found or not executable: $PREPARE_VARIANTS"
    exit 1
fi

# Validate claude CLI is available (unless dry-run or skip-init)
if [[ "$DRY_RUN" != "true" ]] && [[ "$SKIP_INIT" != "true" ]]; then
    if ! command -v claude &>/dev/null; then
        log_error "Claude CLI not found in PATH"
        log_error "Install Claude Code CLI or use --skip-init"
        exit 1
    fi
fi

# Discover fixtures
if ! discover_fixtures "$FIXTURES_DIR"; then
    log_error "Failed to discover fixtures"
    exit 1
fi

# -----------------------------------------------------------------------------
# Dry Run Mode
# -----------------------------------------------------------------------------

if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN MODE ==="
    echo ""
    echo "Configuration:"
    echo "  Fixtures directory: $FIXTURES_DIR"
    echo "  Output directory:   $OUTPUT_DIR"
    echo "  Max retries:        $MAX_RETRIES"
    echo "  Parallel mode:      $PARALLEL_MODE"
    echo "  Skip init:          $SKIP_INIT"
    echo ""
    echo "Fixtures found: $TOTAL"
    for i in "${!FIXTURE_NAMES[@]}"; do
        echo "  - ${FIXTURE_NAMES[$i]}"
    done
    echo ""
    echo "=== Preparing Test Fixtures ==="

    # Simulate processing
    for i in "${!FIXTURE_NAMES[@]}"; do
        echo "[$(($i + 1))/${TOTAL}] ${FIXTURE_NAMES[$i]}... PASS (attempt 1) [DRY-RUN]"
        FIXTURE_RESULTS+=("PASS")
        FIXTURE_ATTEMPTS+=("1")
        PASSED_FIRST_TRY=$((PASSED_FIRST_TRY + 1))
    done

    print_summary
    echo ""
    echo "Dry run complete. No changes were made."
    exit 0
fi

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

echo "=== Preparing Test Fixtures ==="
log_info "Fixtures: ${TOTAL} found in ${FIXTURES_DIR}/user-stories/"
log_info "Output:   ${OUTPUT_DIR}"
log_info "Retries:  ${MAX_RETRIES} max attempts per fixture"
echo ""

if [[ "$PARALLEL_MODE" == "true" ]]; then
    process_fixtures_parallel
    exit_code=$?
else
    process_fixtures_sequential
    exit_code=$?
fi

print_summary

if [[ $FAILED -gt 0 ]]; then
    log_error ""
    log_error "Some fixtures failed. Check logs above for details."
    exit 1
fi

log_success ""
log_success "All fixtures prepared successfully!"
log_info "Variants created in: ${OUTPUT_DIR}/variants/"

exit $exit_code
