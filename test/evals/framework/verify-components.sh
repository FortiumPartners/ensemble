#!/bin/bash
# =============================================================================
# verify-components.sh - Framework Component Verification
# =============================================================================
# Analyzes session logs to verify:
# 1. Framework components ARE used in framework/full-workflow variants
# 2. Framework components are NOT used in baseline variants
#
# Usage: ./verify-components.sh <results-dir>
# =============================================================================

set -euo pipefail

RESULTS_DIR="${1:-}"

if [[ -z "$RESULTS_DIR" ]]; then
    echo "Usage: $0 <results-dir>"
    exit 1
fi

if [[ ! -d "$RESULTS_DIR" ]]; then
    echo "Error: Results directory not found: $RESULTS_DIR"
    exit 1
fi

# Patterns to detect framework components
AGENT_PATTERN='@backend-implementer|@frontend-implementer|@mobile-implementer|@verify-app|@code-simplifier|@product-manager|@technical-architect'
SKILL_PATTERN='developing-with-python|developing-with-typescript|developing-with-flutter|pytest skill'
COMMAND_PATTERN='/create-prd|/create-trd|/implement-trd'
FRAMEWORK_LEAK_PATTERN='\.claude/|Task.*subagent|Skill.*tool'

echo "=== Framework Component Verification Report ==="
echo "Results Directory: $RESULTS_DIR"
echo "Date: $(date)"
echo ""

# Initialize counters
baseline_clean=0
baseline_leaked=0
framework_used=0
framework_missing=0
fullworkflow_used=0
fullworkflow_missing=0

echo "=== Baseline Variant Check (should have NO framework components) ==="
echo ""

for session_dir in $(find "$RESULTS_DIR" -name "metadata.json" -exec dirname {} \;); do
    metadata="$session_dir/metadata.json"
    session="$session_dir/session.jsonl"

    if [[ ! -f "$metadata" ]] || [[ ! -f "$session" ]]; then
        continue
    fi

    variant=$(grep -o '"variant": "[^"]*"' "$metadata" | cut -d'"' -f4)
    session_id=$(grep -o '"session_id": "[^"]*"' "$metadata" | cut -d'"' -f4)

    if [[ "$variant" == "baseline" ]]; then
        # Check for leakage
        if grep -qiE "$AGENT_PATTERN|$SKILL_PATTERN|$COMMAND_PATTERN" "$session" 2>/dev/null; then
            echo "  [FAIL] $session_id - Framework leakage detected!"
            grep -iE "$AGENT_PATTERN|$SKILL_PATTERN|$COMMAND_PATTERN" "$session" | head -3 | sed 's/^/         /'
            ((baseline_leaked++)) || true
        else
            echo "  [PASS] $session_id - No framework leakage"
            ((baseline_clean++)) || true
        fi
    fi
done

echo ""
echo "=== Framework Variant Check (should HAVE framework components) ==="
echo ""

for session_dir in $(find "$RESULTS_DIR" -name "metadata.json" -exec dirname {} \;); do
    metadata="$session_dir/metadata.json"
    session="$session_dir/session.jsonl"

    if [[ ! -f "$metadata" ]] || [[ ! -f "$session" ]]; then
        continue
    fi

    variant=$(grep -o '"variant": "[^"]*"' "$metadata" | cut -d'"' -f4)
    session_id=$(grep -o '"session_id": "[^"]*"' "$metadata" | cut -d'"' -f4)

    if [[ "$variant" == "framework" ]]; then
        agents_found=""
        skills_found=""

        # Check for agents
        if grep -qiE "@backend-implementer" "$session" 2>/dev/null; then
            agents_found="${agents_found}backend-implementer,"
        fi
        if grep -qiE "@frontend-implementer" "$session" 2>/dev/null; then
            agents_found="${agents_found}frontend-implementer,"
        fi
        if grep -qiE "@mobile-implementer" "$session" 2>/dev/null; then
            agents_found="${agents_found}mobile-implementer,"
        fi
        if grep -qiE "@verify-app" "$session" 2>/dev/null; then
            agents_found="${agents_found}verify-app,"
        fi
        if grep -qiE "@code-simplifier" "$session" 2>/dev/null; then
            agents_found="${agents_found}code-simplifier,"
        fi

        # Check for skills
        if grep -qiE "developing-with-python" "$session" 2>/dev/null; then
            skills_found="${skills_found}python,"
        fi
        if grep -qiE "developing-with-typescript" "$session" 2>/dev/null; then
            skills_found="${skills_found}typescript,"
        fi
        if grep -qiE "developing-with-flutter" "$session" 2>/dev/null; then
            skills_found="${skills_found}flutter,"
        fi
        if grep -qiE "pytest" "$session" 2>/dev/null; then
            skills_found="${skills_found}pytest,"
        fi

        if [[ -n "$agents_found" ]]; then
            echo "  [PASS] $session_id"
            echo "         Agents: ${agents_found%,}"
            [[ -n "$skills_found" ]] && echo "         Skills: ${skills_found%,}"
            ((framework_used++)) || true
        else
            echo "  [FAIL] $session_id - No agents detected!"
            ((framework_missing++)) || true
        fi
    fi
done

echo ""
echo "=== Full-Workflow Variant Check (should HAVE commands + agents) ==="
echo ""

for session_dir in $(find "$RESULTS_DIR" -name "metadata.json" -exec dirname {} \;); do
    metadata="$session_dir/metadata.json"
    session="$session_dir/session.jsonl"

    if [[ ! -f "$metadata" ]] || [[ ! -f "$session" ]]; then
        continue
    fi

    variant=$(grep -o '"variant": "[^"]*"' "$metadata" | cut -d'"' -f4)
    session_id=$(grep -o '"session_id": "[^"]*"' "$metadata" | cut -d'"' -f4)

    if [[ "$variant" == "full-workflow" ]]; then
        commands_found=""
        agents_found=""

        # Check for commands
        if grep -qiE "/create-prd" "$session" 2>/dev/null; then
            commands_found="${commands_found}create-prd,"
        fi
        if grep -qiE "/create-trd" "$session" 2>/dev/null; then
            commands_found="${commands_found}create-trd,"
        fi
        if grep -qiE "/implement-trd" "$session" 2>/dev/null; then
            commands_found="${commands_found}implement-trd,"
        fi

        # Check for additional agents
        if grep -qiE "@product-manager|product-manager" "$session" 2>/dev/null; then
            agents_found="${agents_found}product-manager,"
        fi
        if grep -qiE "@technical-architect|technical-architect" "$session" 2>/dev/null; then
            agents_found="${agents_found}technical-architect,"
        fi

        if [[ -n "$commands_found" ]] || [[ -n "$agents_found" ]]; then
            echo "  [PASS] $session_id"
            [[ -n "$commands_found" ]] && echo "         Commands: ${commands_found%,}"
            [[ -n "$agents_found" ]] && echo "         Agents: ${agents_found%,}"
            ((fullworkflow_used++)) || true
        else
            echo "  [FAIL] $session_id - No workflow components detected!"
            ((fullworkflow_missing++)) || true
        fi
    fi
done

echo ""
echo "=== Summary ==="
echo ""
echo "Baseline Variants:"
echo "  Clean (no leakage): $baseline_clean"
echo "  Leaked (PROBLEM):   $baseline_leaked"
echo ""
echo "Framework Variants:"
echo "  Components used:    $framework_used"
echo "  Components missing: $framework_missing"
echo ""
echo "Full-Workflow Variants:"
echo "  Components used:    $fullworkflow_used"
echo "  Components missing: $fullworkflow_missing"
echo ""

# Exit with error if any problems detected
if [[ $baseline_leaked -gt 0 ]] || [[ $framework_missing -gt 0 ]]; then
    echo "RESULT: PROBLEMS DETECTED"
    exit 1
else
    echo "RESULT: ALL CHECKS PASSED"
    exit 0
fi
