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
safe_version() {
  local v core
  v="$(printf '%s' "$1" | tr -cd 'A-Za-z0-9.+_-' | cut -c1-32)"
  [ -n "$v" ] || return 0
  core='[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}'
  if [[ "$v" =~ ^${core}(-(alpha|beta|rc|pre|dev|next|canary)(\.[0-9]{1,4})?)?(\+[0-9A-Za-z]{1,10})?$ ]]; then
    printf '%s' "$v"
  else
    # Distinct per value, carries none of it. Digest of the RAW input, so two
    # different malformed versions never compare equal.
    printf 'unrecognised-%s' "$(printf '%s' "$1" | shasum | cut -c1-8)"
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
if [ "$EVENT" = "UserPromptSubmit" ]; then
  session_id=""
  if [ ! -t 0 ]; then
    input="$(cat 2>/dev/null || true)"
    session_id="$(printf '%s' "$input" | jq -r '.session_id // ""' 2>/dev/null || true)"
  fi
  # The id is interpolated into a path that is then created, so `../` in it writes
  # outside WARN_DIR. Reduce it to the characters a session id is actually made of.
  session_id="$(printf '%s' "$session_id" | tr -cd 'A-Za-z0-9_-' | cut -c1-64)"
  # A bare "anon" fallback is one lock shared by every session that could not be
  # identified, so the first such session that day silences all the others. The
  # pid keeps them apart; a session that cannot be named gets warned rather than
  # suppressed, which is the right way for a rate limit to fail.
  lock="$WARN_DIR/${session_id:-anon-$$}.$(date -u +%Y-%m-%d)"
  [ -f "$lock" ] && exit 0
  : > "$lock"
fi

printf '%s\n' "$msg"
exit 0
