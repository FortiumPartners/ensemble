#!/run/current-system/sw/bin/bash
#
# task-progress-monitor.sh
# Terminal UI for task progress visualization
#
# Arguments:
#   $1 - State file path
#   $2 - Signal file path
#   $3 - Auto-close timeout (0 = disabled)
#
# Features:
#   - Fixed header with progress bar
#   - Scrollable task list
#   - Vim-style navigation (j/k/gg/G)
#   - Section collapse/expand (zc/zo, Enter)
#   - Search mode (/, n/N)
#   - State watching (inotifywait + polling fallback)

set -uo pipefail

# =============================================================================
# SECTION 1: CONFIGURATION & CONSTANTS
# =============================================================================

# Arguments
STATE_FILE="${1:-}"
SIGNAL_FILE="${2:-}"
AUTO_CLOSE_TIMEOUT="${3:-0}"
AUTO_COLLAPSE_THRESHOLD="${4:-5}"  # Auto-collapse completed section after N items

# Validate arguments
if [[ -z "$STATE_FILE" ]]; then
    echo "Usage: $0 <state_file> <signal_file> [auto_close_timeout]" >&2
    exit 1
fi

# ANSI Colors
readonly RESET='\033[0m'
readonly BOLD='\033[1m'
readonly DIM='\033[2m'
readonly ITALIC='\033[3m'
readonly UNDERLINE='\033[4m'

readonly BLACK='\033[30m'
readonly RED='\033[31m'
readonly GREEN='\033[32m'
readonly YELLOW='\033[33m'
readonly BLUE='\033[34m'
readonly MAGENTA='\033[35m'
readonly CYAN='\033[36m'
readonly WHITE='\033[37m'

readonly BG_BLACK='\033[40m'
readonly BG_RED='\033[41m'
readonly BG_GREEN='\033[42m'
readonly BG_YELLOW='\033[43m'
readonly BG_BLUE='\033[44m'
readonly BG_MAGENTA='\033[45m'
readonly BG_CYAN='\033[46m'
readonly BG_WHITE='\033[47m'

# Status icons (Unicode)
readonly ICON_COMPLETED="✓"
readonly ICON_IN_PROGRESS="●"
readonly ICON_PENDING="○"
readonly ICON_FAILED="✗"
readonly ICON_COLLAPSED="▸"
readonly ICON_EXPANDED="▾"

# Layout constants
readonly HEADER_HEIGHT=5
readonly HELP_HEIGHT=1
readonly POLLING_INTERVAL_MS=200

# State variables
declare -i TERM_ROWS=24
declare -i TERM_COLS=80
declare -i SCROLL_OFFSET=0
declare -i CURSOR_POS=0
declare -i BODY_HEIGHT=18
declare -a EXPANDED_TASKS=()
declare -a COLLAPSED_SECTIONS=()
SEARCH_QUERY=""
declare -a SEARCH_MATCHES=()
declare -i SEARCH_INDEX=0
SEARCH_MODE=false
RUNNING=true
LAST_STATE_MTIME=""

# Multi-session state
declare -a SESSION_IDS=()
declare -i CURRENT_SESSION_IDX=0

# Task data (populated from state file - per session)
declare -a TASKS=()
declare -a TASK_STATUSES=()
declare -a TASK_IDS=()
declare PROGRESS_COMPLETED=0
declare PROGRESS_FAILED=0
declare PROGRESS_TOTAL=0
declare PROGRESS_PERCENT=0
declare TOTAL_ELAPSED_MS=0
declare CURRENT_TASK=""

# Multi-session data structure
# Each session is stored in parallel arrays
declare -a ALL_SESSION_TASKS=()       # Pipe-delimited task contents per session
declare -a ALL_SESSION_STATUSES=()    # Pipe-delimited task statuses per session
declare -a ALL_SESSION_IDS=()         # Pipe-delimited task IDs per session
declare -a SESSION_AGENT_TYPES=()     # Agent type per session
declare -a SESSION_PROGRESS_PCT=()    # Progress percentage per session
declare -a SESSION_CURRENT_TASK=()    # Current task per session

# Task details arrays (parallel to TASKS/TASK_STATUSES/TASK_IDS)
declare -a TASK_ERRORS=()             # Error messages for failed tasks
declare -a TASK_ACTIVE_FORMS=()       # Active form descriptions

# =============================================================================
# SECTION 2: TERMINAL UTILITIES
# =============================================================================

# Save cursor position
save_cursor() {
    printf '\033[s'
}

# Restore cursor position
restore_cursor() {
    printf '\033[u'
}

# Move cursor to position
move_to() {
    local row=$1
    local col=$2
    printf '\033[%d;%dH' "$row" "$col"
}

# Clear screen
clear_screen() {
    printf '\033[2J'
    move_to 1 1
}

# Clear line
clear_line() {
    printf '\033[2K'
}

# Hide cursor
hide_cursor() {
    printf '\033[?25l'
}

# Show cursor
show_cursor() {
    printf '\033[?25h'
}

# Get terminal size
update_terminal_size() {
    TERM_ROWS=$(tput lines 2>/dev/null || echo 24)
    TERM_COLS=$(tput cols 2>/dev/null || echo 80)
    BODY_HEIGHT=$((TERM_ROWS - HEADER_HEIGHT - HELP_HEIGHT))
    if ((BODY_HEIGHT < 1)); then
        BODY_HEIGHT=1
    fi
}

# =============================================================================
# SECTION 3: STATE MANAGEMENT
# =============================================================================

# Read and parse state file
read_state() {
    if [[ ! -f "$STATE_FILE" ]]; then
        return 1
    fi

    local content
    content=$(cat "$STATE_FILE" 2>/dev/null) || return 1

    # Parse JSON using jq if available, fallback to basic parsing
    if command -v jq &>/dev/null; then
        parse_state_with_jq "$content"
    else
        parse_state_basic "$content"
    fi

    # Load current session data into working arrays
    load_current_session_data
    return 0
}

# Parse state using jq (fast, accurate)
parse_state_with_jq() {
    local content="$1"

    # Reset multi-session arrays
    SESSION_IDS=()
    ALL_SESSION_TASKS=()
    ALL_SESSION_STATUSES=()
    ALL_SESSION_IDS=()
    SESSION_AGENT_TYPES=()
    SESSION_PROGRESS_PCT=()
    SESSION_CURRENT_TASK=()

    # Get active session index
    CURRENT_SESSION_IDX=$(echo "$content" | jq -r '.activeSessionIndex // 0')

    # Get session count
    local session_count
    session_count=$(echo "$content" | jq -r '.sessions | length')

    if ((session_count == 0)); then
        return 0
    fi

    # Parse each session
    for ((i = 0; i < session_count; i++)); do
        local session_id agent_type current_task progress_pct
        session_id=$(echo "$content" | jq -r ".sessions[$i].sessionId // \"session-$i\"")
        agent_type=$(echo "$content" | jq -r ".sessions[$i].agentType // \"unknown\"")
        current_task=$(echo "$content" | jq -r ".sessions[$i].currentTask // \"\"")
        progress_pct=$(echo "$content" | jq -r ".sessions[$i].progress.percentage // 0")

        SESSION_IDS+=("$session_id")
        SESSION_AGENT_TYPES+=("$agent_type")
        SESSION_CURRENT_TASK+=("$current_task")
        SESSION_PROGRESS_PCT+=("$progress_pct")

        # Get tasks for this session (pipe-delimited)
        local tasks_content tasks_status tasks_ids tasks_errors tasks_activeforms
        tasks_content=$(echo "$content" | jq -r ".sessions[$i].tasks[].content // \"\"" | tr '\n' '|')
        tasks_status=$(echo "$content" | jq -r ".sessions[$i].tasks[].status // \"pending\"" | tr '\n' '|')
        tasks_ids=$(echo "$content" | jq -r ".sessions[$i].tasks[].id // \"\"" | tr '\n' '|')
        tasks_errors=$(echo "$content" | jq -r ".sessions[$i].tasks[].error // \"\"" | tr '\n' '|')
        tasks_activeforms=$(echo "$content" | jq -r ".sessions[$i].tasks[].activeForm // \"\"" | tr '\n' '|')

        ALL_SESSION_TASKS+=("$tasks_content")
        ALL_SESSION_STATUSES+=("$tasks_status")
        ALL_SESSION_IDS+=("$tasks_ids")

        # Store errors and activeforms indexed by session
        eval "SESSION_${i}_ERRORS=\"$tasks_errors\""
        eval "SESSION_${i}_ACTIVEFORMS=\"$tasks_activeforms\""
    done
}

# Basic state parsing (fallback)
parse_state_basic() {
    local content="$1"

    # Reset arrays
    SESSION_IDS=()
    ALL_SESSION_TASKS=()
    ALL_SESSION_STATUSES=()
    ALL_SESSION_IDS=()
    SESSION_AGENT_TYPES=()
    SESSION_PROGRESS_PCT=()
    SESSION_CURRENT_TASK=()
    TASKS=()
    TASK_STATUSES=()
    TASK_IDS=()

    local task_content=""
    local task_status=""
    local task_id=""

    while IFS= read -r line; do
        # Look for progress data
        if [[ "$line" =~ \"completed\":\ *([0-9]+) ]]; then
            PROGRESS_COMPLETED="${BASH_REMATCH[1]}"
        fi
        if [[ "$line" =~ \"failed\":\ *([0-9]+) ]]; then
            PROGRESS_FAILED="${BASH_REMATCH[1]}"
        fi
        if [[ "$line" =~ \"total\":\ *([0-9]+) ]]; then
            PROGRESS_TOTAL="${BASH_REMATCH[1]}"
        fi
        if [[ "$line" =~ \"percentage\":\ *([0-9]+) ]]; then
            PROGRESS_PERCENT="${BASH_REMATCH[1]}"
        fi
        if [[ "$line" =~ \"totalElapsedMs\":\ *([0-9]+) ]]; then
            TOTAL_ELAPSED_MS="${BASH_REMATCH[1]}"
        fi
        if [[ "$line" =~ \"currentTask\":\ *\"([^\"]+)\" ]]; then
            CURRENT_TASK="${BASH_REMATCH[1]}"
        fi
        if [[ "$line" =~ \"sessionId\":\ *\"([^\"]+)\" ]]; then
            SESSION_IDS+=("${BASH_REMATCH[1]}")
        fi
        if [[ "$line" =~ \"agentType\":\ *\"([^\"]+)\" ]]; then
            SESSION_AGENT_TYPES+=("${BASH_REMATCH[1]}")
        fi

        # Parse individual tasks
        if [[ "$line" =~ \"content\":\ *\"([^\"]+)\" ]]; then
            task_content="${BASH_REMATCH[1]}"
        fi
        if [[ "$line" =~ \"status\":\ *\"([^\"]+)\" ]]; then
            task_status="${BASH_REMATCH[1]}"
        fi
        if [[ "$line" =~ \"id\":\ *\"([^\"]+)\" ]]; then
            task_id="${BASH_REMATCH[1]}"
        fi

        # Check for task object end (simplified)
        if [[ -n "$task_content" && -n "$task_status" && -n "$task_id" ]]; then
            TASKS+=("$task_content")
            TASK_STATUSES+=("$task_status")
            TASK_IDS+=("$task_id")
            task_content=""
            task_status=""
            task_id=""
        fi
    done <<< "$content"

    # Set up single "session" for basic parsing
    if (( ${#SESSION_IDS[@]} == 0 )); then
        SESSION_IDS=("default")
    fi
}

# Load current session data into working arrays
load_current_session_data() {
    local session_count=${#SESSION_IDS[@]}

    if ((session_count == 0)); then
        TASKS=()
        TASK_STATUSES=()
        TASK_IDS=()
        TASK_ERRORS=()
        TASK_ACTIVE_FORMS=()
        PROGRESS_PERCENT=0
        CURRENT_TASK=""
        return
    fi

    # Ensure index is valid
    if ((CURRENT_SESSION_IDX >= session_count)); then
        CURRENT_SESSION_IDX=$((session_count - 1))
    fi
    if ((CURRENT_SESSION_IDX < 0)); then
        CURRENT_SESSION_IDX=0
    fi

    # If we have multi-session data from jq parsing
    if (( ${#ALL_SESSION_TASKS[@]} > 0 )); then
        local tasks_str="${ALL_SESSION_TASKS[$CURRENT_SESSION_IDX]}"
        local statuses_str="${ALL_SESSION_STATUSES[$CURRENT_SESSION_IDX]}"
        local ids_str="${ALL_SESSION_IDS[$CURRENT_SESSION_IDX]}"

        # Get errors and activeforms for this session
        local errors_str activeforms_str
        eval "errors_str=\"\${SESSION_${CURRENT_SESSION_IDX}_ERRORS:-}\""
        eval "activeforms_str=\"\${SESSION_${CURRENT_SESSION_IDX}_ACTIVEFORMS:-}\""

        # Convert pipe-delimited strings to arrays
        TASKS=()
        TASK_STATUSES=()
        TASK_IDS=()
        TASK_ERRORS=()
        TASK_ACTIVE_FORMS=()

        IFS='|' read -ra TASKS <<< "$tasks_str"
        IFS='|' read -ra TASK_STATUSES <<< "$statuses_str"
        IFS='|' read -ra TASK_IDS <<< "$ids_str"
        IFS='|' read -ra TASK_ERRORS <<< "$errors_str"
        IFS='|' read -ra TASK_ACTIVE_FORMS <<< "$activeforms_str"

        # Remove empty trailing elements
        while (( ${#TASKS[@]} > 0 )) && [[ -z "${TASKS[-1]:-}" ]]; do
            unset 'TASKS[-1]'
        done

        PROGRESS_PERCENT="${SESSION_PROGRESS_PCT[$CURRENT_SESSION_IDX]:-0}"
        CURRENT_TASK="${SESSION_CURRENT_TASK[$CURRENT_SESSION_IDX]:-}"
    fi

    # Calculate progress from tasks if not set
    local task_count=${#TASKS[@]}
    if ((task_count > 0)); then
        PROGRESS_TOTAL=$task_count
        PROGRESS_COMPLETED=0
        PROGRESS_FAILED=0

        for status in "${TASK_STATUSES[@]}"; do
            case "$status" in
                completed) ((PROGRESS_COMPLETED++)) ;;
                failed) ((PROGRESS_FAILED++)) ;;
            esac
        done

        if ((PROGRESS_TOTAL > 0)); then
            PROGRESS_PERCENT=$(( (PROGRESS_COMPLETED * 100) / PROGRESS_TOTAL ))
        fi
    fi
}

# Format elapsed time
format_elapsed() {
    local ms=$1
    local seconds=$((ms / 1000))
    local minutes=$((seconds / 60))
    local hours=$((minutes / 60))

    if ((hours > 0)); then
        printf "%dh %dm" "$hours" "$((minutes % 60))"
    elif ((minutes > 0)); then
        printf "%dm %ds" "$minutes" "$((seconds % 60))"
    else
        printf "%ds" "$seconds"
    fi
}

# =============================================================================
# SECTION 4: RENDERING FUNCTIONS
# =============================================================================

# Render session indicator
render_session_indicator() {
    local session_count=${#SESSION_IDS[@]}
    if ((session_count <= 1)); then
        return
    fi

    local indicator=""
    for ((i = 0; i < session_count; i++)); do
        if ((i == CURRENT_SESSION_IDX)); then
            indicator+="${BOLD}●${RESET}"
        else
            indicator+="${DIM}○${RESET}"
        fi
        if ((i < session_count - 1)); then
            indicator+=" "
        fi
    done

    printf " %b" "$indicator"
}

# Get current session agent type
get_current_agent_type() {
    local session_count=${#SESSION_AGENT_TYPES[@]}
    if ((CURRENT_SESSION_IDX >= 0 && CURRENT_SESSION_IDX < session_count)); then
        echo "${SESSION_AGENT_TYPES[$CURRENT_SESSION_IDX]:-unknown}"
    else
        echo "unknown"
    fi
}

# Render fixed header
render_header() {
    move_to 1 1

    # Title bar with session info
    local session_count=${#SESSION_IDS[@]}
    local title="Task Progress"

    if ((session_count > 1)); then
        local agent_type
        agent_type=$(get_current_agent_type)
        title="Task Progress [$agent_type] ($((CURRENT_SESSION_IDX + 1))/$session_count)"
    fi

    printf "${BOLD}${BG_BLUE}${WHITE}"
    printf " %-$((TERM_COLS - 2))s " "$title"
    printf "${RESET}\n"

    # Progress bar
    render_progress_bar "$PROGRESS_COMPLETED" "$PROGRESS_FAILED" "$PROGRESS_TOTAL" $((TERM_COLS - 4))

    # Session indicator + Elapsed time
    local elapsed_str
    elapsed_str=$(format_elapsed "$TOTAL_ELAPSED_MS")

    if ((session_count > 1)); then
        printf " "
        render_session_indicator
        printf " ${DIM}| Elapsed: %s${RESET}\n" "$elapsed_str"
    else
        printf " ${DIM}Elapsed: %s${RESET}\n" "$elapsed_str"
    fi

    # Current task (if any)
    if [[ -n "$CURRENT_TASK" ]]; then
        local truncated="${CURRENT_TASK:0:$((TERM_COLS - 12))}"
        printf " ${CYAN}▶ %s${RESET}\n" "$truncated"
    else
        printf "\n"
    fi

    # Separator
    printf "${DIM}"
    printf '─%.0s' $(seq 1 "$TERM_COLS")
    printf "${RESET}\n"
}

# Render progress bar with failed tasks
render_progress_bar() {
    local completed=$1
    local failed=$2
    local total=$3
    local width=${4:-30}

    local percent=0
    if ((total > 0)); then
        percent=$(( (completed * 100) / total ))
    fi

    local filled=$(( (percent * width) / 100 ))
    local empty=$(( width - filled ))

    # Color: green if no failures, yellow if some failures
    local color="$GREEN"
    if ((failed > 0)); then
        color="$YELLOW"
    fi

    printf " %b[" "$color"
    if ((filled > 0)); then
        printf '%*s' "$filled" '' | tr ' ' '█'
    fi
    if ((empty > 0)); then
        printf '%*s' "$empty" '' | tr ' ' '░'
    fi
    printf "]%b %d%% (%d/%d)" "$RESET" "$percent" "$completed" "$total"

    if ((failed > 0)); then
        printf " ${RED}(%d failed)${RESET}" "$failed"
    fi
    printf "\n"
}

# Get status icon for a task
get_status_icon() {
    local status=$1
    case "$status" in
        completed) echo -e "${GREEN}${ICON_COMPLETED}${RESET}" ;;
        in_progress) echo -e "${CYAN}${ICON_IN_PROGRESS}${RESET}" ;;
        failed) echo -e "${RED}${ICON_FAILED}${RESET}" ;;
        *) echo -e "${DIM}${ICON_PENDING}${RESET}" ;;
    esac
}

# Render task list (scrollable)
render_task_list() {
    local visible_start=$SCROLL_OFFSET
    local task_count=${#TASKS[@]}
    local rendered_row=0
    local task_idx=$visible_start

    while ((rendered_row < BODY_HEIGHT && task_idx < task_count)); do
        move_to $((HEADER_HEIGHT + rendered_row + 1)) 1
        clear_line

        local content="${TASKS[$task_idx]}"
        local status="${TASK_STATUSES[$task_idx]}"
        local task_id="${TASK_IDS[$task_idx]}"

        # Check if this section is collapsed
        if is_section_collapsed "$status"; then
            # Skip tasks with this status (only show first as header)
            local section_first=true
            for ((i = 0; i < task_idx; i++)); do
                if [[ "${TASK_STATUSES[$i]}" == "$status" ]]; then
                    section_first=false
                    break
                fi
            done

            if [[ "$section_first" == true ]]; then
                # Show collapsed section header
                local section_count=0
                for s in "${TASK_STATUSES[@]}"; do
                    if [[ "$s" == "$status" ]]; then
                        ((section_count++))
                    fi
                done

                local icon
                icon=$(get_status_icon "$status")

                if ((task_idx == CURSOR_POS)); then
                    printf "${BG_WHITE}${BLACK}"
                fi
                printf " %b %s [%d items collapsed]" "$ICON_COLLAPSED" "$status" "$section_count"
                if ((task_idx == CURSOR_POS)); then
                    printf "${RESET}"
                fi
                ((rendered_row++))
            fi
            ((task_idx++))
            continue
        fi

        local icon
        icon=$(get_status_icon "$status")

        # Truncate content to fit
        local max_len=$((TERM_COLS - 6))
        local truncated="${content:0:$max_len}"

        # Check if task is expanded
        local expand_icon=""
        if is_task_expanded "$task_id"; then
            expand_icon="$ICON_EXPANDED "
        fi

        # Highlight current line if cursor is here
        if ((task_idx == CURSOR_POS)); then
            printf "${BG_WHITE}${BLACK}"
        fi

        # Highlight search matches
        if [[ "$SEARCH_MODE" == true && -n "$SEARCH_QUERY" ]]; then
            if [[ "$content" == *"$SEARCH_QUERY"* ]]; then
                truncated="${truncated//$SEARCH_QUERY/${BOLD}${YELLOW}${SEARCH_QUERY}${RESET}}"
            fi
        fi

        printf " %b%s %s" "$expand_icon" "$icon" "$truncated"

        if ((task_idx == CURSOR_POS)); then
            printf "${RESET}"
        fi

        ((rendered_row++))

        # If task is expanded, show additional details
        if is_task_expanded "$task_id" && ((rendered_row < BODY_HEIGHT)); then
            # Show activeForm if available
            local active_form="${TASK_ACTIVE_FORMS[$task_idx]:-}"
            if [[ -n "$active_form" ]]; then
                move_to $((HEADER_HEIGHT + rendered_row + 1)) 1
                clear_line
                local active_truncated="${active_form:0:$((TERM_COLS - 8))}"
                printf "   ${DIM}→ %s${RESET}" "$active_truncated"
                ((rendered_row++))
            fi

            # Show error details for failed tasks
            local error_msg="${TASK_ERRORS[$task_idx]:-}"
            if [[ "$status" == "failed" && -n "$error_msg" ]] && ((rendered_row < BODY_HEIGHT)); then
                move_to $((HEADER_HEIGHT + rendered_row + 1)) 1
                clear_line
                local error_truncated="${error_msg:0:$((TERM_COLS - 10))}"
                printf "   ${RED}✗ Error: %s${RESET}" "$error_truncated"
                ((rendered_row++))
            fi

            # Show status and ID
            if ((rendered_row < BODY_HEIGHT)); then
                move_to $((HEADER_HEIGHT + rendered_row + 1)) 1
                clear_line
                printf "   ${DIM}Status: %s | ID: %s${RESET}" "$status" "$task_id"
                ((rendered_row++))
            fi
        fi

        ((task_idx++))
    done

    # Clear remaining rows
    while ((rendered_row < BODY_HEIGHT)); do
        move_to $((HEADER_HEIGHT + rendered_row + 1)) 1
        clear_line
        ((rendered_row++))
    done
}

# Render help bar at bottom
render_help_bar() {
    move_to "$TERM_ROWS" 1
    clear_line

    if [[ "$SEARCH_MODE" == true ]]; then
        printf "${BG_YELLOW}${BLACK} /%s${RESET}" "$SEARCH_QUERY"
    else
        local session_count=${#SESSION_IDS[@]}
        if ((session_count > 1)); then
            printf "${DIM} j/k:move  Enter:expand  zc/zo:fold  Tab:session  q:quit${RESET}"
        else
            printf "${DIM} j/k:move  gg/G:jump  Enter:expand  zc/zo:fold  /:search  q:quit${RESET}"
        fi
    fi
}

# Full screen refresh
refresh_display() {
    read_state || true
    update_terminal_size

    # Auto-collapse completed section if threshold exceeded
    check_auto_collapse

    save_cursor
    render_header
    render_task_list
    render_help_bar
    restore_cursor
}

# =============================================================================
# SECTION 5: STATE WATCHING
# =============================================================================

# Check if inotifywait is available
has_inotifywait() {
    command -v inotifywait &>/dev/null
}

# Watch state file with inotifywait (fast)
watch_with_inotify() {
    inotifywait -m -e modify,create "$STATE_FILE" 2>/dev/null | while read -r; do
        refresh_display
    done &
    WATCH_PID=$!
}

# Watch state file with polling (fallback)
watch_with_polling() {
    while [[ "$RUNNING" == true ]]; do
        local current_mtime
        current_mtime=$(stat -c %Y "$STATE_FILE" 2>/dev/null || stat -f %m "$STATE_FILE" 2>/dev/null || echo "")

        if [[ "$current_mtime" != "$LAST_STATE_MTIME" ]]; then
            LAST_STATE_MTIME="$current_mtime"
            refresh_display
        fi

        sleep 0.2
    done &
    WATCH_PID=$!
}

# Watch signal file
watch_signal_file() {
    while [[ "$RUNNING" == true ]]; do
        if [[ -f "$SIGNAL_FILE" ]]; then
            local signal
            signal=$(cat "$SIGNAL_FILE" 2>/dev/null || echo "")

            case "$signal" in
                update:*)
                    refresh_display
                    ;;
                hide)
                    cleanup
                    exit 0
                    ;;
                error:*)
                    local msg="${signal#error:}"
                    # Could display error in UI
                    ;;
            esac

            # Clear signal file
            rm -f "$SIGNAL_FILE" 2>/dev/null || true
        fi
        sleep 0.1
    done &
    SIGNAL_WATCH_PID=$!
}

# =============================================================================
# SECTION 6: NAVIGATION & INPUT
# =============================================================================

# Move cursor down
move_down() {
    local task_count=${#TASKS[@]}
    if ((CURSOR_POS < task_count - 1)); then
        ((CURSOR_POS++))
        # Scroll if needed
        if ((CURSOR_POS >= SCROLL_OFFSET + BODY_HEIGHT)); then
            ((SCROLL_OFFSET++))
        fi
    fi
}

# Move cursor up
move_up() {
    if ((CURSOR_POS > 0)); then
        ((CURSOR_POS--))
        # Scroll if needed
        if ((CURSOR_POS < SCROLL_OFFSET)); then
            ((SCROLL_OFFSET--))
        fi
    fi
}

# Jump to top
jump_to_top() {
    CURSOR_POS=0
    SCROLL_OFFSET=0
}

# Jump to bottom
jump_to_bottom() {
    local task_count=${#TASKS[@]}
    if ((task_count > 0)); then
        CURSOR_POS=$((task_count - 1))
        if ((CURSOR_POS >= BODY_HEIGHT)); then
            SCROLL_OFFSET=$((CURSOR_POS - BODY_HEIGHT + 1))
        else
            SCROLL_OFFSET=0
        fi
    fi
}

# Page down
page_down() {
    local task_count=${#TASKS[@]}
    local half_page=$((BODY_HEIGHT / 2))
    CURSOR_POS=$((CURSOR_POS + half_page))
    if ((CURSOR_POS >= task_count)); then
        CURSOR_POS=$((task_count - 1))
    fi
    if ((CURSOR_POS >= SCROLL_OFFSET + BODY_HEIGHT)); then
        SCROLL_OFFSET=$((CURSOR_POS - BODY_HEIGHT + 1))
    fi
}

# Page up
page_up() {
    local half_page=$((BODY_HEIGHT / 2))
    CURSOR_POS=$((CURSOR_POS - half_page))
    if ((CURSOR_POS < 0)); then
        CURSOR_POS=0
    fi
    if ((CURSOR_POS < SCROLL_OFFSET)); then
        SCROLL_OFFSET=$CURSOR_POS
    fi
}

# Enter search mode
enter_search_mode() {
    SEARCH_MODE=true
    SEARCH_QUERY=""
    SEARCH_MATCHES=()
    SEARCH_INDEX=0
}

# Exit search mode
exit_search_mode() {
    SEARCH_MODE=false
}

# Perform search
perform_search() {
    SEARCH_MATCHES=()
    local task_count=${#TASKS[@]}
    for ((i = 0; i < task_count; i++)); do
        if [[ "${TASKS[$i]}" == *"$SEARCH_QUERY"* ]]; then
            SEARCH_MATCHES+=("$i")
        fi
    done
    SEARCH_INDEX=0
    if ((${#SEARCH_MATCHES[@]} > 0)); then
        CURSOR_POS=${SEARCH_MATCHES[0]}
        if ((CURSOR_POS >= SCROLL_OFFSET + BODY_HEIGHT)); then
            SCROLL_OFFSET=$((CURSOR_POS - BODY_HEIGHT / 2))
        elif ((CURSOR_POS < SCROLL_OFFSET)); then
            SCROLL_OFFSET=$CURSOR_POS
        fi
    fi
}

# Next search match
next_match() {
    if ((${#SEARCH_MATCHES[@]} > 0)); then
        SEARCH_INDEX=$(( (SEARCH_INDEX + 1) % ${#SEARCH_MATCHES[@]} ))
        CURSOR_POS=${SEARCH_MATCHES[$SEARCH_INDEX]}
        if ((CURSOR_POS >= SCROLL_OFFSET + BODY_HEIGHT)); then
            SCROLL_OFFSET=$((CURSOR_POS - BODY_HEIGHT / 2))
        elif ((CURSOR_POS < SCROLL_OFFSET)); then
            SCROLL_OFFSET=$CURSOR_POS
        fi
    fi
}

# Previous search match
prev_match() {
    if ((${#SEARCH_MATCHES[@]} > 0)); then
        SEARCH_INDEX=$(( (SEARCH_INDEX - 1 + ${#SEARCH_MATCHES[@]}) % ${#SEARCH_MATCHES[@]} ))
        CURSOR_POS=${SEARCH_MATCHES[$SEARCH_INDEX]}
        if ((CURSOR_POS >= SCROLL_OFFSET + BODY_HEIGHT)); then
            SCROLL_OFFSET=$((CURSOR_POS - BODY_HEIGHT / 2))
        elif ((CURSOR_POS < SCROLL_OFFSET)); then
            SCROLL_OFFSET=$CURSOR_POS
        fi
    fi
}

# Toggle expand/collapse for task at cursor
toggle_task_expand() {
    local task_count=${#TASKS[@]}
    if ((CURSOR_POS >= 0 && CURSOR_POS < task_count)); then
        local task_id="${TASK_IDS[$CURSOR_POS]}"

        # Check if task is expanded
        local is_expanded=false
        local idx=0
        for id in "${EXPANDED_TASKS[@]}"; do
            if [[ "$id" == "$task_id" ]]; then
                is_expanded=true
                break
            fi
            ((idx++))
        done

        if [[ "$is_expanded" == true ]]; then
            # Remove from expanded list
            unset 'EXPANDED_TASKS[idx]'
            EXPANDED_TASKS=("${EXPANDED_TASKS[@]}")
        else
            # Add to expanded list
            EXPANDED_TASKS+=("$task_id")
        fi
    fi
}

# Check if task is expanded
is_task_expanded() {
    local task_id="$1"
    for id in "${EXPANDED_TASKS[@]}"; do
        if [[ "$id" == "$task_id" ]]; then
            return 0
        fi
    done
    return 1
}

# Collapse section at cursor (zc)
collapse_section() {
    local task_count=${#TASKS[@]}
    if ((CURSOR_POS >= 0 && CURSOR_POS < task_count)); then
        local status="${TASK_STATUSES[$CURSOR_POS]}"

        # Check if section already collapsed
        local is_collapsed=false
        for s in "${COLLAPSED_SECTIONS[@]}"; do
            if [[ "$s" == "$status" ]]; then
                is_collapsed=true
                break
            fi
        done

        if [[ "$is_collapsed" == false ]]; then
            COLLAPSED_SECTIONS+=("$status")
        fi
    fi
}

# Expand section at cursor (zo)
expand_section() {
    local task_count=${#TASKS[@]}
    if ((CURSOR_POS >= 0 && CURSOR_POS < task_count)); then
        local status="${TASK_STATUSES[$CURSOR_POS]}"

        # Remove from collapsed list
        local new_collapsed=()
        for s in "${COLLAPSED_SECTIONS[@]}"; do
            if [[ "$s" != "$status" ]]; then
                new_collapsed+=("$s")
            fi
        done
        COLLAPSED_SECTIONS=("${new_collapsed[@]}")
    fi
}

# Check if section is collapsed
is_section_collapsed() {
    local status="$1"
    for s in "${COLLAPSED_SECTIONS[@]}"; do
        if [[ "$s" == "$status" ]]; then
            return 0
        fi
    done
    return 1
}

# Auto-collapse completed section if threshold exceeded
check_auto_collapse() {
    if ((AUTO_COLLAPSE_THRESHOLD <= 0)); then
        return
    fi

    # Count completed tasks
    local completed_count=0
    for status in "${TASK_STATUSES[@]}"; do
        if [[ "$status" == "completed" ]]; then
            ((completed_count++))
        fi
    done

    # Auto-collapse if threshold exceeded
    if ((completed_count > AUTO_COLLAPSE_THRESHOLD)); then
        local already_collapsed=false
        for s in "${COLLAPSED_SECTIONS[@]}"; do
            if [[ "$s" == "completed" ]]; then
                already_collapsed=true
                break
            fi
        done

        if [[ "$already_collapsed" == false ]]; then
            COLLAPSED_SECTIONS+=("completed")
        fi
    fi
}

# Navigate to next session (Tab)
next_session() {
    local session_count=${#SESSION_IDS[@]}
    if ((session_count > 1)); then
        CURRENT_SESSION_IDX=$(( (CURRENT_SESSION_IDX + 1) % session_count ))
        # Reset cursor and scroll when switching sessions
        CURSOR_POS=0
        SCROLL_OFFSET=0
    fi
}

# Navigate to previous session (Shift+Tab)
prev_session() {
    local session_count=${#SESSION_IDS[@]}
    if ((session_count > 1)); then
        CURRENT_SESSION_IDX=$(( (CURRENT_SESSION_IDX - 1 + session_count) % session_count ))
        # Reset cursor and scroll when switching sessions
        CURSOR_POS=0
        SCROLL_OFFSET=0
    fi
}

# Handle input (single character)
handle_input() {
    local key="$1"

    if [[ "$SEARCH_MODE" == true ]]; then
        case "$key" in
            $'\x1b')  # ESC
                exit_search_mode
                ;;
            $'\x0a')  # Enter
                perform_search
                exit_search_mode
                ;;
            $'\x7f')  # Backspace
                if ((${#SEARCH_QUERY} > 0)); then
                    SEARCH_QUERY="${SEARCH_QUERY:0:-1}"
                fi
                ;;
            *)
                SEARCH_QUERY+="$key"
                ;;
        esac
    else
        case "$key" in
            j) move_down ;;
            k) move_up ;;
            g)
                # Wait for second 'g'
                read -rsn1 -t 0.5 next_key
                if [[ "$next_key" == "g" ]]; then
                    jump_to_top
                fi
                ;;
            G) jump_to_bottom ;;
            /) enter_search_mode ;;
            n) next_match ;;
            N) prev_match ;;
            $'\x04')  # Ctrl+D
                page_down
                ;;
            $'\x15')  # Ctrl+U
                page_up
                ;;
            $'\x0a')  # Enter - toggle expand/collapse task
                toggle_task_expand
                ;;
            z)
                # Wait for second character (c or o)
                read -rsn1 -t 0.5 next_key
                case "$next_key" in
                    c) collapse_section ;;
                    o) expand_section ;;
                esac
                ;;
            $'\x09')  # Tab - next session
                next_session
                ;;
            $'\x1b')  # ESC sequence - check for Shift+Tab
                read -rsn2 -t 0.1 seq
                if [[ "$seq" == "[Z" ]]; then
                    prev_session
                fi
                ;;
            q)
                RUNNING=false
                ;;
        esac
    fi

    refresh_display
}

# =============================================================================
# SECTION 7: MAIN LOOP
# =============================================================================

# Cleanup on exit
cleanup() {
    RUNNING=false

    # Kill background processes
    if [[ -n "${WATCH_PID:-}" ]]; then
        kill "$WATCH_PID" 2>/dev/null || true
    fi
    if [[ -n "${SIGNAL_WATCH_PID:-}" ]]; then
        kill "$SIGNAL_WATCH_PID" 2>/dev/null || true
    fi

    # Restore terminal
    show_cursor
    printf "${RESET}"
    clear_screen

    # Cleanup signal file
    rm -f "$SIGNAL_FILE" 2>/dev/null || true
}

# Handle terminal resize
handle_resize() {
    update_terminal_size
    refresh_display
}

# Main entry point
main() {
    # Set up cleanup trap
    trap cleanup EXIT
    trap handle_resize WINCH

    # Initialize terminal
    update_terminal_size
    hide_cursor
    clear_screen

    # Start state watching
    if has_inotifywait; then
        watch_with_inotify
    else
        watch_with_polling
    fi

    # Start signal file watching
    if [[ -n "$SIGNAL_FILE" ]]; then
        watch_signal_file
    fi

    # Initial render
    refresh_display

    # Main input loop
    while [[ "$RUNNING" == true ]]; do
        if read -rsn1 -t 0.1 key; then
            handle_input "$key"
        fi
    done

    cleanup
}

# Run main
main
