#!/bin/bash
# =============================================================================
# run-session.sh - Claude Session Wrapper for Evaluation Framework
# =============================================================================
# Task: TRD-TEST-068
# Purpose: Execute Claude sessions for evaluations with fixture cloning,
#          session ID generation and tracking, and workspace isolation.
#
# Usage:
#   ./run-session.sh [options] <prompt>
#
# Arguments:
#     prompt             The prompt to execute (or use --prompt-file)
#
# Options:
#     --fixture PATH     Fixture path in ensemble-vnext-test-fixtures repo
#     --variant NAME     Variant name for metadata tracking
#     --session-id UUID  Use specific session ID (default: auto-generated)
#     --output-dir DIR   Output directory (default: ../../results)
#     --timeout SECONDS  Execution timeout (default: 300)
#     --keep             Keep workspace after completion
#     --local            Use local execution (--print) instead of --remote
#     --prompt-file FILE Read prompt from file
#     --quiet            Suppress progress output
#     --dry-run          Show what would be executed without running
#     --help             Show this help
#
# Output Files:
#   Session output saved to: <output-dir>/<session-id>/
#   - session.jsonl  - Claude session output
#   - metadata.json  - Session metadata (variant, fixture, timing)
#   - workspace/     - Cloned fixture (if --keep)
#
# Environment Variables:
#   FIXTURE_REPO_BASE    - GitHub org/repo base (default: ensemble-vnext-test-fixtures)
#   CLAUDE_TIMEOUT       - Default timeout override
#   OTEL_EXPORTER_OTLP_ENDPOINT - OTLP endpoint (loaded from test/.env)
#   OTEL_EXPORTER_OTLP_HEADERS  - OTLP auth headers (loaded from test/.env)
#
# Examples:
#   ./run-session.sh "Build a CLI calculator"
#
#   ./run-session.sh \
#       --fixture "user-stories/python-cli" \
#       --variant "with-skill" \
#       --session-id "abc123" \
#       --output-dir "../results/eval_20260113/" \
#       "Use the Skill tool to invoke developing-with-python, then build a calculator"
#
# Dependencies:
#   - claude CLI installed and available in PATH
#   - git for fixture cloning
#   - uuidgen or equivalent for session ID generation
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values
DEFAULT_OUTPUT_DIR="${SCRIPT_DIR}/../../results"
DEFAULT_TIMEOUT="${CLAUDE_TIMEOUT:-300}"
FIXTURE_REPO_BASE="${FIXTURE_REPO_BASE:-ensemble-vnext-test-fixtures}"

# GitHub repo URL for fixture cloning
FIXTURE_GITHUB_URL="https://github.com/ensemble-ai/${FIXTURE_REPO_BASE}.git"

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
    export OTEL_EXPORTER_OTLP_PROTOCOL="${OTEL_EXPORTER_OTLP_PROTOCOL:-grpc}"
    export OTEL_METRICS_EXPORTER="${OTEL_METRICS_EXPORTER:-otlp}"
    export OTEL_LOGS_EXPORTER="${OTEL_LOGS_EXPORTER:-otlp}"
    export OTEL_EXPORTER_OTLP_HEADERS="${OTEL_EXPORTER_OTLP_HEADERS:-}"
    export OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-ensemble-vnext-eval}"
    export OTEL_RESOURCE_ATTRIBUTES="${OTEL_RESOURCE_ATTRIBUTES:-service.version=1.0.0,test.type=eval}"
else
    # Disable telemetry if no endpoint configured
    export CLAUDE_CODE_ENABLE_TELEMETRY=0
fi

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

PROMPT=""
PROMPT_FILE=""
FIXTURE_PATH=""
VARIANT_NAME=""
SESSION_ID=""
OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
TIMEOUT="$DEFAULT_TIMEOUT"
KEEP_WORKSPACE=false
USE_LOCAL=false
QUIET=false
DRY_RUN=false
PLUGIN_DIR=""

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

usage() {
    cat <<'EOF'
Usage: run-session.sh [options] <prompt>

Execute Claude sessions for evaluations with fixture cloning, session ID
generation and tracking, and workspace isolation.

Arguments:
    prompt             The prompt to execute (or use --prompt-file)

Options:
    --fixture PATH     Fixture path in ensemble-vnext-test-fixtures repo
    --variant NAME     Variant name for metadata tracking
    --session-id UUID  Use specific session ID (default: auto-generated, local only)
    --output-dir DIR   Output directory (default: ../../results)
    --timeout SECONDS  Execution timeout (default: 300)
    --keep             Keep workspace after completion
    --local            Use local execution (--print) instead of --remote
    --plugin-dir DIR   Plugin directory for local mode
    --prompt-file FILE Read prompt from file
    --quiet            Suppress progress output
    --dry-run          Show what would be executed without running
    --help             Show this help

Execution Modes:

    LOCAL (--local):
        - Runs: echo '<prompt>' | claude --print --dangerously-skip-permissions ...
        - Session ID can be specified
        - Supports --plugin-dir and --setting-sources
        - Session logs stored locally in ~/.claude/projects/

    REMOTE (default):
        - Runs: claude --remote '<prompt>'
        - Session ID auto-generated (cannot override)
        - Requires workspace to be a git repo pushed to GitHub
        - Output contains session URL and teleport command
        - Use 'claude --teleport <session_id>' to retrieve session locally

Output Files:
    Session output saved to: <output-dir>/<session-id>/
    - session.jsonl  - Claude session output (or remote session info)
    - metadata.json  - Session metadata (variant, fixture, timing)
    - workspace/     - Cloned fixture (if --keep)

Examples:
    # Local execution with fixture
    ./run-session.sh --local \
        --fixture "variants/full/python-cli" \
        --variant "with-skill" \
        "Build a CLI calculator"

    # Remote execution (requires git repo pushed to GitHub)
    cd /path/to/github-repo
    ./run-session.sh "Build a CLI calculator"
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

validate_dependencies() {
    local missing=()

    if ! command -v claude &>/dev/null; then
        missing+=("claude CLI")
    fi

    if ! command -v git &>/dev/null; then
        missing+=("git")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing[*]}"
        exit 1
    fi
}

validate_timeout() {
    local value="$1"
    if ! [[ "$value" =~ ^[0-9]+$ ]]; then
        log_error "Timeout must be a numeric value, got: $value"
        exit 1
    fi
}

clone_fixture() {
    local fixture_path="$1"
    local target_dir="$2"

    log_info "Cloning fixture: $fixture_path"

    # First, check prepared fixtures in /tmp (output of prepare-all-fixtures.sh)
    local prepared_fixture_base="/tmp/ensemble-test-fixtures"
    if [[ -d "$prepared_fixture_base/$fixture_path" ]]; then
        log_info "Using prepared fixture from: $prepared_fixture_base/$fixture_path"
        cp -r "$prepared_fixture_base/$fixture_path/"* "$target_dir/" 2>/dev/null || true
        return 0
    fi

    # Fall back to project directory (raw fixtures without .claude/)
    local local_fixture_base="${SCRIPT_DIR}/../../../ensemble-vnext-test-fixtures"
    if [[ -d "$local_fixture_base/$fixture_path" ]]; then
        log_info "Using local fixture from: $local_fixture_base/$fixture_path (WARNING: may not have .claude/)"
        cp -r "$local_fixture_base/$fixture_path/"* "$target_dir/" 2>/dev/null || true
        return 0
    fi

    # Clone from GitHub if not available locally
    local temp_clone
    temp_clone="$(mktemp -d)"

    if git clone --depth 1 --quiet "$FIXTURE_GITHUB_URL" "$temp_clone" 2>/dev/null; then
        if [[ -d "$temp_clone/$fixture_path" ]]; then
            cp -r "$temp_clone/$fixture_path/"* "$target_dir/" 2>/dev/null || true
            log_info "Fixture cloned successfully"
        else
            log_error "Fixture path not found in repo: $fixture_path"
            rm -rf "$temp_clone"
            return 1
        fi
        rm -rf "$temp_clone"
    else
        log_error "Failed to clone fixture repository"
        rm -rf "$temp_clone"
        return 1
    fi
}

create_metadata() {
    local session_dir="$1"
    local session_id="$2"
    local variant="$3"
    local fixture="$4"
    local start_time="$5"
    local prompt="$6"

    local metadata_file="$session_dir/metadata.json"

    # Escape special JSON characters in prompt preview
    # Replace backslashes first, then newlines, quotes, tabs
    local escaped_prompt="${prompt:0:200}"
    escaped_prompt="${escaped_prompt//\\/\\\\}"
    escaped_prompt="${escaped_prompt//$'\n'/\\n}"
    escaped_prompt="${escaped_prompt//$'\r'/\\r}"
    escaped_prompt="${escaped_prompt//$'\t'/\\t}"
    escaped_prompt="${escaped_prompt//\"/\\\"}"

    cat > "$metadata_file" <<EOF
{
  "session_id": "$session_id",
  "variant": "$variant",
  "fixture": "$fixture",
  "start_time": "$start_time",
  "prompt_preview": "$escaped_prompt",
  "execution_mode": "$( [[ "$USE_LOCAL" == "true" ]] && echo "local" || echo "remote" )",
  "timeout_seconds": $TIMEOUT,
  "framework_version": "1.0.0"
}
EOF

    log_debug "Created metadata at: $metadata_file"
}

update_metadata_completion() {
    local metadata_file="$1"
    local end_time="$2"
    local exit_code="$3"

    if [[ -f "$metadata_file" ]]; then
        # Use jq if available, otherwise use sed
        if command -v jq &>/dev/null; then
            local temp_file
            temp_file="$(mktemp)"
            jq --arg end_time "$end_time" \
               --arg exit_code "$exit_code" \
               '. + {end_time: $end_time, exit_code: ($exit_code | tonumber)}' \
               "$metadata_file" > "$temp_file" && mv "$temp_file" "$metadata_file"
        else
            # Fallback: append to JSON (less elegant but functional)
            sed -i 's/}$/,\n  "end_time": "'"$end_time"'",\n  "exit_code": '"$exit_code"'\n}/' "$metadata_file"
        fi
    fi
}

execute_claude_session() {
    local prompt="$1"
    local session_id="$2"
    local workspace_dir="$3"
    local output_file="$4"

    log_info "Executing Claude session..."
    log_debug "Working directory: $workspace_dir"

    local exit_code=0

    if [[ "$USE_LOCAL" == "true" ]]; then
        # Local execution with --print
        # - Prompt is piped via stdin
        # - Supports --dangerously-skip-permissions
        # - Supports --session-id for tracking
        # - Supports --plugin-dir and --setting-sources
        local claude_args=(
            "--print"
            "--dangerously-skip-permissions"
            "--setting-sources" "local"
            "--session-id" "$session_id"
        )

        # Add plugin directory if specified
        if [[ -n "$PLUGIN_DIR" ]]; then
            claude_args+=("--plugin-dir" "$PLUGIN_DIR")
        fi

        log_debug "Local mode args: ${claude_args[*]}"

        # Clear CLAUDECODE env vars to prevent nested session interference
        (
            cd "$workspace_dir"
            echo "$prompt" | env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT \
                timeout "$TIMEOUT" claude "${claude_args[@]}"
        ) > "$output_file" 2>&1
        exit_code=$?
    else
        # Remote execution with --remote
        # - Prompt MUST be the argument to --remote (not piped)
        # - Does NOT support --dangerously-skip-permissions
        # - Does NOT support --session-id (remote generates its own)
        # - Does NOT support --setting-sources or --plugin-dir
        # - Requires working directory to be a git repo pushed to GitHub
        # - Must run from the CURRENT directory (the git repo), not workspace

        log_debug "Remote mode: claude --remote \"<prompt>\""
        log_info "Note: Remote sessions require git repo pushed to GitHub"
        log_info "Running from current directory (must be git repo): $(pwd)"

        # Remote runs from current dir (the git repo), not the workspace
        # Note: --remote requires a TTY, so we use 'script' to capture output
        # while maintaining pseudo-terminal
        if command -v script &>/dev/null; then
            # Use script to capture output (works on Linux)
            script -q -c "timeout $TIMEOUT claude --remote \"$prompt\"" "$output_file"
            exit_code=$?
        else
            # Fallback: run without capture, output goes to terminal
            log_info "Warning: 'script' not found, remote output will go to terminal"
            timeout "$TIMEOUT" claude --remote "$prompt"
            exit_code=$?
            echo "Remote session started - check terminal output for session URL" > "$output_file"
        fi
    fi

    return $exit_code
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --fixture)
            FIXTURE_PATH="$2"
            shift 2
            ;;
        --variant)
            VARIANT_NAME="$2"
            shift 2
            ;;
        --session-id)
            SESSION_ID="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --timeout)
            validate_timeout "$2"
            TIMEOUT="$2"
            shift 2
            ;;
        --keep)
            KEEP_WORKSPACE=true
            shift
            ;;
        --local)
            USE_LOCAL=true
            shift
            ;;
        --plugin-dir)
            PLUGIN_DIR="$2"
            shift 2
            ;;
        --prompt-file)
            PROMPT_FILE="$2"
            shift 2
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

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

# Read prompt from file if specified
if [[ -n "$PROMPT_FILE" ]]; then
    if [[ ! -f "$PROMPT_FILE" ]]; then
        log_error "Prompt file not found: $PROMPT_FILE"
        exit 1
    fi
    PROMPT="$(cat "$PROMPT_FILE")"
fi

# Validate prompt is provided
if [[ -z "$PROMPT" ]]; then
    log_error "Prompt is required. Provide as argument or via --prompt-file"
    echo "Use --help for usage information" >&2
    exit 1
fi

# Generate session ID if not provided
if [[ -z "$SESSION_ID" ]]; then
    SESSION_ID="$(generate_uuid)"
fi

# Validate session ID format for security
if [[ -n "$SESSION_ID" ]]; then
    if ! validate_session_id "$SESSION_ID"; then
        log_error "Invalid session ID format: $SESSION_ID"
        log_error "Session ID must be UUID, session_xxx, or alphanumeric with - and _"
        exit 1
    fi
fi

# -----------------------------------------------------------------------------
# Dry Run Mode
# -----------------------------------------------------------------------------

if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN MODE ==="
    echo "Session ID: $SESSION_ID"
    echo "Variant: ${VARIANT_NAME:-<none>}"
    echo "Fixture: ${FIXTURE_PATH:-<none>}"
    echo "Output Dir: $OUTPUT_DIR"
    echo "Timeout: ${TIMEOUT}s"
    echo "Keep Workspace: $KEEP_WORKSPACE"
    echo "Execution Mode: $( [[ "$USE_LOCAL" == "true" ]] && echo "local (--print)" || echo "remote (--remote)" )"
    echo "Prompt Preview: ${PROMPT:0:100}..."
    echo ""
    if [[ "$USE_LOCAL" == "true" ]]; then
        echo "Command: echo '<prompt>' | claude --print --dangerously-skip-permissions --setting-sources local --session-id $SESSION_ID"
    else
        echo "Command: claude --remote '<prompt>'"
        echo ""
        echo "NOTE: Remote mode limitations:"
        echo "  - Requires working directory to be a git repo pushed to GitHub"
        echo "  - Session ID is auto-generated (cannot override)"
        echo "  - Output will contain session URL, not session content"
        echo "  - Use 'claude --teleport <session_id>' to retrieve session locally"
    fi
    echo ""
    echo "Would create: $OUTPUT_DIR/$SESSION_ID/"
    echo "  - session.jsonl"
    echo "  - metadata.json"
    [[ "$KEEP_WORKSPACE" == "true" ]] && echo "  - workspace/"
    exit 0
fi

# Validate dependencies for actual execution
validate_dependencies

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

# Record start time
START_TIME="$(date -Iseconds)"

# Create session output directory
SESSION_DIR="$OUTPUT_DIR/$SESSION_ID"
mkdir -p "$SESSION_DIR"

# Create workspace directory
WORKSPACE_DIR="$SESSION_DIR/workspace"
mkdir -p "$WORKSPACE_DIR"

log_info "Starting session: $SESSION_ID"
log_info "  Variant: ${VARIANT_NAME:-<none>}"
log_info "  Fixture: ${FIXTURE_PATH:-<none>}"
log_info "  Output: $SESSION_DIR"
log_info "  Timeout: ${TIMEOUT}s"

# Clone fixture if specified
if [[ -n "$FIXTURE_PATH" ]]; then
    if ! clone_fixture "$FIXTURE_PATH" "$WORKSPACE_DIR"; then
        log_error "Failed to clone fixture, continuing without it"
    fi
fi

# Create initial metadata
create_metadata \
    "$SESSION_DIR" \
    "$SESSION_ID" \
    "${VARIANT_NAME:-}" \
    "${FIXTURE_PATH:-}" \
    "$START_TIME" \
    "$PROMPT"

# Save prompt for reference
echo "$PROMPT" > "$SESSION_DIR/prompt.txt"

# Execute Claude session
SESSION_OUTPUT_FILE="$SESSION_DIR/session.jsonl"

# Execute and capture exit code properly (disable set -e temporarily)
set +e
execute_claude_session "$PROMPT" "$SESSION_ID" "$WORKSPACE_DIR" "$SESSION_OUTPUT_FILE"
EXIT_CODE=$?
set -e

if [[ $EXIT_CODE -ne 0 ]]; then
    if [[ $EXIT_CODE -eq 124 ]]; then
        log_error "Session timed out after ${TIMEOUT}s"
    else
        log_error "Claude session failed with exit code: $EXIT_CODE"
    fi
fi

# Record end time and update metadata
END_TIME="$(date -Iseconds)"
update_metadata_completion "$SESSION_DIR/metadata.json" "$END_TIME" "$EXIT_CODE"

# Cleanup workspace unless --keep specified
if [[ "$KEEP_WORKSPACE" != "true" ]] && [[ -d "$WORKSPACE_DIR" ]]; then
    rm -rf "$WORKSPACE_DIR"
    log_debug "Cleaned up workspace"
fi

# Output session ID for downstream processing
log_info "Session completed: $SESSION_ID"
echo "$SESSION_ID"

exit $EXIT_CODE
