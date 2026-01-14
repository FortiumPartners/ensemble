# Telemetry Analysis Patterns for Ensemble vNext Testing

**Document Version**: 1.0.0
**Status**: Active
**Created**: 2026-01-13
**Task Reference**: TRD-TEST-064
**Related Tasks**: TRD-TEST-062 (OTel config), TRD-TEST-063 (telemetry verification)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Data Sources](#2-data-sources)
3. [Tool Usage Patterns](#3-tool-usage-patterns)
4. [API Call Analysis](#4-api-call-analysis)
5. [Permission Decision Patterns](#5-permission-decision-patterns)
6. [Skill Invocation Analysis](#6-skill-invocation-analysis)
7. [Complete Analysis Workflows](#7-complete-analysis-workflows)
8. [Troubleshooting](#8-troubleshooting)
9. [Reference](#9-reference)

---

## 1. Overview

### 1.1 Purpose

This document provides patterns for analyzing telemetry data from Claude Code headless sessions. These patterns support:

- Verifying tool invocations during automated testing
- Analyzing token usage and API latency
- Auditing permission decisions
- Validating skill invocations for A/B tests

### 1.2 Prerequisites

- `jq` version 1.6 or higher for JSON processing
- Access to session JSONL files from `test/integration/sessions/`
- Optional: OTLP collector for metrics aggregation

> **Practice File**: A sample session file is available at `test/integration/sessions/sample-analysis.jsonl` for practicing these queries.

### 1.3 Telemetry Data Types

Claude Code exports two categories of telemetry data:

| Category | Protocol | Content |
|----------|----------|---------|
| Events | OTLP Logs | `user_prompt`, `tool_result`, `api_request`, `api_error`, `tool_decision` |
| Metrics | OTLP Metrics | Token counts, API latency histograms, session counters |

When using `console` exporters (default in `run-headless.sh`), telemetry is embedded in the JSONL session logs.

---

## 2. Data Sources

### 2.1 Session JSONL Files

Primary data source for analysis. Located at:

```
test/integration/sessions/session-<UUID>.jsonl
```

Each line is a JSON object representing a session event. Common event types:

```json
{"type": "tool_use", "name": "Read", "input": {...}}
{"type": "tool_result", "tool_name": "Read", "output": "..."}
{"type": "assistant", "content": [...]}
{"type": "user", "content": "..."}
```

### 2.2 OTLP Export (Optional)

For production analysis, configure OTLP export:

```bash
OTEL_METRICS_EXPORTER=otlp \
OTEL_LOGS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
./scripts/run-headless.sh "Your prompt"
```

### 2.3 Validation Before Analysis

Always validate session files before analysis:

```bash
# Check file exists and has content
if [[ ! -s "session-abc.jsonl" ]]; then
    echo "Session file empty or missing"
    exit 1
fi

# Validate JSON syntax
jq empty session-abc.jsonl 2>/dev/null || {
    echo "Invalid JSON in session file"
    exit 1
}
```

---

## 3. Tool Usage Patterns

### 3.1 List All Tools Used

Extract unique tool names from a session:

```bash
# Basic: Get all unique tool names
jq -r '
    (select(.type == "tool_use") | .name) //
    (select(.type == "tool_call") | .name) //
    (.tool_name // empty)
' session.jsonl | sort -u | grep -v '^$'
```

**Example output:**
```
Bash
Edit
Glob
Grep
Read
Write
```

### 3.2 Count Tool Invocations

Count total calls for each tool:

```bash
# Count by tool name
jq -r '
    select(.type == "tool_use" or .type == "tool_call") |
    .name // .tool_name
' session.jsonl | sort | uniq -c | sort -rn
```

**Example output:**
```
     15 Read
      8 Edit
      4 Write
      3 Bash
      2 Grep
      1 Glob
```

### 3.3 Tool Invocation Timeline

Get chronological tool usage with timestamps:

```bash
# If timestamps are present
jq -r '
    select(.type == "tool_use") |
    [.timestamp // "N/A", .name, (.input | keys | join(", "))] |
    @tsv
' session.jsonl

# Without timestamps - sequential line numbers
jq -c '
    select(.type == "tool_use") |
    {tool: .name, input_keys: (.input | keys)}
' session.jsonl | nl -ba
```

### 3.4 Extract Tool Parameters

Get all parameters passed to a specific tool:

```bash
# Extract all Read tool invocations with file paths
jq -r '
    select(.type == "tool_use" and .name == "Read") |
    .input.file_path
' session.jsonl

# Extract all Write operations with files and content lengths
jq -r '
    select(.type == "tool_use" and .name == "Write") |
    "\(.input.file_path)\t\(.input.content | length) chars"
' session.jsonl
```

### 3.5 Tool Success/Failure Analysis

Identify tools that returned errors:

```bash
# Find tool results with errors
jq -c '
    select(.type == "tool_result") |
    select(.error != null or .success == false) |
    {tool: .tool_name, error: (.error // "success=false")}
' session.jsonl

# Count errors by tool
jq -r '
    select(.type == "tool_result") |
    select(.error != null or .success == false) |
    .tool_name
' session.jsonl | sort | uniq -c | sort -rn
```

### 3.6 Check If Specific Tool Was Used

Verify a tool was invoked (for test assertions):

```bash
#!/bin/bash
# check_tool.sh <session_file> <tool_name>
session_file="$1"
tool_name="$2"

count=$(jq --arg tool "$tool_name" '
    select(.type == "tool_use" and .name == $tool) or
    select(.type == "tool_call" and .name == $tool) or
    select(.tool_name == $tool)
' "$session_file" | wc -l)

if [[ "$count" -gt 0 ]]; then
    echo "PASS: $tool_name invoked $count times"
    exit 0
else
    echo "FAIL: $tool_name was not invoked"
    exit 1
fi
```

---

## 4. API Call Analysis

### 4.1 Extract Token Usage

Claude Code may log token usage in various formats:

```bash
# Look for token-related fields
jq 'select(.tokens != null or .usage != null or .token_count != null)' session.jsonl

# Extract from usage objects if present
jq -r '
    select(.usage != null) |
    "Input: \(.usage.input_tokens // "N/A"), Output: \(.usage.output_tokens // "N/A")"
' session.jsonl
```

### 4.2 Aggregate Token Counts

Sum tokens across a session:

```bash
# Sum input and output tokens
jq -s '
    [.[].usage | select(. != null)] |
    {
        total_input: (map(.input_tokens) | add // 0),
        total_output: (map(.output_tokens) | add // 0)
    } |
    .total_combined = (.total_input + .total_output)
' session.jsonl
```

### 4.3 API Request Timing

Extract API call latencies:

```bash
# Look for latency/duration fields
jq 'select(.latency_ms != null or .duration != null or .response_time != null)' session.jsonl

# Calculate average latency if available
jq -s '
    [.[].latency_ms | select(. != null)] |
    if length > 0 then
        {
            count: length,
            avg_ms: (add / length),
            max_ms: max,
            min_ms: min
        }
    else
        {message: "No latency data found"}
    end
' session.jsonl
```

### 4.4 API Error Analysis

Identify API errors:

```bash
# Find api_error events
jq -c 'select(.type == "api_error")' session.jsonl

# Extract error details
jq -r '
    select(.type == "api_error") |
    "[\(.timestamp // "N/A")] \(.error_type // "unknown"): \(.message // .error)"
' session.jsonl
```

### 4.5 Cost Estimation

Estimate API costs (requires token counts and pricing):

```bash
#!/bin/bash
# estimate_cost.sh <session_file>
# Pricing per 1M tokens (example rates - adjust as needed)
INPUT_PRICE_PER_M=3.00
OUTPUT_PRICE_PER_M=15.00

result=$(jq -s '
    [.[].usage | select(. != null)] |
    {
        input: (map(.input_tokens) | add // 0),
        output: (map(.output_tokens) | add // 0)
    }
' "$1")

input=$(echo "$result" | jq '.input')
output=$(echo "$result" | jq '.output')

input_cost=$(echo "scale=4; $input / 1000000 * $INPUT_PRICE_PER_M" | bc)
output_cost=$(echo "scale=4; $output / 1000000 * $OUTPUT_PRICE_PER_M" | bc)
total=$(echo "scale=4; $input_cost + $output_cost" | bc)

echo "Input tokens:  $input"
echo "Output tokens: $output"
echo "Estimated cost: \$$total"
```

---

## 5. Permission Decision Patterns

### 5.1 Permission Hook Events

When permission decisions are logged:

```bash
# Find permission-related events
jq 'select(.type == "permission" or .permission != null or .allowed != null)' session.jsonl

# Alternative: grep for permission keywords
grep -i "permission" session.jsonl | jq -c '.'
```

### 5.2 Permission Audit Trail

Create an audit trail of permission decisions:

```bash
# Extract permission decision sequence
jq -c '
    select(
        .type == "permission" or
        .permission_requested != null or
        (.action != null and .allowed != null)
    ) |
    {
        action: (.action // .type // "unknown"),
        resource: (.resource // .path // .target // "N/A"),
        allowed: (.allowed // .granted // .permitted // "N/A"),
        reason: (.reason // .rule // "N/A")
    }
' session.jsonl
```

### 5.3 Denied Permissions

List all denied permission requests:

```bash
jq -c '
    select(
        .allowed == false or
        .granted == false or
        .permitted == false or
        .denied == true
    ) |
    {action: .action, resource: .resource, reason: .reason}
' session.jsonl
```

### 5.4 Permission Statistics

Summarize permission decisions:

```bash
jq -s '
    [.[] | select(.allowed != null or .granted != null)] |
    {
        total_requests: length,
        allowed: ([.[] | select(.allowed == true or .granted == true)] | length),
        denied: ([.[] | select(.allowed == false or .granted == false)] | length)
    } |
    .allow_rate = (if .total_requests > 0 then (.allowed / .total_requests * 100 | round) else 0 end)
' session.jsonl
```

### 5.5 Permission by Resource Type

Group permissions by resource type:

```bash
jq -s '
    [.[] | select(.allowed != null)] |
    group_by(.resource_type // .type // "unknown") |
    map({
        resource_type: .[0].resource_type // .[0].type // "unknown",
        count: length,
        allowed: ([.[] | select(.allowed == true)] | length),
        denied: ([.[] | select(.allowed == false)] | length)
    })
' session.jsonl
```

---

## 6. Skill Invocation Analysis

### 6.1 Detect Skill Tool Usage

Check if the Skill tool was invoked:

```bash
# Check for Skill tool invocation
jq -c '
    select(.type == "tool_use" and .name == "Skill") |
    {skill: .input.skill, args: .input.args}
' session.jsonl
```

### 6.2 List All Skills Used

Extract all skill names from a session:

```bash
jq -r '
    select(.type == "tool_use" and .name == "Skill") |
    .input.skill
' session.jsonl | sort -u
```

### 6.3 Skill Invocation Verification

Verify expected skills were loaded (for A/B tests):

```bash
#!/bin/bash
# verify_skills.sh <session_file> <expected_skills.json>
session_file="$1"
expected_file="$2"

# Get expected skills
expected=$(jq -r '.[]' "$expected_file" | sort)

# Get actual skills used
actual=$(jq -r '
    select(.type == "tool_use" and .name == "Skill") |
    .input.skill
' "$session_file" | sort -u)

# Compare
echo "Expected skills:"
echo "$expected"
echo ""
echo "Actual skills used:"
echo "$actual"
echo ""

# Check each expected skill
missing=0
while IFS= read -r skill; do
    if ! echo "$actual" | grep -q "^$skill$"; then
        echo "MISSING: $skill"
        missing=$((missing + 1))
    fi
done <<< "$expected"

if [[ $missing -eq 0 ]]; then
    echo "PASS: All expected skills were invoked"
    exit 0
else
    echo "FAIL: $missing expected skills not found"
    exit 1
fi
```

### 6.4 Skill Load Messages

Skills may appear in assistant messages after loading:

```bash
# Look for skill-related content in assistant responses
jq -r '
    select(.type == "assistant") |
    .content[]? |
    select(.type == "text") |
    .text
' session.jsonl | grep -i "skill\|SKILL.md"
```

---

## 7. Complete Analysis Workflows

### 7.1 Session Summary Report

Generate a comprehensive session analysis:

```bash
#!/bin/bash
# session_summary.sh <session_file>
SESSION_FILE="$1"

echo "========================================"
echo "SESSION ANALYSIS REPORT"
echo "========================================"
echo "File: $SESSION_FILE"
echo "Generated: $(date)"
echo ""

# Tool usage
echo "--- TOOL USAGE ---"
jq -r '
    select(.type == "tool_use" or .type == "tool_call") |
    .name // .tool_name
' "$SESSION_FILE" | sort | uniq -c | sort -rn

echo ""

# Skills used
echo "--- SKILLS LOADED ---"
skills=$(jq -r '
    select(.type == "tool_use" and .name == "Skill") |
    .input.skill
' "$SESSION_FILE" | sort -u)

if [[ -n "$skills" ]]; then
    echo "$skills"
else
    echo "(none)"
fi

echo ""

# Files created
echo "--- FILES WRITTEN ---"
jq -r '
    select(.type == "tool_use" and .name == "Write") |
    .input.file_path
' "$SESSION_FILE" | sort -u

echo ""

# Errors
echo "--- ERRORS ---"
error_count=$(jq 'select(.error != null or .success == false)' "$SESSION_FILE" | wc -l)
echo "Error events: $error_count"

if [[ $error_count -gt 0 ]]; then
    jq -r '
        select(.error != null) |
        "  - \(.error)"
    ' "$SESSION_FILE" | head -5
fi

echo ""
echo "========================================"
```

### 7.2 A/B Test Comparison

Compare two sessions for A/B testing:

```bash
#!/bin/bash
# compare_sessions.sh <session_a> <session_b>
SESSION_A="$1"
SESSION_B="$2"

echo "A/B SESSION COMPARISON"
echo "======================"
echo "Session A: $SESSION_A"
echo "Session B: $SESSION_B"
echo ""

# Tool count comparison
echo "--- TOOL INVOCATION COUNTS ---"
echo "Session A:"
jq -r 'select(.type == "tool_use") | .name' "$SESSION_A" | sort | uniq -c | sort -rn
echo ""
echo "Session B:"
jq -r 'select(.type == "tool_use") | .name' "$SESSION_B" | sort | uniq -c | sort -rn
echo ""

# Skill comparison
echo "--- SKILL USAGE ---"
echo "Session A skills:"
jq -r 'select(.type == "tool_use" and .name == "Skill") | .input.skill' "$SESSION_A" | sort -u || echo "(none)"
echo ""
echo "Session B skills:"
jq -r 'select(.type == "tool_use" and .name == "Skill") | .input.skill' "$SESSION_B" | sort -u || echo "(none)"
echo ""

# Output size comparison
echo "--- OUTPUT METRICS ---"
a_lines=$(wc -l < "$SESSION_A")
b_lines=$(wc -l < "$SESSION_B")
a_size=$(wc -c < "$SESSION_A")
b_size=$(wc -c < "$SESSION_B")

echo "Session A: $a_lines events, $a_size bytes"
echo "Session B: $b_lines events, $b_size bytes"
```

### 7.3 Automated Test Assertion Script

Use in CI/CD for test validation:

```bash
#!/bin/bash
# assert_session.sh <session_file> <assertions.json>
# assertions.json format:
# {
#   "required_tools": ["Read", "Write"],
#   "required_skills": ["developing-with-python"],
#   "forbidden_tools": ["Bash"],
#   "min_tool_calls": 5
# }

SESSION_FILE="$1"
ASSERTIONS_FILE="$2"
FAILURES=0

# Required tools
for tool in $(jq -r '.required_tools[]?' "$ASSERTIONS_FILE"); do
    count=$(jq --arg t "$tool" 'select(.type == "tool_use" and .name == $t)' "$SESSION_FILE" | wc -l)
    if [[ $count -eq 0 ]]; then
        echo "FAIL: Required tool '$tool' not invoked"
        FAILURES=$((FAILURES + 1))
    else
        echo "PASS: Required tool '$tool' invoked ($count times)"
    fi
done

# Required skills
for skill in $(jq -r '.required_skills[]?' "$ASSERTIONS_FILE"); do
    count=$(jq --arg s "$skill" \
        'select(.type == "tool_use" and .name == "Skill" and .input.skill == $s)' \
        "$SESSION_FILE" | wc -l)
    if [[ $count -eq 0 ]]; then
        echo "FAIL: Required skill '$skill' not loaded"
        FAILURES=$((FAILURES + 1))
    else
        echo "PASS: Required skill '$skill' loaded"
    fi
done

# Forbidden tools
for tool in $(jq -r '.forbidden_tools[]?' "$ASSERTIONS_FILE"); do
    count=$(jq --arg t "$tool" 'select(.type == "tool_use" and .name == $t)' "$SESSION_FILE" | wc -l)
    if [[ $count -gt 0 ]]; then
        echo "FAIL: Forbidden tool '$tool' was invoked ($count times)"
        FAILURES=$((FAILURES + 1))
    else
        echo "PASS: Forbidden tool '$tool' was not used"
    fi
done

# Minimum tool calls
min_calls=$(jq -r '.min_tool_calls // 0' "$ASSERTIONS_FILE")
actual_calls=$(jq 'select(.type == "tool_use")' "$SESSION_FILE" | wc -l)
if [[ $actual_calls -lt $min_calls ]]; then
    echo "FAIL: Only $actual_calls tool calls (minimum: $min_calls)"
    FAILURES=$((FAILURES + 1))
else
    echo "PASS: $actual_calls tool calls (minimum: $min_calls)"
fi

echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo "All assertions passed"
    exit 0
else
    echo "$FAILURES assertion(s) failed"
    exit 1
fi
```

---

## 8. Troubleshooting

### 8.1 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Empty jq output | Wrong event type selector | Try multiple selectors: `tool_use`, `tool_call`, direct field access |
| Parse errors | Mixed JSON formats | Use `-c` flag and validate with `jq empty` first |
| Missing tools | Tools recorded differently | Check with `grep` first: `grep -o '"name":"[^"]*"' session.jsonl` |
| No timestamps | Console exporter mode | Timestamps may not be included in console mode |

### 8.2 Debugging jq Filters

Test filters incrementally:

```bash
# Step 1: See all event types
jq -r '.type // "no-type"' session.jsonl | sort | uniq -c

# Step 2: See structure of tool events
jq 'select(.type == "tool_use")' session.jsonl | head -1 | jq '.'

# Step 3: Build filter based on actual structure
jq 'select(.type == "tool_use") | keys' session.jsonl | head -1
```

### 8.3 Handling Large Files

For large session files (>100MB):

```bash
# Stream processing (memory efficient)
jq -c --stream 'select(.[0][-1] == "name" and .[1] != null)' session.jsonl

# Process in chunks
split -l 10000 session.jsonl chunk_
for chunk in chunk_*; do
    jq 'select(.type == "tool_use")' "$chunk"
done
```

---

## 9. Reference

### 9.1 Quick Reference Card

```bash
# LIST ALL TOOLS
jq -r 'select(.type == "tool_use") | .name' session.jsonl | sort -u

# COUNT TOOLS
jq -r 'select(.type == "tool_use") | .name' session.jsonl | sort | uniq -c | sort -rn

# CHECK SPECIFIC TOOL
jq --arg t "Write" 'select(.type == "tool_use" and .name == $t)' session.jsonl | wc -l

# LIST SKILLS
jq -r 'select(.type == "tool_use" and .name == "Skill") | .input.skill' session.jsonl

# FIND ERRORS
jq 'select(.error != null)' session.jsonl

# FILES WRITTEN
jq -r 'select(.type == "tool_use" and .name == "Write") | .input.file_path' session.jsonl
```

### 9.2 Event Type Reference

| Event Type | Description | Key Fields |
|------------|-------------|------------|
| `tool_use` | Tool invocation | `.name`, `.input` |
| `tool_result` | Tool response | `.tool_name`, `.output`, `.error` |
| `assistant` | Model response | `.content[]` |
| `user` | User input | `.content` |
| `api_request` | API call metadata | `.tokens`, `.latency_ms` |
| `api_error` | API error | `.error_type`, `.message` |
| `permission` | Permission decision | `.action`, `.allowed`, `.resource` |

### 9.3 Related Documentation

- [Integration Test Infrastructure](../../test/integration/README.md)
- [verify-output.sh Script](../../test/integration/scripts/verify-output.sh)
- [Testing Phase TRD](./testing-phase.md)
- [OpenTelemetry Configuration](../../test/integration/README.md#opentelemetry-configuration)

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-13 | Initial document creation (TRD-TEST-064) |
