#!/usr/bin/env bash
# validate-jj-vcs.sh
# Cross-platform validation for jj + git-town + gh CLI
#
# Tool chain: jj (local) -> git-town (remote workflow) -> git (transport)
#
# Exit codes:
# 0 - Success (all checks passed)
# 1 - jj not found
# 2 - Not a jj repository
# 3 - jj version too old (< 0.25.0)
# 4 - Not a git repository
# 5 - gh CLI not installed or not authenticated
# 6 - git-town not installed or not configured

set -euo pipefail

# Exit code constants
readonly EXIT_SUCCESS=0
readonly EXIT_NOT_FOUND=1
readonly EXIT_NOT_JJ_REPO=2
readonly EXIT_OLD_VERSION=3
readonly EXIT_NOT_GIT_REPO=4
readonly EXIT_GH_NOT_READY=5
readonly EXIT_GIT_TOWN_NOT_READY=6

# Minimum required versions
readonly JJ_MIN_MAJOR=0
readonly JJ_MIN_MINOR=25
readonly JJ_MIN_PATCH=0
readonly GT_MIN_MAJOR=14
readonly GT_MIN_MINOR=0
readonly GT_MIN_PATCH=0

# Color codes (disabled if not a terminal)
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

detect_platform() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "linux"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

check_jj_installed() {
    command -v jj > /dev/null 2>&1
}

check_jj_version() {
    check_jj_installed || return "$EXIT_NOT_FOUND"
    local version
    version=$(jj --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    [ -z "$version" ] && return "$EXIT_OLD_VERSION"
    local major minor patch
    major=$(echo "$version" | cut -d. -f1)
    minor=$(echo "$version" | cut -d. -f2)
    patch=$(echo "$version" | cut -d. -f3)
    if [ "$major" -lt "$JJ_MIN_MAJOR" ]; then return "$EXIT_OLD_VERSION"
    elif [ "$major" -eq "$JJ_MIN_MAJOR" ]; then
        if [ "$minor" -lt "$JJ_MIN_MINOR" ]; then return "$EXIT_OLD_VERSION"
        elif [ "$minor" -eq "$JJ_MIN_MINOR" ] && [ "$patch" -lt "$JJ_MIN_PATCH" ]; then return "$EXIT_OLD_VERSION"
        fi
    fi
    return "$EXIT_SUCCESS"
}

check_git_repository() {
    git rev-parse --git-dir > /dev/null 2>&1
}

check_jj_repository() {
    jj root > /dev/null 2>&1
}

check_gh_cli() {
    command -v gh > /dev/null 2>&1 && gh auth status > /dev/null 2>&1
}

check_git_town_installed() {
    command -v git-town > /dev/null 2>&1
}

check_git_town_version() {
    check_git_town_installed || return "$EXIT_GIT_TOWN_NOT_READY"
    local version
    version=$(git-town --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    [ -z "$version" ] && return "$EXIT_GIT_TOWN_NOT_READY"
    local major
    major=$(echo "$version" | cut -d. -f1)
    [ "$major" -lt "$GT_MIN_MAJOR" ] && return "$EXIT_GIT_TOWN_NOT_READY"
    return "$EXIT_SUCCESS"
}

check_git_town_configured() {
    check_git_repository || return "$EXIT_NOT_GIT_REPO"
    git config --get git-town.main-branch > /dev/null 2>&1
}

check_jst_available() {
    command -v jst > /dev/null 2>&1
}

print_error()   { echo -e "${RED}ERROR:${NC} $*" >&2; }
print_warning() { echo -e "${YELLOW}WARNING:${NC} $*" >&2; }
print_success() { echo -e "${GREEN}✓${NC} $*"; }
print_info()    { echo -e "${BLUE}ℹ${NC} $*"; }

validate_jj_vcs() {
    local platform
    platform=$(detect_platform)
    print_info "Platform detected: $platform"
    echo ""

    # Check 1: jj installed
    if ! check_jj_installed; then
        print_error "jj is not installed or not in PATH"
        echo ""
        case "$platform" in
            macos)  echo "  brew install jj" ;;
            linux)  echo "  cargo install --locked --bin jj jj-cli" ;;
            *)      echo "  See: https://jj-vcs.github.io/jj/latest/install/" ;;
        esac
        return "$EXIT_NOT_FOUND"
    fi
    print_success "jj is installed"

    # Check 2: jj version
    local jj_version
    jj_version=$(jj --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    if ! check_jj_version; then
        print_error "jj version $jj_version is too old (minimum: ${JJ_MIN_MAJOR}.${JJ_MIN_MINOR}.${JJ_MIN_PATCH})"
        return "$EXIT_OLD_VERSION"
    fi
    print_success "jj version $jj_version meets minimum requirements"

    # Check 3: git repository
    if ! check_git_repository; then
        print_error "Not in a git repository"
        return "$EXIT_NOT_GIT_REPO"
    fi
    print_success "Current directory is a git repository"

    # Check 4: jj repository
    if ! check_jj_repository; then
        print_warning "Not a jj repository. Initialize with:"
        echo "  jj git init --colocate"
        return "$EXIT_NOT_JJ_REPO"
    fi
    print_success "Current directory is a jj repository (colocated)"

    # Check 5: gh CLI
    if ! check_gh_cli; then
        print_warning "GitHub CLI (gh) is not installed or not authenticated"
        echo "  Install: brew install gh"
        echo "  Auth: gh auth login"
        return "$EXIT_GH_NOT_READY"
    fi
    print_success "GitHub CLI (gh) is installed and authenticated"

    # Check 6: git-town
    if ! check_git_town_installed; then
        print_warning "git-town is not installed"
        case "$platform" in
            macos)  echo "  brew install git-town" ;;
            *)      echo "  See: https://www.git-town.com/install" ;;
        esac
        return "$EXIT_GIT_TOWN_NOT_READY"
    fi

    local gt_version
    gt_version=$(git-town --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    if ! check_git_town_version; then
        print_error "git-town version $gt_version is too old (minimum: ${GT_MIN_MAJOR}.${GT_MIN_MINOR}.${GT_MIN_PATCH})"
        return "$EXIT_GIT_TOWN_NOT_READY"
    fi
    print_success "git-town version $gt_version meets minimum requirements"

    if ! check_git_town_configured; then
        print_warning "git-town is not configured for this repository"
        echo "  Run: git town config set-main-branch main"
        return "$EXIT_GIT_TOWN_NOT_READY"
    fi
    local main_branch
    main_branch=$(git config --get git-town.main-branch)
    print_success "git-town is configured (main branch: $main_branch)"

    # Optional: jst
    echo ""
    if check_jst_available; then
        print_success "jj-stack (jst) is available (optional)"
    else
        print_info "jj-stack (jst) is not installed (optional)"
        echo "  Install: cargo install jj-stack"
    fi

    echo ""
    print_success "All validation checks passed!"
    print_info "Tool chain: jj -> git-town -> git"
    return "$EXIT_SUCCESS"
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    validate_jj_vcs
    exit $?
fi
