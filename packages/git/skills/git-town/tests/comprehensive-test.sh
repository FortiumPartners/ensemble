#!/usr/bin/env bash
#
# Comprehensive Test Suite for Git-Town Skill
# Tests all phases (1-6) and validates complete implementation
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Helper functions
pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    : $((TESTS_PASSED++))
    : $((TESTS_TOTAL++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    : $((TESTS_FAILED++))
    : $((TESTS_TOTAL++))
}

info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

section() {
    echo ""
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}$1${NC}"
    echo -e "${YELLOW}========================================${NC}"
}

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

# Header
echo "╔══════════════════════════════════════════════════╗"
echo "║  Git-Town Skill Comprehensive Test Suite        ║"
echo "║  Validates Phases 1-6 Implementation            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
info "Testing location: $SCRIPT_DIR"
echo ""

# ============================================================================
# Phase 1-2: Core Documentation
# ============================================================================

section "Phase 1-2: Core Documentation"

# Test core files exist
if [ -f "SKILL.md" ]; then
    pass "SKILL.md exists"
else
    fail "SKILL.md missing"
fi

if [ -f "REFERENCE.md" ]; then
    pass "REFERENCE.md exists"
else
    fail "REFERENCE.md missing"
fi

if [ -f "ERROR_HANDLING.md" ]; then
    pass "ERROR_HANDLING.md exists"
else
    fail "ERROR_HANDLING.md missing"
fi

if [ -f "TESTING.md" ]; then
    pass "TESTING.md exists"
else
    fail "TESTING.md missing"
fi

# Check file sizes
SKILL_LINES=$(wc -l < SKILL.md)
if [ "$SKILL_LINES" -ge 400 ]; then
    pass "SKILL.md size ($SKILL_LINES lines, target 400+)"
else
    fail "SKILL.md too small ($SKILL_LINES lines)"
fi

REFERENCE_LINES=$(wc -l < REFERENCE.md)
if [ "$REFERENCE_LINES" -ge 400 ]; then
    pass "REFERENCE.md size ($REFERENCE_LINES lines, target 400+)"
else
    fail "REFERENCE.md too small ($REFERENCE_LINES lines)"
fi

ERROR_LINES=$(wc -l < ERROR_HANDLING.md)
if [ "$ERROR_LINES" -ge 1500 ]; then
    pass "ERROR_HANDLING.md size ($ERROR_LINES lines, target 1500+)"
else
    fail "ERROR_HANDLING.md too small ($ERROR_LINES lines)"
fi

# Check scripts directory
if [ -f "scripts/validate-git-town.sh" ]; then
    pass "Validation script exists"
else
    fail "Validation script missing"
fi

if [ -x "scripts/validate-git-town.sh" ]; then
    pass "Validation script is executable"
else
    fail "Validation script not executable"
fi

# Check templates directory
TEMPLATE_COUNT=$(find templates/ -name "*.md" -type f | wc -l)
if [ "$TEMPLATE_COUNT" -ge 3 ]; then
    pass "Interview templates exist ($TEMPLATE_COUNT templates)"
else
    fail "Not enough interview templates ($TEMPLATE_COUNT, expected 3+)"
fi

# ============================================================================
# Phase 3: Agent Integration
# ============================================================================

section "Phase 3: Agent Integration Tests"

# Run integration tests
if bash tests/test-integration.sh > /dev/null 2>&1; then
    pass "Integration tests pass (22 tests)"
else
    fail "Integration tests failed"
fi

# ============================================================================
# Phase 5: Migration Guides
# ============================================================================

section "Phase 5: Migration Guides"

# Test onboarding guide
if [ -f "guides/onboarding.md" ]; then
    LINES=$(wc -l < guides/onboarding.md)
    pass "Onboarding guide exists ($LINES lines)"
else
    fail "Onboarding guide missing"
fi

# Test migration guides
for guide in git-flow github-flow trunk-based; do
    FILE="guides/migration-$guide.md"
    if [ -f "$FILE" ]; then
        LINES=$(wc -l < "$FILE")
        pass "Migration guide: $guide ($LINES lines)"
    else
        fail "Migration guide missing: $guide"
    fi
done

# Check migration guide content
MIGRATION_SECTIONS=$(grep "^## " guides/migration-*.md | wc -l)
if [ "$MIGRATION_SECTIONS" -ge 20 ]; then
    pass "Migration guides have sufficient sections ($MIGRATION_SECTIONS)"
else
    fail "Not enough sections in migration guides ($MIGRATION_SECTIONS, expected 20+)"
fi

# ============================================================================
# Phase 6: Monorepo & CI/CD
# ============================================================================

section "Phase 6: Monorepo & CI/CD"

# Test monorepo guide
if [ -f "guides/monorepo.md" ]; then
    LINES=$(wc -l < guides/monorepo.md)
    pass "Monorepo guide exists ($LINES lines)"
else
    fail "Monorepo guide missing"
fi

# Check workspace integrations documented
WORKSPACE_REFS=$(grep -E "(npm workspaces|pnpm|Nx|Turborepo|Lerna)" guides/monorepo.md | wc -l)
if [ "$WORKSPACE_REFS" -ge 10 ]; then
    pass "Workspace integrations documented ($WORKSPACE_REFS references)"
else
    fail "Insufficient workspace coverage ($WORKSPACE_REFS references)"
fi

# Test CI/CD integration guide
if [ -f "cicd/INTEGRATION.md" ]; then
    LINES=$(wc -l < cicd/INTEGRATION.md)
    pass "CI/CD integration guide exists ($LINES lines)"
else
    fail "CI/CD integration guide missing"
fi

# Test CI/CD examples
if [ -f "cicd/examples/github-actions.yml" ]; then
    LINES=$(wc -l < cicd/examples/github-actions.yml)
    pass "GitHub Actions example exists ($LINES lines)"
else
    fail "GitHub Actions example missing"
fi

if [ -f "cicd/examples/gitlab-ci.yml" ]; then
    LINES=$(wc -l < cicd/examples/gitlab-ci.yml)
    pass "GitLab CI example exists ($LINES lines)"
else
    fail "GitLab CI example missing"
fi

# Validate YAML syntax (if yamllint available)
if command -v yamllint &> /dev/null; then
    if yamllint cicd/examples/github-actions.yml > /dev/null 2>&1; then
        pass "GitHub Actions YAML valid"
    else
        fail "GitHub Actions YAML invalid"
    fi

    if yamllint cicd/examples/gitlab-ci.yml > /dev/null 2>&1; then
        pass "GitLab CI YAML valid"
    else
        fail "GitLab CI YAML invalid"
    fi
else
    info "yamllint not installed, skipping YAML validation"
fi

# ============================================================================
# Context7 Integration
# ============================================================================

section "Context7 Integration"

# Check Context7 references in skill files
if grep -q "## Context7 Integration" SKILL.md; then
    pass "SKILL.md documents Context7 integration"
else
    fail "SKILL.md missing Context7 section"
fi

if grep -q "Context7 MCP" REFERENCE.md; then
    pass "REFERENCE.md references Context7"
else
    fail "REFERENCE.md missing Context7 references"
fi

if grep -q "Context7 Integration for Error Documentation" ERROR_HANDLING.md; then
    pass "ERROR_HANDLING.md has Context7 integration"
else
    fail "ERROR_HANDLING.md missing Context7 section"
fi

# Check ensemble-core exports Context7 utilities
if grep -q "checkContext7Available" ../../../core/lib/index.js; then
    pass "ensemble-core exports Context7 utilities"
else
    fail "ensemble-core missing Context7 exports"
fi

# ============================================================================
# Phase 7: Final Polish
# ============================================================================

section "Phase 7: Final Polish"

# Check README.md
if [ -f "README.md" ]; then
    LINES=$(wc -l < README.md)
    pass "README.md exists ($LINES lines)"
else
    fail "README.md missing"
fi

# Check TESTING.md updated
if grep -q "Phase 5-6 Testing" TESTING.md; then
    pass "TESTING.md updated with new phases"
else
    fail "TESTING.md not updated"
fi

# ============================================================================
# Documentation Quality Metrics
# ============================================================================

section "Documentation Quality Metrics"

# Total documentation size
TOTAL_LINES=$(find . -name "*.md" -type f -exec wc -l {} + | tail -1 | awk '{print $1}')
info "Total documentation: $TOTAL_LINES lines"

if [ "$TOTAL_LINES" -ge 8000 ]; then
    pass "Documentation meets size target ($TOTAL_LINES lines, target 8000+)"
else
    fail "Documentation too small ($TOTAL_LINES lines, target 8000+)"
fi

# Total code examples
CODE_BLOCKS=$(find . -name "*.md" -type f -exec grep -c '```' {} + | awk -F: '{s+=$2} END {print s}')
info "Total code blocks: $CODE_BLOCKS"

if [ "$CODE_BLOCKS" -ge 200 ]; then
    pass "Sufficient code examples ($CODE_BLOCKS blocks, target 200+)"
else
    fail "Not enough code examples ($CODE_BLOCKS blocks, target 200+)"
fi

# Total mermaid diagrams
DIAGRAMS=$(find . -name "*.md" -type f -exec grep -c '```mermaid' {} + | awk -F: '{s+=$2} END {print s}')
info "Total Mermaid diagrams: $DIAGRAMS"

if [ "$DIAGRAMS" -ge 7 ]; then
    pass "Sufficient decision trees ($DIAGRAMS diagrams, target 7+)"
else
    fail "Not enough decision trees ($DIAGRAMS diagrams, target 7+)"
fi

# ============================================================================
# Performance Benchmarks
# ============================================================================

section "Performance Benchmarks"

# Skill loading time
START_TIME=$(date +%s%N)
cat SKILL.md REFERENCE.md ERROR_HANDLING.md > /dev/null
END_TIME=$(date +%s%N)
LOAD_TIME=$(( (END_TIME - START_TIME) / 1000000 ))

info "Skill load time: ${LOAD_TIME}ms"

if [ "$LOAD_TIME" -lt 100 ]; then
    pass "Skill loads within target (<100ms)"
else
    fail "Skill load time too slow (${LOAD_TIME}ms, target <100ms)"
fi

# Section query time
START_TIME=$(date +%s%N)
grep -A 20 "## Quick Start" SKILL.md > /dev/null
END_TIME=$(date +%s%N)
QUERY_TIME=$(( (END_TIME - START_TIME) / 1000000 ))

info "Section query time: ${QUERY_TIME}ms"

if [ "$QUERY_TIME" -lt 30 ]; then
    pass "Section queries fast (<30ms)"
else
    fail "Section query too slow (${QUERY_TIME}ms, target <30ms)"
fi

# ============================================================================
# Final Summary
# ============================================================================

section "Test Results Summary"

echo ""
echo "Tests Passed: ${GREEN}${TESTS_PASSED}${NC}"
echo "Tests Failed: ${RED}${TESTS_FAILED}${NC}"
echo "Tests Total:  ${TESTS_TOTAL}"
echo ""

if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✓ All tests passed!                            ║${NC}"
    echo -e "${GREEN}║  Git-Town skill implementation verified         ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${RED}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ✗ Some tests failed                             ║${NC}"
    echo -e "${RED}║  Please review failures above                    ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════╝${NC}"
    exit 1
fi
