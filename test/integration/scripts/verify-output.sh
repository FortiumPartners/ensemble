#!/bin/bash
# =============================================================================
# verify-output.sh - Session output verification utilities
# =============================================================================
# Task: TRD-TEST-030
# Purpose: Verify tool invocations, file creation, and parse session logs
#          from Claude Code headless sessions.
#
# Usage:
#   ./verify-output.sh check_tool_invoked <session_file> <tool_name>
#   ./verify-output.sh check_file_created <session_file> <file_path>
#   ./verify-output.sh extract_tool_results <session_file> <tool_name>
#   ./verify-output.sh count_tool_calls <session_file> <tool_name>
#   ./verify-output.sh list_all_tools <session_file>
#   ./verify-output.sh get_final_response <session_file>
#
# Dependencies:
#   - jq (required for JSON parsing)
#
# Exit Codes:
#   0 - Check passed / data extracted successfully
#   1 - Check failed / tool not found / error
#   2 - Invalid arguments or missing dependencies
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
    echo "[INFO] $*" >&2
}

log_error() {
    echo "[ERROR] $*" >&2
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
# Core Verification Functions
# -----------------------------------------------------------------------------

# Check if a specific tool was invoked during the session
# Usage: check_tool_invoked <session_file> <tool_name>
# Returns: 0 if tool was invoked, 1 if not
check_tool_invoked() {
    local session_file="$1"
    local tool_name="$2"

    validate_session_file "$session_file"

    if [[ -z "$tool_name" ]]; then
        log_error "Tool name is required"
        exit 2
    fi

    # Look for tool invocations in JSONL output
    # Claude Code JSONL format includes tool calls with a "type" field
    local count
    count=$(jq -r --arg tool "$tool_name" '
        select(.type == "tool_use" or .type == "tool_call" or .tool_name != null) |
        select(.name == $tool or .tool_name == $tool or .tool == $tool)
    ' "$session_file" 2>/dev/null | wc -l)

    # Also check for tool invocations in assistant messages
    if [[ "$count" -eq 0 ]]; then
        count=$(jq -r --arg tool "$tool_name" '
            select(.type == "assistant") |
            .content[]? |
            select(.type == "tool_use") |
            select(.name == $tool)
        ' "$session_file" 2>/dev/null | wc -l)
    fi

    # Fallback: grep for tool name in the raw output
    if [[ "$count" -eq 0 ]]; then
        if grep -q "\"name\":\"$tool_name\"" "$session_file" 2>/dev/null || \
           grep -q "\"tool\":\"$tool_name\"" "$session_file" 2>/dev/null || \
           grep -q "\"tool_name\":\"$tool_name\"" "$session_file" 2>/dev/null; then
            count=1
        fi
    fi

    if [[ "$count" -gt 0 ]]; then
        log_info "Tool '$tool_name' was invoked ($count invocations found)"
        return 0
    else
        log_info "Tool '$tool_name' was NOT invoked"
        return 1
    fi
}

# Check if a file was created during the session
# Usage: check_file_created <session_file> <file_path>
# Returns: 0 if file creation was detected, 1 if not
check_file_created() {
    local session_file="$1"
    local file_path="$2"

    validate_session_file "$session_file"

    if [[ -z "$file_path" ]]; then
        log_error "File path is required"
        exit 2
    fi

    # Look for Write tool invocations with the specified file path
    local found
    found=$(jq -r --arg path "$file_path" '
        select(.type == "tool_use" or .type == "tool_call") |
        select(.name == "Write" or .tool_name == "Write") |
        .input.file_path // .arguments.file_path // .input.path // empty |
        select(. == $path or endswith($path) or contains($path))
    ' "$session_file" 2>/dev/null | head -1)

    # Also check for file_path in tool results
    if [[ -z "$found" ]]; then
        if grep -q "\"file_path\":\"[^\"]*$file_path" "$session_file" 2>/dev/null; then
            found="$file_path"
        fi
    fi

    # Check for successful file creation messages
    if [[ -z "$found" ]]; then
        if grep -q "File created successfully.*$file_path" "$session_file" 2>/dev/null || \
           grep -q "created.*$file_path" "$session_file" 2>/dev/null; then
            found="$file_path"
        fi
    fi

    if [[ -n "$found" ]]; then
        log_info "File creation detected: $file_path"
        return 0
    else
        log_info "File creation NOT detected: $file_path"
        return 1
    fi
}

# Extract tool results for a specific tool
# Usage: extract_tool_results <session_file> <tool_name>
# Returns: JSON array of tool results
extract_tool_results() {
    local session_file="$1"
    local tool_name="$2"

    validate_session_file "$session_file"

    if [[ -z "$tool_name" ]]; then
        log_error "Tool name is required"
        exit 2
    fi

    # Extract tool results from JSONL
    # Try multiple formats since Claude Code output may vary
    local results
    results=$(jq -c --arg tool "$tool_name" '
        select(
            (.type == "tool_result" and .tool_name == $tool) or
            (.type == "tool_use" and .name == $tool) or
            (.name == $tool and .output != null)
        ) |
        {
            tool: (.name // .tool_name // $tool),
            input: (.input // .arguments // {}),
            output: (.output // .result // .content // null),
            success: (.success // (.error == null))
        }
    ' "$session_file" 2>/dev/null)

    if [[ -n "$results" ]]; then
        echo "$results"
    else
        # Fallback: search for tool-related entries and format them
        jq -c --arg tool "$tool_name" '
            select(
                .name == $tool or
                .tool_name == $tool or
                (.type == "assistant" and (.content[]? | .name? == $tool))
            )
        ' "$session_file" 2>/dev/null || echo "[]"
    fi
}

# Count the number of times a tool was called
# Usage: count_tool_calls <session_file> <tool_name>
# Returns: Count as integer
count_tool_calls() {
    local session_file="$1"
    local tool_name="$2"

    validate_session_file "$session_file"

    if [[ -z "$tool_name" ]]; then
        log_error "Tool name is required"
        exit 2
    fi

    local count
    count=$(jq --arg tool "$tool_name" '
        select(
            (.type == "tool_use" and .name == $tool) or
            (.type == "tool_call" and .name == $tool) or
            .tool_name == $tool
        )
    ' "$session_file" 2>/dev/null | jq -s 'length')

    # Fallback to grep count
    if [[ "$count" -eq 0 ]]; then
        count=$(grep -c "\"name\":\"$tool_name\"" "$session_file" 2>/dev/null || echo "0")
    fi

    echo "$count"
}

# List all tools that were invoked during the session
# Usage: list_all_tools <session_file>
# Returns: Newline-separated list of tool names
list_all_tools() {
    local session_file="$1"

    validate_session_file "$session_file"

    # Extract unique tool names from various formats
    jq -r '
        (select(.type == "tool_use") | .name) //
        (select(.type == "tool_call") | .name) //
        (.tool_name // empty)
    ' "$session_file" 2>/dev/null | sort -u | grep -v '^$'
}

# Get the final response text from the session
# Usage: get_final_response <session_file>
# Returns: Final text response
get_final_response() {
    local session_file="$1"

    validate_session_file "$session_file"

    # Try to get the last assistant message text
    local response
    response=$(jq -r '
        select(.type == "assistant" or .role == "assistant") |
        if .content | type == "array" then
            .content[] | select(.type == "text") | .text
        else
            .content // empty
        end
    ' "$session_file" 2>/dev/null | tail -1)

    if [[ -n "$response" ]]; then
        echo "$response"
    else
        # Fallback: get last non-empty text content
        jq -r '.text // .content // empty' "$session_file" 2>/dev/null | tail -1
    fi
}

# Check if session completed successfully
# Usage: check_session_success <session_file>
# Returns: 0 if successful, 1 if errors detected
check_session_success() {
    local session_file="$1"

    validate_session_file "$session_file"

    # Check for error indicators
    if grep -qi '"error":\s*"[^"]*"' "$session_file" 2>/dev/null || \
       grep -qi '"status":\s*"failed"' "$session_file" 2>/dev/null || \
       grep -qi '"success":\s*false' "$session_file" 2>/dev/null; then
        log_info "Session contains errors"
        return 1
    fi

    log_info "Session completed without detected errors"
    return 0
}

# Extract specific field from session output
# Usage: extract_field <session_file> <jq_filter>
# Returns: Extracted value(s)
extract_field() {
    local session_file="$1"
    local filter="$2"

    validate_session_file "$session_file"

    if [[ -z "$filter" ]]; then
        log_error "JQ filter is required"
        exit 2
    fi

    jq -r "$filter" "$session_file" 2>/dev/null
}

# Get session metadata (if available)
# Usage: get_session_metadata <session_file>
# Returns: JSON object with session metadata
get_session_metadata() {
    local session_file="$1"

    validate_session_file "$session_file"

    # Extract metadata from first few lines (usually contains session info)
    jq -s '
        [.[] | select(.type == "session" or .session_id != null or .metadata != null)] |
        first // {info: "No explicit metadata found"}
    ' "$session_file" 2>/dev/null
}

# -----------------------------------------------------------------------------
# Help / Usage
# -----------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") <command> [arguments]

Session output verification utilities for Claude Code headless testing.

Commands:
    check_tool_invoked <session_file> <tool_name>
        Check if a specific tool was invoked during the session.
        Exit code 0 if invoked, 1 if not.

    check_file_created <session_file> <file_path>
        Check if a file creation was detected for the given path.
        Exit code 0 if detected, 1 if not.

    extract_tool_results <session_file> <tool_name>
        Extract all results from invocations of the specified tool.
        Outputs JSON objects, one per line.

    count_tool_calls <session_file> <tool_name>
        Count the number of times a tool was called.
        Outputs a single integer.

    list_all_tools <session_file>
        List all unique tools that were invoked during the session.
        Outputs tool names, one per line.

    get_final_response <session_file>
        Get the final text response from the session.

    check_session_success <session_file>
        Check if the session completed without errors.
        Exit code 0 if successful, 1 if errors detected.

    extract_field <session_file> <jq_filter>
        Extract specific fields using a custom jq filter.

    get_session_metadata <session_file>
        Extract session metadata if available.

Examples:
    $(basename "$0") check_tool_invoked session.jsonl Write
    $(basename "$0") check_file_created session.jsonl src/main.py
    $(basename "$0") extract_tool_results session.jsonl Read
    $(basename "$0") list_all_tools session.jsonl
    $(basename "$0") extract_field session.jsonl '.[] | select(.type=="text")'

Exit Codes:
    0 - Success / Check passed
    1 - Failure / Check failed
    2 - Invalid arguments or missing dependencies
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
    check_tool_invoked)
        check_tool_invoked "$@"
        ;;
    check_file_created)
        check_file_created "$@"
        ;;
    extract_tool_results)
        extract_tool_results "$@"
        ;;
    count_tool_calls)
        count_tool_calls "$@"
        ;;
    list_all_tools)
        list_all_tools "$@"
        ;;
    get_final_response)
        get_final_response "$@"
        ;;
    check_session_success)
        check_session_success "$@"
        ;;
    extract_field)
        extract_field "$@"
        ;;
    get_session_metadata)
        get_session_metadata "$@"
        ;;
    --help|-h|help)
        usage
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        usage
        ;;
esac
