# Git-Town Skill Testing Guide

This guide explains how to test the git-town skill implementation (Phases 1 & 2).

## Quick Test (30 seconds)

Run the automated test suite:

```bash
cd packages/git/skills/git-town

# Test 1: Run validation script tests
bash scripts/test-validate.sh

# Test 2: Run validation script
bash scripts/validate-git-town.sh

# Test 3: Check file structure
ls -la scripts/ templates/ guides/
```

**Expected Results**:
- ✓ Test suite: "All tests passed!" (10/10)
- ✓ Validation: "All validation checks passed!"
- ✓ Files: All directories should have files

---

## Detailed Testing (5 minutes)

### 1. File Existence Test

```bash
# Check all required files exist
test -f SKILL.md && echo "✓ SKILL.md exists"
test -f REFERENCE.md && echo "✓ REFERENCE.md exists"
test -f ERROR_HANDLING.md && echo "✓ ERROR_HANDLING.md exists"
test -f scripts/validate-git-town.sh && echo "✓ Validation script exists"
test -f templates/interview-branch-creation.md && echo "✓ Branch template exists"
test -f templates/interview-pr-creation.md && echo "✓ PR template exists"
test -f templates/interview-completion.md && echo "✓ Completion template exists"
```

### 2. Documentation Quality Test

```bash
# Check word counts (should meet TRD requirements)
echo "SKILL.md lines: $(wc -l < SKILL.md) (target: 400-600)"
echo "REFERENCE.md lines: $(wc -l < REFERENCE.md) (target: 800+)"
echo "ERROR_HANDLING.md lines: $(wc -l < ERROR_HANDLING.md) (target: 1500+)"

# Check for required sections
grep -c "## Mission" SKILL.md && echo "✓ SKILL.md has Mission section"
grep -c "## Quick Start" SKILL.md && echo "✓ SKILL.md has Quick Start section"
grep -c "```mermaid" REFERENCE.md && echo "  Mermaid diagrams in REFERENCE.md"
grep -c "```mermaid" ERROR_HANDLING.md && echo "  Mermaid diagrams in ERROR_HANDLING.md"
```

### 3. YAML Frontmatter Test

```bash
# Extract and validate YAML frontmatter
head -20 SKILL.md | grep -A 10 "^---$"

# Check interview templates have frontmatter
head -30 templates/interview-branch-creation.md | grep "template_type"
head -30 templates/interview-pr-creation.md | grep "template_type"
head -30 templates/interview-completion.md | grep "template_type"
```

### 4. Exit Code Documentation Test

```bash
# Check exit codes are documented
for code in {0..10}; do
  grep -q "EXIT.*$code" REFERENCE.md && echo "✓ Exit code $code documented"
done
```

### 5. Mermaid Diagram Test

```bash
# Count Mermaid diagrams (should be 10 total)
echo "Mermaid diagrams:"
echo "  REFERENCE.md: $(grep -c '```mermaid' REFERENCE.md)"
echo "  ERROR_HANDLING.md: $(grep -c '```mermaid' ERROR_HANDLING.md)"
echo "  Total: $(grep -c '```mermaid' REFERENCE.md ERROR_HANDLING.md)"
```

To visually verify Mermaid diagrams render correctly:
1. Open any `.md` file in GitHub, VS Code with Markdown Preview, or [Mermaid Live Editor](https://mermaid.live)
2. Check that flowcharts display with proper colors and connections

---

## Integration Testing (10 minutes)

### Automated Integration Tests

Run the comprehensive integration test suite (GT-018 and GT-019):

```bash
# Run automated integration tests
bash tests/test-integration.sh
```

**What it tests:**
- GT-018: Agent executes git-town workflow via skill
  - Skill file accessibility and loading performance
  - Branch creation workflow with explicit CLI flags
  - Interview template validation
  - Skill query syntax
- GT-019: Agent handles merge conflict error
  - ERROR_HANDLING.md merge conflict documentation
  - Exit code mapping and documentation
  - Mermaid decision trees for error recovery
  - Merge conflict simulation
  - Error recovery state machine

**Expected Results:**
- ✓ All 22 integration tests pass
- ✓ Skill loads in <100ms
- ✓ Branch creation succeeds with non-interactive flags
- ✓ Merge conflict detection and recovery works

### Test 1: Skill Loading Simulation

```bash
# Simulate how an agent would load the skill
cat > /tmp/test-skill-loading.sh << 'EOF'
#!/bin/bash

# Simulate agent loading git-town skill
SKILL_PATH="packages/git/skills/git-town"

# Test 1: Load SKILL.md
echo "Loading SKILL.md..."
if [ -f "$SKILL_PATH/SKILL.md" ]; then
  LINES=$(wc -l < "$SKILL_PATH/SKILL.md")
  echo "✓ Loaded $LINES lines from SKILL.md"
else
  echo "✗ Failed to load SKILL.md"
fi

# Test 2: Query specific section (simulate agent query)
echo ""
echo "Querying section: Quick Start..."
if grep -A 20 "## Quick Start" "$SKILL_PATH/SKILL.md" > /dev/null; then
  echo "✓ Section query successful"
else
  echo "✗ Section query failed"
fi

# Test 3: Load interview template
echo ""
echo "Loading interview template..."
if [ -f "$SKILL_PATH/templates/interview-branch-creation.md" ]; then
  echo "✓ Template loaded successfully"
else
  echo "✗ Template not found"
fi

# Test 4: Check validation script
echo ""
echo "Running validation script..."
if bash "$SKILL_PATH/scripts/validate-git-town.sh" > /dev/null 2>&1; then
  echo "✓ Validation passed"
else
  echo "✗ Validation failed"
fi

echo ""
echo "Integration test complete!"
EOF

chmod +x /tmp/test-skill-loading.sh
bash /tmp/test-skill-loading.sh
```

### Test 2: Agent Interview Simulation

```bash
# Simulate agent reading interview template
echo "Simulating agent interview for branch creation..."
echo ""
echo "Template fields:"
grep -A 5 "fields:" templates/interview-branch-creation.md | head -20

echo ""
echo "Validation rules:"
grep "validation:" templates/interview-branch-creation.md
```

### Test 3: Error Handling Simulation

```bash
# Simulate agent querying error handling
echo "Simulating error recovery for merge conflict..."
echo ""

# Agent detects error
EXIT_CODE=5

# Query ERROR_HANDLING.md for merge conflicts
if grep -A 20 "### Exit Code 5" REFERENCE.md; then
  echo "✓ Found error handling guidance for exit code $EXIT_CODE"
fi
```

---

## Visual Testing (in Browser/Editor)

### 1. Test Mermaid Diagrams

Open these files in VS Code or GitHub to verify diagrams render:
- `REFERENCE.md` - Should show 3 decision tree diagrams (branching, sync, completion)
- `ERROR_HANDLING.md` - Should show 6 error recovery flowcharts

### 2. Test Documentation Formatting

Open in a Markdown viewer to check:
- ✓ Headers are properly formatted
- ✓ Code blocks have syntax highlighting
- ✓ Tables render correctly
- ✓ Links work (internal section links)

### 3. Test YAML Frontmatter

Use a YAML validator:
```bash
# Extract frontmatter and validate
awk '/^---$/{i++}i==1' SKILL.md | head -n -1 | tail -n +2 > /tmp/frontmatter.yml

# Validate with Python (if available)
python3 -c "import yaml; print(yaml.safe_load(open('/tmp/frontmatter.yml')))"
```

---

## Manual Testing Checklist

Use this checklist to verify implementation quality:

### Phase 1 Deliverables
- [ ] GT-001: Directory structure exists and organized
- [ ] GT-002: Validation script runs without errors
- [ ] GT-003: SKILL.md has all required sections
- [ ] GT-004: REFERENCE.md documents 4 core commands
- [ ] GT-005: ERROR_HANDLING.md covers 6 error categories
- [ ] GT-006: Test suite passes (10/10 tests)
- [ ] GT-038: Exit codes 0-10 fully documented
- [ ] GT-039: SKILL_TEMPLATE.md exists and is reusable
- [ ] GT-040: Agent integration guide complete
- [ ] GT-041: Error recovery state machine documented

### Phase 2 Deliverables
- [ ] GT-008: Branch creation template has YAML frontmatter
- [ ] GT-009: PR creation template validates input
- [ ] GT-010: Completion template requires confirmation
- [ ] GT-011: Branching strategy decision tree renders
- [ ] GT-012: Sync scope decision tree is clear
- [ ] GT-013: Completion strategy decision tree complete
- [ ] GT-014: All 6 error categories have decision trees

### Quality Checks
- [ ] All Mermaid diagrams render correctly
- [ ] No broken internal links
- [ ] Code examples are syntactically correct
- [ ] Validation script is POSIX-compliant
- [ ] Interview templates parse as valid YAML
- [ ] Exit codes are consistently documented
- [ ] File sizes meet TRD requirements

---

## Performance Testing

### Skill Loading Time

```bash
# Test skill loading performance (target: <100ms)
time cat SKILL.md REFERENCE.md ERROR_HANDLING.md > /dev/null

# Test section query (target: <30ms)
time grep -A 20 "## Quick Start" SKILL.md > /dev/null
```

### Validation Script Performance

```bash
# Test validation script speed (target: <500ms)
time bash scripts/validate-git-town.sh > /dev/null
```

---

## Automated Test Suite

Run the comprehensive test suite:

```bash
# Run all automated tests
bash tests/test-skill.sh
```

This will test:
1. File existence
2. Validation script functionality
3. YAML frontmatter validity
4. Mermaid diagram presence
5. Documentation quality
6. File size requirements
7. Exit code documentation
8. Interview template structure

---

## Troubleshooting

### Test failures

**If validation tests fail:**
```bash
# Run validation with verbose output
bash scripts/validate-git-town.sh

# Check git-town installation
which git-town
git-town --version
```

**If YAML validation fails:**
```bash
# Check frontmatter syntax
head -20 SKILL.md

# Install yamllint for detailed validation
pip install yamllint
yamllint SKILL.md
```

**If Mermaid diagrams don't render:**
- Try opening in GitHub (automatic rendering)
- Use VS Code with "Markdown Preview Mermaid Support" extension
- Copy diagram to https://mermaid.live for validation

---

---

## Phase 5-6 Testing (Migration Guides, CI/CD, Monorepo)

### Testing Migration Guides

```bash
# Test onboarding guide
test -f guides/onboarding.md && echo "✓ Onboarding guide exists"
echo "Onboarding guide lines: $(wc -l < guides/onboarding.md) (target: 400+)"

# Test migration guides
test -f guides/migration-git-flow.md && echo "✓ Git-flow migration guide exists"
test -f guides/migration-github-flow.md && echo "✓ GitHub Flow migration guide exists"
test -f guides/migration-trunk-based.md && echo "✓ Trunk-based migration guide exists"

# Check migration guide structure
echo ""
echo "Migration guide sections:"
grep "^## " guides/migration-*.md | wc -l
echo "  Expected: 24+ sections across 3 guides"

# Check for comparison tables
echo ""
echo "Comparison tables:"
grep -c "^|" guides/migration-*.md
echo "  Expected: 30+ table rows"
```

### Testing Monorepo Guide

```bash
# Test monorepo guide existence
test -f guides/monorepo.md && echo "✓ Monorepo guide exists"
echo "Monorepo guide lines: $(wc -l < guides/monorepo.md) (target: 500+)"

# Check for workspace integrations
echo ""
echo "Workspace integrations documented:"
grep -E "(npm workspaces|pnpm|Nx|Turborepo|Lerna)" guides/monorepo.md | wc -l
echo "  Expected: 15+ references"

# Check for code examples
echo ""
echo "Code examples:"
grep -c '```' guides/monorepo.md
echo "  Expected: 40+ code blocks"
```

### Testing CI/CD Integration

```bash
# Test CI/CD documentation
test -f cicd/INTEGRATION.md && echo "✓ CI/CD integration guide exists"
test -f cicd/examples/github-actions.yml && echo "✓ GitHub Actions example exists"
test -f cicd/examples/gitlab-ci.yml && echo "✓ GitLab CI example exists"

# Validate YAML syntax in CI examples
echo ""
echo "Validating CI/CD YAML syntax..."

# GitHub Actions validation (requires yq or yamllint)
if command -v yamllint &> /dev/null; then
  yamllint cicd/examples/github-actions.yml && echo "✓ GitHub Actions YAML valid"
  yamllint cicd/examples/gitlab-ci.yml && echo "✓ GitLab CI YAML valid"
else
  echo "⚠️  yamllint not installed, skipping YAML validation"
  echo "  Install with: pip install yamllint"
fi

# Check for required CI/CD patterns
echo ""
echo "CI/CD patterns documented:"
grep -c "jobs:" cicd/examples/*.yml
echo "  Total jobs defined across examples"
```

### Testing Context7 Integration

```bash
# Check Context7 references in skill files
echo "Context7 integration documentation:"
echo ""

# SKILL.md should have Context7 section
if grep -q "## Context7 Integration" SKILL.md; then
  echo "✓ SKILL.md documents Context7 integration"
else
  echo "✗ SKILL.md missing Context7 section"
fi

# REFERENCE.md should have Context7 documentation sources
if grep -q "Context7 MCP" REFERENCE.md; then
  echo "✓ REFERENCE.md references Context7"
else
  echo "✗ REFERENCE.md missing Context7 references"
fi

# ERROR_HANDLING.md should have Context7 integration
if grep -q "Context7 Integration for Error Documentation" ERROR_HANDLING.md; then
  echo "✓ ERROR_HANDLING.md has Context7 integration"
else
  echo "✗ ERROR_HANDLING.md missing Context7 section"
fi

# Check ensemble-core exports Context7 utilities
echo ""
echo "Checking ensemble-core Context7 utilities..."
if grep -q "checkContext7Available" ../../core/lib/index.js; then
  echo "✓ ensemble-core exports Context7 utilities"
else
  echo "✗ ensemble-core missing Context7 exports"
fi
```

---

## Comprehensive Test Suite

Run all tests for Phases 1-6:

```bash
#!/bin/bash
# comprehensive-test.sh

echo "=================================="
echo "Git-Town Skill Comprehensive Tests"
echo "=================================="
echo ""

# Phase 1-2: Core Documentation
echo "Phase 1-2: Core Documentation"
echo "------------------------------"
bash tests/test-integration.sh
echo ""

# Phase 5: Migration Guides
echo "Phase 5: Migration Guides"
echo "-------------------------"
echo "Checking migration guides..."
for guide in guides/migration-*.md guides/onboarding.md; do
  if [ -f "$guide" ]; then
    lines=$(wc -l < "$guide")
    echo "✓ $guide ($lines lines)"
  else
    echo "✗ Missing: $guide"
  fi
done
echo ""

# Phase 6: Monorepo & CI/CD
echo "Phase 6: Monorepo & CI/CD"
echo "-------------------------"
[ -f guides/monorepo.md ] && echo "✓ Monorepo guide" || echo "✗ Missing monorepo guide"
[ -f cicd/INTEGRATION.md ] && echo "✓ CI/CD integration guide" || echo "✗ Missing CI/CD guide"
[ -f cicd/examples/github-actions.yml ] && echo "✓ GitHub Actions example" || echo "✗ Missing GitHub Actions"
[ -f cicd/examples/gitlab-ci.yml ] && echo "✓ GitLab CI example" || echo "✗ Missing GitLab CI"
echo ""

# Context7 Integration
echo "Context7 Integration"
echo "--------------------"
grep -q "Context7" SKILL.md && echo "✓ SKILL.md has Context7 docs" || echo "✗ Missing Context7 in SKILL.md"
grep -q "Context7" REFERENCE.md && echo "✓ REFERENCE.md has Context7 docs" || echo "✗ Missing Context7 in REFERENCE.md"
grep -q "Context7" ERROR_HANDLING.md && echo "✓ ERROR_HANDLING.md has Context7 docs" || echo "✗ Missing Context7 in ERROR_HANDLING.md"
echo ""

# Documentation Quality Metrics
echo "Documentation Quality Metrics"
echo "-----------------------------"
echo "Total documentation size:"
find . -name "*.md" -type f -exec wc -l {} + | tail -1
echo ""
echo "Total code examples:"
find . -name "*.md" -type f -exec grep -c '```' {} + | awk '{s+=$1} END {print s " code blocks"}'
echo ""
echo "Total mermaid diagrams:"
find . -name "*.md" -type f -exec grep -c '```mermaid' {} + | awk '{s+=$1} END {print s " diagrams"}'
echo ""

echo "=================================="
echo "Testing Complete!"
echo "=================================="
```

Save as `tests/comprehensive-test.sh` and run:

```bash
chmod +x tests/comprehensive-test.sh
bash tests/comprehensive-test.sh
```

---

## Performance Benchmarks

### Skill Loading Performance (Updated)

```bash
# Full skill load (all core files + new guides)
echo "Full skill loading benchmark:"
time {
  cat SKILL.md REFERENCE.md ERROR_HANDLING.md \
      guides/*.md cicd/INTEGRATION.md > /dev/null
}

# Expected: <200ms for complete skill load
```

### Context7 Query Performance

```bash
# Simulate Context7 query performance
# Note: Requires Context7 MCP to be installed

# Mock test (without actual Context7)
echo "Context7 query simulation:"
time {
  # Simulate network latency + parsing
  sleep 0.2  # 200ms (typical Context7 response time)
}

echo "Expected Context7 query time: ~200ms"
echo "Local doc query time: <30ms"
echo "Trade-off: Context7 is slower but always current"
```

---

## CI/CD Pipeline Validation

### GitHub Actions Validation

```bash
# Validate GitHub Actions workflow locally (requires act)
if command -v act &> /dev/null; then
  echo "Testing GitHub Actions locally..."
  cd cicd/examples/
  act -l  # List available jobs

  # Run specific job
  # act -j lint  # Example: run lint job
else
  echo "⚠️  'act' not installed for local GitHub Actions testing"
  echo "  Install with: brew install act"
fi
```

### GitLab CI Validation

```bash
# Validate GitLab CI syntax (requires gitlab-ci-local)
if command -v gitlab-ci-local &> /dev/null; then
  echo "Testing GitLab CI locally..."
  cd cicd/examples/
  gitlab-ci-local --file gitlab-ci.yml --list
else
  echo "⚠️  'gitlab-ci-local' not installed"
  echo "  Install with: npm install -g gitlab-ci-local"
fi
```

---

## Manual Testing Checklist (Updated for All Phases)

### Phase 1-2 Deliverables ✓
- [ ] GT-001: Directory structure exists and organized
- [ ] GT-002: Validation script runs without errors
- [ ] GT-003: SKILL.md has all required sections
- [ ] GT-004: REFERENCE.md documents git-town integration
- [ ] GT-005: ERROR_HANDLING.md covers 6 error categories
- [ ] GT-006: Test suite passes (22/22 tests)

### Phase 3 Deliverables ✓
- [ ] GT-018: Agent integration tests pass
- [ ] GT-019: Merge conflict handling validated

### Phase 4 Deliverables ✓
- [ ] GT-020: Stacked branches documented
- [ ] GT-021: Offline mode documented
- [ ] GT-022: Configuration management documented
- [ ] GT-023: GitHub CLI integration documented

### Phase 5 Deliverables ✓
- [ ] GT-024: Onboarding guide complete (487 lines)
- [ ] GT-025: Git-flow migration guide complete (586 lines)
- [ ] GT-026: GitHub Flow migration guide complete (502 lines)
- [ ] GT-027: Trunk-based migration guide complete (605 lines)

### Phase 6 Deliverables ✓
- [ ] GT-028: Monorepo guide complete (621 lines)
- [ ] GT-029: CI/CD integration guide complete (563 lines)
- [ ] GT-030: GitHub Actions example complete (481 lines)
- [ ] GT-031: GitLab CI example complete (470 lines)

### Phase 7 Deliverables
- [ ] GT-034: ERROR_HANDLING.md updated with Context7 ✓
- [ ] GT-035: TESTING.md updated (this file) ✓
- [ ] GT-036: Comprehensive README.md created
- [ ] GT-037: Integration test validation complete

### Context7 Integration ✓
- [ ] packages/core/lib/context7-integration.js created
- [ ] ensemble-core exports Context7 utilities
- [ ] SKILL.md documents Context7 usage
- [ ] REFERENCE.md references Context7 for commands
- [ ] ERROR_HANDLING.md has Context7 integration section

### Quality Checks (Final)
- [ ] All Mermaid diagrams render correctly
- [ ] No broken internal links in documentation
- [ ] All code examples are syntactically correct
- [ ] CI/CD YAML examples validate
- [ ] Migration guides have clear step-by-step instructions
- [ ] Monorepo guide covers all major tools (npm, pnpm, Nx, Turborepo)
- [ ] Performance targets met (<100ms skill load, <200ms Context7 query)

---

## Next Steps

After all tests pass:

1. **Create comprehensive README.md** (GT-036)
   - Overview of all skill components
   - Quick start guide
   - Links to all documentation

2. **Final integration test** (GT-037)
   - Run comprehensive test suite
   - Validate all 37 tasks completed
   - Performance benchmarking

3. **Agent-level testing**
   - Test with git-workflow agent
   - Test with tech-lead-orchestrator
   - Test error handling in real scenarios

4. **Production deployment**
   - Package skill for distribution
   - Update ensemble-git plugin manifest
   - Release notes and changelog
