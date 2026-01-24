#!/usr/bin/env bash
#
# scaffold-project.sh - Create directory structure for Ensemble vNext
#
# Creates the vendored runtime directory structure for AI-augmented development.
# This script is extracted from init-project.md Step 3.
#
# Usage:
#   ./scaffold-project.sh [--plugin-dir DIR] [--copy-skills] [--force] [project-directory]
#
# Options:
#   --plugin-dir DIR   Plugin directory containing agents, skills, hooks
#   --copy-skills      Copy skills listed in .claude/selected-skills.txt
#   --force            Overwrite existing files (for "Replace All" scenarios)
#
# If project-directory is not provided, uses current directory.
#
# TRD Reference: TRD-TEST-016
#

set -euo pipefail

# Script directory (for finding templates)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="${SCRIPT_DIR}/../templates"

# Default values
PLUGIN_DIR=""
COPY_SKILLS=false
FORCE=false
PROJECT_DIR=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --plugin-dir)
            PLUGIN_DIR="$2"
            shift 2
            ;;
        --copy-skills)
            COPY_SKILLS=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        -*)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
        *)
            if [[ -z "$PROJECT_DIR" ]]; then
                PROJECT_DIR="$1"
            fi
            shift
            ;;
    esac
done

# Default project directory to current directory if not specified
PROJECT_DIR="${PROJECT_DIR:-.}"

# Colors for output (disabled if not a terminal)
if [[ -t 1 ]]; then
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    RED='\033[0;31m'
    NC='\033[0m'
else
    GREEN=''
    YELLOW=''
    RED=''
    NC=''
fi

# Output functions
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Create directory if it doesn't exist
create_dir() {
    local dir="$1"
    if [[ -d "$dir" ]]; then
        info "Directory exists: $dir"
    else
        mkdir -p "$dir"
        info "Created: $dir"
    fi
}

# Copy template file (overwrites if --force)
copy_template() {
    local template="$1"
    local dest="$2"
    local template_path="${TEMPLATES_DIR}/${template}"

    if [[ -f "$dest" && "$FORCE" != "true" ]]; then
        info "File exists: $dest"
    elif [[ -f "$template_path" ]]; then
        cp "$template_path" "$dest"
        if [[ "$FORCE" == "true" ]]; then
            info "Replaced from template: $dest"
        else
            info "Created from template: $dest"
        fi
    else
        warn "Template not found: $template_path"
    fi
}

# Copy agents from plugin directory
copy_agents() {
    local src="$PLUGIN_DIR/agents"
    local dest="$1/.claude/agents"

    if [[ -z "$PLUGIN_DIR" ]]; then
        warn "No plugin directory specified, skipping agents"
        return 0
    fi

    if [[ ! -d "$src" ]]; then
        warn "Agents directory not found: $src"
        return 0
    fi

    local count=0
    for agent in "$src"/*.md; do
        [[ -f "$agent" ]] || continue
        local basename
        basename="$(basename "$agent")"
        if [[ -f "$dest/$basename" && "$FORCE" != "true" ]]; then
            info "Agent exists: $basename"
        else
            cp "$agent" "$dest/"
            if [[ "$FORCE" == "true" && -f "$dest/$basename" ]]; then
                info "Replaced agent: $basename"
            else
                info "Copied agent: $basename"
            fi
            ((count++)) || true
        fi
    done
    info "Copied $count agents"
}

# Copy workflow commands from plugin directory
copy_commands() {
    # Commands are relative to plugin dir: ../core/commands/
    local src="$PLUGIN_DIR/../core/commands"
    local dest="$1/.claude/commands"

    if [[ -z "$PLUGIN_DIR" ]]; then
        warn "No plugin directory specified, skipping commands"
        return 0
    fi

    if [[ ! -d "$src" ]]; then
        warn "Commands directory not found: $src"
        return 0
    fi

    # Copy specific workflow commands (not init-project or rebase-project)
    local commands=(
        "create-prd.md"
        "refine-prd.md"
        "create-trd.md"
        "refine-trd.md"
        "implement-trd.md"
        "fold-prompt.md"
        "cleanup-project.md"
        "update-project.md"
    )

    local count=0
    for cmd in "${commands[@]}"; do
        if [[ -f "$dest/$cmd" && "$FORCE" != "true" ]]; then
            info "Command exists: $cmd"
        elif [[ -f "$src/$cmd" ]]; then
            cp "$src/$cmd" "$dest/"
            if [[ "$FORCE" == "true" ]]; then
                info "Replaced command: $cmd"
            else
                info "Copied command: $cmd"
            fi
            ((count++)) || true
        else
            warn "Command not found: $cmd"
        fi
    done
    info "Copied $count commands"
}

# Copy global router rules to vendored lib directory
copy_global_router_rules() {
    local target_dir="$1"
    local dest="$target_dir/.claude/lib"

    if [[ -z "$PLUGIN_DIR" ]]; then
        warn "No plugin directory specified, skipping global router rules"
        return 0
    fi

    # Global router rules are in packages/router/lib/router-rules.json
    local src="$PLUGIN_DIR/../router/lib/router-rules.json"

    if [[ -f "$src" ]]; then
        if [[ -f "$dest/router-rules.json" && "$FORCE" != "true" ]]; then
            info "Global router rules exist: .claude/lib/router-rules.json"
        else
            cp "$src" "$dest/router-rules.json"
            if [[ "$FORCE" == "true" ]]; then
                info "Replaced global router rules: .claude/lib/router-rules.json"
            else
                info "Copied global router rules to .claude/lib/router-rules.json"
            fi
        fi
    else
        warn "Global router rules not found: $src"
    fi
}

# Ensure all hook files have executable permissions
ensure_hooks_executable() {
    local hooks_dir="$1"

    info "Ensuring hooks are executable..."

    # List of hook files that need to be executable
    local hook_files=(
        "$hooks_dir/router.py"
        "$hooks_dir/formatter.sh"
        "$hooks_dir/learning.sh"
        "$hooks_dir/status.js"
        "$hooks_dir/wiggum.js"
        "$hooks_dir/save-remote-logs.js"
        "$hooks_dir/permitter/permitter.js"
    )

    local count=0
    for hook in "${hook_files[@]}"; do
        if [[ -f "$hook" ]]; then
            if [[ ! -x "$hook" ]]; then
                chmod +x "$hook"
                info "Made executable: $(basename "$hook")"
                ((count++)) || true
            fi
        fi
    done

    if [[ $count -gt 0 ]]; then
        info "Made $count hooks executable"
    else
        info "All hooks already executable"
    fi
}

# Copy hooks from plugin directory
copy_hooks() {
    local dest="$1/.claude/hooks"

    if [[ -z "$PLUGIN_DIR" ]]; then
        warn "No plugin directory specified, skipping hooks"
        return 0
    fi

    local count=0

    # Permitter hook (with lib dependencies)
    local permitter_src="$PLUGIN_DIR/../permitter"
    if [[ -d "$permitter_src" ]]; then
        mkdir -p "$dest/permitter/lib"
        if [[ -f "$permitter_src/hooks/permitter.js" ]]; then
            if [[ ! -f "$dest/permitter/permitter.js" || "$FORCE" == "true" ]]; then
                cp "$permitter_src/hooks/permitter.js" "$dest/permitter/"
                if [[ "$FORCE" == "true" ]]; then
                    info "Replaced hook: permitter/permitter.js"
                else
                    info "Copied hook: permitter/permitter.js"
                fi
                ((count++)) || true
            else
                info "Hook exists: permitter/permitter.js"
            fi
        fi
        # Copy lib files
        for lib in "$permitter_src/lib"/*.js; do
            [[ -f "$lib" ]] || continue
            local basename
            basename="$(basename "$lib")"
            if [[ ! -f "$dest/permitter/lib/$basename" || "$FORCE" == "true" ]]; then
                cp "$lib" "$dest/permitter/lib/"
                if [[ "$FORCE" == "true" ]]; then
                    info "Replaced lib: permitter/lib/$basename"
                else
                    info "Copied lib: permitter/lib/$basename"
                fi
            fi
        done
    fi

    # Router hook
    local router_src="$PLUGIN_DIR/../router/hooks/router.py"
    if [[ -f "$router_src" ]]; then
        if [[ ! -f "$dest/router.py" || "$FORCE" == "true" ]]; then
            cp "$router_src" "$dest/"
            if [[ "$FORCE" == "true" ]]; then
                info "Replaced hook: router.py"
            else
                info "Copied hook: router.py"
            fi
            ((count++)) || true
        else
            info "Hook exists: router.py"
        fi
    fi

    # Core hooks
    local core_hooks="$PLUGIN_DIR/../core/hooks"
    for hook in formatter.sh learning.sh status.js wiggum.js save-remote-logs.js; do
        if [[ -f "$core_hooks/$hook" ]]; then
            if [[ ! -f "$dest/$hook" || "$FORCE" == "true" ]]; then
                cp "$core_hooks/$hook" "$dest/"
                if [[ "$FORCE" == "true" ]]; then
                    info "Replaced hook: $hook"
                else
                    info "Copied hook: $hook"
                fi
                ((count++)) || true
            else
                info "Hook exists: $hook"
            fi
        fi
    done

    info "Copied $count hooks"

    # Ensure all hooks are executable
    ensure_hooks_executable "$dest"
}

# Copy skills from plugin directory based on selection file
copy_skills() {
    local target_dir="$1"
    local selection_file="$target_dir/.claude/selected-skills.txt"
    local src="$PLUGIN_DIR/skills"
    local dest="$target_dir/.claude/skills"

    if [[ -z "$PLUGIN_DIR" ]]; then
        warn "No plugin directory specified, skipping skills"
        return 0
    fi

    if [[ ! -f "$selection_file" ]]; then
        info "No skill selection file found: $selection_file"
        return 0
    fi

    if [[ ! -d "$src" ]]; then
        warn "Skills directory not found: $src"
        return 0
    fi

    local count=0
    while IFS= read -r skill || [[ -n "$skill" ]]; do
        # Skip empty lines and comments
        [[ -z "$skill" || "$skill" =~ ^[[:space:]]*# ]] && continue
        # Trim whitespace
        skill="${skill// /}"

        if [[ -d "$src/$skill" ]]; then
            if [[ -d "$dest/$skill" && "$FORCE" != "true" ]]; then
                info "Skill exists: $skill"
            else
                if [[ "$FORCE" == "true" && -d "$dest/$skill" ]]; then
                    rm -rf "$dest/$skill"
                fi
                cp -r "$src/$skill" "$dest/"
                if [[ "$FORCE" == "true" ]]; then
                    info "Replaced skill: $skill"
                else
                    info "Copied skill: $skill"
                fi
                ((count++)) || true
            fi
        else
            warn "Skill not found: $skill"
        fi
    done < "$selection_file"

    info "Copied $count skills"
}

# Main scaffolding function
scaffold_project() {
    local target_dir="$1"

    # Ensure target directory exists and is accessible
    if [[ ! -d "$target_dir" ]]; then
        error "Target directory does not exist: $target_dir"
        return 1
    fi

    # Store original directory and change to target
    local original_dir
    original_dir="$(pwd)"
    cd "$target_dir" || {
        error "Cannot access target directory: $target_dir"
        return 1
    }

    echo "========================================"
    echo " Scaffolding Ensemble Runtime"
    echo "========================================"
    echo ""
    echo "Target Directory: $(pwd)"
    if [[ "$FORCE" == "true" ]]; then
        echo "Mode: FORCE (overwriting existing files)"
    else
        echo "Mode: Safe (preserving existing files)"
    fi
    echo ""

    # Create .claude/ directory structure
    echo "--- .claude/ Directory Structure ---"
    create_dir ".claude/agents"
    create_dir ".claude/rules"
    create_dir ".claude/skills"
    create_dir ".claude/commands"
    create_dir ".claude/hooks"
    create_dir ".claude/lib"
    echo ""

    # Create docs structure
    echo "--- docs/ Directory Structure ---"
    create_dir "docs/PRD"
    create_dir "docs/TRD/completed"
    create_dir "docs/TRD/cancelled"
    create_dir "docs/standards"
    echo ""

    # Create .trd-state structure
    echo "--- .trd-state/ Directory Structure ---"
    create_dir ".trd-state"
    echo ""

    # Copy template files
    echo "--- Template Files ---"
    copy_template "CLAUDE.md.template" "CLAUDE.md"
    copy_template "claude-directory/router-rules.json" ".claude/router-rules.json"
    copy_template "claude-directory/settings.json" ".claude/settings.json"
    copy_template "trd-state/current.json.template" ".trd-state/current.json"
    echo ""

    # Copy plugin content if plugin directory specified
    if [[ -n "$PLUGIN_DIR" ]]; then
        echo "--- Copying Plugin Content ---"
        echo "Plugin directory: $PLUGIN_DIR"
        echo ""

        echo "--- Agents ---"
        copy_agents "$(pwd)"
        echo ""

        echo "--- Commands ---"
        copy_commands "$(pwd)"
        echo ""

        echo "--- Hooks ---"
        copy_hooks "$(pwd)"
        echo ""

        echo "--- Global Router Rules ---"
        copy_global_router_rules "$(pwd)"
        echo ""

        # Copy skills only if --copy-skills flag was set
        if [[ "$COPY_SKILLS" == "true" ]]; then
            echo "--- Skills ---"
            copy_skills "$(pwd)"
            echo ""
        fi
    fi

    # Return to original directory
    cd "$original_dir"

    echo "========================================"
    echo " Scaffolding Complete"
    echo "========================================"
    echo ""
    echo "Created directories:"
    echo "  .claude/agents/"
    echo "  .claude/rules/"
    echo "  .claude/skills/"
    echo "  .claude/commands/"
    echo "  .claude/hooks/"
    echo "  .claude/lib/"
    echo "  docs/PRD/"
    echo "  docs/TRD/"
    echo "  docs/TRD/completed/"
    echo "  docs/TRD/cancelled/"
    echo "  docs/standards/"
    echo "  .trd-state/"
    echo ""
    echo "Created files from templates:"
    echo "  CLAUDE.md"
    echo "  .claude/router-rules.json (project-specific rules)"
    echo "  .claude/settings.json"
    echo "  .trd-state/current.json"
    echo ""
    echo "Copied global assets:"
    echo "  .claude/lib/router-rules.json (global routing rules)"
    echo ""

    if [[ -n "$PLUGIN_DIR" ]]; then
        echo "Copied from plugin:"
        echo "  Agents: $(ls -1 "$target_dir/.claude/agents/"*.md 2>/dev/null | wc -l) files"
        echo "  Commands: $(ls -1 "$target_dir/.claude/commands/"*.md 2>/dev/null | wc -l) files"
        echo "  Hooks: $(ls -1 "$target_dir/.claude/hooks/" 2>/dev/null | wc -l) files/dirs"
        if [[ "$COPY_SKILLS" == "true" ]]; then
            echo "  Skills: $(ls -1d "$target_dir/.claude/skills/"*/ 2>/dev/null | wc -l) skills"
        fi
        echo ""
    fi

    return 0
}

# Run if executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    scaffold_project "$PROJECT_DIR"
fi
