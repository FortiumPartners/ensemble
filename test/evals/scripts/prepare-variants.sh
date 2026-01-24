#!/bin/bash
# =============================================================================
# prepare-variants.sh - Prepare Test Variants for Eval Framework
# =============================================================================
# Task: TRD-TEST-XXX
# Purpose: Create variant directories for A/B testing by preparing baseline
#          and component-removed variants of fixtures.
#
# Usage:
#   ./prepare-variants.sh [options] <fixture-source> [output-dir]
#
# Arguments:
#     fixture-source     Path to the source fixture directory
#     output-dir         Directory to create variants in (default: /tmp/ensemble-test-fixtures)
#
# Options:
#     --fixture-name NAME    Name for this fixture (default: basename of source)
#     --plugin-dir DIR       Path to ensemble plugin (default: packages/full)
#     --skip-init            Skip /init-project step (for testing)
#     --force                Overwrite existing variants
#     --force-skip-validation  Skip init-project output validation (debugging)
#     --dry-run              Show what would be created
#     --no-git               Skip git operations (clone/branch/commit)
#     --branch NAME          Feature branch name (default: feature/eval-fixtures)
#     --help                 Show help
#
# Git Workflow:
#   When output-dir is not specified, the script will:
#   1. Clone https://github.com/islayjames/ensemble-vnext-test-fixtures.git
#      to /tmp/ensemble-test-fixtures/ if not already present
#   2. Create and checkout a feature branch (default: feature/eval-fixtures)
#   3. Create variants in that working directory
#   4. Commit changes after each fixture is prepared
#
# Output Structure:
#   <output-dir>/variants/
#     baseline/<fixture-name>/       # Raw fixture, NO .claude/
#     full/<fixture-name>/           # Full initialized structure
#     without-skills/<fixture-name>/ # Full minus .claude/skills/
#     without-agents/<fixture-name>/ # Full minus .claude/agents/
#     without-commands/<fixture-name>/ # Full minus .claude/commands/
#     without-hooks/<fixture-name>/  # Full minus .claude/hooks/
#
# Examples:
#   ./prepare-variants.sh ./fixtures/taskflow-api
#   ./prepare-variants.sh --branch feature/new-fixtures ./fixtures/taskflow-api
#   ./prepare-variants.sh --no-git ./fixtures/taskflow-api ./local-output
#   ./prepare-variants.sh --fixture-name custom-name ./fixtures/taskflow-api ./out
#   ./prepare-variants.sh --skip-init --dry-run ./fixtures/taskflow-api ./out
#
# Dependencies:
#   - claude CLI installed and available in PATH
#   - git (for default git workflow)
#   - bash 4.0+
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Repository root (for finding plugin directory)
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Plugin directory - defaults to packages/full in the repo
PLUGIN_DIR="${PLUGIN_DIR:-${REPO_ROOT}/packages/full}"

# Default timeout for init-project (10 minutes)
INIT_TIMEOUT=600

# Git workflow configuration
DEFAULT_FIXTURES_REPO="https://github.com/islayjames/ensemble-vnext-test-fixtures.git"
DEFAULT_FIXTURES_DIR="/tmp/ensemble-test-fixtures"
DEFAULT_BRANCH="feature/eval-fixtures"

# Variant names to create
VARIANTS=("baseline" "full" "without-skills" "without-agents" "without-commands" "without-hooks")

# Component directories to remove for each variant
declare -A COMPONENT_DIRS=(
    ["without-skills"]=".claude/skills"
    ["without-agents"]=".claude/agents"
    ["without-commands"]=".claude/commands"
    ["without-hooks"]=".claude/hooks"
)

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

FIXTURE_SOURCE=""
OUTPUT_DIR=""
FIXTURE_NAME=""
SKIP_INIT=false
FORCE=false
DRY_RUN=false
NO_GIT=false
FORCE_SKIP_VALIDATION=false
BRANCH_NAME="$DEFAULT_BRANCH"
TEMP_DIR=""
USE_DEFAULT_OUTPUT=false

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

usage() {
    cat <<'EOF'
Usage: prepare-variants.sh [options] <fixture-source> [output-dir]

Prepare test variants for the eval framework. Creates baseline and
component-removed variants for A/B testing.

Arguments:
    fixture-source     Path to the source fixture directory
    output-dir         Directory to create variants in (default: /tmp/ensemble-test-fixtures)

Options:
    --fixture-name NAME    Name for this fixture (default: basename of source)
    --plugin-dir DIR       Path to ensemble plugin (default: packages/full)
    --skip-init            Skip /init-project step (for testing)
    --force                Overwrite existing variants
    --force-skip-validation  Skip init-project output validation (debugging only)
    --dry-run              Show what would be created
    --no-git               Skip git operations (clone/branch/commit)
    --branch NAME          Feature branch name (default: feature/eval-fixtures)
    --help                 Show help

Git Workflow (when output-dir not specified):
    1. Clone ensemble-vnext-test-fixtures repo to /tmp/ensemble-test-fixtures/
    2. Create and checkout feature branch
    3. Create variants
    4. Commit changes

Output Structure:
    <output-dir>/variants/
      baseline/<fixture-name>/       # Raw fixture, NO .claude/
      full/<fixture-name>/           # Full initialized structure
      without-skills/<fixture-name>/ # Full minus .claude/skills/
      without-agents/<fixture-name>/ # Full minus .claude/agents/
      without-commands/<fixture-name>/ # Full minus .claude/commands/
      without-hooks/<fixture-name>/  # Full minus .claude/hooks/

Examples:
    ./prepare-variants.sh ./fixtures/taskflow-api
    ./prepare-variants.sh --branch feature/new-fixtures ./fixtures/taskflow-api
    ./prepare-variants.sh --no-git ./fixtures/taskflow-api ./local-output
    ./prepare-variants.sh --skip-init ./fixtures/taskflow-api ./test-variants
    ./prepare-variants.sh --force ./fixtures/taskflow-api ./test-variants
EOF
    exit 0
}

log_info() {
    echo "[INFO] $*" >&2
}

log_error() {
    echo "[ERROR] $*" >&2
}

log_success() {
    echo "[OK] $*" >&2
}

log_debug() {
    if [[ "${DEBUG:-false}" == "true" ]]; then
        echo "[DEBUG] $*" >&2
    fi
}

# Cleanup function for trap
cleanup() {
    local exit_code=$?
    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        log_debug "Cleaning up temporary directory: $TEMP_DIR"
        rm -rf "$TEMP_DIR"
    fi
    exit $exit_code
}

# Validate path doesn't escape base directory (path traversal prevention)
validate_path() {
    local base_dir="$1"
    local target_path="$2"

    local abs_base
    abs_base="$(cd "$base_dir" 2>/dev/null && pwd)"

    local abs_target
    abs_target="$(cd "$(dirname "$target_path")" 2>/dev/null && pwd)/$(basename "$target_path")"

    if [[ "$abs_target" != "$abs_base"* ]]; then
        log_error "Path traversal detected: $target_path escapes $base_dir"
        return 1
    fi

    return 0
}

# Count files in a directory matching a pattern
count_files() {
    local dir="$1"
    local pattern="${2:-*}"

    if [[ -d "$dir" ]]; then
        find "$dir" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | wc -l
    else
        echo "0"
    fi
}

# Count items in a directory
count_items() {
    local dir="$1"

    if [[ -d "$dir" ]]; then
        find "$dir" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l
    else
        echo "0"
    fi
}

# -----------------------------------------------------------------------------
# Git Workflow Functions
# -----------------------------------------------------------------------------

# Setup fixtures repository (clone or verify existing)
setup_fixtures_repo() {
    local target_dir="$1"
    local branch="$2"

    log_info "Setting up fixtures repository..."

    if [[ -d "$target_dir/.git" ]]; then
        log_info "Repository already exists at $target_dir"

        # Verify it's the correct repo
        local remote_url
        remote_url=$(cd "$target_dir" && git remote get-url origin 2>/dev/null || echo "")

        if [[ "$remote_url" != *"ensemble-vnext-test-fixtures"* ]]; then
            log_error "Directory exists but is not the expected repository"
            log_error "Expected: ensemble-vnext-test-fixtures"
            log_error "Found: $remote_url"
            return 1
        fi

        # Fetch latest
        log_info "Fetching latest changes..."
        (cd "$target_dir" && git fetch origin) || {
            log_error "Failed to fetch from origin"
            return 1
        }
    else
        # Clone the repository
        log_info "Cloning $DEFAULT_FIXTURES_REPO to $target_dir..."

        if [[ -d "$target_dir" ]]; then
            log_error "Directory exists but is not a git repository: $target_dir"
            return 1
        fi

        git clone "$DEFAULT_FIXTURES_REPO" "$target_dir" || {
            log_error "Failed to clone repository"
            return 1
        }

        log_success "Repository cloned successfully"
    fi

    # Checkout or create branch
    setup_branch "$target_dir" "$branch"
}

# Setup feature branch
setup_branch() {
    local repo_dir="$1"
    local branch="$2"

    log_info "Setting up branch: $branch"

    (
        cd "$repo_dir"

        # Check if branch exists locally
        if git show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null; then
            log_info "Branch $branch exists locally, checking out..."
            git checkout "$branch"
        # Check if branch exists on remote
        elif git show-ref --verify --quiet "refs/remotes/origin/$branch" 2>/dev/null; then
            log_info "Branch $branch exists on remote, creating local tracking branch..."
            git checkout -b "$branch" "origin/$branch"
        else
            # Create new branch from current HEAD
            log_info "Creating new branch: $branch"
            git checkout -b "$branch"
        fi

        log_success "Now on branch: $(git branch --show-current)"
    ) || {
        log_error "Failed to setup branch: $branch"
        return 1
    }
}

# Commit fixture changes
commit_fixture() {
    local repo_dir="$1"
    local fixture_name="$2"

    log_info "Committing changes for fixture: $fixture_name"

    (
        cd "$repo_dir"

        # Check for changes
        if [[ -z "$(git status --porcelain)" ]]; then
            log_info "No changes to commit"
            return 0
        fi

        # Add all changes in variants directory
        git add variants/ 2>/dev/null || true
        git add fixtures/ 2>/dev/null || true

        # Check if there are staged changes
        if [[ -z "$(git diff --cached --name-only)" ]]; then
            log_info "No staged changes to commit"
            return 0
        fi

        # Create commit message
        local commit_msg="feat(fixtures): add variants for $fixture_name

Prepared variants:
- baseline (no .claude/)
- full (initialized)
- without-skills
- without-agents
- without-commands
- without-hooks

Generated by prepare-variants.sh"

        git commit -m "$commit_msg" || {
            log_error "Failed to commit changes"
            return 1
        }

        log_success "Changes committed successfully"
    ) || return 1
}

# Show repository status
show_repo_status() {
    local repo_dir="$1"

    echo ""
    echo "=== Repository Status ==="
    echo "Directory: $repo_dir"
    echo ""

    (
        cd "$repo_dir"

        echo "Branch: $(git branch --show-current)"
        echo ""

        echo "Remote:"
        git remote -v | head -2
        echo ""

        echo "Status:"
        git status --short | head -20
        echo ""

        echo "Recent commits:"
        git log --oneline -5
    )
}

# -----------------------------------------------------------------------------
# Init-Project Validation
# -----------------------------------------------------------------------------

# Validate that init-project completed all steps successfully
# This prevents incomplete fixtures with template placeholders or missing components
validate_init_output() {
    local workspace="$1"
    local errors=0

    log_info "Validating init-project output..."

    # Gate 1: CLAUDE.md exists and has no template placeholders
    if [[ ! -f "$workspace/CLAUDE.md" ]]; then
        log_error "Validation: CLAUDE.md not created"
        ((errors++))
    elif grep -qE '\{\{PROJECT_NAME\}\}|\{\{STACK_SUMMARY\}\}|\{\{PROJECT_DESCRIPTION\}\}|\{\{[A-Z_]+\}\}' "$workspace/CLAUDE.md" 2>/dev/null; then
        log_error "Validation: CLAUDE.md still contains template placeholders"
        log_debug "Found placeholders: $(grep -oE '\{\{[A-Z_]+\}\}' "$workspace/CLAUDE.md" 2>/dev/null | sort -u | tr '\n' ' ')"
        ((errors++))
    else
        log_debug "Validation: CLAUDE.md OK"
    fi

    # Gate 2: router-rules.json exists (if .claude directory was created)
    if [[ -d "$workspace/.claude" ]]; then
        if [[ ! -f "$workspace/.claude/router-rules.json" ]]; then
            log_error "Validation: router-rules.json not created"
            ((errors++))
        else
            log_debug "Validation: router-rules.json OK"
        fi
    fi

    # Gate 3: Required directories exist with content
    local required_dirs=("agents" "commands" "skills" "hooks" "rules")
    for dir in "${required_dirs[@]}"; do
        if [[ ! -d "$workspace/.claude/$dir" ]]; then
            log_error "Validation: .claude/$dir directory not created"
            ((errors++))
        elif [[ -z "$(ls -A "$workspace/.claude/$dir" 2>/dev/null)" ]]; then
            log_error "Validation: .claude/$dir directory is empty"
            ((errors++))
        else
            local count
            count=$(ls -A "$workspace/.claude/$dir" 2>/dev/null | wc -l)
            log_debug "Validation: .claude/$dir OK ($count items)"
        fi
    done

    # Gate 4: settings.json exists
    if [[ ! -f "$workspace/.claude/settings.json" ]]; then
        log_error "Validation: settings.json not created"
        ((errors++))
    else
        log_debug "Validation: settings.json OK"
    fi

    # Gate 5: Check for minimum expected file counts (sanity check)
    local agents_count skills_count commands_count
    agents_count=$(ls -A "$workspace/.claude/agents" 2>/dev/null | wc -l)
    skills_count=$(ls -A "$workspace/.claude/skills" 2>/dev/null | wc -l)
    commands_count=$(ls -A "$workspace/.claude/commands" 2>/dev/null | wc -l)

    # We expect at least some agents (12 streamlined agents defined in constitution)
    if [[ "$agents_count" -lt 5 ]]; then
        log_error "Validation: Too few agents ($agents_count) - init-project may not have completed"
        ((errors++))
    fi

    # Return validation result
    if [[ $errors -gt 0 ]]; then
        log_error "Validation failed with $errors error(s)"
        log_error "init-project did not complete all steps - fixture may be incomplete"
        return 1
    fi

    log_success "Validation passed - init-project completed successfully"
    return 0
}

# Create baseline variant (raw fixture, no .claude/)
create_baseline_variant() {
    local source="$1"
    local dest="$2"

    log_info "Creating baseline variant..."

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  Would copy: $source -> $dest"
        echo "  Would remove: $dest/.claude/"
        return 0
    fi

    # Copy source to destination
    mkdir -p "$(dirname "$dest")"
    cp -r "$source" "$dest"

    # Ensure no .claude/ directory exists
    rm -rf "$dest/.claude"

    log_success "Created baseline variant (no .claude/)"
}

# Run init-project on a workspace
run_init_project() {
    local workspace="$1"

    log_info "Running /init-project on workspace..."

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  Would run: echo '/init-project' | claude --print --plugin-dir $PLUGIN_DIR ..."
        return 0
    fi

    # Validate plugin directory exists
    if [[ ! -d "$PLUGIN_DIR" ]]; then
        log_error "Plugin directory not found: $PLUGIN_DIR"
        return 1
    fi

    # Run init-project via headless Claude
    # Use echo pipe instead of here-string for reliable input
    local init_output
    set +e
    init_output=$(
        cd "$workspace" && \
        echo "/init-project" | timeout "$INIT_TIMEOUT" claude \
            --print \
            --plugin-dir "$PLUGIN_DIR" \
            --setting-sources local \
            --dangerously-skip-permissions \
            2>&1
    )
    local exit_code=$?
    set -e

    if [[ $exit_code -eq 124 ]]; then
        log_error "init-project timed out after ${INIT_TIMEOUT}s"
        return 1
    elif [[ $exit_code -ne 0 ]]; then
        log_error "init-project failed with exit code: $exit_code"
        log_debug "Output: $init_output"
        return 1
    fi

    log_success "init-project completed"

    # Validate that init-project completed all steps
    if [[ "$FORCE_SKIP_VALIDATION" == "true" ]]; then
        log_info "Skipping validation (--force-skip-validation)"
        return 0
    fi

    if ! validate_init_output "$workspace"; then
        log_error "init-project output validation failed"
        log_debug "Output: $init_output"
        return 1
    fi

    return 0
}

# Create full variant (initialized with .claude/)
create_full_variant() {
    local source="$1"
    local dest="$2"
    local temp_workspace="$3"

    log_info "Creating full variant..."

    if [[ "$DRY_RUN" == "true" ]]; then
        if [[ "$SKIP_INIT" == "true" ]]; then
            echo "  Would copy: $source -> $dest"
            echo "  Would skip init-project (--skip-init)"
        else
            echo "  Would copy: $source -> $temp_workspace"
            echo "  Would run init-project in $temp_workspace"
            echo "  Would copy result to: $dest"
        fi
        return 0
    fi

    if [[ "$SKIP_INIT" == "true" ]]; then
        # Just copy source without init
        mkdir -p "$(dirname "$dest")"
        cp -r "$source" "$dest"
        log_info "Skipped init-project (--skip-init)"
    else
        # Copy source to temp workspace
        cp -r "$source" "$temp_workspace"

        # Run init-project
        if ! run_init_project "$temp_workspace"; then
            log_error "Failed to initialize workspace"
            return 1
        fi

        # Copy initialized workspace to destination
        mkdir -p "$(dirname "$dest")"
        cp -r "$temp_workspace" "$dest"
    fi

    log_success "Created full variant"
}

# Create a component-removed variant
create_component_removed_variant() {
    local full_source="$1"
    local dest="$2"
    local variant_name="$3"
    local component_dir="${COMPONENT_DIRS[$variant_name]}"

    log_info "Creating $variant_name variant..."

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  Would copy: $full_source -> $dest"
        echo "  Would remove: $dest/$component_dir"
        return 0
    fi

    # Copy full variant to destination
    mkdir -p "$(dirname "$dest")"
    cp -r "$full_source" "$dest"

    # Remove the specific component directory
    if [[ -d "$dest/$component_dir" ]]; then
        rm -rf "$dest/$component_dir"
        log_success "Created $variant_name variant (removed $component_dir)"
    else
        log_info "$variant_name: $component_dir did not exist, skipping removal"
    fi
}

# Validate created variants
validate_variants() {
    local output_base="$1"
    local fixture_name="$2"

    log_info ""
    log_info "Validating variants..."

    local all_valid=true

    # Validate baseline
    local baseline_dir="$output_base/baseline/$fixture_name"
    if [[ -d "$baseline_dir" ]]; then
        if [[ -d "$baseline_dir/.claude" ]]; then
            log_error "baseline: FAILED - .claude/ directory exists"
            all_valid=false
        else
            log_success "baseline: OK (no .claude/)"
        fi
    else
        log_error "baseline: FAILED - directory not found"
        all_valid=false
    fi

    # Validate full
    local full_dir="$output_base/full/$fixture_name"
    if [[ -d "$full_dir" ]]; then
        local agents_count skills_count commands_count hooks_count
        agents_count=$(count_items "$full_dir/.claude/agents")
        skills_count=$(count_items "$full_dir/.claude/skills")
        commands_count=$(count_items "$full_dir/.claude/commands")
        hooks_count=$(count_items "$full_dir/.claude/hooks")

        if [[ -d "$full_dir/.claude" ]]; then
            log_success "full: OK (agents: $agents_count, commands: $commands_count, skills: $skills_count, hooks: $hooks_count)"
        else
            if [[ "$SKIP_INIT" == "true" ]]; then
                log_info "full: SKIPPED init (no .claude/)"
            else
                log_error "full: FAILED - .claude/ directory not created"
                all_valid=false
            fi
        fi
    else
        log_error "full: FAILED - directory not found"
        all_valid=false
    fi

    # Validate component-removed variants
    for variant in without-skills without-agents without-commands without-hooks; do
        local variant_dir="$output_base/$variant/$fixture_name"
        local component_dir="${COMPONENT_DIRS[$variant]}"

        if [[ -d "$variant_dir" ]]; then
            local agents_count skills_count commands_count hooks_count
            agents_count=$(count_items "$variant_dir/.claude/agents")
            skills_count=$(count_items "$variant_dir/.claude/skills")
            commands_count=$(count_items "$variant_dir/.claude/commands")
            hooks_count=$(count_items "$variant_dir/.claude/hooks")

            if [[ -d "$variant_dir/$component_dir" ]]; then
                log_error "$variant: FAILED - $component_dir still exists"
                all_valid=false
            else
                log_success "$variant: OK (agents: $agents_count, commands: $commands_count, skills: $skills_count, hooks: $hooks_count)"
            fi
        else
            log_error "$variant: FAILED - directory not found"
            all_valid=false
        fi
    done

    if [[ "$all_valid" == "true" ]]; then
        return 0
    else
        return 1
    fi
}

# Print summary
print_summary() {
    local output_base="$1"
    local fixture_name="$2"

    echo ""
    echo "Variants created for: $fixture_name"

    for variant in "${VARIANTS[@]}"; do
        local variant_dir="$output_base/$variant/$fixture_name"
        local status_icon

        if [[ -d "$variant_dir" ]]; then
            local agents_count skills_count commands_count hooks_count
            agents_count=$(count_items "$variant_dir/.claude/agents")
            skills_count=$(count_items "$variant_dir/.claude/skills")
            commands_count=$(count_items "$variant_dir/.claude/commands")
            hooks_count=$(count_items "$variant_dir/.claude/hooks")

            # Determine validation status
            if [[ "$variant" == "baseline" ]]; then
                if [[ ! -d "$variant_dir/.claude" ]]; then
                    status_icon="[PASS]"
                    echo "  $variant:         $status_icon (no .claude/)"
                else
                    status_icon="[FAIL]"
                    echo "  $variant:         $status_icon (has .claude/)"
                fi
            elif [[ "$variant" == "full" ]]; then
                status_icon="[PASS]"
                echo "  $variant:             $status_icon (agents: $agents_count, commands: $commands_count, skills: $skills_count, hooks: $hooks_count)"
            else
                local component_dir="${COMPONENT_DIRS[$variant]}"
                if [[ ! -d "$variant_dir/$component_dir" ]]; then
                    status_icon="[PASS]"
                else
                    status_icon="[FAIL]"
                fi
                echo "  $variant:   $status_icon (agents: $agents_count, commands: $commands_count, skills: $skills_count, hooks: $hooks_count)"
            fi
        else
            echo "  $variant: [MISSING]"
        fi
    done
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --fixture-name)
            FIXTURE_NAME="$2"
            shift 2
            ;;
        --plugin-dir)
            PLUGIN_DIR="$2"
            shift 2
            ;;
        --skip-init)
            SKIP_INIT=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --force-skip-validation)
            FORCE_SKIP_VALIDATION=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-git)
            NO_GIT=true
            shift
            ;;
        --branch)
            BRANCH_NAME="$2"
            shift 2
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
            if [[ -z "$FIXTURE_SOURCE" ]]; then
                FIXTURE_SOURCE="$1"
            elif [[ -z "$OUTPUT_DIR" ]]; then
                OUTPUT_DIR="$1"
            else
                log_error "Unexpected argument: $1"
                echo "Use --help for usage information" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

# Validate required arguments
if [[ -z "$FIXTURE_SOURCE" ]]; then
    log_error "Fixture source is required"
    echo "Use --help for usage information" >&2
    exit 1
fi

# Handle optional output-dir with git workflow
if [[ -z "$OUTPUT_DIR" ]]; then
    # Use default fixtures directory with git workflow
    OUTPUT_DIR="$DEFAULT_FIXTURES_DIR"
    USE_DEFAULT_OUTPUT=true
    log_info "Using default output directory: $OUTPUT_DIR"
fi

# If using default output and git is not disabled, require git
if [[ "$USE_DEFAULT_OUTPUT" == "true" ]] && [[ "$NO_GIT" != "true" ]]; then
    if ! command -v git &>/dev/null; then
        log_error "Git is required for default workflow"
        log_error "Use --no-git to skip git operations, or specify an output directory"
        exit 1
    fi
fi

# Validate fixture source exists
if [[ ! -d "$FIXTURE_SOURCE" ]]; then
    log_error "Fixture source directory not found: $FIXTURE_SOURCE"
    exit 1
fi

# Resolve to absolute path
FIXTURE_SOURCE="$(cd "$FIXTURE_SOURCE" && pwd)"

# Set default fixture name if not provided
if [[ -z "$FIXTURE_NAME" ]]; then
    FIXTURE_NAME="$(basename "$FIXTURE_SOURCE")"
fi

# Validate fixture name (no path chars)
if [[ "$FIXTURE_NAME" == *"/"* ]] || [[ "$FIXTURE_NAME" == *".."* ]]; then
    log_error "Invalid fixture name: $FIXTURE_NAME (cannot contain path characters)"
    exit 1
fi

# Create output directory
OUTPUT_BASE="$OUTPUT_DIR/variants"

# Check for existing variants
if [[ -d "$OUTPUT_BASE/baseline/$FIXTURE_NAME" ]] && [[ "$FORCE" != "true" ]] && [[ "$DRY_RUN" != "true" ]]; then
    log_error "Variants already exist for: $FIXTURE_NAME"
    log_error "Use --force to overwrite"
    exit 1
fi

# Validate claude CLI is available (unless dry-run or skip-init)
if [[ "$DRY_RUN" != "true" ]] && [[ "$SKIP_INIT" != "true" ]]; then
    if ! command -v claude &>/dev/null; then
        log_error "Claude CLI not found in PATH"
        log_error "Install Claude Code CLI or use --skip-init"
        exit 1
    fi
fi

# -----------------------------------------------------------------------------
# Dry Run Mode
# -----------------------------------------------------------------------------

if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN MODE ==="
    echo ""
    echo "Fixture Source: $FIXTURE_SOURCE"
    echo "Fixture Name: $FIXTURE_NAME"
    echo "Output Base: $OUTPUT_BASE"
    echo "Plugin Dir: $PLUGIN_DIR"
    echo "Skip Init: $SKIP_INIT"
    echo "Skip Validation: $FORCE_SKIP_VALIDATION"
    echo "No Git: $NO_GIT"
    echo "Branch: $BRANCH_NAME"
    echo ""

    if [[ "$USE_DEFAULT_OUTPUT" == "true" ]] && [[ "$NO_GIT" != "true" ]]; then
        echo "Git workflow:"
        echo "  Would clone: $DEFAULT_FIXTURES_REPO"
        echo "  To: $DEFAULT_FIXTURES_DIR"
        echo "  Branch: $BRANCH_NAME"
        echo ""
    fi

    echo "Would create:"
    for variant in "${VARIANTS[@]}"; do
        echo "  $OUTPUT_BASE/$variant/$FIXTURE_NAME/"
    done
    echo ""

    # Run through creation logic in dry-run mode
    create_baseline_variant "$FIXTURE_SOURCE" "$OUTPUT_BASE/baseline/$FIXTURE_NAME"
    create_full_variant "$FIXTURE_SOURCE" "$OUTPUT_BASE/full/$FIXTURE_NAME" "/tmp/workspace"

    for variant in without-skills without-agents without-commands without-hooks; do
        create_component_removed_variant \
            "$OUTPUT_BASE/full/$FIXTURE_NAME" \
            "$OUTPUT_BASE/$variant/$FIXTURE_NAME" \
            "$variant"
    done

    if [[ "$USE_DEFAULT_OUTPUT" == "true" ]] && [[ "$NO_GIT" != "true" ]]; then
        echo ""
        echo "Would commit changes after variant creation"
    fi

    exit 0
fi

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

# Set up cleanup trap
trap cleanup EXIT

# Create temporary directory for init-project workspace
TEMP_DIR="$(mktemp -d)"
log_debug "Created temp directory: $TEMP_DIR"

log_info "Preparing variants for: $FIXTURE_NAME"
log_info "  Source: $FIXTURE_SOURCE"
log_info "  Output: $OUTPUT_BASE"
log_info "  Plugin: $PLUGIN_DIR"
if [[ "$USE_DEFAULT_OUTPUT" == "true" ]] && [[ "$NO_GIT" != "true" ]]; then
    log_info "  Branch: $BRANCH_NAME"
fi
log_info ""

# Step 0: Setup git repository if using default workflow
if [[ "$USE_DEFAULT_OUTPUT" == "true" ]] && [[ "$NO_GIT" != "true" ]]; then
    setup_fixtures_repo "$OUTPUT_DIR" "$BRANCH_NAME" || {
        log_error "Failed to setup fixtures repository"
        exit 1
    }
fi

# Create output directory structure
mkdir -p "$OUTPUT_BASE"

# Step 1: Create baseline variant
if [[ "$FORCE" == "true" ]] && [[ -d "$OUTPUT_BASE/baseline/$FIXTURE_NAME" ]]; then
    rm -rf "$OUTPUT_BASE/baseline/$FIXTURE_NAME"
fi
create_baseline_variant "$FIXTURE_SOURCE" "$OUTPUT_BASE/baseline/$FIXTURE_NAME"

# Step 2: Create full variant (with init-project)
if [[ "$FORCE" == "true" ]] && [[ -d "$OUTPUT_BASE/full/$FIXTURE_NAME" ]]; then
    rm -rf "$OUTPUT_BASE/full/$FIXTURE_NAME"
fi
create_full_variant "$FIXTURE_SOURCE" "$OUTPUT_BASE/full/$FIXTURE_NAME" "$TEMP_DIR/workspace"

# Step 3: Create component-removed variants
for variant in without-skills without-agents without-commands without-hooks; do
    if [[ "$FORCE" == "true" ]] && [[ -d "$OUTPUT_BASE/$variant/$FIXTURE_NAME" ]]; then
        rm -rf "$OUTPUT_BASE/$variant/$FIXTURE_NAME"
    fi
    create_component_removed_variant \
        "$OUTPUT_BASE/full/$FIXTURE_NAME" \
        "$OUTPUT_BASE/$variant/$FIXTURE_NAME" \
        "$variant"
done

# Step 4: Validate and print summary
echo ""
validate_variants "$OUTPUT_BASE" "$FIXTURE_NAME"
print_summary "$OUTPUT_BASE" "$FIXTURE_NAME"

# Step 5: Commit changes if using git workflow
if [[ "$USE_DEFAULT_OUTPUT" == "true" ]] && [[ "$NO_GIT" != "true" ]]; then
    echo ""
    commit_fixture "$OUTPUT_DIR" "$FIXTURE_NAME"
    show_repo_status "$OUTPUT_DIR"
fi

log_info ""
log_info "Variant preparation complete: $OUTPUT_BASE"
