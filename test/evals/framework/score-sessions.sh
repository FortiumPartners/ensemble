#!/bin/bash
# score-sessions.sh - Reproducible batch scoring for eval sessions
#
# PART OF REPEATABLE PROCESS - This script scores sessions against all rubrics
#
# DEFAULT BEHAVIOR: Baseline-relative scoring
#   1. First scores baseline sessions independently (absolute scores)
#   2. Then scores other variants RELATIVE to baseline using comparative judging
#   3. Produces both absolute scores AND baseline comparison results
#
# Usage:
#   ./score-sessions.sh <results-dir> [options]
#
# Options:
#   --eval <name>     Score only sessions for a specific eval (e.g., python-cli)
#   --variant <name>  Score only sessions for a specific variant (baseline, framework, full-workflow)
#   --rubrics <list>  Comma-separated list of rubrics (default: code-quality,test-quality,architecture,error-handling)
#   --parallel <n>    Number of parallel scoring jobs (default: 2)
#   --absolute-only   Skip baseline comparison, use absolute scoring only (legacy mode)
#   --dry-run         Show what would be scored without running
#   --help            Show this help
#
# Output Structure:
#   <session>/scores/<rubric>.json                    - Absolute scores (all sessions)
#   <results>/comparisons/baseline-comparison-<rubric>.json - Baseline comparison results
#
# Examples:
#   ./score-sessions.sh test/evals/results/overnight-20260115                    # Score all (baseline-relative)
#   ./score-sessions.sh test/evals/results/overnight-20260115 --eval python-cli  # Single eval
#   ./score-sessions.sh test/evals/results/overnight-20260115 --absolute-only    # Skip baseline comparison
#   ./score-sessions.sh test/evals/results/overnight-20260115 --dry-run          # Preview

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_RUBRICS="code-quality,test-quality,architecture,error-handling"

# Parse arguments
RESULTS_DIR=""
EVAL_FILTER=""
VARIANT_FILTER=""
RUBRICS="$DEFAULT_RUBRICS"
PARALLEL=2
ABSOLUTE_ONLY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --eval)
            EVAL_FILTER="$2"
            shift 2
            ;;
        --variant)
            VARIANT_FILTER="$2"
            shift 2
            ;;
        --rubrics)
            RUBRICS="$2"
            shift 2
            ;;
        --parallel)
            PARALLEL="$2"
            shift 2
            ;;
        --absolute-only)
            ABSOLUTE_ONLY=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help)
            head -35 "$0" | tail -33
            exit 0
            ;;
        *)
            if [[ -z "$RESULTS_DIR" ]]; then
                RESULTS_DIR="$1"
            fi
            shift
            ;;
    esac
done

if [[ -z "$RESULTS_DIR" ]]; then
    echo "Error: results-dir argument is required"
    echo "Run with --help for usage information"
    exit 1
fi

if [[ ! -d "$RESULTS_DIR" ]]; then
    echo "Error: Results directory not found: $RESULTS_DIR"
    exit 1
fi

RESULTS_DIR="$(cd "$RESULTS_DIR" && pwd)"

echo "=== Batch Session Scoring ==="
echo "Results dir: $RESULTS_DIR"
echo "Rubrics: $RUBRICS"
echo "Parallel jobs: $PARALLEL"
echo "Mode: $( [[ "$ABSOLUTE_ONLY" == "true" ]] && echo "Absolute only" || echo "Baseline-relative (default)" )"
[[ -n "$EVAL_FILTER" ]] && echo "Eval filter: $EVAL_FILTER"
[[ -n "$VARIANT_FILTER" ]] && echo "Variant filter: $VARIANT_FILTER"
echo ""

# Convert rubrics to array
IFS=',' read -ra RUBRIC_ARRAY <<< "$RUBRICS"

# Get variant from session metadata
get_variant() {
    local session_dir="$1"
    local metadata="$session_dir/metadata.json"
    if [[ -f "$metadata" ]]; then
        grep -o '"variant": "[^"]*"' "$metadata" 2>/dev/null | cut -d'"' -f4 || echo ""
    else
        echo ""
    fi
}

# Find all session directories (those containing workspace/)
find_sessions() {
    local dir="$1"
    # UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex chars)
    find "$dir" -type d 2>/dev/null | \
        grep -E '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' | \
        while read -r session_dir; do
            if [[ -d "$session_dir/workspace" ]]; then
                echo "$session_dir"
            fi
        done
}

# Collect sessions grouped by eval
declare -A BASELINE_SESSIONS      # eval_name -> baseline session path
declare -A FRAMEWORK_SESSIONS     # eval_name -> framework session path
declare -A FULLWORKFLOW_SESSIONS  # eval_name -> full-workflow session path
declare -a ALL_SESSIONS

# Determine if RESULTS_DIR contains eval subdirectories or is itself an eval
# An eval directory contains session UUIDs directly; a results root contains eval directories
has_direct_sessions() {
    local dir="$1"
    # Check if any UUID-named directories exist directly under this directory
    # UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex chars)
    # Use grep with regex for precise matching instead of glob
    find "$dir" -maxdepth 1 -type d 2>/dev/null | \
        grep -E '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' | \
        head -1 | grep -q .
}

# Build list of eval directories to process
EVAL_DIRS=()
if has_direct_sessions "$RESULTS_DIR"; then
    # RESULTS_DIR is itself an eval directory
    EVAL_DIRS+=("$RESULTS_DIR")
else
    # RESULTS_DIR contains eval subdirectories
    for eval_dir in "$RESULTS_DIR"/*/; do
        [[ ! -d "$eval_dir" ]] && continue
        [[ "$(basename "$eval_dir")" == *.log ]] && continue
        EVAL_DIRS+=("$eval_dir")
    done
fi

for eval_dir in "${EVAL_DIRS[@]}"; do
    eval_name=$(basename "$eval_dir")

    # Apply eval filter
    if [[ -n "$EVAL_FILTER" && "$eval_name" != *"$EVAL_FILTER"* ]]; then
        continue
    fi

    while IFS= read -r session_dir; do
        [[ -z "$session_dir" ]] && continue

        variant=$(get_variant "$session_dir")

        # Apply variant filter
        if [[ -n "$VARIANT_FILTER" && "$variant" != "$VARIANT_FILTER" ]]; then
            continue
        fi

        ALL_SESSIONS+=("$session_dir")

        # Group by variant for baseline comparison (keyed by eval_name)
        case "$variant" in
            baseline|baseline_run*)
                # Use first baseline session found for each eval
                if [[ -z "${BASELINE_SESSIONS[$eval_name]:-}" ]]; then
                    BASELINE_SESSIONS[$eval_name]="$session_dir"
                fi
                ;;
            framework|framework_run*)
                if [[ -z "${FRAMEWORK_SESSIONS[$eval_name]:-}" ]]; then
                    FRAMEWORK_SESSIONS[$eval_name]="$session_dir"
                fi
                ;;
            full-workflow|full-workflow_run*)
                if [[ -z "${FULLWORKFLOW_SESSIONS[$eval_name]:-}" ]]; then
                    FULLWORKFLOW_SESSIONS[$eval_name]="$session_dir"
                fi
                ;;
        esac
    done < <(find_sessions "$eval_dir")
done

SESSION_COUNT=${#ALL_SESSIONS[@]}
BASELINE_COUNT=${#BASELINE_SESSIONS[@]}
COMPARISON_COUNT=0

# Count comparisons needed
for eval_name in "${!BASELINE_SESSIONS[@]}"; do
    [[ -n "${FRAMEWORK_SESSIONS[$eval_name]:-}" ]] && COMPARISON_COUNT=$((COMPARISON_COUNT + 1))
    [[ -n "${FULLWORKFLOW_SESSIONS[$eval_name]:-}" ]] && COMPARISON_COUNT=$((COMPARISON_COUNT + 1))
done

ABSOLUTE_JOBS=$((SESSION_COUNT * ${#RUBRIC_ARRAY[@]}))
COMPARISON_JOBS=$((COMPARISON_COUNT * ${#RUBRIC_ARRAY[@]}))

echo "Found $SESSION_COUNT sessions ($BASELINE_COUNT baselines)"
echo "Absolute scoring jobs: $ABSOLUTE_JOBS"
if [[ "$ABSOLUTE_ONLY" != "true" ]]; then
    echo "Baseline comparison jobs: $COMPARISON_JOBS"
fi
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN ==="
    echo ""
    echo "Phase 1: Absolute scoring (all sessions)"
    for session_dir in "${ALL_SESSIONS[@]}"; do
        session_id=$(basename "$session_dir")
        eval_name=$(basename "$(dirname "$session_dir")")
        variant=$(get_variant "$session_dir")
        echo "  $eval_name/$session_id ($variant)"
    done

    if [[ "$ABSOLUTE_ONLY" != "true" ]]; then
        echo ""
        echo "Phase 2: Baseline comparisons"
        for eval_name in "${!BASELINE_SESSIONS[@]}"; do
            baseline="${BASELINE_SESSIONS[$eval_name]}"
            baseline_id=$(basename "$baseline")

            if [[ -n "${FRAMEWORK_SESSIONS[$eval_name]:-}" ]]; then
                framework="${FRAMEWORK_SESSIONS[$eval_name]}"
                framework_id=$(basename "$framework")
                echo "  $eval_name: baseline ($baseline_id) vs framework ($framework_id)"
            fi

            if [[ -n "${FULLWORKFLOW_SESSIONS[$eval_name]:-}" ]]; then
                fullworkflow="${FULLWORKFLOW_SESSIONS[$eval_name]}"
                fullworkflow_id=$(basename "$fullworkflow")
                echo "  $eval_name: baseline ($baseline_id) vs full-workflow ($fullworkflow_id)"
            fi
        done
    fi

    echo ""
    echo "Total jobs: $ABSOLUTE_JOBS absolute + $( [[ "$ABSOLUTE_ONLY" == "true" ]] && echo "0" || echo "$COMPARISON_JOBS" ) comparisons"
    exit 0
fi

# Create log file
LOG_FILE="$RESULTS_DIR/scoring-$(date +%Y%m%d-%H%M%S).log"
echo "Logging to: $LOG_FILE"
echo ""

# Score function for absolute scoring
score_absolute() {
    local session_dir="$1"
    local rubric="$2"
    local log_file="$3"

    local session_id=$(basename "$session_dir")
    local eval_name=$(basename "$(dirname "$session_dir")")
    local variant=$(get_variant "$session_dir")

    echo "[$(date +%H:%M:%S)] Absolute: $eval_name/$variant/$rubric" | tee -a "$log_file"

    if node "$SCRIPT_DIR/judge.js" "$session_dir" "$rubric" >> "$log_file" 2>&1; then
        echo "[$(date +%H:%M:%S)] OK: $eval_name/$variant/$rubric" | tee -a "$log_file"
        return 0
    else
        echo "[$(date +%H:%M:%S)] FAIL: $eval_name/$variant/$rubric" | tee -a "$log_file"
        return 1
    fi
}

# Score function for baseline comparison
score_comparison() {
    local baseline_dir="$1"
    local other_dir="$2"
    local rubric="$3"
    local log_file="$4"

    local eval_name=$(basename "$(dirname "$baseline_dir")")
    local other_variant=$(get_variant "$other_dir")

    echo "[$(date +%H:%M:%S)] Compare: $eval_name baseline vs $other_variant / $rubric" | tee -a "$log_file"

    if node "$SCRIPT_DIR/judge.js" --compare "$baseline_dir" "$other_dir" "$rubric" --baseline "$baseline_dir" >> "$log_file" 2>&1; then
        echo "[$(date +%H:%M:%S)] OK: $eval_name baseline vs $other_variant / $rubric" | tee -a "$log_file"
        return 0
    else
        echo "[$(date +%H:%M:%S)] FAIL: $eval_name baseline vs $other_variant / $rubric" | tee -a "$log_file"
        return 1
    fi
}

export -f score_absolute score_comparison get_variant
export SCRIPT_DIR LOG_FILE

# ============================================================================
# PHASE 1: Absolute scoring for all sessions
# ============================================================================
echo "=== Phase 1: Absolute Scoring ===" | tee -a "$LOG_FILE"
echo "Starting at $(date)" | tee -a "$LOG_FILE"

COMPLETED=0
for session_dir in "${ALL_SESSIONS[@]}"; do
    for rubric in "${RUBRIC_ARRAY[@]}"; do
        score_absolute "$session_dir" "$rubric" "$LOG_FILE" &

        # Limit parallelism
        while [[ $(jobs -r | wc -l) -ge $PARALLEL ]]; do
            sleep 1
        done
    done

    COMPLETED=$((COMPLETED + 1))
    echo "Phase 1 progress: $COMPLETED/$SESSION_COUNT sessions"
done

# Wait for phase 1 to complete
wait
echo "Phase 1 complete at $(date)" | tee -a "$LOG_FILE"

# ============================================================================
# PHASE 2: Baseline comparisons (unless --absolute-only)
# ============================================================================
if [[ "$ABSOLUTE_ONLY" != "true" && $COMPARISON_COUNT -gt 0 ]]; then
    echo "" | tee -a "$LOG_FILE"
    echo "=== Phase 2: Baseline Comparisons ===" | tee -a "$LOG_FILE"
    echo "Starting at $(date)" | tee -a "$LOG_FILE"

    COMPLETED=0
    for eval_name in "${!BASELINE_SESSIONS[@]}"; do
        baseline="${BASELINE_SESSIONS[$eval_name]}"

        # Compare framework vs baseline
        if [[ -n "${FRAMEWORK_SESSIONS[$eval_name]:-}" ]]; then
            framework="${FRAMEWORK_SESSIONS[$eval_name]}"
            for rubric in "${RUBRIC_ARRAY[@]}"; do
                score_comparison "$baseline" "$framework" "$rubric" "$LOG_FILE" &

                while [[ $(jobs -r | wc -l) -ge $PARALLEL ]]; do
                    sleep 1
                done
            done
            COMPLETED=$((COMPLETED + 1))
        fi

        # Compare full-workflow vs baseline
        if [[ -n "${FULLWORKFLOW_SESSIONS[$eval_name]:-}" ]]; then
            fullworkflow="${FULLWORKFLOW_SESSIONS[$eval_name]}"
            for rubric in "${RUBRIC_ARRAY[@]}"; do
                score_comparison "$baseline" "$fullworkflow" "$rubric" "$LOG_FILE" &

                while [[ $(jobs -r | wc -l) -ge $PARALLEL ]]; do
                    sleep 1
                done
            done
            COMPLETED=$((COMPLETED + 1))
        fi

        echo "Phase 2 progress: $COMPLETED/$COMPARISON_COUNT comparisons"
    done

    # Wait for phase 2 to complete
    wait
    echo "Phase 2 complete at $(date)" | tee -a "$LOG_FILE"
fi

echo ""
echo "=== Scoring Complete ==="
echo "Completed at $(date)"
echo "Log file: $LOG_FILE"

# Summary
ABSOLUTE_COUNT=$(find "$RESULTS_DIR" -name "*.json" -path "*/scores/*" -newer "$LOG_FILE" 2>/dev/null | wc -l || echo "0")
COMPARISON_FILE_COUNT=$(find "$RESULTS_DIR" -name "baseline-comparison-*.json" -newer "$LOG_FILE" 2>/dev/null | wc -l || echo "0")
echo "Absolute score files: $ABSOLUTE_COUNT"
echo "Baseline comparison files: $COMPARISON_FILE_COUNT"
