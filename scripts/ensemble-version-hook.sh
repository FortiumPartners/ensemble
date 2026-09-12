#!/usr/bin/env bash
# ensemble-version-hook.sh — tells a session, quietly, that the Ensemble plugin
# it loaded is behind the live upstream.
#
# Wired as a SessionStart hook (and optionally a rate-limited UserPromptSubmit
# hook) in each ~/.claude*/settings.json. Reads only the cached state file that
# ensemble-version-watch.sh writes daily, so it is fast and offline.
#
# This exists instead of a cc-bus broadcast: it lands as ambient context in
# whichever session next wakes, and nobody has to read or acknowledge a message.
#
# Silent when there is nothing to say. It speaks in exactly three cases:
#   1. the live worktree is behind upstream,
#   2. the session's own plugin cache is behind the live worktree,
#   3. the watcher itself is broken or stale — because a notifier that goes
#      quiet when its own data source dies is worse than no notifier.

set -uo pipefail

EVENT="${1:-SessionStart}"
STATE_FILE="${ENSEMBLE_STATE_FILE:-$HOME/.local/state/ensemble/version-state.json}"
WARN_DIR="$HOME/.local/state/ensemble/session-warn"
STALE_AFTER_DAYS="${ENSEMBLE_STALE_AFTER_DAYS:-3}"
mkdir -p "$WARN_DIR"

[ -f "$STATE_FILE" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Case 3 in the header — "the watcher itself is broken" — has to survive its own
# data being unreadable. Every field below is read with 2>/dev/null, so a
# truncated or invalid state file made all of them empty, INCLUDING .error, and
# the hook fell through every branch and exited silently: indistinguishable from
# "Ensemble is current". Parse once, up front, and say so when it fails.
if ! jq -e . "$STATE_FILE" >/dev/null 2>&1; then
  printf '%s\n' "[ensemble-watch] The Ensemble version state file is unreadable or not valid JSON:
  $STATE_FILE
The watcher writes it daily, so this means the watcher failed part-way or the file
was truncated. Sessions may be loading a stale plugin with nothing else warning them.
Ask the FS-Ensemble session to check the launchd job."
  exit 0
fi

checked_at="$(jq -r '.checked_at // ""' "$STATE_FILE" 2>/dev/null)"
behind="$(jq -r '.commits_behind // ""' "$STATE_FILE" 2>/dev/null)"
# Both versions come from plugin.json in a third-party fork, and this text is
# printed straight into the startup context of every session on the machine.
#
# The first attempt at this allowed a free-form prerelease tag, which is the
# semver grammar and is also exactly wide enough to carry a sentence written with
# dashes: `7.0.0-IGNORE-ALL-PREVIOUS-INSTRUCTIONS...` passed it verbatim. It
# rejected the one payload written in the commit message and nothing shaped
# differently. A version is not a free-text field, so the tag is an ALLOWLIST of
# the words a prerelease is actually made of. Anything else is not relayed at all.
#
# And a rejected value is NOT collapsed to a shared word. The first attempt
# printed 'unrecognised' for every bad value, so two DIFFERENT bad values compared
# equal and the "your plugin is stale" branch below went silent precisely when the
# data was untrustworthy — a notifier failing quiet, which is what this hook's
# header says is worse than no notifier. A short digest keeps distinct values
# distinct while relaying none of their content.
# Eight hex digits that depend on the whole input and carry none of it.
#
# The first version called shasum directly with no guard. jq is guarded a few
# lines above precisely because a hook runs with whatever environment it is given,
# and shasum got no equivalent — so on a PATH without it the substitution produced
# nothing, every rejected value rendered as the bare string "unrecognised-", and
# the false-equality bug this digest exists to prevent came straight back.
# Reproduced under a PATH holding only tr/cut/printf.
#
# Three sources, the last needing no external command at all, so there is no
# environment in which this collapses.
digest8() {
  local s="$1" out=""
  if command -v shasum >/dev/null 2>&1; then
    out="$(printf '%s' "$s" | shasum 2>/dev/null | cut -c1-8)"
  elif command -v cksum >/dev/null 2>&1; then
    out="$(printf '%s' "$s" | cksum 2>/dev/null | tr -cd '0-9' | cut -c1-8)"
  fi
  if [ -z "$out" ]; then
    local i c h=5381
    for ((i = 0; i < ${#s}; i++)); do
      printf -v c '%d' "'${s:i:1}"
      h=$(( (h * 33 + c) % 4294967296 ))
    done
    printf -v out '%08x' "$h"
  fi
  printf '%s' "$out"
}

safe_version() {
  local v core
  v="$(printf '%s' "$1" | tr -cd 'A-Za-z0-9.+_-' | cut -c1-32)"
  [ -n "$v" ] || return 0
  core='[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}'
  if [[ "$v" =~ ^${core}(-(alpha|beta|rc|pre|dev|next|canary)(\.[0-9]{1,4})?)?(\+(build)?[0-9]{1,8})?$ ]]; then
    printf '%s' "$v"
  else
    # Bounded input. The pure-bash tier of digest8 is a per-character loop, so
    # handing it the RAW unbounded string let a long version in a third-party
    # plugin.json burn CPU at every SessionStart on a machine without shasum or
    # cksum — measured at 31 seconds for 100,000 characters. 256 characters is far
    # past any real version and still distinguishes values that the 32-char
    # sanitised form would have flattened together.
    printf 'unrecognised-%s' "$(digest8 "${1:0:256}")"
  fi
}
live_ver="$(safe_version "$(jq -r '.live.version // ""' "$STATE_FILE" 2>/dev/null)")"
up_ver="$(safe_version "$(jq -r '.upstream.version // ""' "$STATE_FILE" 2>/dev/null)")"
state_err="$(jq -r '.error // ""' "$STATE_FILE" 2>/dev/null)"

# What THIS session's config root actually has installed.
root="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
installed="$(safe_version "$(jq -r '.plugins["ensemble-full@ensemble"][]? | select(.scope=="user") | .version' \
  "$root/plugins/installed_plugins.json" 2>/dev/null | head -1)")"

# Is the watcher's own data stale? Compare dates, not a parsed timestamp —
# `date -d` is GNU-only and this is macOS.
watcher_stale=""
if [ -n "$checked_at" ]; then
  age_days=$(( ( $(date -u +%s) - $(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$checked_at" +%s 2>/dev/null || echo 0) ) / 86400 ))
  [ "$age_days" -gt "$STALE_AFTER_DAYS" ] 2>/dev/null && watcher_stale="$age_days"
fi

msg=""
if [ -n "$state_err" ]; then
  msg="[ensemble-watch] The Ensemble version watcher could not complete: ${state_err}
Sessions may be loading a stale plugin without any further warning. Ask the FS-Ensemble session to check."
elif [ -n "$watcher_stale" ]; then
  msg="[ensemble-watch] The Ensemble version watcher has not run in ${watcher_stale} days (last: ${checked_at}).
Treat the version numbers below as unverified. Ask the FS-Ensemble session to check the launchd job."
elif [ -n "$behind" ] && [ "$behind" -gt 0 ] 2>/dev/null; then
  msg="[ensemble-watch] Ensemble is behind upstream by ${behind} commit(s).
- Live worktree: ${live_ver:-unknown} · Upstream: ${up_ver:-unknown}
- The plugin you loaded comes from ~/projects/.worktrees/ensemble-live, which is not auto-updated.

Action: none from you. The FS-Ensemble session owns the sync and reviews changes before they land.
Mention it if you are blocked on a command that only exists upstream."
elif [ -n "$installed" ] && [ -n "$live_ver" ] && [ "$installed" != "$live_ver" ]; then
  msg="[ensemble-watch] This session's Ensemble plugin is ${installed}, but the live source is ${live_ver}.
Action: run \`claude plugin update ensemble-full\`, then /exit and resume — the running process keeps ${installed} until restart."
fi

[ -z "$msg" ] && exit 0

# Rate-limit the chatty event to once per session per day.
#
# The key has to be STABLE ACROSS INVOCATIONS of this hook, because every
# UserPromptSubmit is a fresh process. Two earlier attempts each failed one half
# of that: a shared literal "anon" was stable but not per-session, so the first
# unidentified session of the day silenced every other one; `anon-$$` was
# per-process rather than per-session, so no two invocations ever produced the
# same filename, the daily cap never engaged at all, and WARN_DIR grew by one
# empty file per prompt with nothing pruning it. Reproduced both ways.
#
# transcript_path is the fallback that is actually stable per session, so it is
# tried before giving up. If neither identifier resolves the warning is repeated
# rather than suppressed and NO lock is written — this hook's own header says a
# notifier that goes quiet is worse than a noisy one, and writing no file keeps
# the unidentified case from growing the directory.
if [ "$EVENT" = "UserPromptSubmit" ]; then
  session_key=""
  if [ ! -t 0 ]; then
    input="$(cat 2>/dev/null || true)"
    session_key="$(printf '%s' "$input" | jq -r '.session_id // ""' 2>/dev/null || true)"
    if [ -z "$session_key" ]; then
      transcript="$(printf '%s' "$input" | jq -r '.transcript_path // ""' 2>/dev/null || true)"
      [ -n "$transcript" ] && session_key="t$(digest8 "$transcript")"
    fi
  fi
  # The key is interpolated into a path that is then created, so `../` in it would
  # write outside WARN_DIR. Reduce it to the characters an identifier is made of.
  session_key="$(printf '%s' "$session_key" | tr -cd 'A-Za-z0-9_-' | cut -c1-64)"

  if [ -n "$session_key" ]; then
    lock="$WARN_DIR/${session_key}.$(date -u +%Y-%m-%d)"
    [ -f "$lock" ] && exit 0
    # If the marker cannot be written the dedup never engages and the warning
    # repeats every prompt. That is noise rather than silence, so it does not stop
    # the message, but it should not be invisible either.
    if ! : > "$lock" 2>/dev/null; then
      printf '%s\n' "[ensemble-watch] (cannot write $WARN_DIR — this notice will repeat until that is fixed)"
    fi
    # Bound the directory: yesterday's locks are dead weight, and an unpruned
    # marker directory is its own small leak.
    find "$WARN_DIR" -type f -mtime +7 -delete 2>/dev/null || true
  fi
fi

printf '%s\n' "$msg"
exit 0
