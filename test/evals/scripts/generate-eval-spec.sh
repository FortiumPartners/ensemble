#!/bin/bash
# =============================================================================
# generate-eval-spec.sh - Generate Eval Spec from Fixture
# =============================================================================
# Purpose: Generate a complete eval spec YAML from a fixture directory,
#          using the standard 3-variant, 4-rubric template.
#
# Usage:
#   ./generate-eval-spec.sh <fixture-path> --name <eval-name> [options]
#
# Options:
#   --name NAME        Eval name (required, e.g., "my-calculator")
#   --language LANG    Language: python, typescript, flutter (default: auto-detect)
#   --output FILE      Output path (default: specs/dev-loop/dev-loop-<name>.yaml)
#   --runs N           Runs per variant (default: 3)
#   --dry-run          Print spec to stdout instead of writing file
#   --help             Show help
#
# Example:
#   ./generate-eval-spec.sh /tmp/my-fixture --name calculator --language python
#
# Output:
#   A complete eval spec with:
#   - 3 variants: baseline, framework, full-workflow
#   - 4 rubrics: code-quality, test-quality, architecture, error-handling
#   - Standard judging criteria and acceptance thresholds
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECS_DIR="$(cd "${SCRIPT_DIR}/../specs/dev-loop" && pwd)"

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

FIXTURE_PATH=""
EVAL_NAME=""
LANGUAGE=""
OUTPUT_FILE=""
RUNS_PER_VARIANT=3
DRY_RUN=false

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

usage() {
    cat <<'EOF'
Usage: generate-eval-spec.sh <fixture-path> --name <eval-name> [options]

Generate a complete eval spec from a fixture directory.

Arguments:
    fixture-path       Path to fixture directory (must contain story.md)

Options:
    --name NAME        Eval name (required, e.g., "my-calculator")
    --language LANG    Language: python, typescript, flutter (default: auto-detect)
    --output FILE      Output path (default: specs/dev-loop/dev-loop-<name>.yaml)
    --runs N           Runs per variant (default: 3)
    --dry-run          Print spec to stdout instead of writing file
    --help             Show help

Example:
    ./generate-eval-spec.sh /tmp/my-fixture --name calculator --language python
    ./generate-eval-spec.sh ./fixtures/todo-app --name todo-app --dry-run

The generated spec includes:
    - 3 variants: baseline, framework, full-workflow
    - 4 rubrics: code-quality, test-quality, architecture, error-handling
    - Standard binary checks and acceptance criteria
EOF
    exit 0
}

log_info() {
    echo "[INFO] $*" >&2
}

log_error() {
    echo "[ERROR] $*" >&2
}

# Auto-detect language from story.md
detect_language() {
    local story_file="$1"

    if grep -qiE 'python|pytest|pip|\.py\b' "$story_file"; then
        echo "python"
    elif grep -qiE 'typescript|javascript|npm|node|\.ts\b|\.tsx\b|jest|vitest' "$story_file"; then
        echo "typescript"
    elif grep -qiE 'flutter|dart|widget|\.dart\b' "$story_file"; then
        echo "flutter"
    else
        echo "python"  # Default
    fi
}

# Get file patterns for language
get_source_pattern() {
    case "$1" in
        python) echo "*.py" ;;
        typescript) echo "*.ts" ;;
        flutter) echo "*.dart" ;;
        *) echo "*" ;;
    esac
}

get_test_pattern() {
    case "$1" in
        python) echo "test_*.py" ;;
        typescript) echo "*.test.ts" ;;
        flutter) echo "*_test.dart" ;;
        *) echo "test*" ;;
    esac
}

get_test_command() {
    case "$1" in
        python) echo "python -m pytest -v --cov=. --cov-report=term" ;;
        typescript) echo "npm test" ;;
        flutter) echo "flutter test" ;;
        *) echo "echo 'No test command'" ;;
    esac
}

get_implementer_agent() {
    case "$1" in
        python) echo "backend-implementer" ;;
        typescript) echo "frontend-implementer" ;;
        flutter) echo "mobile-implementer" ;;
        *) echo "backend-implementer" ;;
    esac
}

get_dev_skill() {
    case "$1" in
        python) echo "developing-with-python" ;;
        typescript) echo "developing-with-typescript" ;;
        flutter) echo "developing-with-flutter" ;;
        *) echo "developing-with-python" ;;
    esac
}

get_test_skill() {
    case "$1" in
        python) echo "pytest" ;;
        typescript) echo "jest" ;;
        flutter) echo "flutter" ;;
        *) echo "pytest" ;;
    esac
}

# Extract first paragraph from story.md as description
extract_description() {
    local story_file="$1"
    # Get content after first heading, up to next heading or blank line
    sed -n '/^#/,/^$/p' "$story_file" | tail -n +2 | head -5 | tr '\n' ' ' | sed 's/  */ /g'
}

# Generate the spec YAML
generate_spec() {
    local fixture_name="$1"
    local eval_name="$2"
    local language="$3"
    local description="$4"
    local runs="$5"

    local implementer=$(get_implementer_agent "$language")
    local dev_skill=$(get_dev_skill "$language")
    local test_skill=$(get_test_skill "$language")
    local test_cmd=$(get_test_command "$language")
    local source_pattern=$(get_source_pattern "$language")

    cat <<EOF
# Eval spec for development loop testing: implement -> verify -> simplify -> verify
# Auto-generated by generate-eval-spec.sh
# Fixture: ${fixture_name}

name: dev-loop-${eval_name}
version: 1.0.0
description: |
  Test the complete development loop with: ${eval_name}

  ${description}

  Three test variants:
  - baseline: Vanilla Claude without framework assistance
  - framework: Full Ensemble with agents and skills (implement + verify + simplify)
  - full-workflow: PRD -> TRD -> implement-trd orchestrated workflow

# Test fixture configuration
fixture:
  repo: ensemble-vnext-test-fixtures

# Test case definition
test_case:
  base_prompt: |
    Complete this task using the full development loop:

    ## STEP 1 - IMPLEMENT
    Read the story.md file and implement the requirements.
    Create appropriate source files and comprehensive tests.

    ## STEP 2 - VERIFY (Initial)
    Run tests to verify the implementation works correctly.
    Report test results and coverage metrics.
    Target: >= 80% coverage.

    ## STEP 3 - SIMPLIFY
    Review the code for potential simplifications:
    - Reduce complexity where possible
    - Improve separation of concerns
    - Ensure consistent error handling
    - Extract common patterns

    ## STEP 4 - VERIFY (Final)
    Run tests again to confirm all tests still pass after simplification.
    Report final coverage metrics.

# Variants to compare
variants:
  - id: baseline
    name: Vanilla Claude (No Framework)
    description: Complete all steps directly without framework assistance
    fixture_path: variants/baseline/${fixture_name}
    is_baseline: true
    suffix: |
      Implement directly without any framework assistance.

      Complete all steps directly without delegating to any agents.

      For STEP 1 (IMPLEMENT):
        Implement based on story.md requirements.
        Create all required source and test files.

      For STEP 2 and STEP 4 (VERIFY):
        Run tests directly: ${test_cmd}
        Report pass/fail counts and coverage percentage.

      For STEP 3 (SIMPLIFY):
        Apply refactoring patterns directly to improve code quality.
        Ensure tests still pass after changes.

      Do not use any agents, skills, or commands from the framework.
    agent_enabled: false
    skill_enabled: false
    timeout_seconds: 900
    expected_agents: []
    expected_skills: []

  - id: framework
    name: Full Ensemble Framework with Agent Delegation
    description: Use agent delegation pattern for ALL steps
    fixture_path: variants/full/${fixture_name}
    suffix: |
      Use the full Ensemble workflow with agent delegation for EVERY step.

      For STEP 1 (IMPLEMENT):
        Delegate to @${implementer} agent for initial implementation.
        Request: Read story.md and implement with comprehensive tests.

      For STEP 2 and STEP 4 (VERIFY):
        Delegate to @verify-app agent for test execution.
        Request: Run tests with coverage, report results against 80% threshold.

      For STEP 3 (SIMPLIFY):
        Delegate to @code-simplifier agent for refactoring.
        Request: Simplify the implementation while preserving test behavior.

      Use the appropriate skills:
      - ${dev_skill} for implementation patterns
      - ${test_skill} for test execution

      Report which agents and skills you used at each step.
    agent_enabled: true
    skill_enabled: true
    timeout_seconds: 900
    expected_agents:
      - ${implementer}
      - verify-app
      - code-simplifier
    expected_skills:
      - ${dev_skill}
      - ${test_skill}

  - id: full-workflow
    name: Full PRD -> TRD -> implement-trd Workflow
    description: Use the complete structured workflow with upfront design
    fixture_path: variants/full/${fixture_name}
    suffix: |
      Use the full structured workflow with upfront design artifacts.

      BEFORE implementing, create the design artifacts:

      1. Run /create-prd to generate a Product Requirements Document
         Input: Use the story.md as the product description.
         Output: docs/PRD/${eval_name}.md

      2. Run /create-trd to generate a Technical Requirements Document
         Input: Use the PRD just created.
         Output: docs/TRD/${eval_name}.md
         The TRD should include an execution plan with phases.

      3. Run /implement-trd to execute the implementation
         This should orchestrate the full dev loop with TDD methodology:
         - Use @${implementer} for implementation
         - Use @verify-app for test verification
         - Use @code-simplifier for refactoring
         - Track progress in .trd-state/

      The implement-trd command should handle STEPS 1-4 automatically.

      Report which commands, agents, and skills were used throughout.
    agent_enabled: true
    skill_enabled: true
    timeout_seconds: 1500
    expected_agents:
      - product-manager
      - technical-architect
      - ${implementer}
      - verify-app
      - code-simplifier
    expected_skills:
      - ${dev_skill}
      - ${test_skill}
    expected_commands:
      - create-prd
      - create-trd
      - implement-trd

# Execution configuration
runs_per_variant: ${runs}

# Automated binary checks
binary_checks:
  - name: implementation_complete
    description: Source files were created
    check: |
      cd {workspace} && ls ${source_pattern} 2>/dev/null | grep -q .
    weight: 0.25

  - name: tests_exist
    description: Test files were created
    check: |
      cd {workspace} && ls ${source_pattern} 2>/dev/null | grep -qiE 'test'
    weight: 0.25

  - name: tests_pass_final
    description: Tests pass after simplification
    check: |
      cd {workspace} && ${test_cmd} 2>&1 | grep -qiE 'passed|ok|success'
    weight: 0.50
    critical: true

# LLM-judged quality metrics
metrics:
  - name: code_quality
    description: Overall code quality
    rubric: code-quality.md
    files:
      - "${source_pattern}"
    context_files:
      - "story.md"
    weight: 0.25

  - name: test_quality
    description: Quality of the test suite
    rubric: test-quality.md
    files:
      - "${source_pattern}"
    weight: 0.25

  - name: architecture_quality
    description: Quality of code architecture
    rubric: architecture.md
    files:
      - "${source_pattern}"
    weight: 0.25

  - name: error_handling
    description: Error handling quality
    rubric: error-handling.md
    files:
      - "${source_pattern}"
    weight: 0.25

# Judge configuration
judge:
  model: opus
  use_cot: true
  temperature: 0
  system_prompt: |
    You are evaluating code implementation quality.
    Score each metric on a 1-5 scale according to the provided rubric.
    Use the two-step scoring method: pin base score, then apply modifier.
    Output JSON: {"scores": {"metric_name": {"score": N, "justification": "..."}}}

# Session log analysis
session_analysis:
  verify_implementer_delegation:
    pattern: "${implementer}"
    description: Verify implementer agent was delegated to
  verify_verify_app_delegation:
    pattern: "verify-app"
    description: Verify @verify-app agent was used for testing
  verify_code_simplifier_delegation:
    pattern: "code-simplifier"
    description: Verify @code-simplifier agent was used for refactoring
  verify_no_framework_leak:
    pattern: '\\.claude/|@verify-app|@${implementer}|/create-prd'
    description: Check for framework usage (should NOT appear in baseline)
    expect_in_baseline: false

# Acceptance criteria
acceptance:
  minimum_mean_difference: 0.3
  significance_threshold: 0.05
  binary_pass_threshold: 0.7
  critical_checks_required: true

# Metadata
metadata:
  category: dev-loop
  target_workflow: implement-verify-simplify-verify
  language: ${language}
  complexity: standard
  estimated_duration_minutes: 15
  tags:
    - development-loop
    - ${language}
    - agent-comparison
    - auto-generated
EOF
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --name)
            EVAL_NAME="$2"
            shift 2
            ;;
        --language)
            LANGUAGE="$2"
            shift 2
            ;;
        --output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --runs)
            RUNS_PER_VARIANT="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            usage
            ;;
        -*)
            log_error "Unknown option: $1"
            exit 1
            ;;
        *)
            if [[ -z "$FIXTURE_PATH" ]]; then
                FIXTURE_PATH="$1"
            else
                log_error "Unexpected argument: $1"
                exit 1
            fi
            shift
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

if [[ -z "$FIXTURE_PATH" ]]; then
    log_error "Fixture path is required"
    echo "Usage: generate-eval-spec.sh <fixture-path> --name <eval-name>" >&2
    exit 1
fi

if [[ -z "$EVAL_NAME" ]]; then
    log_error "--name is required"
    exit 1
fi

# Resolve fixture path
if [[ ! -d "$FIXTURE_PATH" ]]; then
    log_error "Fixture directory not found: $FIXTURE_PATH"
    exit 1
fi

FIXTURE_PATH="$(cd "$FIXTURE_PATH" && pwd)"
FIXTURE_NAME="$(basename "$FIXTURE_PATH")"

# Check for story.md
STORY_FILE="$FIXTURE_PATH/story.md"
if [[ ! -f "$STORY_FILE" ]]; then
    log_error "story.md not found in fixture: $FIXTURE_PATH"
    exit 1
fi

# Auto-detect language if not specified
if [[ -z "$LANGUAGE" ]]; then
    LANGUAGE=$(detect_language "$STORY_FILE")
    log_info "Auto-detected language: $LANGUAGE"
fi

# Set default output file
if [[ -z "$OUTPUT_FILE" ]]; then
    OUTPUT_FILE="${SPECS_DIR}/dev-loop-${EVAL_NAME}.yaml"
fi

# Extract description
DESCRIPTION=$(extract_description "$STORY_FILE")

# -----------------------------------------------------------------------------
# Generate Spec
# -----------------------------------------------------------------------------

log_info "Generating eval spec for: $EVAL_NAME"
log_info "  Fixture: $FIXTURE_NAME"
log_info "  Language: $LANGUAGE"
log_info "  Runs per variant: $RUNS_PER_VARIANT"

SPEC_CONTENT=$(generate_spec "$FIXTURE_NAME" "$EVAL_NAME" "$LANGUAGE" "$DESCRIPTION" "$RUNS_PER_VARIANT")

if [[ "$DRY_RUN" == "true" ]]; then
    echo "$SPEC_CONTENT"
    log_info ""
    log_info "Dry run - spec not written"
else
    mkdir -p "$(dirname "$OUTPUT_FILE")"
    echo "$SPEC_CONTENT" > "$OUTPUT_FILE"
    log_info "Generated: $OUTPUT_FILE"
    log_info ""
    log_info "Next steps:"
    log_info "  1. Prepare fixtures: ./prepare-variants.sh $FIXTURE_PATH /tmp/test-fixtures"
    log_info "  2. Run eval: node ../framework/run-eval.js $OUTPUT_FILE"
fi
