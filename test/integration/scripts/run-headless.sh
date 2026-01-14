#!/bin/bash
# =============================================================================
# run-headless.sh - Run Claude CLI in headless mode with OpenTelemetry
# =============================================================================
# Task: TRD-TEST-029
# Purpose: Execute Claude Code CLI in non-interactive headless mode with
#          OpenTelemetry tracing enabled for session verification.
#
# Usage:
#   ./run-headless.sh "Your prompt here"
#   ./run-headless.sh "Your prompt here" --timeout 300
#   ./run-headless.sh "Your prompt" --plugin-dir /path/to/plugin
#   OTEL_ENDPOINT=http://collector:4317 ./run-headless.sh "Your prompt"
#
# Environment Variables:
#   PLUGIN_DIR                   - Plugin directory (default: auto-detected from repo)
#   CLAUDE_CODE_ENABLE_TELEMETRY - Enables telemetry (set to 1)
#   OTEL_METRICS_EXPORTER        - Metrics exporter (default: console)
#   OTEL_LOGS_EXPORTER           - Logs exporter (default: console)
#   OTEL_ENDPOINT                - OTLP endpoint (default: http://localhost:4317)
#   SESSION_DIR                  - Output directory (default: ../sessions)
#
# Output:
#   - Session UUID printed to stdout
#   - JSONL session log saved to sessions/session-<UUID>.jsonl
#   - Exit code 0 on success, non-zero on failure
#
# Dependencies:
#   - claude CLI installed and available in PATH
#   - uuidgen command available (usually pre-installed on Linux/macOS)
#   - jq for JSON parsing (optional, for post-processing)
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

# Script directory for relative paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Repository root (for finding plugin directory)
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Plugin directory - defaults to packages/full in the repo
# This ensures tests use the local plugin, not any system-installed version
PLUGIN_DIR="${PLUGIN_DIR:-${REPO_ROOT}/packages/full}"

# Session output directory
SESSION_DIR="${SESSION_DIR:-${SCRIPT_DIR}/../sessions}"

# Default timeout in seconds (5 minutes)
DEFAULT_TIMEOUT=300

# -----------------------------------------------------------------------------
# OpenTelemetry Environment Setup
# -----------------------------------------------------------------------------

export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER="${OTEL_METRICS_EXPORTER:-console}"
export OTEL_LOGS_EXPORTER="${OTEL_LOGS_EXPORTER:-console}"
export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_ENDPOINT:-http://localhost:4317}"

# Additional OpenTelemetry settings for better observability
export OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-ensemble-vnext-test}"
export OTEL_RESOURCE_ATTRIBUTES="${OTEL_RESOURCE_ATTRIBUTES:-service.version=1.0.0}"

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") <prompt> [options]

Run Claude CLI in headless mode with OpenTelemetry tracing.
Uses local plugin directory to ensure tests run against development version.

Arguments:
    prompt              The prompt to send to Claude (required)

Options:
    --timeout SECONDS   Timeout for the session (default: ${DEFAULT_TIMEOUT})
    --session-id UUID   Use a specific session ID (default: auto-generated)
    --output-dir DIR    Output directory for session logs (default: ../sessions)
    --plugin-dir DIR    Plugin directory to use (default: repo's packages/full)
    --quiet             Suppress informational output
    --help              Show this help message

Examples:
    $(basename "$0") "Create a simple Python function"
    $(basename "$0") "/init-project" --timeout 600
    $(basename "$0") "Fix the bug in main.py" --plugin-dir /custom/plugin

Environment Variables:
    PLUGIN_DIR          Plugin directory (overrides default)
    OTEL_ENDPOINT       OpenTelemetry collector endpoint
    SESSION_DIR         Default output directory for sessions
EOF
    exit 0
}

log_info() {
    if [[ "${QUIET:-false}" != "true" ]]; then
        echo "[INFO] $*" >&2
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

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

PROMPT=""
TIMEOUT="${DEFAULT_TIMEOUT}"
CUSTOM_SESSION_ID=""
QUIET="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
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
        --plugin-dir)
            PLUGIN_DIR="$2"
            shift 2
            ;;
        --quiet)
            QUIET="true"
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

# Validate Claude CLI is available
validate_claude_cli

# Generate or use provided session ID
if [[ -n "$CUSTOM_SESSION_ID" ]]; then
    UUID="$CUSTOM_SESSION_ID"
else
    UUID="$(generate_uuid)"
fi

# Create sessions directory if it doesn't exist
mkdir -p "$SESSION_DIR"

# Define output file path
SESSION_FILE="${SESSION_DIR}/session-${UUID}.jsonl"

# Validate plugin directory exists
if [[ ! -d "$PLUGIN_DIR" ]]; then
    log_error "Plugin directory not found: $PLUGIN_DIR"
    exit 1
fi

log_info "Starting headless Claude session"
log_info "  Session ID: ${UUID}"
log_info "  Output: ${SESSION_FILE}"
log_info "  Timeout: ${TIMEOUT}s"
log_info "  Plugin: ${PLUGIN_DIR}"
log_info "  Telemetry: enabled (OTLP: ${OTEL_EXPORTER_OTLP_ENDPOINT})"

# Export environment variables for init-project plugin path resolution
# These are used by the !` shell commands in init-project.md
export ENSEMBLE_TEST_MODE=true
export ENSEMBLE_PLUGIN_DIR="${PLUGIN_DIR}"

# Write plugin path to a well-known location for !` commands to read
# Since !` commands don't inherit env vars, this provides a fallback
mkdir -p /tmp/.ensemble-test
echo "${PLUGIN_DIR}" > /tmp/.ensemble-test/plugin-path

# Execute Claude CLI in headless mode
# --plugin-dir: Use local plugin instead of system-installed
# --setting-sources local: Ignore global/system settings, use only local
# --permission-mode bypassPermissions: Skip permission prompts for automated testing
# --output-format stream-json: Machine-parseable output for verification
# --session-id: Track this specific session
set +e
timeout "${TIMEOUT}" claude \
    --print \
    --verbose \
    --plugin-dir "$PLUGIN_DIR" \
    --setting-sources local \
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
    # Still output the UUID so logs can be inspected
    echo "$UUID"
    exit 124
elif [[ $EXIT_CODE -ne 0 ]]; then
    log_error "Claude CLI exited with code ${EXIT_CODE}"
    # Check if there's any output to debug
    if [[ -f "$SESSION_FILE" ]] && [[ -s "$SESSION_FILE" ]]; then
        log_info "Partial session output saved to: ${SESSION_FILE}"
    fi
    echo "$UUID"
    exit $EXIT_CODE
fi

log_info "Session completed successfully"
log_info "Session log: ${SESSION_FILE}"

# Output the session UUID for downstream processing
echo "$UUID"
