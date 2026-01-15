#!/bin/bash
# =============================================================================
# collect-results.sh - Collect Results from Claude Sessions
# =============================================================================
# Task: TRD-TEST-069
# Purpose: Collect results from completed Claude sessions via session teleporting,
#          extract relevant files, and organize output for judging.
#
# Usage:
#   ./collect-results.sh [options] <session-id>
#
# Arguments:
#     session-id         Session ID to collect results from
#
# Options:
#     --output-dir DIR   Output directory (default: ../../results)
#     --source-dir DIR   Source directory for local sessions (default: ../../results)
#     --timeout SECONDS  Max wait time for completion (default: 600)
#     --poll-interval S  Polling interval in seconds (default: 10)
#     --force            Collect partial results even if session incomplete
#     --patterns GLOB    File patterns to extract (default: "*.py,*.ts,*.js,*.dart")
#     --keep-session     Keep teleported session active
#     --quiet            Suppress progress output
#     --dry-run          Show what would be collected without executing
#     --help             Show this help
#
# Session ID Formats:
#   - Local sessions: UUID format (ebb01d82-e53e-4ddb-842f-3c77580c426c)
#   - Web sessions: session_<ID> format (session_018wgy4uwwvjuwd4ehmfjhnh)
#
# Output Structure:
#   <output-dir>/<session-id>/
#     code/              - Generated code files
#     tests/             - Generated test files
#     session.jsonl      - Session log
#     metadata.json      - Collection metadata
#     summary.json       - Quick reference (files collected, success status)
#
# Examples:
#   # Collect from local session
#   ./collect-results.sh abc123-def456-...
#
#   # Collect from remote web session
#   ./collect-results.sh session_018wgy4uwwvjuwd4ehmfjhnh
#
#   # Collect with custom patterns and output
#   ./collect-results.sh \
#       --output-dir "../results/eval_20260113/" \
#       --patterns "*.py" \
#       "abc123"
#
# Dependencies:
#   - claude CLI (for teleport operations with remote sessions)
#   - jq (optional, for JSON manipulation)
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resource limits for security
MAX_FILE_SIZE="10M"      # Maximum size per file
MAX_FILES=1000           # Maximum total files to process

# Default values
DEFAULT_OUTPUT_DIR="${SCRIPT_DIR}/../../results"
DEFAULT_SOURCE_DIR="${SCRIPT_DIR}/../../results"
DEFAULT_TIMEOUT=600
DEFAULT_POLL_INTERVAL=10
DEFAULT_PATTERNS="*.py,*.ts,*.js,*.dart"

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

SESSION_ID=""
OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
SOURCE_DIR="$DEFAULT_SOURCE_DIR"
TIMEOUT="$DEFAULT_TIMEOUT"
POLL_INTERVAL="$DEFAULT_POLL_INTERVAL"
FORCE=false
PATTERNS="$DEFAULT_PATTERNS"
KEEP_SESSION=false
QUIET=false
DRY_RUN=false

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

usage() {
    cat <<'EOF'
Usage: collect-results.sh [options] <session-id>

Collect results from completed Claude sessions via session teleporting,
extract relevant files, and organize output for judging.

Arguments:
    session-id         Session ID to collect results from

Options:
    --output-dir DIR   Output directory (default: ../../results)
    --source-dir DIR   Source directory for local sessions (default: ../../results)
    --timeout SECONDS  Max wait time for completion (default: 600)
    --poll-interval S  Polling interval in seconds (default: 10)
    --force            Collect partial results even if session incomplete
    --patterns GLOB    File patterns to extract (default: "*.py,*.ts,*.js,*.dart")
    --keep-session     Keep teleported session active
    --quiet            Suppress progress output
    --dry-run          Show what would be collected without executing
    --help             Show this help

Session ID Formats:
    Local sessions:    UUID format (ebb01d82-e53e-4ddb-842f-3c77580c426c)
    Web sessions:      session_<ID> format (session_018wgy4uwwvjuwd4ehmfjhnh)

Output Structure:
    <output-dir>/<session-id>/
      code/              - Generated code files
      tests/             - Generated test files
      session.jsonl      - Session log
      metadata.json      - Collection metadata
      summary.json       - Quick reference

Examples:
    ./collect-results.sh abc123-def456-...
    ./collect-results.sh session_018wgy4uwwvjuwd4ehmfjhnh
    ./collect-results.sh --patterns "*.py" --output-dir ../results/ "abc123"
EOF
    exit 0
}

log_info() {
    if [[ "$QUIET" != "true" ]]; then
        echo "[INFO] $*" >&2
    fi
}

log_error() {
    echo "[ERROR] $*" >&2
}

log_debug() {
    if [[ "${DEBUG:-false}" == "true" ]]; then
        echo "[DEBUG] $*" >&2
    fi
}

validate_numeric() {
    local value="$1"
    local name="$2"
    if ! [[ "$value" =~ ^[0-9]+$ ]]; then
        log_error "$name must be a numeric value, got: $value"
        exit 1
    fi
}

# Validate session ID format for security
validate_session_id() {
    local session_id="$1"

    # UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    local uuid_pattern='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

    # Web session format: session_<alphanumeric>
    local web_pattern='^session_[a-zA-Z0-9]+$'

    # Custom format: alphanumeric with dashes and underscores only (no path chars)
    local custom_pattern='^[a-zA-Z0-9_-]+$'

    if [[ "$session_id" =~ $uuid_pattern ]]; then
        return 0
    elif [[ "$session_id" =~ $web_pattern ]]; then
        return 0
    elif [[ "$session_id" =~ $custom_pattern ]]; then
        # Additional check: no path traversal
        if [[ "$session_id" != *".."* ]] && [[ "$session_id" != *"/"* ]]; then
            return 0
        fi
    fi

    return 1
}

# Detect session ID format
# Returns: "local" for UUID format, "remote" for session_xxx format
detect_session_format() {
    local session_id="$1"

    if [[ "$session_id" =~ ^session_ ]]; then
        echo "remote"
    elif [[ "$session_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
        echo "local"
    else
        # Default to local for other formats
        echo "local"
    fi
}

# Check if session is complete
# Args: session_dir
# Returns: 0 if complete, 1 if not
is_session_complete() {
    local session_dir="$1"
    local metadata_file="$session_dir/metadata.json"

    if [[ ! -f "$metadata_file" ]]; then
        return 1
    fi

    # Check for end_time or exit_code in metadata
    if command -v jq &>/dev/null; then
        local end_time
        end_time=$(jq -r '.end_time // empty' "$metadata_file" 2>/dev/null)
        if [[ -n "$end_time" && "$end_time" != "null" ]]; then
            return 0
        fi
    else
        # Fallback: grep for end_time
        if grep -q '"end_time"' "$metadata_file" 2>/dev/null; then
            return 0
        fi
    fi

    return 1
}

# Wait for session completion with polling
# Args: session_dir timeout poll_interval
# Returns: 0 if complete, 1 if timeout
wait_for_completion() {
    local session_dir="$1"
    local timeout="$2"
    local poll_interval="$3"
    local elapsed=0

    while [[ $elapsed -lt $timeout ]]; do
        if is_session_complete "$session_dir"; then
            return 0
        fi

        log_info "Waiting for session completion... ($elapsed/$timeout seconds)"
        sleep "$poll_interval"
        elapsed=$((elapsed + poll_interval))
    done

    return 1
}

# Extract files matching patterns from workspace
# Args: source_workspace dest_dir patterns
extract_files() {
    local source_workspace="$1"
    local dest_dir="$2"
    local patterns="$3"

    local code_dir="$dest_dir/code"
    local tests_dir="$dest_dir/tests"
    mkdir -p "$code_dir" "$tests_dir"

    # Split patterns by comma
    IFS=',' read -ra PATTERN_ARRAY <<< "$patterns"

    local code_files=()
    local test_files=()

    for pattern in "${PATTERN_ARRAY[@]}"; do
        # Trim whitespace
        pattern=$(echo "$pattern" | xargs)

        # Find files matching pattern
        while IFS= read -r -d '' file; do
            local relative_path="${file#$source_workspace/}"
            local filename="$(basename "$file")"
            local dirname="$(dirname "$relative_path")"

            # Determine if it's a test file
            if [[ "$filename" == test_* ]] || \
               [[ "$filename" == *_test.* ]] || \
               [[ "$filename" == *.test.* ]] || \
               [[ "$filename" == *_spec.* ]] || \
               [[ "$dirname" == *test* ]] || \
               [[ "$dirname" == *spec* ]]; then
                # Copy to tests directory
                local dest_path="$tests_dir/$relative_path"
                mkdir -p "$(dirname "$dest_path")"
                cp "$file" "$dest_path"
                test_files+=("$relative_path")
                log_debug "Extracted test: $relative_path"
            else
                # Copy to code directory
                local dest_path="$code_dir/$relative_path"
                mkdir -p "$(dirname "$dest_path")"
                cp "$file" "$dest_path"
                code_files+=("$relative_path")
                log_debug "Extracted code: $relative_path"
            fi
        done < <(find "$source_workspace" -type f -name "$pattern" \
             -size "-${MAX_FILE_SIZE}" \
             ! -type l \
             -print0 2>/dev/null | head -z -n "$MAX_FILES")
    done

    # Return file lists as JSON-compatible output
    echo "CODE_FILES=(${code_files[*]:-})"
    echo "TEST_FILES=(${test_files[*]:-})"
}

# Calculate session duration in seconds
# Args: metadata_file
calculate_duration() {
    local metadata_file="$1"
    local duration=0

    if command -v jq &>/dev/null && [[ -f "$metadata_file" ]]; then
        local start_time end_time
        start_time=$(jq -r '.start_time // empty' "$metadata_file" 2>/dev/null)
        end_time=$(jq -r '.end_time // empty' "$metadata_file" 2>/dev/null)

        if [[ -n "$start_time" && -n "$end_time" && "$start_time" != "null" && "$end_time" != "null" ]]; then
            # Try to calculate duration using date command
            if command -v date &>/dev/null; then
                local start_epoch end_epoch
                start_epoch=$(date -d "$start_time" +%s 2>/dev/null || echo 0)
                end_epoch=$(date -d "$end_time" +%s 2>/dev/null || echo 0)
                if [[ $end_epoch -gt 0 && $start_epoch -gt 0 ]]; then
                    duration=$((end_epoch - start_epoch))
                fi
            fi
        fi
    fi

    echo "$duration"
}

# Create summary.json file
# Args: output_dir session_id status code_files test_files duration
create_summary() {
    local output_dir="$1"
    local session_id="$2"
    local status="$3"
    local -n code_arr=$4
    local -n test_arr=$5
    local duration="$6"

    local summary_file="$output_dir/summary.json"
    local collected_at
    collected_at="$(date -Iseconds)"

    local ready_for_judging="false"
    if [[ "$status" == "complete" ]]; then
        ready_for_judging="true"
    fi

    # Build code files JSON array
    local code_json="[]"
    if [[ ${#code_arr[@]} -gt 0 ]]; then
        code_json="["
        local first=true
        for f in "${code_arr[@]}"; do
            if [[ "$first" == "true" ]]; then
                first=false
            else
                code_json+=","
            fi
            code_json+="\"$f\""
        done
        code_json+="]"
    fi

    # Build test files JSON array
    local test_json="[]"
    if [[ ${#test_arr[@]} -gt 0 ]]; then
        test_json="["
        local first=true
        for f in "${test_arr[@]}"; do
            if [[ "$first" == "true" ]]; then
                first=false
            else
                test_json+=","
            fi
            test_json+="\"$f\""
        done
        test_json+="]"
    fi

    cat > "$summary_file" <<EOF
{
  "session_id": "$session_id",
  "collected_at": "$collected_at",
  "status": "$status",
  "files": {
    "code": $code_json,
    "tests": $test_json
  },
  "session_duration": $duration,
  "ready_for_judging": $ready_for_judging
}
EOF

    log_debug "Created summary at: $summary_file"
}

# Teleport remote session and extract files
# Args: session_id output_dir
teleport_and_extract() {
    local session_id="$1"
    local output_dir="$2"

    log_info "Teleporting remote session: $session_id"

    # Check if claude CLI is available
    if ! command -v claude &>/dev/null; then
        log_error "claude CLI not found. Required for teleporting remote sessions."
        return 1
    fi

    local temp_dir
    temp_dir="$(mktemp -d)"

    # Teleport session to extract workspace
    if ! claude --teleport "$session_id" \
            --extract "$temp_dir" \
            2>/dev/null; then
        log_error "Failed to teleport session: $session_id"
        rm -rf "$temp_dir"
        return 1
    fi

    # Extract session log
    claude --teleport "$session_id" \
        --format jsonl \
        > "$output_dir/session.jsonl" \
        2>/dev/null || true

    # Move extracted files
    if [[ -d "$temp_dir" ]]; then
        mkdir -p "$output_dir/workspace"
        cp -r "$temp_dir/"* "$output_dir/workspace/" 2>/dev/null || true
    fi

    rm -rf "$temp_dir"
    return 0
}

# Collect from local session directory
# Args: session_id source_dir output_dir
collect_local_session() {
    local session_id="$1"
    local source_dir="$2"
    local output_dir="$3"

    local session_source="$source_dir/$session_id"

    if [[ ! -d "$session_source" ]]; then
        log_error "Session directory not found: $session_source"
        return 1
    fi

    log_info "Collecting from local session: $session_id"

    # Create output directory structure
    mkdir -p "$output_dir"

    # Copy session.jsonl if exists
    if [[ -f "$session_source/session.jsonl" ]]; then
        cp "$session_source/session.jsonl" "$output_dir/"
    fi

    # Copy or create metadata.json
    if [[ -f "$session_source/metadata.json" ]]; then
        cp "$session_source/metadata.json" "$output_dir/"
    else
        # Create minimal metadata
        cat > "$output_dir/metadata.json" <<EOF
{
  "session_id": "$session_id",
  "collected_at": "$(date -Iseconds)"
}
EOF
    fi

    # Determine workspace location
    local workspace=""
    if [[ -d "$session_source/workspace" ]]; then
        workspace="$session_source/workspace"
    elif [[ -d "$session_source" ]]; then
        workspace="$session_source"
    fi

    echo "$workspace"
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --source-dir)
            SOURCE_DIR="$2"
            shift 2
            ;;
        --timeout)
            validate_numeric "$2" "Timeout"
            TIMEOUT="$2"
            shift 2
            ;;
        --poll-interval)
            validate_numeric "$2" "Poll interval"
            POLL_INTERVAL="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --patterns)
            PATTERNS="$2"
            shift 2
            ;;
        --keep-session)
            KEEP_SESSION=true
            shift
            ;;
        --quiet)
            QUIET=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
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
            if [[ -z "$SESSION_ID" ]]; then
                SESSION_ID="$1"
            else
                log_error "Multiple session IDs provided. Only one session ID allowed."
                exit 1
            fi
            shift
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

if [[ -z "$SESSION_ID" ]]; then
    log_error "Session ID is required."
    echo "Use --help for usage information" >&2
    exit 1
fi

# Validate session ID format for security
if ! validate_session_id "$SESSION_ID"; then
    log_error "Invalid session ID format: $SESSION_ID"
    log_error "Session ID must be UUID, session_xxx, or alphanumeric with - and _"
    exit 1
fi

# Detect session format
SESSION_FORMAT=$(detect_session_format "$SESSION_ID")
log_debug "Session format detected: $SESSION_FORMAT"

# -----------------------------------------------------------------------------
# Dry Run Mode
# -----------------------------------------------------------------------------

if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN MODE ==="
    echo "Session ID: $SESSION_ID"
    echo "Session Format: $SESSION_FORMAT"
    echo "Source Dir: $SOURCE_DIR"
    echo "Output Dir: $OUTPUT_DIR"
    echo "Timeout: ${TIMEOUT}s"
    echo "Poll Interval: ${POLL_INTERVAL}s"
    echo "Force: $FORCE"
    echo "Patterns: $PATTERNS"
    echo "Keep Session: $KEEP_SESSION"
    echo ""
    if [[ "$SESSION_FORMAT" == "local" ]]; then
        echo "Would collect from: $SOURCE_DIR/$SESSION_ID"
    else
        echo "Would teleport remote session: $SESSION_ID"
    fi
    echo "Would create: $OUTPUT_DIR/$SESSION_ID/"
    echo "  - code/"
    echo "  - tests/"
    echo "  - session.jsonl"
    echo "  - metadata.json"
    echo "  - summary.json"
    exit 0
fi

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

SESSION_OUTPUT_DIR="$OUTPUT_DIR/$SESSION_ID"
mkdir -p "$SESSION_OUTPUT_DIR"

log_info "Collecting results for session: $SESSION_ID"

# Variables to track collection
COLLECTION_STATUS="complete"
WORKSPACE_DIR=""
declare -a COLLECTED_CODE_FILES=()
declare -a COLLECTED_TEST_FILES=()

# Handle based on session format
if [[ "$SESSION_FORMAT" == "remote" ]]; then
    # Remote session - use teleport
    if ! teleport_and_extract "$SESSION_ID" "$SESSION_OUTPUT_DIR"; then
        if [[ "$FORCE" == "true" ]]; then
            COLLECTION_STATUS="incomplete"
            log_info "Force collecting partial results"
        else
            log_error "Failed to collect remote session"
            exit 1
        fi
    fi
    WORKSPACE_DIR="$SESSION_OUTPUT_DIR/workspace"
else
    # Local session - collect from source directory
    WORKSPACE_DIR=$(collect_local_session "$SESSION_ID" "$SOURCE_DIR" "$SESSION_OUTPUT_DIR")

    if [[ -z "$WORKSPACE_DIR" || ! -d "$WORKSPACE_DIR" ]]; then
        log_error "Workspace not found for session: $SESSION_ID"
        exit 1
    fi

    # Check completion status
    if ! is_session_complete "$SOURCE_DIR/$SESSION_ID"; then
        if [[ "$FORCE" == "true" ]]; then
            COLLECTION_STATUS="incomplete"
            log_info "Force collecting partial results (session incomplete)"
        else
            log_info "Session not complete, waiting..."
            if ! wait_for_completion "$SOURCE_DIR/$SESSION_ID" "$TIMEOUT" "$POLL_INTERVAL"; then
                log_error "Session did not complete within timeout"
                COLLECTION_STATUS="timeout"
            fi
        fi
    fi
fi

# Extract files from workspace
if [[ -d "$WORKSPACE_DIR" ]]; then
    log_info "Extracting files from workspace: $WORKSPACE_DIR"

    # Create output directories
    mkdir -p "$SESSION_OUTPUT_DIR/code" "$SESSION_OUTPUT_DIR/tests"

    # Split patterns and extract files
    IFS=',' read -ra PATTERN_ARRAY <<< "$PATTERNS"

    # Track total file count for limit enforcement
    FILE_COUNT=0
    FILE_LIMIT_REACHED=false

    for pattern in "${PATTERN_ARRAY[@]}"; do
        pattern=$(echo "$pattern" | xargs)

        # Check if we've hit the file limit
        if [[ "$FILE_LIMIT_REACHED" == "true" ]]; then
            break
        fi

        while IFS= read -r -d '' file; do
            # Check file count limit
            if [[ $FILE_COUNT -ge $MAX_FILES ]]; then
                log_info "Warning: Maximum file limit ($MAX_FILES) reached, some files may be skipped"
                FILE_LIMIT_REACHED=true
                break
            fi

            relative_path="${file#$WORKSPACE_DIR/}"
            filename="$(basename "$file")"
            file_dirname="$(dirname "$relative_path")"

            # Determine if it's a test file
            if [[ "$filename" == test_* ]] || \
               [[ "$filename" == *_test.* ]] || \
               [[ "$filename" == *.test.* ]] || \
               [[ "$filename" == *_spec.* ]] || \
               [[ "$file_dirname" == *test* ]] || \
               [[ "$file_dirname" == *spec* ]]; then
                # Copy to tests directory
                dest_path="$SESSION_OUTPUT_DIR/tests/$relative_path"
                mkdir -p "$(dirname "$dest_path")"
                cp "$file" "$dest_path"
                COLLECTED_TEST_FILES+=("$relative_path")
                log_debug "Extracted test: $relative_path"
            else
                # Copy to code directory
                dest_path="$SESSION_OUTPUT_DIR/code/$relative_path"
                mkdir -p "$(dirname "$dest_path")"
                cp "$file" "$dest_path"
                COLLECTED_CODE_FILES+=("$relative_path")
                log_debug "Extracted code: $relative_path"
            fi

            FILE_COUNT=$((FILE_COUNT + 1))
        done < <(find "$WORKSPACE_DIR" -type f -name "$pattern" \
             -size "-${MAX_FILE_SIZE}" \
             ! -type l \
             -print0 2>/dev/null | head -z -n "$MAX_FILES")
    done
fi

# Calculate session duration
SESSION_DURATION=$(calculate_duration "$SESSION_OUTPUT_DIR/metadata.json")

# Create summary
create_summary \
    "$SESSION_OUTPUT_DIR" \
    "$SESSION_ID" \
    "$COLLECTION_STATUS" \
    COLLECTED_CODE_FILES \
    COLLECTED_TEST_FILES \
    "$SESSION_DURATION"

# Report results
log_info "Collection complete: $SESSION_OUTPUT_DIR"
log_info "  Status: $COLLECTION_STATUS"
log_info "  Code files: ${#COLLECTED_CODE_FILES[@]}"
log_info "  Test files: ${#COLLECTED_TEST_FILES[@]}"
log_info "  Duration: ${SESSION_DURATION}s"

# Output session ID for downstream processing
echo "$SESSION_ID"

exit 0
