#!/usr/bin/env bash
#
# formatter.sh - PostToolUse hook for automatic code formatting
#
# Fires on Edit/Write tool use and formats the affected file using the
# appropriate formatter based on file extension.
#
# Environment Variables:
#   FORMATTER_HOOK_DISABLE - Set to "1" to disable (default: enabled)
#   FORMATTER_HOOK_DEBUG   - Enable debug logging to stderr (default: "0")
#
# Hook Type: PostToolUse
#   - Fires after Edit or Write tool completes
#   - Extracts file path from tool output
#   - Routes to correct formatter based on extension
#   - Non-blocking: errors logged but don't fail the hook
#
# Exit codes:
#   0 - Hook processed successfully (always non-blocking)
#
# TRD Reference: TRD-H101, TRD-H102
#

set -euo pipefail

# Debug logging function
debug_log() {
    if [[ "${FORMATTER_HOOK_DEBUG:-0}" == "1" ]]; then
        echo "[FORMATTER $(date -Iseconds)] $1" >&2
    fi
}

# Output hook result to stdout
output_result() {
    local status="$1"
    local message="${2:-}"
    local formatted_file="${3:-}"

    cat <<EOF
{"hookSpecificOutput": {"hookEventName": "PostToolUse", "status": "$status", "message": "$message", "formatted_file": "$formatted_file", "timestamp": "$(date -Iseconds)"}}
EOF
    exit 0
}

# Check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Get formatter command for a given file extension
# Returns: formatter command string or empty if no formatter for extension
get_formatter_command() {
    local ext="$1"
    local file="$2"

    case "$ext" in
        # Prettier: JavaScript, TypeScript, HTML, CSS, JSON, YAML, Markdown
        js|jsx|ts|tsx|html|css|json|yaml|yml|md)
            if command_exists prettier; then
                echo "prettier --write"
            elif command_exists npx; then
                echo "npx prettier --write"
            fi
            ;;

        # Ruff: Python
        py)
            if command_exists ruff; then
                echo "ruff format"
            fi
            ;;

        # goimports: Go
        go)
            if command_exists goimports; then
                echo "goimports -w"
            elif command_exists gofmt; then
                echo "gofmt -w"
            fi
            ;;

        # rustfmt: Rust
        rs)
            if command_exists rustfmt; then
                echo "rustfmt"
            fi
            ;;

        # shfmt: Shell scripts
        sh|bash)
            if command_exists shfmt; then
                echo "shfmt -w"
            fi
            ;;

        # Terraform
        tf|tfvars)
            if command_exists terraform; then
                echo "terraform fmt"
            fi
            ;;

        # clang-format: C/C++
        c|cpp|h|hpp|cc|cxx)
            if command_exists clang-format; then
                echo "clang-format -i"
            fi
            ;;

        # google-java-format: Java
        java)
            if command_exists google-java-format; then
                echo "google-java-format -i"
            fi
            ;;

        # ktlint: Kotlin
        kt|kts)
            if command_exists ktlint; then
                echo "ktlint -F"
            fi
            ;;

        # CSharpier: C#
        cs)
            if command_exists dotnet; then
                echo "dotnet csharpier"
            fi
            ;;

        # swift-format: Swift
        swift)
            if command_exists swift-format; then
                echo "swift-format format -i"
            fi
            ;;

        # StyLua: Lua
        lua)
            if command_exists stylua; then
                echo "stylua"
            fi
            ;;

        # No formatter for this extension
        *)
            echo ""
            ;;
    esac
}

# Extract file extension (lowercase)
get_extension() {
    local file="$1"
    local ext="${file##*.}"
    # Handle files with no extension
    if [[ "$ext" == "$file" ]]; then
        echo ""
    else
        echo "${ext,,}" # lowercase
    fi
}

# Parse hook input from stdin and extract file path
# Claude Code sends tool result data via stdin as JSON
parse_file_path() {
    local input="$1"
    local file_path=""

    # Try to extract file path from JSON input
    # Expected format varies by tool, but typically includes "file_path" or similar

    # Try jq first (most reliable)
    if command_exists jq; then
        # Try various JSON paths where file path might be
        file_path=$(echo "$input" | jq -r '.tool_result.file_path // .file_path // .toolResult.file_path // .result.file_path // empty' 2>/dev/null)
        if [[ -z "$file_path" || "$file_path" == "null" ]]; then
            # Try to find any field ending in _path or containing file
            file_path=$(echo "$input" | jq -r '.. | strings | select(test("^/.*\\.[a-zA-Z0-9]+$"))' 2>/dev/null | head -1)
        fi
    fi

    # Fallback: grep for file paths
    if [[ -z "$file_path" || "$file_path" == "null" ]]; then
        # Look for absolute paths
        file_path=$(echo "$input" | grep -oE '"/[^"]+\.[a-zA-Z0-9]+"' | head -1 | tr -d '"')
    fi

    # Fallback: look for relative paths with common extensions
    if [[ -z "$file_path" ]]; then
        file_path=$(echo "$input" | grep -oE '"[a-zA-Z0-9_./-]+\.(js|jsx|ts|tsx|py|go|rs|sh|md|json|yaml|yml|html|css|java|kt|cs|swift|lua|c|cpp|h|hpp|tf)"' | head -1 | tr -d '"')
    fi

    echo "$file_path"
}

# Main hook logic
main() {
    # 1. Check if disabled
    if [[ "${FORMATTER_HOOK_DISABLE:-0}" == "1" ]]; then
        debug_log "Hook disabled (FORMATTER_HOOK_DISABLE=1)"
        output_result "disabled" "Hook disabled by environment variable"
    fi

    # 2. Read input from stdin
    local input=""
    if [[ ! -t 0 ]]; then
        input=$(cat)
    fi

    debug_log "Received input: ${input:0:500}..."

    # 3. Parse file path from input
    local file_path
    file_path=$(parse_file_path "$input")

    if [[ -z "$file_path" ]]; then
        debug_log "No file path found in input"
        output_result "no_file" "Could not extract file path from tool result"
    fi

    debug_log "Extracted file path: $file_path"

    # 4. Check if file exists
    if [[ ! -f "$file_path" ]]; then
        debug_log "File does not exist: $file_path"
        output_result "file_not_found" "File not found: $file_path"
    fi

    # 5. Get file extension
    local ext
    ext=$(get_extension "$file_path")

    if [[ -z "$ext" ]]; then
        debug_log "No extension for file: $file_path"
        output_result "no_extension" "File has no extension: $file_path"
    fi

    debug_log "File extension: $ext"

    # 6. Get formatter command
    local formatter_cmd
    formatter_cmd=$(get_formatter_command "$ext" "$file_path")

    if [[ -z "$formatter_cmd" ]]; then
        debug_log "No formatter available for extension: $ext"
        output_result "no_formatter" "No formatter configured for .$ext files"
    fi

    debug_log "Using formatter: $formatter_cmd"

    # 7. Execute formatter (fire-and-forget, non-blocking)
    # Run in background and capture any errors
    local format_output=""
    local format_exit=0

    # Execute formatter with timeout to prevent hanging
    # Use array execution to safely handle the formatter command (prevents command injection)
    local -a cmd_array
    read -ra cmd_array <<< "$formatter_cmd"
    if command_exists timeout; then
        format_output=$( timeout 30 "${cmd_array[@]}" "$file_path" 2>&1 ) || format_exit=$?
    else
        format_output=$( "${cmd_array[@]}" "$file_path" 2>&1 ) || format_exit=$?
    fi

    if [[ $format_exit -ne 0 ]]; then
        debug_log "Formatter failed (exit $format_exit): $format_output"
        # Log error but don't fail the hook
        output_result "format_error" "Formatter returned exit code $format_exit" "$file_path"
    fi

    debug_log "Formatting successful for: $file_path"
    output_result "formatted" "Successfully formatted with $formatter_cmd" "$file_path"
}

# Run main
main "$@"
