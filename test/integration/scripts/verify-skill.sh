#!/bin/bash
# =============================================================================
# verify-skill.sh - Skill invocation verification for A/B testing
# =============================================================================
# Task: TRD-TEST-065
# Purpose: Verify skill invocations in Claude Code session logs using
#          telemetry data for A/B test comparisons.
#
# Usage:
#   ./verify-skill.sh check <session_file> <skill_name>
#   ./verify-skill.sh list <session_file>
#   ./verify-skill.sh compare <session_file> <expected_skills.json>
#   ./verify-skill.sh count <session_file> [skill_name]
#   ./verify-skill.sh extract <session_file> [skill_name]
#
# Expected Session Log Format:
#   Skills are invoked via the Skill tool:
#   {"type": "tool_use", "name": "Skill", "input": {"skill": "developing-with-python", "args": "..."}}
#
# Exit Codes:
#   0 - Verification passed / skill(s) found
#   1 - Verification failed / skill(s) not found
#   2 - Invalid arguments or missing dependencies
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -----------------------------------------------------------------------------
# Dependency Checks
# -----------------------------------------------------------------------------

check_dependencies() {
    if ! command -v jq &>/dev/null; then
        echo "[ERROR] jq is required but not installed" >&2
        echo "Install with: apt-get install jq (Debian/Ubuntu)" >&2
        echo "          or: brew install jq (macOS)" >&2
        exit 2
    fi
}

# -----------------------------------------------------------------------------
# Utility Functions
# -----------------------------------------------------------------------------

log_info() {
    echo "[INFO] $*"
}

log_error() {
    echo "[ERROR] $*" >&2
}

log_success() {
    echo "[OK] $*"
}

log_warning() {
    echo "[WARN] $*"
}

validate_session_file() {
    local session_file="$1"

    if [[ -z "$session_file" ]]; then
        log_error "Session file path is required"
        exit 2
    fi

    if [[ ! -f "$session_file" ]]; then
        log_error "Session file not found: $session_file"
        exit 2
    fi

    if [[ ! -s "$session_file" ]]; then
        log_error "Session file is empty: $session_file"
        exit 1
    fi
}

# -----------------------------------------------------------------------------
# Core Skill Verification Functions
# -----------------------------------------------------------------------------

# Check if a specific skill was invoked during the session
# Usage: check_skill <session_file> <skill_name>
# Returns: 0 if skill was invoked, 1 if not
check_skill() {
    local session_file="$1"
    local skill_name="$2"

    validate_session_file "$session_file"

    if [[ -z "$skill_name" ]]; then
        log_error "Skill name is required"
        exit 2
    fi

    local count=0

    # Primary method: Look for Skill tool invocations with matching skill name
    # Format: {"type": "tool_use", "name": "Skill", "input": {"skill": "skill-name"}}
    count=$(jq -r --arg skill "$skill_name" '
        select(.type == "tool_use" and .name == "Skill") |
        select(.input.skill == $skill)
    ' "$session_file" 2>/dev/null | wc -l)

    # Alternative format: tool_call with Skill
    if [[ "$count" -eq 0 ]]; then
        count=$(jq -r --arg skill "$skill_name" '
            select(.type == "tool_call" and .name == "Skill") |
            select(.arguments.skill == $skill or .input.skill == $skill)
        ' "$session_file" 2>/dev/null | wc -l)
    fi

    # Check in assistant message content blocks
    if [[ "$count" -eq 0 ]]; then
        count=$(jq -r --arg skill "$skill_name" '
            select(.type == "assistant") |
            .content[]? |
            select(.type == "tool_use" and .name == "Skill") |
            select(.input.skill == $skill)
        ' "$session_file" 2>/dev/null | wc -l)
    fi

    # Fallback: grep for skill name in Skill tool context
    if [[ "$count" -eq 0 ]]; then
        if grep -q "\"name\":\"Skill\"" "$session_file" 2>/dev/null && \
           grep -q "\"skill\":\"$skill_name\"" "$session_file" 2>/dev/null; then
            count=1
        fi
    fi

    if [[ "$count" -gt 0 ]]; then
        return 0
    else
        return 1
    fi
}

# List all skills invoked during the session
# Usage: list_skills <session_file>
# Returns: Newline-separated list of unique skill names
list_skills() {
    local session_file="$1"

    validate_session_file "$session_file"

    # Extract skill names from multiple formats and deduplicate
    {
        # Format 1: Direct tool_use events
        jq -r '
            select(.type == "tool_use" and .name == "Skill") |
            .input.skill // empty
        ' "$session_file" 2>/dev/null

        # Format 2: tool_call events
        jq -r '
            select(.type == "tool_call" and .name == "Skill") |
            .arguments.skill // .input.skill // empty
        ' "$session_file" 2>/dev/null

        # Format 3: Nested in assistant message content
        jq -r '
            select(.type == "assistant") |
            .content[]? |
            select(.type == "tool_use" and .name == "Skill") |
            .input.skill // empty
        ' "$session_file" 2>/dev/null
    } | sort -u | grep -v '^$'
}

# Count skill invocations
# Usage: count_skills <session_file> [skill_name]
# Returns: Count as integer (total skills or specific skill count)
count_skills() {
    local session_file="$1"
    local skill_name="${2:-}"

    validate_session_file "$session_file"

    if [[ -n "$skill_name" ]]; then
        # Count specific skill invocations
        local count=0

        count=$(jq --arg skill "$skill_name" '
            select(.type == "tool_use" and .name == "Skill" and .input.skill == $skill) or
            select(.type == "tool_call" and .name == "Skill" and (.arguments.skill == $skill or .input.skill == $skill))
        ' "$session_file" 2>/dev/null | jq -s 'length')

        # Add nested content blocks
        nested=$(jq --arg skill "$skill_name" '
            select(.type == "assistant") |
            .content[]? |
            select(.type == "tool_use" and .name == "Skill" and .input.skill == $skill)
        ' "$session_file" 2>/dev/null | jq -s 'length')

        echo $((count + nested))
    else
        # Count all skill invocations
        local total=0

        total=$(jq '
            select(.type == "tool_use" and .name == "Skill") or
            select(.type == "tool_call" and .name == "Skill")
        ' "$session_file" 2>/dev/null | jq -s 'length')

        # Add nested content blocks
        nested=$(jq '
            select(.type == "assistant") |
            .content[]? |
            select(.type == "tool_use" and .name == "Skill")
        ' "$session_file" 2>/dev/null | jq -s 'length')

        echo $((total + nested))
    fi
}

# Compare expected skills vs actual skills invoked
# Usage: compare_skills <session_file> <expected_skills.json>
# Expected format: ["skill-a", "skill-b", "skill-c"] or {"expected": ["skill-a"]}
# Returns: 0 if all expected skills found, 1 if any missing
compare_skills() {
    local session_file="$1"
    local expected_file="$2"

    validate_session_file "$session_file"

    if [[ -z "$expected_file" ]]; then
        log_error "Expected skills file is required"
        exit 2
    fi

    if [[ ! -f "$expected_file" ]]; then
        log_error "Expected skills file not found: $expected_file"
        exit 2
    fi

    # Parse expected skills (handle both array and object formats)
    local expected_skills
    if jq -e 'type == "array"' "$expected_file" &>/dev/null; then
        expected_skills=$(jq -r '.[]' "$expected_file")
    elif jq -e '.expected' "$expected_file" &>/dev/null; then
        expected_skills=$(jq -r '.expected[]' "$expected_file")
    elif jq -e '.required_skills' "$expected_file" &>/dev/null; then
        expected_skills=$(jq -r '.required_skills[]' "$expected_file")
    else
        log_error "Invalid expected skills format. Use array or {expected: [...]}"
        exit 2
    fi

    # Get actual skills used
    local actual_skills
    actual_skills=$(list_skills "$session_file")

    log_info "Comparing skills in: $session_file"
    echo ""

    log_info "Expected skills:"
    if [[ -n "$expected_skills" ]]; then
        echo "$expected_skills" | while read -r skill; do
            echo "  - $skill"
        done
    else
        echo "  (none)"
    fi

    echo ""
    log_info "Actual skills invoked:"
    if [[ -n "$actual_skills" ]]; then
        echo "$actual_skills" | while read -r skill; do
            local count
            count=$(count_skills "$session_file" "$skill")
            echo "  - $skill ($count invocations)"
        done
    else
        echo "  (none)"
    fi

    echo ""
    log_info "Verification results:"

    local missing_count=0
    local found_count=0

    # Check each expected skill
    while IFS= read -r skill; do
        [[ -z "$skill" ]] && continue
        if check_skill "$session_file" "$skill" 2>/dev/null; then
            log_success "  $skill: found"
            found_count=$((found_count + 1))
        else
            log_warning "  $skill: MISSING"
            missing_count=$((missing_count + 1))
        fi
    done <<< "$expected_skills"

    # Report extra skills (not in expected list)
    local extra_skills=""
    while IFS= read -r skill; do
        [[ -z "$skill" ]] && continue
        if ! echo "$expected_skills" | grep -q "^${skill}$"; then
            extra_skills="${extra_skills}${skill}\n"
        fi
    done <<< "$actual_skills"

    if [[ -n "$extra_skills" ]]; then
        echo ""
        log_info "Additional skills invoked (not in expected list):"
        echo -e "$extra_skills" | while read -r skill; do
            [[ -n "$skill" ]] && echo "  + $skill"
        done
    fi

    echo ""

    # Summary
    local total_expected
    total_expected=$(echo "$expected_skills" | grep -c '.' || echo "0")

    if [[ $missing_count -eq 0 ]] && [[ $total_expected -gt 0 ]]; then
        log_success "All $total_expected expected skills were invoked"
        return 0
    elif [[ $missing_count -eq 0 ]] && [[ $total_expected -eq 0 ]]; then
        log_info "No expected skills specified"
        return 0
    elif [[ $found_count -gt 0 ]]; then
        log_warning "$found_count/$total_expected expected skills found, $missing_count missing"
        return 1
    else
        log_error "No expected skills were invoked"
        return 1
    fi
}

# Extract skill invocation details as JSON
# Usage: extract_skills <session_file> [skill_name]
# Returns: JSON objects with skill invocation details
extract_skills() {
    local session_file="$1"
    local skill_name="${2:-}"

    validate_session_file "$session_file"

    if [[ -n "$skill_name" ]]; then
        # Extract specific skill
        jq -c --arg skill "$skill_name" '
            select(.type == "tool_use" and .name == "Skill" and .input.skill == $skill) |
            {
                skill: .input.skill,
                args: .input.args,
                id: .id,
                timestamp: .timestamp
            }
        ' "$session_file" 2>/dev/null
    else
        # Extract all skills
        jq -c '
            select(.type == "tool_use" and .name == "Skill") |
            {
                skill: .input.skill,
                args: .input.args,
                id: .id,
                timestamp: .timestamp
            }
        ' "$session_file" 2>/dev/null
    fi
}

# Verify skills with detailed output for CI usage
# Usage: verify_skills <session_file>
# Returns: 0 if any skills found, 1 if none
verify_skills() {
    local session_file="$1"

    validate_session_file "$session_file"

    log_info "Verifying skill invocations in: $session_file"
    echo ""

    local skills
    skills=$(list_skills "$session_file")
    local skill_count
    skill_count=$(count_skills "$session_file")

    if [[ -z "$skills" ]] || [[ "$skill_count" -eq 0 ]]; then
        log_warning "No skills were invoked in this session"
        echo ""
        log_info "To invoke a skill, the assistant must use the Skill tool:"
        echo "  {\"type\": \"tool_use\", \"name\": \"Skill\", \"input\": {\"skill\": \"skill-name\"}}"
        return 1
    fi

    log_success "Found $skill_count skill invocation(s)"
    echo ""

    log_info "Skills invoked:"
    echo "$skills" | while read -r skill; do
        local count
        count=$(count_skills "$session_file" "$skill")
        echo "  - $skill: $count invocation(s)"
    done

    echo ""

    # Show invocation details
    log_info "Invocation details:"
    extract_skills "$session_file" | while read -r line; do
        skill=$(echo "$line" | jq -r '.skill')
        args=$(echo "$line" | jq -r '.args // "(no args)"')
        echo "  - $skill"
        if [[ "$args" != "(no args)" ]] && [[ "$args" != "null" ]]; then
            echo "    args: $args"
        fi
    done

    return 0
}

# -----------------------------------------------------------------------------
# Help / Usage
# -----------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") <command> [arguments]

Skill invocation verification for Claude Code A/B testing.

Commands:
    check <session_file> <skill_name>
        Check if a specific skill was invoked during the session.
        Exit code 0 if found, 1 if not.

    list <session_file>
        List all unique skills invoked during the session.
        Outputs skill names, one per line.

    compare <session_file> <expected_skills.json>
        Compare expected skills vs actual skills invoked.
        Expected file format: ["skill-a", "skill-b"] or {"expected": [...]}
        Exit code 0 if all expected found, 1 if any missing.

    count <session_file> [skill_name]
        Count skill invocations (all or specific skill).
        Outputs a single integer.

    extract <session_file> [skill_name]
        Extract skill invocation details as JSON.
        Outputs JSON objects, one per line.

    verify <session_file>
        Verify skills with detailed output for CI usage.
        Lists all skills and their invocation counts.

Options:
    --help, -h      Show this help message

Session Log Format:
    Skills are invoked via the Skill tool with this format:
    {"type": "tool_use", "name": "Skill", "input": {"skill": "developing-with-python"}}

Examples:
    # Check if a skill was invoked
    $(basename "$0") check session.jsonl developing-with-python

    # List all skills used
    $(basename "$0") list session.jsonl

    # Compare expected vs actual (for A/B tests)
    echo '["developing-with-python", "pytest"]' > expected.json
    $(basename "$0") compare session.jsonl expected.json

    # Count skill invocations
    $(basename "$0") count session.jsonl
    $(basename "$0") count session.jsonl developing-with-python

    # Extract skill details as JSON
    $(basename "$0") extract session.jsonl | jq '.skill'

Exit Codes:
    0 - Success / Skill(s) found / All expected skills found
    1 - Failure / Skill(s) not found / Expected skills missing
    2 - Invalid arguments or missing dependencies

A/B Testing Usage:
    For A/B tests comparing behavior with/without skills:

    1. Run variant A (without skill):
       echo "Create Python function" | claude --print > session-a.jsonl

    2. Run variant B (with skill):
       echo "Use Skill tool for Python, then create function" | claude --print > session-b.jsonl

    3. Compare skill usage:
       $(basename "$0") list session-a.jsonl  # Should be empty
       $(basename "$0") list session-b.jsonl  # Should show developing-with-python

    4. Verify expected skills in variant B:
       $(basename "$0") compare session-b.jsonl expected-skills.json
EOF
    exit 0
}

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------

check_dependencies

if [[ $# -lt 1 ]]; then
    usage
fi

COMMAND="$1"
shift

case "$COMMAND" in
    check)
        if [[ $# -lt 2 ]]; then
            log_error "Usage: $(basename "$0") check <session_file> <skill_name>"
            exit 2
        fi
        if check_skill "$1" "$2"; then
            log_success "Skill '$2' was invoked"
            exit 0
        else
            log_error "Skill '$2' was NOT invoked"
            exit 1
        fi
        ;;
    list)
        if [[ $# -lt 1 ]]; then
            log_error "Usage: $(basename "$0") list <session_file>"
            exit 2
        fi
        list_skills "$1"
        ;;
    compare)
        if [[ $# -lt 2 ]]; then
            log_error "Usage: $(basename "$0") compare <session_file> <expected_skills.json>"
            exit 2
        fi
        compare_skills "$1" "$2"
        ;;
    count)
        if [[ $# -lt 1 ]]; then
            log_error "Usage: $(basename "$0") count <session_file> [skill_name]"
            exit 2
        fi
        count_skills "$@"
        ;;
    extract)
        if [[ $# -lt 1 ]]; then
            log_error "Usage: $(basename "$0") extract <session_file> [skill_name]"
            exit 2
        fi
        extract_skills "$@"
        ;;
    verify)
        if [[ $# -lt 1 ]]; then
            log_error "Usage: $(basename "$0") verify <session_file>"
            exit 2
        fi
        verify_skills "$1"
        ;;
    --help|-h|help)
        usage
        ;;
    *)
        # If first argument looks like a file, try to detect intent
        if [[ -f "$COMMAND" ]]; then
            # Default to verify if just given a file
            verify_skills "$COMMAND"
        else
            log_error "Unknown command: $COMMAND"
            echo "" >&2
            usage
        fi
        ;;
esac
