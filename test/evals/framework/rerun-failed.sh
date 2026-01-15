#!/bin/bash
# Re-run rate-limited sessions

set -euo pipefail

RESULTS_DIR="${1:-test/evals/results/overnight-20260115}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Re-running rate-limited sessions ==="
echo "Results dir: $RESULTS_DIR"
echo "Time: $(date)"
echo ""

rerun_count=0

# Find all session directories
while IFS= read -r session_dir; do
    session="$session_dir/session.jsonl"
    metadata="$session_dir/metadata.json"
    prompt_file="$session_dir/prompt.txt"

    # Skip if not rate limited
    if ! grep -q "hit your limit" "$session" 2>/dev/null; then
        continue
    fi

    # Skip if no prompt file
    if [ ! -f "$prompt_file" ]; then
        echo "SKIP: No prompt file for $(basename "$session_dir")"
        continue
    fi

    # Get details from metadata
    variant=$(grep -o '"variant": "[^"]*"' "$metadata" | cut -d'"' -f4)
    fixture=$(grep -o '"fixture": "[^"]*"' "$metadata" | cut -d'"' -f4)
    timeout=$(grep -o '"timeout_seconds": [0-9]*' "$metadata" | grep -o '[0-9]*' || echo "600")
    session_id=$(grep -o '"session_id": "[^"]*"' "$metadata" | cut -d'"' -f4)

    # Clear old session output
    > "$session"

    echo "Re-running: $session_id ($variant)"

    # Re-run the session
    prompt=$(cat "$prompt_file")

    "$SCRIPT_DIR/run-session.sh" \
        --local \
        --keep \
        --output-dir "$(dirname "$session_dir")" \
        --variant "$variant" \
        --session-id "$session_id" \
        --fixture "$fixture" \
        --timeout "$timeout" \
        "$prompt" &

    rerun_count=$((rerun_count + 1))

    # Stagger to avoid rate limits
    if [ $((rerun_count % 2)) -eq 0 ]; then
        sleep 10
    fi
done < <(find "$RESULTS_DIR" -name "session.jsonl" -exec dirname {} \;)

echo ""
echo "Started $rerun_count re-runs"
echo "Waiting for completion..."
wait
echo "All re-runs complete."
