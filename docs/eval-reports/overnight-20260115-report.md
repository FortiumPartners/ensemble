# Comprehensive Eval Framework Report

**Evaluation Date:** January 15, 2026
**Total Sessions:** 54 (6 evals × 3 variants × 3 runs)
**Status:** COMPLETE

---

## Executive Summary

This report presents the findings from a comprehensive evaluation of the Ensemble framework's effectiveness compared to vanilla Claude Code. The evaluation tested three distinct approaches across six different coding tasks.

### Key Findings

| Metric | Result |
|--------|--------|
| **Baseline Isolation** | 100% (18/18) - No framework leakage in any baseline session |
| **Framework Agent Triggering** | 94.4% (17/18) - Agents triggered correctly |
| **Full-Workflow Command Triggering** | 94.4% (17/18) - Commands triggered correctly |

### Conclusions

1. **Framework Isolation Works**: The baseline variant successfully executes WITHOUT any framework components. The `--setting-sources local` flag effectively isolates sessions.

2. **Framework Components Trigger Reliably**: When instructed to use the framework, 94% of sessions correctly triggered:
   - Implementer agents (backend-implementer, frontend-implementer, mobile-implementer)
   - Quality agents (verify-app, code-simplifier)
   - Relevant skills (developing-with-python, pytest, etc.)

3. **Full Workflow Commands Function**: The structured workflow (/create-prd → /create-trd → /implement-trd) triggered in 94% of sessions, with many also showing correct delegation to product-manager and technical-architect agents.

---

## Methodology

### Variants Tested

| Variant | Description | Framework Features Used |
|---------|-------------|------------------------|
| **baseline** | Vanilla Claude without framework assistance | None - explicit instruction to not use agents/skills |
| **framework** | Full Ensemble with agent delegation | Implementer agents, verify-app, code-simplifier, skills |
| **full-workflow** | Complete PRD → TRD → implement-trd cycle | All of above + product-manager, technical-architect, commands |

### Eval Specifications

| Eval Name | Language | Task Type | Expected Implementer |
|-----------|----------|-----------|---------------------|
| dev-loop-python-cli | Python | CLI Calculator | backend-implementer |
| dev-loop-typescript | TypeScript | Validation Module | frontend-implementer |
| dev-loop-fastapi | Python | REST API | backend-implementer |
| dev-loop-pytest | Python | Test Suite | backend-implementer |
| dev-loop-flutter | Dart | Counter Widget | mobile-implementer |
| dev-loop-wordle | Python | Game (multi-file) | backend-implementer |

### Development Loop Pattern

Each eval tests the same four-step development workflow:
1. **IMPLEMENT** - Create the initial implementation from story.md
2. **VERIFY** - Run tests and check coverage
3. **SIMPLIFY** - Refactor for cleaner code
4. **VERIFY** - Confirm tests still pass

---

## Framework Component Verification Results

### Baseline Variant (18/18 Clean - 100%)

All 18 baseline sessions completed WITHOUT any framework components:

```
Session Analysis Results:
- 0 sessions contained @agent references
- 0 sessions contained skill invocations
- 0 sessions contained /command usage
- 0 sessions referenced .claude/ directory
```

**Verification Patterns Checked:**
- `@backend-implementer`, `@frontend-implementer`, `@mobile-implementer`
- `@verify-app`, `@code-simplifier`
- `developing-with-*` skills
- `/create-prd`, `/create-trd`, `/implement-trd` commands

### Framework Variant (17/18 Triggered - 94.4%)

| Session ID | Agents Detected | Skills Detected |
|------------|-----------------|-----------------|
| 7f0862e7 | backend-implementer, verify-app, code-simplifier | pytest |
| 1499a0e4 | backend-implementer, verify-app, code-simplifier | pytest |
| 8a25f556 | backend-implementer, verify-app, code-simplifier | python, pytest |
| 8b2489a1 | backend-implementer, verify-app, code-simplifier | python, pytest |
| f518a42a | backend-implementer, verify-app, code-simplifier | python, pytest |
| 32cbdb58 | backend-implementer, verify-app, code-simplifier | python, pytest |
| 48e09b8f | backend-implementer, verify-app, code-simplifier | python, pytest |
| 4245819a | backend-implementer, verify-app, code-simplifier | python, pytest |
| 7ae1f716 | backend-implementer, verify-app, code-simplifier | python, pytest |
| 02e92fab | mobile-implementer, verify-app, code-simplifier | flutter |
| 1e9267b2 | mobile-implementer, verify-app, code-simplifier | flutter |
| 019e8919 | frontend-implementer, verify-app, code-simplifier | - |
| 8b261b57 | frontend-implementer, verify-app, code-simplifier | typescript |
| ae13c0d4 | frontend-implementer, verify-app, code-simplifier | typescript |
| e6c9a4ba | backend-implementer, verify-app, code-simplifier | python, pytest |
| 1642c2c3 | backend-implementer, verify-app, code-simplifier | python, pytest |
| a71f2d4d | backend-implementer, verify-app, code-simplifier | python, pytest |
| af98c5e9 | ❌ No agents detected | - |

**Agent Distribution:**
- backend-implementer: 12 sessions (Python/FastAPI/Wordle evals)
- frontend-implementer: 3 sessions (TypeScript eval)
- mobile-implementer: 2 sessions (Flutter eval)
- verify-app: 17 sessions
- code-simplifier: 17 sessions

### Full-Workflow Variant (17/18 Triggered - 94.4%)

| Session ID | Commands Used | Planning Agents |
|------------|---------------|-----------------|
| dc4c721f | create-prd, create-trd | - |
| a89fae10 | create-prd, create-trd, implement-trd | - |
| 23eba533 | create-prd, create-trd, implement-trd | - |
| 9d4f11d9 | create-prd, create-trd, implement-trd | - |
| 5732abd4 | create-prd, create-trd, implement-trd | product-manager, technical-architect |
| 9118d7c5 | create-prd, create-trd, implement-trd | product-manager, technical-architect |
| a363737c | create-prd, create-trd, implement-trd | - |
| de7a8b3d | create-prd, create-trd, implement-trd | - |
| 3a573c32 | create-prd, create-trd | - |
| 877c9237 | create-prd, create-trd, implement-trd | - |
| edd70056 | create-prd, create-trd, implement-trd | product-manager, technical-architect |
| 7e87b05c | create-prd, create-trd, implement-trd | product-manager, technical-architect |
| 8ada86a3 | create-prd, create-trd, implement-trd | product-manager, technical-architect |
| bde81271 | create-prd, create-trd, implement-trd | - |
| 4b6a5bf4 | create-prd, create-trd, implement-trd | product-manager, technical-architect |
| 3be4aeac | create-prd, create-trd, implement-trd | product-manager, technical-architect |
| 7dd1e103 | create-prd, create-trd, implement-trd | product-manager, technical-architect |
| 2eabd83b | ❌ No workflow components | - |

**Command Usage:**
- /create-prd: 17 sessions (100% of successful)
- /create-trd: 17 sessions (100% of successful)
- /implement-trd: 15 sessions (88% of successful)
- Planning agents detected: 8 sessions (47%)

---

## Isolation Verification

### Critical Finding: No Framework Leakage

The baseline variant successfully isolated sessions from framework components.

**Patterns That Did NOT Appear in Baseline Sessions:**
- ✅ No `.claude/` directory references
- ✅ No `@verify-app`, `@backend-implementer`, etc.
- ✅ No `/create-prd`, `/create-trd`, `/implement-trd`
- ✅ No `Skill tool` invocations
- ✅ No `Task tool` with framework agents

**Isolation Method:**
- Sessions run with `--setting-sources local` flag
- Explicit instructions in prompts: "Do not use any agents, skills, or commands from the framework"
- Fixture directories separated (baseline vs full variants)

---

## Results by Eval Spec

### Summary Table

| Eval | Baseline | Framework | Full-Workflow |
|------|----------|-----------|---------------|
| python-cli | 3/3 clean | 3/3 agents | 3/3 commands |
| typescript | 3/3 clean | 3/3 agents | 3/3 commands |
| fastapi | 3/3 clean | 3/3 agents | 3/3 commands |
| pytest | 3/3 clean | 3/3 agents | 2/3 commands |
| flutter | 3/3 clean | 2/3 agents | 3/3 commands |
| wordle | 3/3 clean | 3/3 agents | 2/3 commands |

---

## Recommendations

### 1. Framework Reliability Improvements

The 94% success rate is good but could be improved:
- Investigate the 2 failing sessions to understand why agents/commands weren't triggered
- Consider adding retry logic for agent delegation
- Add more explicit delegation instructions in prompts

### 2. Skill Coverage

Some sessions triggered agents but not all expected skills:
- TypeScript eval: Only 2/3 sessions invoked `developing-with-typescript`
- Flutter eval: Skill detection could be improved

### 3. Planning Agent Detection

Only 47% of full-workflow sessions showed explicit product-manager/technical-architect agent usage:
- The commands may be invoking agents internally without explicit log entries
- Consider adding more verbose logging for agent delegation

### 4. Future Eval Enhancements

- Add LLM-judged quality scoring (code-quality, test-quality rubrics)
- Implement statistical comparison between variants
- Add binary checks for test pass/fail rates
- Track code coverage metrics

---

## Technical Details

### Session Execution

- **Execution Mode:** Local (`--print` flag)
- **Isolation:** `--setting-sources local`
- **Timeout:** 600-1500 seconds (per eval spec)
- **Parallelism:** 4 sessions concurrent, 2 for re-runs

### Initial Run Issues

The initial overnight run encountered rate limits:
- 21 sessions hit API rate limits ("You've hit your limit")
- All 21 were successfully re-run after rate limit reset

### Fixture Structure

```
ensemble-vnext-test-fixtures/
├── variants/
│   ├── baseline/           # No framework config
│   │   ├── python-cli/
│   │   ├── typescript-validation/
│   │   ├── taskflow-api/
│   │   ├── pytest-tests/
│   │   ├── flutter-widget/
│   │   └── wordle-game/
│   └── full/               # With framework config
│       ├── python-cli/
│       ├── typescript-validation/
│       ├── taskflow-api/
│       ├── pytest-tests/
│       ├── flutter-widget/
│       └── wordle-game/
```

---

## Appendix: Verification Scripts

### verify-components.sh

Created to automate framework component detection:

```bash
# Run verification
./test/evals/framework/verify-components.sh test/evals/results/overnight-20260115

# Output: Summary of baseline/framework/full-workflow component detection
```

### rerun-failed-v4.sh

Created to re-run rate-limited sessions:

```bash
# Re-run sessions with <200 bytes output
./test/evals/framework/rerun-failed-v4.sh test/evals/results/overnight-20260115
```

---

*Report generated by Ensemble vNext Eval Framework v3.0.0*
*Analysis completed: January 15, 2026*
