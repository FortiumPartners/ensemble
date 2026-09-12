#!/usr/bin/env bash
# ensemble-version-watch.sh — records how far the Ensemble plugin every session
# loads has fallen behind the live upstream, so a SessionStart hook can say so
# without anyone broadcasting a message.
#
# Since 2026-09-06 the `ensemble` marketplace in every Claude config root on this
# machine (five of them today, discovered rather than listed by the ops scripts)
# is a DIRECTORY source pointed at a git worktree we control:
#
#   ~/projects/.worktrees/ensemble-live   (branch `live`, tracks sunstone/main)
#
# Nothing is pulled from a remote marketplace any more. That worktree is the
# only thing that decides what 56 sessions load, so "behind" means: the live
# worktree is behind Sunstone-Partners/ensemble main.
#
# Runs daily under launchd. Writes ~/.local/state/ensemble/version-state.json,
# read offline by ensemble-version-hook.sh.
#
# Failure is recorded, never swallowed. Every field that could not be determined
# is written as null with an `error` string beside it, because a watcher that
# cannot reach GitHub must not leave a state file that reads as "up to date".

set -uo pipefail

LIVE_WORKTREE="${ENSEMBLE_LIVE_WORKTREE:-$HOME/projects/.worktrees/ensemble-live}"
DEV_CLONE="${ENSEMBLE_DEV_CLONE:-$HOME/projects/ensemble}"
UPSTREAM_REMOTE="${ENSEMBLE_UPSTREAM_REMOTE:-sunstone}"

STATE_DIR="$HOME/.local/state/ensemble"
STATE_FILE="$STATE_DIR/version-state.json"
mkdir -p "$STATE_DIR"

err=""
live_sha=""; live_version=""; upstream_sha=""; upstream_version=""; behind=""

if [ ! -d "$LIVE_WORKTREE/.git" ] && [ ! -f "$LIVE_WORKTREE/.git" ]; then
  err="live worktree missing at $LIVE_WORKTREE — sessions may be loading a stale plugin cache"
else
  live_sha="$(git -C "$LIVE_WORKTREE" rev-parse HEAD 2>/dev/null || true)"
  live_version="$(jq -r '.version // empty' \
    "$LIVE_WORKTREE/packages/full/.claude-plugin/plugin.json" 2>/dev/null || true)"

  # Fetch into the dev clone; the worktree shares its object store.
  if ! git -C "$DEV_CLONE" fetch --quiet "$UPSTREAM_REMOTE" 2>/dev/null; then
    err="could not fetch remote '$UPSTREAM_REMOTE' from $DEV_CLONE"
  else
    upstream_sha="$(git -C "$DEV_CLONE" rev-parse "$UPSTREAM_REMOTE/main" 2>/dev/null || true)"
    upstream_version="$(git -C "$DEV_CLONE" show \
      "$UPSTREAM_REMOTE/main:packages/full/.claude-plugin/plugin.json" 2>/dev/null \
      | jq -r '.version // empty' 2>/dev/null || true)"
    if [ -n "$live_sha" ] && [ -n "$upstream_sha" ]; then
      behind="$(git -C "$DEV_CLONE" rev-list --count "${live_sha}..${upstream_sha}" 2>/dev/null || true)"
    fi
  fi
fi

[ -z "$err" ] && [ -z "$behind" ] && err="could not compute how far behind the live worktree is"

jq -n \
  --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg lw "$LIVE_WORKTREE" \
  --arg lsha "$live_sha" --arg lver "$live_version" \
  --arg usha "$upstream_sha" --arg uver "$upstream_version" \
  --arg behind "$behind" --arg err "$err" \
  '{
     checked_at: $now,
     live: { worktree: $lw,
             sha: (if $lsha == "" then null else $lsha end),
             version: (if $lver == "" then null else $lver end) },
     upstream: { sha: (if $usha == "" then null else $usha end),
                 version: (if $uver == "" then null else $uver end) },
     commits_behind: (if $behind == "" then null else ($behind | tonumber) end),
     error: (if $err == "" then null else $err end)
   }' > "$STATE_FILE"

echo "[ensemble-version-watch] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -c '{live:.live.version, upstream:.upstream.version, behind:.commits_behind, error:.error}' "$STATE_FILE"
