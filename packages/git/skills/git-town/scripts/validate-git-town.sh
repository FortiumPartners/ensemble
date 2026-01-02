#!/usr/bin/env bash
# validate-git-town.sh
# Cross-platform validation script for git-town installation and configuration
#
# Platform support:
# - macOS: Bash 3.2+
# - Linux: Bash 4.0+
# - Windows: Git Bash 4.4+
#
# Exit codes:
# 0 - Success (all checks passed)
# 1 - git-town not found
# 2 - git-town not configured
# 3 - git-town version too old (< 14.0.0)
# 4 - not a git repository

set -euo pipefail

# Exit code constants
readonly EXIT_SUCCESS=0
readonly EXIT_NOT_FOUND=1
readonly EXIT_NOT_CONFIGURED=2
readonly EXIT_OLD_VERSION=3
readonly EXIT_NOT_GIT_REPO=4

# Minimum required version
readonly MIN_VERSION_MAJOR=14
readonly MIN_VERSION_MINOR=0
readonly MIN_VERSION_PATCH=0

# Color codes for output (disabled if not a terminal)
if [ -t 1 ]; then
    readonly RED='\033[0;31m'
    readonly GREEN='\033[0;32m'
    readonly YELLOW='\033[1;33m'
    readonly BLUE='\033[0;34m'
    readonly NC='\033[0m'
else
    readonly RED=''
    readonly GREEN=''
    readonly YELLOW=''
    readonly BLUE=''
    readonly NC=''
fi

# Detect platform
# Returns: macos, linux, windows, or unknown
detect_platform() {
    local platform="unknown"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        platform="macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "linux"* ]]; then
        platform="linux"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        platform="windows"
    fi

    echo "$platform"
}

# Check if git-town is installed
# Returns: 0 if found, 1 if not found
check_git_town_installed() {
    if command -v git-town > /dev/null 2>&1; then
        return "$EXIT_SUCCESS"
    else
        return "$EXIT_NOT_FOUND"
    fi
}

# Check git-town version meets minimum requirements
# Returns: 0 if version is sufficient, 3 if too old, 1 if not found
check_git_town_version() {
    if ! check_git_town_installed; then
        return "$EXIT_NOT_FOUND"
    fi

    # Get version string (e.g., "14.2.0")
    local version_output
    version_output=$(git-town --version 2>/dev/null || echo "")

    # Extract version number using grep with POSIX-compatible regex
    local version
    version=$(echo "$version_output" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)

    if [ -z "$version" ]; then
        return "$EXIT_OLD_VERSION"
    fi

    # Parse version components
    local major minor patch
    major=$(echo "$version" | cut -d. -f1)
    minor=$(echo "$version" | cut -d. -f2)
    patch=$(echo "$version" | cut -d. -f3)

    # Compare version (major.minor.patch)
    if [ "$major" -lt "$MIN_VERSION_MAJOR" ]; then
        return "$EXIT_OLD_VERSION"
    elif [ "$major" -eq "$MIN_VERSION_MAJOR" ]; then
        if [ "$minor" -lt "$MIN_VERSION_MINOR" ]; then
            return "$EXIT_OLD_VERSION"
        elif [ "$minor" -eq "$MIN_VERSION_MINOR" ]; then
            if [ "$patch" -lt "$MIN_VERSION_PATCH" ]; then
                return "$EXIT_OLD_VERSION"
            fi
        fi
    fi

    return "$EXIT_SUCCESS"
}

# Check if current directory is a git repository
# Returns: 0 if in git repo, 4 if not
check_git_repository() {
    if git rev-parse --git-dir > /dev/null 2>&1; then
        return "$EXIT_SUCCESS"
    else
        return "$EXIT_NOT_GIT_REPO"
    fi
}

# Check if git-town is configured
# Returns: 0 if configured, 2 if not configured, 4 if not a git repo
check_git_town_config() {
    if ! check_git_repository; then
        return "$EXIT_NOT_GIT_REPO"
    fi

    # Check for main branch configuration (required for git-town)
    if git config --get git-town.main-branch > /dev/null 2>&1; then
        return "$EXIT_SUCCESS"
    else
        return "$EXIT_NOT_CONFIGURED"
    fi
}

# Print error message to stderr
print_error() {
    echo -e "${RED}ERROR:${NC} $*" >&2
}

# Print warning message to stderr
print_warning() {
    echo -e "${YELLOW}WARNING:${NC} $*" >&2
}

# Print success message
print_success() {
    echo -e "${GREEN}✓${NC} $*"
}

# Print info message
print_info() {
    echo -e "${BLUE}ℹ${NC} $*"
}

# Main validation function
# Returns: appropriate exit code based on validation results
validate_git_town() {
    local platform
    platform=$(detect_platform)

    print_info "Platform detected: $platform"
    echo ""

    # Check 1: git-town installed
    if ! check_git_town_installed; then
        print_error "git-town is not installed or not in PATH"
        echo ""
        echo "Installation instructions:"
        case "$platform" in
            macos)
                echo "  brew install git-town"
                ;;
            linux)
                echo "  See: https://www.git-town.com/install"
                ;;
            windows)
                echo "  scoop install git-town"
                echo "  Or download from: https://github.com/git-town/git-town/releases"
                ;;
            *)
                echo "  See: https://www.git-town.com/install"
                ;;
        esac
        return "$EXIT_NOT_FOUND"
    fi
    print_success "git-town is installed"

    # Check 2: git-town version
    local version_output
    version_output=$(git-town --version 2>/dev/null)
    local version
    version=$(echo "$version_output" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)

    if ! check_git_town_version; then
        print_error "git-town version $version is too old (minimum: ${MIN_VERSION_MAJOR}.${MIN_VERSION_MINOR}.${MIN_VERSION_PATCH})"
        echo ""
        echo "Update instructions:"
        case "$platform" in
            macos)
                echo "  brew upgrade git-town"
                ;;
            linux)
                echo "  See: https://www.git-town.com/install"
                ;;
            windows)
                echo "  scoop update git-town"
                ;;
            *)
                echo "  See: https://www.git-town.com/install"
                ;;
        esac
        return "$EXIT_OLD_VERSION"
    fi
    print_success "git-town version $version meets minimum requirements"

    # Check 3: git repository
    if ! check_git_repository; then
        print_error "Not in a git repository"
        echo ""
        echo "Run this script from within a git repository."
        return "$EXIT_NOT_GIT_REPO"
    fi
    print_success "Current directory is a git repository"

    # Check 4: git-town configuration
    if ! check_git_town_config; then
        print_warning "git-town is not configured for this repository"
        echo ""
        echo "Configuration instructions:"
        echo "  git town config setup"
        echo ""
        echo "This will guide you through:"
        echo "  - Setting the main branch (e.g., main, master)"
        echo "  - Defining perennial branches (e.g., develop, staging)"
        echo "  - Configuring contribution branches"
        return "$EXIT_NOT_CONFIGURED"
    fi

    local main_branch
    main_branch=$(git config --get git-town.main-branch)
    print_success "git-town is configured (main branch: $main_branch)"

    echo ""
    print_success "All validation checks passed!"
    return "$EXIT_SUCCESS"
}

# Run validation if script is executed directly (not sourced)
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    validate_git_town
    exit $?
fi
