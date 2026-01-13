#!/bin/bash
# =============================================================================
# verify-telemetry.sh - Telemetry event verification for Claude Code sessions
# =============================================================================
# Task: TRD-TEST-063
# Purpose: Verify telemetry data capture in headless Claude Code sessions.
#          Checks for expected OpenTelemetry event types in session logs.
#
# Usage:
#   ./verify-telemetry.sh <session_file>
#   ./verify-telemetry.sh <session_file> --report
#   ./verify-telemetry.sh <session_file> --check-event tool_result
#   ./verify-telemetry.sh list_event_types <session_file>
#   ./verify-telemetry.sh check_event <session_file> <event_type>
#   ./verify-telemetry.sh count_events <session_file> [event_type]
#   ./verify-telemetry.sh verify_all <session_file>
#
# Expected Event Types (per TRD):
#   - tool_result       : Tool completion with timing
#   - api_request       : API calls with token usage
#   - tool_decision     : Permission decisions
#
# Additional Event Types (discovered through analysis):
#   - tool_use          : Tool invocation
#   - assistant         : Assistant messages
#   - user              : User messages
#   - system            : System events
#
# Exit Codes:
#   0 - Verification passed / key events found
#   1 - Verification failed / events not found
#   2 - Invalid arguments or missing dependencies
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Expected telemetry event types per TRD Section 9.3
# These are the key events Claude Code emits with OpenTelemetry enabled
EXPECTED_EVENTS=(
    "tool_result"
    "api_request"
    "tool_decision"
)

# Additional common event types that may appear in session logs
COMMON_EVENTS=(
    "tool_use"
    "tool_call"
    "assistant"
    "user"
    "system"
    "text"
    "message"
)

# -----------------------------------------------------------------------------
# Dependency Checks
# -----------------------------------------------------------------------------

check_dependencies() {
    if ! command -v jq &>/dev/null; then
        echo "[ERROR] jq is required but not installed" >&2
        echo "Install with: apt-get install jq (Debian/Ubuntu)" >&2
        echo "          or: brew install jq (macOS)" >&2
        exit 2
    fi
}

# -----------------------------------------------------------------------------
# Utility Functions
# -----------------------------------------------------------------------------

log_info() {
    echo "[INFO] $*"
}

log_error() {
    echo "[ERROR] $*" >&2
}

log_success() {
    echo "[OK] $*"
}

log_warning() {
    echo "[WARN] $*"
}

validate_session_file() {
    local session_file="$1"

    if [[ -z "$session_file" ]]; then
        log_error "Session file path is required"
        exit 2
    fi

    if [[ ! -f "$session_file" ]]; then
        log_error "Session file not found: $session_file"
        exit 2
    fi

    if [[ ! -s "$session_file" ]]; then
        log_error "Session file is empty: $session_file"
        exit 1
    fi
}

# -----------------------------------------------------------------------------
# Core Telemetry Verification Functions
# -----------------------------------------------------------------------------

# Check if a specific event type exists in the session
# Usage: check_event <session_file> <event_type>
# Returns: 0 if event found, 1 if not
check_event() {
    local session_file="$1"
    local event_type="$2"

    validate_session_file "$session_file"

    if [[ -z "$event_type" ]]; then
        log_error "Event type is required"
        exit 2
    fi

    local count=0

    # Check for event type in various JSON formats
    # Format 1: {"type": "event_type", ...}
    count=$(jq -r --arg type "$event_type" '
        select(.type == $type)
    ' "$session_file" 2>/dev/null | wc -l)

    # Format 2: {"event": "event_type", ...}
    if [[ "$count" -eq 0 ]]; then
        count=$(jq -r --arg type "$event_type" '
            select(.event == $type)
        ' "$session_file" 2>/dev/null | wc -l)
    fi

    # Format 3: OpenTelemetry span/event format {"name": "claude_code.event_type", ...}
    if [[ "$count" -eq 0 ]]; then
        count=$(jq -r --arg type "claude_code.$event_type" '
            select(.name == $type or .spanName == $type)
        ' "$session_file" 2>/dev/null | wc -l)
    fi

    # Fallback: grep for the event type string
    if [[ "$count" -eq 0 ]]; then
        if grep -q "\"type\":\"$event_type\"" "$session_file" 2>/dev/null || \
           grep -q "\"event\":\"$event_type\"" "$session_file" 2>/dev/null || \
           grep -q "\"name\":\"claude_code.$event_type\"" "$session_file" 2>/dev/null || \
           grep -q "\"$event_type\"" "$session_file" 2>/dev/null; then
            count=1
        fi
    fi

    if [[ "$count" -gt 0 ]]; then
        return 0
    else
        return 1
    fi
}

# Count events of a specific type (or all events)
# Usage: count_events <session_file> [event_type]
# Returns: Event count as integer
count_events() {
    local session_file="$1"
    local event_type="${2:-}"

    validate_session_file "$session_file"

    if [[ -n "$event_type" ]]; then
        # Count specific event type
        local count=0

        # Primary: jq extraction
        count=$(jq --arg type "$event_type" '
            select(.type == $type or .event == $type or .name == ("claude_code." + $type))
        ' "$session_file" 2>/dev/null | jq -s 'length')

        # Fallback: grep count
        if [[ "$count" -eq 0 ]]; then
            count=$(grep -c "\"$event_type\"" "$session_file" 2>/dev/null || echo "0")
        fi

        echo "$count"
    else
        # Count all events (total lines in JSONL)
        wc -l < "$session_file" | tr -d ' '
    fi
}

# List all unique event types found in the session
# Usage: list_event_types <session_file>
# Returns: Newline-separated list of event types
list_event_types() {
    local session_file="$1"

    validate_session_file "$session_file"

    # Extract event types from multiple formats and deduplicate
    {
        # Format: {"type": "..."}
        jq -r '.type // empty' "$session_file" 2>/dev/null

        # Format: {"event": "..."}
        jq -r '.event // empty' "$session_file" 2>/dev/null

        # OpenTelemetry format: {"name": "claude_code.xxx"}
        jq -r '.name // empty | select(startswith("claude_code.")) | sub("claude_code."; "")' "$session_file" 2>/dev/null

        # Span name format
        jq -r '.spanName // empty | select(startswith("claude_code.")) | sub("claude_code."; "")' "$session_file" 2>/dev/null
    } | sort -u | grep -v '^$'
}

# Verify all expected telemetry events are captured
# Usage: verify_all <session_file>
# Returns: 0 if key events found, 1 if any missing
verify_all() {
    local session_file="$1"
    local found_count=0
    local missing_events=()

    validate_session_file "$session_file"

    log_info "Verifying telemetry events in: $session_file"
    log_info "Expected events: ${EXPECTED_EVENTS[*]}"
    echo ""

    # Check each expected event type
    for event_type in "${EXPECTED_EVENTS[@]}"; do
        if check_event "$session_file" "$event_type" 2>/dev/null; then
            local count
            count=$(count_events "$session_file" "$event_type")
            log_success "$event_type: found ($count occurrences)"
            found_count=$((found_count + 1))
        else
            log_warning "$event_type: NOT found"
            missing_events+=("$event_type")
        fi
    done

    echo ""

    # Also report on common event types found
    log_info "Common event types found:"
    for event_type in "${COMMON_EVENTS[@]}"; do
        if check_event "$session_file" "$event_type" 2>/dev/null; then
            local count
            count=$(count_events "$session_file" "$event_type")
            echo "  - $event_type: $count"
        fi
    done

    # Report all discovered event types
    echo ""
    log_info "All event types in session:"
    list_event_types "$session_file" | while read -r type; do
        echo "  - $type"
    done

    echo ""

    # Summary
    local total_expected=${#EXPECTED_EVENTS[@]}

    if [[ ${#missing_events[@]} -eq 0 ]]; then
        log_success "All $total_expected expected telemetry events found"
        return 0
    elif [[ $found_count -gt 0 ]]; then
        log_warning "$found_count/$total_expected expected events found"
        log_warning "Missing: ${missing_events[*]}"
        # Partial success - some telemetry captured
        return 0
    else
        log_error "No expected telemetry events found"
        log_error "Ensure CLAUDE_CODE_ENABLE_TELEMETRY=1 was set during session"
        return 1
    fi
}

# Generate a detailed report of telemetry data
# Usage: generate_report <session_file>
# Outputs: Markdown-formatted report to stdout
generate_report() {
    local session_file="$1"

    validate_session_file "$session_file"

    local filename
    filename=$(basename "$session_file")
    local total_events
    total_events=$(count_events "$session_file")

    cat <<EOF
# Telemetry Verification Report

**Session File:** $filename
**Total Events:** $total_events

## Expected Telemetry Events

| Event Type | Status | Count |
|------------|--------|-------|
EOF

    for event_type in "${EXPECTED_EVENTS[@]}"; do
        local status="Not Found"
        local count="0"
        if check_event "$session_file" "$event_type"; then
            status="Found"
            count=$(count_events "$session_file" "$event_type")
        fi
        echo "| $event_type | $status | $count |"
    done

    cat <<EOF

## All Discovered Event Types

EOF

    list_event_types "$session_file" | while read -r type; do
        local count
        count=$(count_events "$session_file" "$type")
        echo "- **$type**: $count occurrences"
    done

    cat <<EOF

## Notes

- Events are captured when \`CLAUDE_CODE_ENABLE_TELEMETRY=1\` is set
- Event format may vary based on Claude Code version
- Some events may only appear with specific operations

### Event Type Reference

| Event | Description |
|-------|-------------|
| tool_result | Tool completion with timing |
| api_request | API calls with token usage |
| tool_decision | Permission decisions |
| tool_use | Tool invocation |
| assistant | Assistant messages |
| user | User messages |
EOF
}

# Extract telemetry data for a specific event type
# Usage: extract_events <session_file> <event_type>
# Returns: JSON array of matching events
extract_events() {
    local session_file="$1"
    local event_type="$2"

    validate_session_file "$session_file"

    if [[ -z "$event_type" ]]; then
        log_error "Event type is required"
        exit 2
    fi

    jq -c --arg type "$event_type" '
        select(
            .type == $type or
            .event == $type or
            .name == ("claude_code." + $type)
        )
    ' "$session_file" 2>/dev/null
}

# -----------------------------------------------------------------------------
# Help / Usage
# -----------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") <command> [arguments]

Telemetry verification utilities for Claude Code headless sessions.

Commands:
    verify_all <session_file>
        Verify all expected telemetry events are captured.
        Reports on tool_result, api_request, and tool_decision events.
        Exit code 0 if key events found, 1 if none found.

    check_event <session_file> <event_type>
        Check if a specific event type exists in the session.
        Exit code 0 if found, 1 if not.

    count_events <session_file> [event_type]
        Count events of a specific type (or all events if type omitted).
        Outputs a single integer.

    list_event_types <session_file>
        List all unique event types found in the session.
        Outputs event types, one per line.

    extract_events <session_file> <event_type>
        Extract all events of a specific type as JSON.
        Outputs JSON objects, one per line.

    generate_report <session_file>
        Generate a Markdown report of telemetry data.
        Outputs Markdown to stdout.

    --report <session_file>
        Shorthand for generate_report.

Options:
    --help, -h      Show this help message

Expected Telemetry Events (per TRD):
    tool_result     Tool completion with timing
    api_request     API calls with token usage
    tool_decision   Permission decisions

Examples:
    $(basename "$0") verify_all session.jsonl
    $(basename "$0") check_event session.jsonl tool_result
    $(basename "$0") count_events session.jsonl api_request
    $(basename "$0") list_event_types session.jsonl
    $(basename "$0") --report session.jsonl > report.md

Exit Codes:
    0 - Success / Events found
    1 - Failure / Events not found
    2 - Invalid arguments or missing dependencies

Environment:
    Telemetry is captured when CLAUDE_CODE_ENABLE_TELEMETRY=1 is set
    during the Claude Code session execution.
EOF
    exit 0
}

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------

check_dependencies

if [[ $# -lt 1 ]]; then
    usage
fi

COMMAND="$1"
shift

case "$COMMAND" in
    verify_all)
        verify_all "$@"
        ;;
    check_event)
        if check_event "$@"; then
            echo "Event found"
            exit 0
        else
            echo "Event not found"
            exit 1
        fi
        ;;
    count_events)
        count_events "$@"
        ;;
    list_event_types)
        list_event_types "$@"
        ;;
    extract_events)
        extract_events "$@"
        ;;
    generate_report|--report)
        generate_report "$@"
        ;;
    --help|-h|help)
        usage
        ;;
    *)
        # If first argument is a file, treat as verify_all
        if [[ -f "$COMMAND" ]]; then
            # Handle additional flags
            if [[ "${1:-}" == "--report" ]]; then
                generate_report "$COMMAND"
            elif [[ "${1:-}" == "--check-event" ]] && [[ -n "${2:-}" ]]; then
                if check_event "$COMMAND" "$2"; then
                    log_success "Event '$2' found"
                    exit 0
                else
                    log_error "Event '$2' not found"
                    exit 1
                fi
            else
                verify_all "$COMMAND"
            fi
        else
            log_error "Unknown command: $COMMAND"
            usage
        fi
        ;;
esac
