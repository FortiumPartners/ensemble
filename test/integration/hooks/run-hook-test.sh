#!/bin/bash
# =============================================================================
# run-hook-test.sh - Run Claude CLI sessions with hooks enabled for testing
# =============================================================================
# Task: TRD-TEST-093
# Purpose: Wrapper script for running Claude sessions with hooks enabled,
#          capturing session logs for hook event analysis.
#
# Usage:
#   ./run-hook-test.sh "Your prompt here"
#   ./run-hook-test.sh "Your prompt here" --hook wiggum
#   ./run-hook-test.sh "Your prompt here" --hook all --timeout 300
#
# Arguments:
#   prompt              The prompt to send to Claude (required)
#
# Options:
#   --hook NAME         Specify which hook(s) to test. Options:
#                         all      - All hooks enabled (default)
#                         wiggum   - Test wiggum.js (Stop event)
#                         status   - Test status.js (SubagentStop event)
#                         formatter - Test formatter.sh (PostToolUse event)
#                         learning - Test learning.sh (SessionEnd event)
#   --timeout SECONDS   Timeout for the session (default: 300)
#   --session-id UUID   Use a specific session ID (default: auto-generated)
#   --output-dir DIR    Output directory for session logs (default: ../sessions)
#   --quiet             Suppress informational output
#   --debug             Enable verbose debugging
#   --help              Show this help message
#
# Environment Variables:
#   CLAUDE_CODE_ENABLE_TELEMETRY - Enables telemetry (set to 1)
#   OTEL_ENDPOINT                - OTLP endpoint (default: http://localhost:4317)
#   SESSION_DIR                  - Output directory (default: ../sessions)
#   CLAUDE_PLUGIN_ROOT           - Path to hooks directory
#
# Output:
#   - Session UUID printed to stdout
#   - Streaming JSON session log saved to sessions/hook-test-<UUID>.jsonl
#   - Exit code 0 on success, non-zero on failure
#
# Hook Events Captured:
#   - PreToolUse       - Before tool execution
#   - PostToolUse      - After tool execution (formatter.sh)
#   - UserPromptSubmit - User prompt submission
#   - Notification     - System notifications
#   - Stop             - Session end attempt (wiggum.js)
#   - SubagentStop     - Subagent completion (status.js)
#   - SessionEnd       - Session termination (learning.sh)
#
# Dependencies:
#   - TRD-TEST-029 (run-headless.sh) for base patterns
#   - claude CLI installed and available in PATH
#   - uuidgen command available
#   - jq for JSON parsing (optional, for post-processing)
#
# Examples:
#   # Run with all hooks enabled
#   ./run-hook-test.sh "Create a simple Python function"
#
#   # Test specific hook
#   ./run-hook-test.sh "Edit test.py" --hook formatter
#
#   # Test wiggum with custom timeout
#   ./run-hook-test.sh "/implement-trd" --hook wiggum --timeout 600
#
#   # Debug mode for troubleshooting
#   ./run-hook-test.sh "Test prompt" --debug
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

# Script directory for relative paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Session output directory (default to sibling sessions directory)
SESSION_DIR="${SESSION_DIR:-${SCRIPT_DIR}/../sessions}"

# Default timeout in seconds (5 minutes)
DEFAULT_TIMEOUT=300

# Default hook to test
DEFAULT_HOOK="all"

# Project root detection (for finding hooks)
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"

# Path to hooks directory
HOOKS_DIR="${CLAUDE_PLUGIN_ROOT:-${PROJECT_ROOT}/packages/core/hooks}"

# -----------------------------------------------------------------------------
# OpenTelemetry Environment Setup
# -----------------------------------------------------------------------------

# Load .env file from test/ directory if it exists
ENV_FILE="${SCRIPT_DIR}/../../.env"
if [[ -f "$ENV_FILE" ]]; then
    # Export all variables from .env file (skip comments and empty lines)
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE"
    set +a
fi

# Only enable telemetry if OTEL endpoint is explicitly configured
# This prevents errors when no collector is running
if [[ -n "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ]]; then
    export CLAUDE_CODE_ENABLE_TELEMETRY="${CLAUDE_CODE_ENABLE_TELEMETRY:-1}"
    export OTEL_EXPORTER_OTLP_PROTOCOL="${OTEL_EXPORTER_OTLP_PROTOCOL:-http/protobuf}"
    export OTEL_METRICS_EXPORTER="${OTEL_METRICS_EXPORTER:-otlp}"
    export OTEL_LOGS_EXPORTER="${OTEL_LOGS_EXPORTER:-otlp}"
    export OTEL_EXPORTER_OTLP_HEADERS="${OTEL_EXPORTER_OTLP_HEADERS:-}"
    export OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-ensemble-hook-test}"
    export OTEL_RESOURCE_ATTRIBUTES="${OTEL_RESOURCE_ATTRIBUTES:-service.version=1.0.0,test.type=hook-integration}"
else
    # Disable telemetry if no endpoint configured
    export CLAUDE_CODE_ENABLE_TELEMETRY=0
fi

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") <prompt> [options]

Run Claude CLI sessions with hooks enabled for integration testing.

Arguments:
    prompt              The prompt to send to Claude (required)

Options:
    --hook NAME         Which hook(s) to test:
                          all       - All hooks enabled (default)
                          wiggum    - Test wiggum.js (Stop event)
                          status    - Test status.js (SubagentStop event)
                          formatter - Test formatter.sh (PostToolUse event)
                          learning  - Test learning.sh (SessionEnd event)
    --timeout SECONDS   Timeout for the session (default: ${DEFAULT_TIMEOUT})
    --session-id UUID   Use a specific session ID (default: auto-generated)
    --output-dir DIR    Output directory for session logs (default: ../sessions)
    --quiet             Suppress informational output
    --debug             Enable verbose debugging
    --help              Show this help message

Hook Events:
    PreToolUse       - Before tool execution
    PostToolUse      - After tool execution (triggers formatter.sh)
    UserPromptSubmit - User prompt submission
    Notification     - System notifications
    Stop             - Session end attempt (triggers wiggum.js)
    SubagentStop     - Subagent completion (triggers status.js)
    SessionEnd       - Session termination (triggers learning.sh)

Examples:
    $(basename "$0") "Create a simple Python function"
    $(basename "$0") "Edit test.py" --hook formatter
    $(basename "$0") "/implement-trd" --hook wiggum --timeout 600

Environment Variables:
    OTEL_ENDPOINT         OpenTelemetry collector endpoint
    SESSION_DIR           Default output directory for sessions
    CLAUDE_PLUGIN_ROOT    Path to hooks directory (for isolated testing)
EOF
    exit 0
}

log_info() {
    if [[ "${QUIET:-false}" != "true" ]]; then
        echo "[INFO] $*" >&2
    fi
}

log_debug() {
    if [[ "${DEBUG:-false}" == "true" ]]; then
        echo "[DEBUG] $*" >&2
    fi
}

log_error() {
    echo "[ERROR] $*" >&2
}

generate_uuid() {
    # Try multiple methods for UUID generation
    if command -v uuidgen &>/dev/null; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    elif [[ -f /proc/sys/kernel/random/uuid ]]; then
        cat /proc/sys/kernel/random/uuid
    elif command -v python3 &>/dev/null; then
        python3 -c "import uuid; print(uuid.uuid4())"
    else
        # Fallback: generate a pseudo-UUID from /dev/urandom
        od -x /dev/urandom | head -1 | awk '{OFS="-"; print $2$3,$4,$5,$6,$7$8$9}'
    fi
}

validate_claude_cli() {
    if ! command -v claude &>/dev/null; then
        log_error "Claude CLI not found in PATH"
        log_error "Please install Claude Code CLI: https://docs.anthropic.com/claude-code"
        exit 1
    fi
}

validate_hooks_directory() {
    if [[ ! -d "$HOOKS_DIR" ]]; then
        log_error "Hooks directory not found: $HOOKS_DIR"
        log_error "Set CLAUDE_PLUGIN_ROOT or ensure hooks exist at expected path"
        exit 1
    fi
    log_debug "Hooks directory: $HOOKS_DIR"
}

validate_hook_exists() {
    local hook_name="$1"
    local hook_file=""

    case "$hook_name" in
        wiggum)   hook_file="$HOOKS_DIR/wiggum.js" ;;
        status)   hook_file="$HOOKS_DIR/status.js" ;;
        formatter) hook_file="$HOOKS_DIR/formatter.sh" ;;
        learning) hook_file="$HOOKS_DIR/learning.sh" ;;
        all)      return 0 ;;  # All hooks - check individually
        *)
            log_error "Unknown hook: $hook_name"
            log_error "Valid hooks: all, wiggum, status, formatter, learning"
            exit 1
            ;;
    esac

    if [[ -n "$hook_file" ]] && [[ ! -f "$hook_file" ]]; then
        log_error "Hook file not found: $hook_file"
        exit 1
    fi

    log_debug "Hook validated: $hook_name -> $hook_file"
}

get_hook_event() {
    # Return the hook event type for a given hook name
    local hook_name="$1"
    case "$hook_name" in
        wiggum)   echo "Stop" ;;
        status)   echo "SubagentStop" ;;
        formatter) echo "PostToolUse" ;;
        learning) echo "SessionEnd" ;;
        all)      echo "all" ;;
        *)        echo "unknown" ;;
    esac
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

PROMPT=""
TIMEOUT="${DEFAULT_TIMEOUT}"
CUSTOM_SESSION_ID=""
QUIET="false"
DEBUG="false"
HOOK="${DEFAULT_HOOK}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --hook)
            HOOK="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --session-id)
            CUSTOM_SESSION_ID="$2"
            shift 2
            ;;
        --output-dir)
            SESSION_DIR="$2"
            shift 2
            ;;
        --quiet)
            QUIET="true"
            shift
            ;;
        --debug)
            DEBUG="true"
            shift
            ;;
        --help|-h)
            usage
            ;;
        -*)
            log_error "Unknown option: $1"
            usage
            ;;
        *)
            if [[ -z "$PROMPT" ]]; then
                PROMPT="$1"
            else
                log_error "Multiple prompts provided. Use quotes for multi-word prompts."
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate required arguments
if [[ -z "$PROMPT" ]]; then
    log_error "Prompt is required"
    usage
fi

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

# Validate prerequisites
validate_claude_cli
validate_hooks_directory
validate_hook_exists "$HOOK"

# Generate or use provided session ID
if [[ -n "$CUSTOM_SESSION_ID" ]]; then
    UUID="$CUSTOM_SESSION_ID"
else
    UUID="$(generate_uuid)"
fi

# Create sessions directory if it doesn't exist
mkdir -p "$SESSION_DIR"

# Define output file path with hook-test prefix for easy identification
SESSION_FILE="${SESSION_DIR}/hook-test-${UUID}.jsonl"

# Get hook event type for logging
HOOK_EVENT=$(get_hook_event "$HOOK")

log_info "Starting hook integration test session"
log_info "  Session ID: ${UUID}"
log_info "  Hook: ${HOOK} (event: ${HOOK_EVENT})"
log_info "  Output: ${SESSION_FILE}"
log_info "  Timeout: ${TIMEOUT}s"
log_info "  Telemetry: enabled (OTLP: ${OTEL_EXPORTER_OTLP_ENDPOINT})"

log_debug "  Hooks directory: ${HOOKS_DIR}"
log_debug "  Project root: ${PROJECT_ROOT}"

# Set up hook-specific environment variables
export CLAUDE_PLUGIN_ROOT="$HOOKS_DIR"

# For wiggum testing, we may want to set specific environment variables
if [[ "$HOOK" == "wiggum" || "$HOOK" == "all" ]]; then
    # Don't enable WIGGUM_ACTIVE by default - it should only be enabled
    # by /implement-trd command. But we can enable debug mode.
    export WIGGUM_DEBUG="${WIGGUM_DEBUG:-0}"
    log_debug "  WIGGUM_DEBUG: ${WIGGUM_DEBUG}"
fi

# Trust boundary: PROMPT comes from test scripts, not untrusted user input
# The --print flag and quoted variable provide protection, but callers
# should ensure prompts don't contain shell metacharacters if sourced externally

# Execute Claude CLI in headless mode with hooks enabled
# --print: Non-interactive mode (required for headless execution)
# --permission-mode bypassPermissions: Skip permission prompts for automated testing
# --output-format stream-json: Streaming JSON output for hook event analysis
# --session-id: Track this specific session
# Prompt is passed as positional argument at the end
set +e
timeout "${TIMEOUT}" claude \
    --print \
    --session-id "$UUID" \
    --permission-mode bypassPermissions \
    --output-format stream-json \
    "$PROMPT" \
    > "$SESSION_FILE" 2>&1

EXIT_CODE=$?
set -e

# Handle exit codes
if [[ $EXIT_CODE -eq 124 ]]; then
    log_error "Session timed out after ${TIMEOUT} seconds"
    echo "$UUID"
    exit 124
elif [[ $EXIT_CODE -ne 0 ]]; then
    log_error "Claude CLI exited with code ${EXIT_CODE}"
    if [[ -f "$SESSION_FILE" ]] && [[ -s "$SESSION_FILE" ]]; then
        log_info "Partial session output saved to: ${SESSION_FILE}"
    fi
    echo "$UUID"
    exit $EXIT_CODE
fi

# Log success with hook context
log_info "Hook integration test session completed successfully"
log_info "  Session log: ${SESSION_FILE}"

# Provide quick summary if session file exists and is not empty
if [[ -f "$SESSION_FILE" ]] && [[ -s "$SESSION_FILE" ]]; then
    LINE_COUNT=$(wc -l < "$SESSION_FILE")
    log_info "  Session lines: ${LINE_COUNT}"

    # Quick hook event detection (basic grep, proper parsing in TRD-TEST-094)
    if command -v grep &>/dev/null; then
        if grep -q '"hook"' "$SESSION_FILE" 2>/dev/null; then
            log_info "  Hook events detected in session log"
        fi
        if grep -q '"Stop"' "$SESSION_FILE" 2>/dev/null; then
            log_debug "  Stop event detected"
        fi
        if grep -q '"PostToolUse"' "$SESSION_FILE" 2>/dev/null; then
            log_debug "  PostToolUse event detected"
        fi
        if grep -q '"SubagentStop"' "$SESSION_FILE" 2>/dev/null; then
            log_debug "  SubagentStop event detected"
        fi
        if grep -q '"SessionEnd"' "$SESSION_FILE" 2>/dev/null; then
            log_debug "  SessionEnd event detected"
        fi
    fi
fi

# Output the session UUID for downstream processing
# This is used by parse-hook-events.js (TRD-TEST-094) and other scripts
echo "$UUID"
