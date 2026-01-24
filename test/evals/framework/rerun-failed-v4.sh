#!/bin/bash
# Re-run rate-limited sessions with new session IDs

set -euo pipefail

RESULTS_DIR="$(cd "${1:-test/evals/results/overnight-20260115}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "=== Re-running rate-limited sessions ==="
echo "Results dir: $RESULTS_DIR"
echo "Project root: $PROJECT_ROOT"
echo "Time: $(date)"
echo ""

rerun_count=0

# Find all session directories
while IFS= read -r session_dir; do
    session_dir="$(cd "$session_dir" && pwd)"
    session="$session_dir/session.jsonl"
    metadata="$session_dir/metadata.json"
    prompt_file="$session_dir/prompt.txt"

    # Skip if has substantial content already (not rate limited)
    size=$(wc -c < "$session" 2>/dev/null || echo "0")
    if [ "$size" -gt 200 ]; then
        continue
    fi

    # Skip if no prompt file
    if [ ! -f "$prompt_file" ]; then
        echo "SKIP: No prompt file for $(basename "$session_dir")"
        continue
    fi

    # Get details from metadata
    variant=$(grep -o '"variant": "[^"]*"' "$metadata" | cut -d'"' -f4)
    raw_fixture=$(grep -o '"fixture": "[^"]*"' "$metadata" | cut -d'"' -f4)
    timeout=$(grep -o '"timeout_seconds": [0-9]*' "$metadata" | grep -o '[0-9]*' || echo "600")
    old_session_id=$(grep -o '"session_id": "[^"]*"' "$metadata" | cut -d'"' -f4)

    # Strip the repo prefix from fixture path if present
    fixture="${raw_fixture#ensemble-vnext-test-fixtures/}"

    echo "Re-running: $old_session_id ($variant)"
    echo "  Fixture: $fixture"

    # Get workspace directory for this session
    workspace="$session_dir/workspace"
    mkdir -p "$workspace"

    # Copy fixture to workspace
    local_fixture="$PROJECT_ROOT/ensemble-vnext-test-fixtures/$fixture"
    if [ -d "$local_fixture" ]; then
        cp -r "$local_fixture/"* "$workspace/" 2>/dev/null || true
        echo "  Copied fixture from: $local_fixture"
    else
        echo "  WARNING: Local fixture not found: $local_fixture"
    fi

    # Read prompt
    prompt=$(cat "$prompt_file")

    # Run Claude session without --session-id (let Claude generate new one)
    # Output goes to the original session file location
    (
        cd "$workspace"
        echo "$prompt" | timeout "$timeout" claude \
            --print \
            --dangerously-skip-permissions \
            --setting-sources local \
            > "$session" 2>&1 || true
    ) &

    rerun_count=$((rerun_count + 1))

    # Stagger to avoid rate limits (run 2 at a time, then wait longer)
    if [ $((rerun_count % 2)) -eq 0 ]; then
        echo "  Waiting 30s before next batch..."
        sleep 30
    fi
done < <(find "$RESULTS_DIR" -name "session.jsonl" -exec dirname {} \;)

echo ""
echo "Started $rerun_count re-runs"
echo "Waiting for completion..."
wait
echo "All re-runs complete at $(date)"
