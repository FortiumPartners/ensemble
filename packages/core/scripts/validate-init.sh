#!/usr/bin/env bash
#
# validate-init.sh - Validation script for /init-project command
#
# Verifies that the vendored runtime is correctly set up after initialization.
# Returns exit code 0 if all checks pass, non-zero otherwise.
#
# Usage:
#   ./validate-init.sh [project-directory]
#
# If project-directory is not provided, uses current directory.
#
# TRD Reference: TRD-C007

set -euo pipefail

# Colors for output (disabled if not a terminal)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    NC=''
fi

# Counters
PASS=0
FAIL=0
WARN=0

# Project directory
PROJECT_DIR="${1:-.}"

# Output functions
pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASS++))
}

fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAIL++))
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    ((WARN++))
}

info() {
    echo -e "      $1"
}

# Header
echo "========================================"
echo " Ensemble Runtime Validation"
echo "========================================"
echo ""
echo "Project Directory: $PROJECT_DIR"
echo ""

# Change to project directory
cd "$PROJECT_DIR" || {
    fail "Cannot access project directory: $PROJECT_DIR"
    exit 1
}

# ========================================
# Section 1: Directory Structure
# ========================================
echo "--- Directory Structure ---"

# Check .claude/ directory
if [[ -d ".claude" ]]; then
    pass ".claude/ directory exists"
else
    fail ".claude/ directory missing"
fi

# Check subdirectories
for dir in ".claude/agents" ".claude/rules" ".claude/skills" ".claude/commands" ".claude/hooks"; do
    if [[ -d "$dir" ]]; then
        pass "$dir/ exists"
    else
        fail "$dir/ missing"
    fi
done

# Check docs structure
for dir in "docs/PRD" "docs/TRD"; do
    if [[ -d "$dir" ]]; then
        pass "$dir/ exists"
    else
        fail "$dir/ missing"
    fi
done

# Check .trd-state
if [[ -d ".trd-state" ]]; then
    pass ".trd-state/ directory exists"
else
    fail ".trd-state/ directory missing"
fi

echo ""

# ========================================
# Section 2: Required Agent Files
# ========================================
echo "--- Subagent Files ---"

REQUIRED_AGENTS=(
    "product-manager.md"
    "technical-architect.md"
    "spec-planner.md"
    "frontend-implementer.md"
    "backend-implementer.md"
    "mobile-implementer.md"
    "verify-app.md"
    "code-simplifier.md"
    "code-reviewer.md"
    "app-debugger.md"
    "devops-engineer.md"
    "cicd-specialist.md"
)

AGENT_COUNT=0
for agent in "${REQUIRED_AGENTS[@]}"; do
    if [[ -f ".claude/agents/$agent" ]]; then
        ((AGENT_COUNT++))
    else
        fail "Missing agent: $agent"
    fi
done

if [[ $AGENT_COUNT -eq ${#REQUIRED_AGENTS[@]} ]]; then
    pass "All 12 subagents present"
else
    info "Found $AGENT_COUNT of ${#REQUIRED_AGENTS[@]} agents"
fi

echo ""

# ========================================
# Section 3: Governance Files
# ========================================
echo "--- Governance Files ---"

for file in ".claude/rules/constitution.md" ".claude/rules/stack.md" ".claude/rules/process.md"; do
    if [[ -f "$file" ]]; then
        pass "$file exists"
        # Check file is not empty
        if [[ ! -s "$file" ]]; then
            warn "$file is empty"
        fi
    else
        fail "$file missing"
    fi
done

echo ""

# ========================================
# Section 4: Hook Files
# ========================================
echo "--- Hook Files ---"

REQUIRED_HOOKS=(
    "permitter.js"
    "router.py"
    "status.js"
)

OPTIONAL_HOOKS=(
    "formatter.sh"
    "learning.js"
)

for hook in "${REQUIRED_HOOKS[@]}"; do
    if [[ -f ".claude/hooks/$hook" ]]; then
        pass ".claude/hooks/$hook exists"
        # Check executable permission for shell scripts
        if [[ "$hook" == *.sh ]] && [[ ! -x ".claude/hooks/$hook" ]]; then
            warn ".claude/hooks/$hook is not executable"
        fi
    else
        fail "Missing required hook: $hook"
    fi
done

for hook in "${OPTIONAL_HOOKS[@]}"; do
    if [[ -f ".claude/hooks/$hook" ]]; then
        pass ".claude/hooks/$hook exists (optional)"
        if [[ "$hook" == *.sh ]] && [[ ! -x ".claude/hooks/$hook" ]]; then
            warn ".claude/hooks/$hook is not executable"
        fi
    else
        warn "Optional hook missing: $hook"
    fi
done

echo ""

# ========================================
# Section 5: JSON Configuration Files
# ========================================
echo "--- Configuration Files ---"

validate_json() {
    local file=$1
    if [[ -f "$file" ]]; then
        if command -v jq &> /dev/null; then
            if jq empty "$file" 2>/dev/null; then
                pass "$file is valid JSON"
            else
                fail "$file contains invalid JSON"
            fi
        elif command -v python3 &> /dev/null; then
            if python3 -c "import json; json.load(open('$file'))" 2>/dev/null; then
                pass "$file is valid JSON"
            else
                fail "$file contains invalid JSON"
            fi
        elif command -v node &> /dev/null; then
            if node -e "JSON.parse(require('fs').readFileSync('$file', 'utf8'))" 2>/dev/null; then
                pass "$file is valid JSON"
            else
                fail "$file contains invalid JSON"
            fi
        else
            warn "Cannot validate $file - no JSON parser available (jq, python3, or node)"
        fi
    else
        fail "$file missing"
    fi
}

validate_json ".claude/settings.json"
validate_json ".claude/router-rules.json"
validate_json ".trd-state/current.json"

echo ""

# ========================================
# Section 6: .gitignore Check
# ========================================
echo "--- .gitignore Configuration ---"

if [[ -f ".gitignore" ]]; then
    pass ".gitignore exists"

    # Check for required patterns
    REQUIRED_PATTERNS=(
        "settings.local.json"
        ".env"
    )

    for pattern in "${REQUIRED_PATTERNS[@]}"; do
        if grep -q "$pattern" .gitignore 2>/dev/null; then
            pass ".gitignore includes '$pattern'"
        else
            warn ".gitignore missing pattern: '$pattern'"
        fi
    done

    # Ensure .claude/ is NOT ignored
    if grep -q "^\.claude/$" .gitignore 2>/dev/null || grep -q "^\.claude$" .gitignore 2>/dev/null; then
        fail ".gitignore incorrectly excludes .claude/ (should be tracked)"
    else
        pass ".claude/ is not excluded (correctly tracked)"
    fi

    # Ensure .trd-state/ is NOT ignored
    if grep -q "^\.trd-state/$" .gitignore 2>/dev/null || grep -q "^\.trd-state$" .gitignore 2>/dev/null; then
        fail ".gitignore incorrectly excludes .trd-state/ (should be tracked)"
    else
        pass ".trd-state/ is not excluded (correctly tracked)"
    fi
else
    warn ".gitignore not found"
fi

echo ""

# ========================================
# Section 7: Skills Directory
# ========================================
echo "--- Skills Directory ---"

if [[ -d ".claude/skills" ]]; then
    SKILL_COUNT=$(find .claude/skills -name "SKILL.md" -type f 2>/dev/null | wc -l)
    if [[ $SKILL_COUNT -gt 0 ]]; then
        pass "Found $SKILL_COUNT skill(s) installed"
    else
        warn "No skills installed (skills may be optional based on stack)"
    fi
else
    fail ".claude/skills/ directory missing"
fi

echo ""

# ========================================
# Section 8: Commands Directory
# ========================================
echo "--- Commands Directory ---"

if [[ -d ".claude/commands" ]]; then
    CMD_COUNT=$(find .claude/commands -name "*.md" -type f 2>/dev/null | wc -l)
    if [[ $CMD_COUNT -gt 0 ]]; then
        pass "Found $CMD_COUNT command(s) installed"
    else
        warn "No commands installed"
    fi
else
    fail ".claude/commands/ directory missing"
fi

echo ""

# ========================================
# Section 9: Optional Files Check
# ========================================
echo "--- Optional Files ---"

if [[ -f "CLAUDE.md" ]]; then
    pass "CLAUDE.md exists at project root"
else
    warn "CLAUDE.md not found (optional but recommended)"
fi

echo ""

# ========================================
# Summary
# ========================================
echo "========================================"
echo " Validation Summary"
echo "========================================"
echo ""
echo -e "${GREEN}Passed:${NC} $PASS"
echo -e "${RED}Failed:${NC} $FAIL"
echo -e "${YELLOW}Warnings:${NC} $WARN"
echo ""

if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}Validation PASSED${NC} - Ensemble runtime is correctly configured"
    exit 0
else
    echo -e "${RED}Validation FAILED${NC} - Please fix the issues above"
    echo ""
    echo "Common fixes:"
    echo "  - Run /init-project again with 'force' to regenerate"
    echo "  - Check file permissions"
    echo "  - Verify JSON syntax in configuration files"
    exit 1
fi
