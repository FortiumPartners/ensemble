#!/run/current-system/sw/bin/bash
# Task progress monitor - flicker-free version

STATE_FILE="${1:-}"
SIGNAL_FILE="${2:-}"

# Colors
GREEN='\033[32m'
CYAN='\033[36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

LAST_HASH=""

cleanup() {
    printf '\033[?25h'  # Show cursor
    printf '\033[0m'    # Reset
    clear
    exit 0
}

trap cleanup EXIT INT TERM

# Hide cursor and clear once at start
printf '\033[?25l'
clear

draw_progress_bar() {
    local percent=$1
    local width=40
    local filled=$((percent * width / 100))
    local empty=$((width - filled))
    
    printf "${GREEN}"
    for ((i=0; i<filled; i++)); do printf "█"; done
    printf "${DIM}"
    for ((i=0; i<empty; i++)); do printf "░"; done
    printf "${RESET}"
}

render() {
    # Move to top instead of clearing
    printf '\033[H'
    
    if [[ ! -f "$STATE_FILE" ]]; then
        printf "Waiting for tasks...                              \n"
        return
    fi
    
    local content=$(cat "$STATE_FILE" 2>/dev/null)
    local hash=$(echo "$content" | md5sum 2>/dev/null || md5 -q <<< "$content" 2>/dev/null)
    
    # Skip if nothing changed
    [[ "$hash" == "$LAST_HASH" ]] && return
    LAST_HASH="$hash"
    
    local session_count=$(echo "$content" | jq '.sessions | length' 2>/dev/null || echo 0)
    if [[ "$session_count" == "0" ]]; then
        printf "No active sessions                                \n"
        return
    fi
    
    # Get latest session (last one)
    local tasks=$(echo "$content" | jq -r '.sessions[-1].tasks // []' 2>/dev/null)
    local task_count=$(echo "$tasks" | jq 'length' 2>/dev/null || echo 0)
    
    if [[ "$task_count" == "0" ]]; then
        printf "No tasks                                          \n"
        return
    fi
    
    # Calculate progress
    local completed=$(echo "$tasks" | jq '[.[] | select(.status=="completed")] | length' 2>/dev/null || echo 0)
    local percent=$((completed * 100 / task_count))
    
    # Header
    printf "${BOLD}Task Progress${RESET}                              \n"
    draw_progress_bar $percent
    printf " ${percent}%% (${completed}/${task_count})     \n"
    printf "────────────────────────────────────────────\n"
    
    # Tasks
    local line=0
    echo "$tasks" | jq -r '.[] | "\(.status)|\(.content)"' 2>/dev/null | while IFS='|' read -r status content; do
        # Truncate content to fit
        content="${content:0:50}"
        case "$status" in
            completed)   printf " ${GREEN}✓${RESET} ${DIM}%-50s${RESET}\n" "$content" ;;
            in_progress) printf " ${CYAN}●${RESET} %-50s\n" "$content" ;;
            pending)     printf " ${DIM}○ %-50s${RESET}\n" "$content" ;;
            failed)      printf " \033[31m✗${RESET} %-50s\n" "$content" ;;
        esac
        ((line++))
    done
    
    # Clear any remaining lines from previous render
    for ((i=line; i<15; i++)); do
        printf "                                                      \n"
    done
    
    printf "${DIM}Press q to close${RESET}                          "
}

# Initial render
render

# Main loop
while true; do
    # Check for signal file
    if [[ -f "$SIGNAL_FILE" ]]; then
        signal=$(cat "$SIGNAL_FILE" 2>/dev/null)
        rm -f "$SIGNAL_FILE"
        case "$signal" in
            hide) exit 0 ;;
            update:*) render ;;
        esac
    fi
    
    # Periodic refresh (less frequent)
    render
    
    # Non-blocking key read
    if read -t 1 -n 1 key 2>/dev/null; then
        [[ "$key" == "q" ]] && exit 0
    fi
done
