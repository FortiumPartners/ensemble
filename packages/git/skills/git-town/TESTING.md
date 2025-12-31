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

## Next Steps

After all tests pass:

1. **Test with actual agents**: Create a test agent that loads the git-town skill
2. **Test interview workflow**: Have an agent use the interview templates
3. **Test error recovery**: Simulate errors and verify decision trees work
4. **Integration test**: Test skill in real git-town workflow

See `INTEGRATION_TESTING.md` for agent-level testing (to be created in Phase 3).
