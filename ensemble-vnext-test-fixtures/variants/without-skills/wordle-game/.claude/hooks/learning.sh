#!/usr/bin/env bash
#
# learning.sh - SessionEnd hook for learning capture and file staging
#
# Fires on SessionEnd and performs the following:
# 1. Detects CLAUDE_CODE_REMOTE environment variable
# 2. Stages CLAUDE.md (if modified)
# 3. Stages all other changed files from the session
# 4. NEVER commits or pushes
# 5. Logs appropriate context-aware message
#
# Environment Variables:
#   LEARNING_HOOK_DISABLE    - Set to "1" to disable (default: enabled)
#   LEARNING_HOOK_DEBUG      - Enable debug logging to stderr (default: "0")
#   CLAUDE_CODE_REMOTE       - Set when running in Claude Code Web/Cloud
#
# Hook Type: SessionEnd
#   - Fires when Claude Code session ends
#   - Stages files for commit but NEVER commits
#   - Context-aware messaging based on environment
#
# Exit codes:
#   0 - Hook processed successfully (always non-blocking)
#
# TRD Reference: TRD-H103, TRD-H104, TRD-H105
#

set -euo pipefail

# Debug logging function
debug_log() {
    if [[ "${LEARNING_HOOK_DEBUG:-0}" == "1" ]]; then
        echo "[LEARNING $(date -Iseconds)] $1" >&2
    fi
}

# Output hook result to stdout
# SessionEnd hooks should only return {"continue": true}
output_result() {
    local status="$1"
    local message="${2:-}"
    local staged_count="${3:-0}"
    local is_remote="${4:-false}"

    # Log diagnostic info to stderr for debugging
    debug_log "Result: status=$status, message=$message, staged_count=$staged_count, is_remote=$is_remote"

    # SessionEnd hooks don't support hookSpecificOutput - just return continue
    echo '{"continue": true}'
    exit 0
}

# Check if we're in a git repository
is_git_repo() {
    git rev-parse --is-inside-work-tree &>/dev/null
}

# Get git repository root for a given directory
# Uses PROJECT_DIR if set, otherwise finds git root from cwd
get_git_root() {
    local start_dir="${1:-$(pwd)}"

    # Change to start directory to find its git root
    (cd "$start_dir" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)
}

# Find project root by looking for .claude/ directory
# This ensures we stay within the correct project scope
find_project_root() {
    local start_dir="${1:-$(pwd)}"
    local current="$start_dir"
    local root="/"

    while [[ "$current" != "$root" ]]; do
        if [[ -d "$current/.claude" ]]; then
            echo "$current"
            return 0
        fi
        current=$(dirname "$current")
    done

    # Fallback to git root if no .claude/ found
    get_git_root "$start_dir"
}

# Check if CLAUDE.md exists at project root
find_claude_md() {
    local git_root
    git_root=$(get_git_root)

    if [[ -n "$git_root" && -f "$git_root/CLAUDE.md" ]]; then
        echo "$git_root/CLAUDE.md"
    elif [[ -f "./CLAUDE.md" ]]; then
        echo "./CLAUDE.md"
    else
        echo ""
    fi
}

# Check if file has uncommitted changes (modified or new)
has_changes() {
    local file="$1"

    # Check if file is tracked and modified
    if git diff --name-only -- "$file" 2>/dev/null | grep -q .; then
        return 0
    fi

    # Check if file is staged
    if git diff --staged --name-only -- "$file" 2>/dev/null | grep -q .; then
        return 0
    fi

    # Check if file is untracked
    if git ls-files --others --exclude-standard -- "$file" 2>/dev/null | grep -q .; then
        return 0
    fi

    return 1
}

# Get list of all changed files (modified, staged, or untracked)
# Respects project_root to only return files within the project
get_changed_files() {
    local project_root="${1:-$(pwd)}"
    local git_root
    git_root=$(get_git_root "$project_root")

    if [[ -z "$git_root" ]]; then
        echo ""
        return
    fi

    cd "$git_root"

    # Calculate relative path from git root to project root
    local relative_path=""
    if [[ "$project_root" != "$git_root" ]]; then
        relative_path="${project_root#$git_root/}"
    fi

    {
        # Modified but not staged
        git diff --name-only 2>/dev/null

        # Already staged
        git diff --staged --name-only 2>/dev/null

        # Untracked files (excluding ignored)
        git ls-files --others --exclude-standard 2>/dev/null
    } | if [[ -n "$relative_path" ]]; then
        # Filter to only include files within the project directory
        grep "^${relative_path}/" | sed "s|^${relative_path}/||"
    else
        cat
    fi | sort -u
}

# Stage files for commit
# Returns: number of files staged
stage_files() {
    local project_root="${1:-$(pwd)}"
    local staged_count=0
    local git_root
    git_root=$(get_git_root "$project_root")

    if [[ -z "$git_root" ]]; then
        echo "0"
        return
    fi

    cd "$project_root"

    # Get all changed files within this project
    local changed_files
    changed_files=$(get_changed_files "$project_root")

    if [[ -z "$changed_files" ]]; then
        debug_log "No changed files found in project"
        echo "0"
        return
    fi

    # Stage each changed file
    while IFS= read -r file; do
        if [[ -n "$file" && -e "$file" ]]; then
            debug_log "Staging file: $file"
            if git add "$file" 2>/dev/null; then
                ((staged_count++))
            else
                debug_log "Failed to stage: $file"
            fi
        fi
    done <<< "$changed_files"

    echo "$staged_count"
}

# Stage CLAUDE.md specifically if it has changes
stage_claude_md() {
    local claude_md
    claude_md=$(find_claude_md)

    if [[ -z "$claude_md" ]]; then
        debug_log "CLAUDE.md not found"
        return 1
    fi

    if has_changes "$claude_md"; then
        debug_log "Staging CLAUDE.md: $claude_md"
        git add "$claude_md" 2>/dev/null && return 0
    else
        debug_log "CLAUDE.md has no changes"
    fi

    return 1
}

# Parse hook input from stdin and extract working directory
parse_input() {
    local input=""
    if [[ ! -t 0 ]]; then
        input=$(cat)
    fi
    echo "$input"
}

# Extract cwd from hook input JSON
get_cwd_from_input() {
    local input="$1"

    # Try to extract cwd from JSON input using jq
    if command -v jq &>/dev/null; then
        local cwd
        cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null)
        if [[ -n "$cwd" && "$cwd" != "null" ]]; then
            echo "$cwd"
            return
        fi
    fi

    # Fallback: try sed for cwd field (POSIX-compatible, no Perl regex)
    local cwd
    cwd=$(echo "$input" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' 2>/dev/null || true)
    if [[ -n "$cwd" ]]; then
        echo "$cwd"
        return
    fi

    # Default to current working directory
    pwd
}

# Determine if running in remote/cloud environment
is_remote_environment() {
    # CLAUDE_CODE_REMOTE is the primary indicator
    if [[ -n "${CLAUDE_CODE_REMOTE:-}" ]]; then
        return 0
    fi

    # Additional checks for cloud environments
    # Check for common cloud CI/CD environment variables
    if [[ -n "${CI:-}" || -n "${GITHUB_ACTIONS:-}" || -n "${GITLAB_CI:-}" ]]; then
        return 0
    fi

    return 1
}

# Main hook logic
main() {
    # 1. Check if disabled
    if [[ "${LEARNING_HOOK_DISABLE:-0}" == "1" ]]; then
        debug_log "Hook disabled (LEARNING_HOOK_DISABLE=1)"
        output_result "disabled" "Hook disabled by environment variable"
    fi

    # 2. Read input from stdin (for hook context if needed)
    local input
    input=$(parse_input)
    debug_log "Received input: ${input:0:200}..."

    # 3. Determine working directory from input or current directory
    local working_dir
    working_dir=$(get_cwd_from_input "$input")
    debug_log "Working directory: $working_dir"

    # 4. Find project root (looks for .claude/ directory)
    local project_root
    project_root=$(find_project_root "$working_dir")
    debug_log "Project root: $project_root"

    # 5. Check if we're in a git repository
    if ! (cd "$project_root" && is_git_repo); then
        debug_log "Not in a git repository"
        output_result "no_git" "Not in a git repository - skipping staging"
    fi

    local git_root
    git_root=$(get_git_root "$project_root")
    debug_log "Git root: $git_root"

    # 6. Detect remote environment
    local is_remote="false"
    if is_remote_environment; then
        is_remote="true"
        debug_log "Running in remote/cloud environment"
    else
        debug_log "Running in local environment"
    fi

    # 7. Stage CLAUDE.md first (priority)
    local claude_staged="false"
    if stage_claude_md; then
        claude_staged="true"
        debug_log "CLAUDE.md staged successfully"
    fi

    # 8. Stage all other changed files within the project
    local staged_count
    staged_count=$(stage_files "$project_root")
    debug_log "Total files staged: $staged_count"

    # 9. Generate appropriate message based on context
    local message=""
    if [[ "$is_remote" == "true" ]]; then
        message="Staged $staged_count file(s). Will be included in auto-push."
    else
        message="Staged $staged_count file(s). Review and commit when ready."
    fi

    # Log message to stderr for user visibility
    if [[ "$staged_count" -gt 0 ]]; then
        if [[ "$is_remote" == "true" ]]; then
            echo "[LEARNING] $message (Remote session)" >&2
        else
            echo "[LEARNING] $message" >&2
        fi
    fi

    # 10. Output result
    output_result "staged" "$message" "$staged_count" "$is_remote"
}

# Run main
main "$@"
