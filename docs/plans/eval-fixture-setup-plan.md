# Plan: Eval Framework Fixture Setup

**Date**: 2026-01-14
**Status**: Draft
**Related TRD**: testing-phase.md v1.4.0

---

## Problem Statement

The eval framework runs sessions against fixtures that lack vendored `.claude/` structure. This means:
- Commands like `/create-prd`, `/create-trd`, `/implement-trd` don't exist in sessions
- Router hook doesn't fire (no routing to agents/skills)
- Skills aren't available
- **All eval results are testing vanilla Claude, not Ensemble**

---

## Current State Analysis

### What EXISTS and WORKS

| Component | Status | Notes |
|-----------|--------|-------|
| `run-eval.js` | Complete | Orchestrates sessions, runs checks |
| `run-session.sh` | Complete | Clones fixtures, manages workspaces, supports `--plugin-dir` |
| `scaffold-project.sh` | Complete | Copies agents, commands, hooks from plugin to `.claude/` |
| `run-headless.sh` | Complete | Sets `ENSEMBLE_PLUGIN_DIR`, writes `/tmp/.ensemble-test/plugin-path` |
| `/init-project` command | 60% Complete | Steps 1-4, 6-11 work; Steps 5, 12-15 incomplete |
| Vendoring tests (TRD-TEST-033-035) | Pass | Proves `/init-project` can create structure |

### What's MISSING

| Gap | Impact | Fix Complexity |
|-----|--------|----------------|
| `pre-initialized/` fixture is empty | Cannot test against vendored structure | Low - run init-project once, commit result |
| Evals don't run `/init-project` as setup | Sessions have no commands/skills/agents | Low - add setup_commands to specs |
| Agent customization (Step 5) | Agents generic, not project-specific | Medium - template system |
| Router rules generation (Step 12) | Routing doesn't work | Medium - new command |
| Validation logic (Steps 14-15) | Init may be incomplete | Low - file checks |

---

## Proposed Solution

### Option A: Pre-Initialize Fixtures (Recommended)

**Approach**: Run `/init-project` once on each fixture, commit the result to `ensemble-vnext-test-fixtures`.

**Pros**:
- Zero runtime overhead (already vendored)
- Deterministic (same structure every run)
- Works for local and remote execution
- Easy to diff/debug fixture contents

**Cons**:
- Fixtures need regeneration when plugin changes
- Multiple copies of `.claude/` in git

**Implementation**:
1. Create script `scripts/prepare-fixtures.sh` that:
   - For each fixture in `fixtures/`:
     - Runs `/init-project` via headless Claude
     - Commits result
2. Run once to populate `pre-initialized/` and update other fixtures
3. Evals use pre-vendored fixtures

### Option B: Setup Phase in run-eval.js

**Approach**: Add `setup_commands` to eval specs that run `/init-project` before each session.

**Pros**:
- Always uses latest plugin version
- Single source of truth (plugin, not fixtures)

**Cons**:
- Adds ~60-120s to each session
- Requires headless Claude to run setup
- More complex error handling
- Non-deterministic (init-project output may vary)

**Implementation**:
1. Modify `run-session.sh` to support `--setup-command`
2. Update eval specs with:
   ```yaml
   setup_commands:
     - "/init-project --skip-interactive"
   ```
3. Session runs setup before main prompt

### Option C: Hybrid (Use Worktrees)

**Approach**: Use git worktrees for isolation, with pre-initialized base.

**Pros**:
- Clean isolation per variant
- Can modify vendored structure for A/B tests

**Cons**:
- More complex setup
- Git operations add overhead

**Implementation**:
1. Maintain `pre-initialized` branch with vendored structure
2. Before each eval run:
   - Create worktree from pre-initialized
   - Optionally modify for variant (remove skills, change config)
   - Run session in worktree
3. Cleanup worktrees after

---

## Recommended Approach: Option A (Pre-Initialize Fixtures)

### Phase 1: Populate Pre-Initialized Fixture

**Tasks**:
1. Create `scripts/prepare-fixture.sh`:
   ```bash
   #!/bin/bash
   # Runs /init-project on a fixture to vendor .claude/
   FIXTURE_PATH="$1"
   PLUGIN_DIR="${2:-packages/full}"

   # Run headless Claude with init-project
   cd "$FIXTURE_PATH"
   echo "/init-project" | claude --print \
     --plugin-dir "$PLUGIN_DIR" \
     --dangerously-skip-permissions
   ```

2. Run on `fixtures/pre-initialized/`:
   ```bash
   ./scripts/prepare-fixture.sh ensemble-vnext-test-fixtures/fixtures/pre-initialized
   ```

3. Commit result to test-fixtures repo

### Phase 2: Update Eval Specs to Use Pre-Initialized

**Tasks**:
1. Create new fixture variant `pre-initialized-python` etc. OR
2. Update existing fixtures to include `.claude/`
3. Modify eval specs:
   ```yaml
   fixture:
     repo: ensemble-vnext-test-fixtures
     path: fixtures/pre-initialized  # Now has .claude/
   ```

### Phase 3: Variant Testing via Fixture Modification

**For A/B testing skills/agents**:
1. Use `setup_commands` in spec to remove specific components:
   ```yaml
   variants:
     - id: with_skill
       setup_commands: []  # Use full vendored structure

     - id: without_skill
       setup_commands:
         - "rm -rf .claude/skills/developing-with-python"
   ```

### Phase 4: Automation for Plugin Updates

**Tasks**:
1. Create GitHub Action or script `scripts/regenerate-fixtures.sh`
2. Runs when plugin content changes
3. Regenerates all pre-initialized fixtures
4. Opens PR to test-fixtures repo

---

## Implementation Order

```
1. Create prepare-fixture.sh script
   └── Test locally on empty-project

2. Populate pre-initialized fixture
   └── Run prepare-fixture.sh
   └── Verify .claude/ structure
   └── Commit to test-fixtures repo

3. Update one eval spec as proof-of-concept
   └── Modify dev-loop-python-cli.yaml
   └── Use pre-initialized fixture
   └── Run eval, verify commands work

4. Update remaining eval specs
   └── All 17 specs point to pre-initialized fixtures

5. Create regeneration automation
   └── Script to update fixtures when plugin changes

6. Document fixture management
   └── Add to test/evals/README.md
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `scripts/prepare-fixture.sh` | Create | Runs init-project on fixture |
| `scripts/regenerate-fixtures.sh` | Create | Batch regenerate all fixtures |
| `ensemble-vnext-test-fixtures/fixtures/pre-initialized/` | Populate | Vendored structure |
| `test/evals/specs/**/*.yaml` | Modify | Point to pre-initialized fixtures |
| `test/evals/README.md` | Modify | Document fixture management |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Fixtures get stale when plugin updates | Regeneration script + CI check |
| Large git diff when fixtures change | Accept this tradeoff; benefits outweigh |
| Init-project has bugs that propagate | Run validation after prepare-fixture.sh |
| Variants need different vendored states | Use setup_commands to modify post-clone |

---

## Success Criteria

1. `pre-initialized/` fixture contains complete `.claude/` structure
2. Eval sessions can successfully invoke `/create-prd`, `/create-trd`, etc.
3. Router hook fires and recommends agents/skills
4. A/B tests can isolate skill/agent impact by removing components
5. Regeneration script exists for plugin updates

---

## Questions for Review

1. Should we pre-initialize ALL fixtures or just `pre-initialized/`?
2. How often will plugin changes require fixture regeneration?
3. Should fixtures live in same repo or separate `ensemble-vnext-test-fixtures`?
4. Do we need per-framework pre-initialized variants (python, flutter, etc.)?
