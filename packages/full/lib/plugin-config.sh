#!/bin/bash
# =============================================================================
# plugin-config.sh - Plugin configuration reader
# =============================================================================
# Purpose: Provide a single source of truth for plugin metadata by reading
#          from .claude-plugin/plugin.json
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/plugin-config.sh"
#   # or
#   source "/path/to/packages/full/lib/plugin-config.sh"
#
# Exports:
#   PLUGIN_NAME         - Plugin name (e.g., "ensemble-vnext")
#   PLUGIN_VERSION      - Plugin version (e.g., "1.0.0")
#   PLUGIN_DESCRIPTION  - Plugin description
#   PLUGIN_ROOT         - Absolute path to plugin root directory
#   PLUGIN_JSON_PATH    - Absolute path to plugin.json
#
# Functions:
#   get_plugin_name     - Echo plugin name
#   get_plugin_version  - Echo plugin version
#   get_command_prefix  - Echo command prefix for slash commands
#   format_command      - Format a command with plugin prefix
#
# Dependencies:
#   - jq (for JSON parsing)
#   - bash 4.0+ (for associative arrays)
#
# =============================================================================

set -euo pipefail

# =============================================================================
# Path Resolution
# =============================================================================

# Get the directory containing this script
_PLUGIN_CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Plugin root is parent of lib/
PLUGIN_ROOT="$(cd "${_PLUGIN_CONFIG_DIR}/.." && pwd)"
export PLUGIN_ROOT

# Path to plugin.json
PLUGIN_JSON_PATH="${PLUGIN_ROOT}/.claude-plugin/plugin.json"
export PLUGIN_JSON_PATH

# =============================================================================
# Validation
# =============================================================================

if [[ ! -f "$PLUGIN_JSON_PATH" ]]; then
    echo "[ERROR] plugin.json not found at: $PLUGIN_JSON_PATH" >&2
    echo "[ERROR] Ensure this script is sourced from within the plugin structure" >&2
    # Don't exit - allow scripts to continue with defaults
    PLUGIN_NAME="${PLUGIN_NAME:-ensemble-vnext}"
    PLUGIN_VERSION="${PLUGIN_VERSION:-0.0.0}"
    PLUGIN_DESCRIPTION="${PLUGIN_DESCRIPTION:-Unknown plugin}"
else
    # Check for jq
    if ! command -v jq &>/dev/null; then
        echo "[WARN] jq not found - using fallback parsing" >&2
        # Fallback: use grep/sed for basic parsing
        PLUGIN_NAME=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_JSON_PATH" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
        PLUGIN_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_JSON_PATH" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
        PLUGIN_DESCRIPTION=$(grep -o '"description"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_JSON_PATH" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    else
        # Use jq for robust parsing
        PLUGIN_NAME=$(jq -r '.name // "ensemble-vnext"' "$PLUGIN_JSON_PATH")
        PLUGIN_VERSION=$(jq -r '.version // "0.0.0"' "$PLUGIN_JSON_PATH")
        PLUGIN_DESCRIPTION=$(jq -r '.description // ""' "$PLUGIN_JSON_PATH")
    fi
fi

export PLUGIN_NAME
export PLUGIN_VERSION
export PLUGIN_DESCRIPTION

# =============================================================================
# Helper Functions
# =============================================================================

# Get plugin name
# Usage: name=$(get_plugin_name)
get_plugin_name() {
    echo "$PLUGIN_NAME"
}

# Get plugin version
# Usage: version=$(get_plugin_version)
get_plugin_version() {
    echo "$PLUGIN_VERSION"
}

# Get command prefix for slash commands
# Returns: "plugin-name:" (e.g., "ensemble-vnext:")
# Usage: prefix=$(get_command_prefix)
get_command_prefix() {
    echo "${PLUGIN_NAME}:"
}

# Format a command with plugin prefix
# Usage: full_cmd=$(format_command "create-prd")
# Returns: "ensemble-vnext:create-prd"
format_command() {
    local cmd_name="$1"
    echo "${PLUGIN_NAME}:${cmd_name}"
}

# Get full command invocation (with slash)
# Usage: invoke=$(get_command_invoke "create-prd")
# Returns: "/ensemble-vnext:create-prd"
get_command_invoke() {
    local cmd_name="$1"
    echo "/${PLUGIN_NAME}:${cmd_name}"
}

# List all available commands by scanning command directories
# Usage: list_commands
list_commands() {
    local cmd_dirs

    if command -v jq &>/dev/null && [[ -f "$PLUGIN_JSON_PATH" ]]; then
        # Parse command directories from plugin.json
        while IFS= read -r cmd_dir; do
            local full_path="${PLUGIN_ROOT}/${cmd_dir}"
            if [[ -d "$full_path" ]]; then
                find "$full_path" -name "*.md" -type f -exec basename {} .md \; 2>/dev/null
            fi
        done < <(jq -r '.commands[]' "$PLUGIN_JSON_PATH" 2>/dev/null)
    else
        # Fallback: scan known directories
        for cmd_dir in "${PLUGIN_ROOT}/commands/core" "${PLUGIN_ROOT}/commands/router"; do
            if [[ -d "$cmd_dir" ]]; then
                find "$cmd_dir" -name "*.md" -type f -exec basename {} .md \; 2>/dev/null
            fi
        done
    fi
}

# =============================================================================
# Exports for sourcing scripts
# =============================================================================

export -f get_plugin_name
export -f get_plugin_version
export -f get_command_prefix
export -f format_command
export -f get_command_invoke
export -f list_commands

# =============================================================================
# Debug output (only if PLUGIN_CONFIG_DEBUG is set)
# =============================================================================

if [[ "${PLUGIN_CONFIG_DEBUG:-}" == "true" ]]; then
    echo "[DEBUG] Plugin Config Loaded:" >&2
    echo "  PLUGIN_NAME: $PLUGIN_NAME" >&2
    echo "  PLUGIN_VERSION: $PLUGIN_VERSION" >&2
    echo "  PLUGIN_ROOT: $PLUGIN_ROOT" >&2
    echo "  PLUGIN_JSON_PATH: $PLUGIN_JSON_PATH" >&2
fi
