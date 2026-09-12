#!/usr/bin/env bash
# install-ensemble-hooks.sh — put the version watcher and its SessionStart hook
# somewhere their existence does not depend on a git checkout.
#
# THE BUG THIS EXISTS TO PREVENT (FortiumPartners/ensemble#97, 2026-09-06):
# the hook was originally wired straight at this repo's working tree —
# /Users/.../projects/ensemble/scripts/ensemble-version-hook.sh. That path holds
# a file only while the tree has the right branch checked out. Switching branches
# to work on something else deleted it out from under every session on the
# machine: 44 of 48 live panes printed a hook error at startup, and the launchd
# watcher failed the same way for a day. Both halves broke together because both
# pointed into the same worktree.
#
# So the scripts get COPIED to ~/.claude/scripts, next to version-warn-hook.sh,
# which is where this machine already keeps hooks. Re-run after changing either
# script; it is idempotent.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${ENSEMBLE_HOOK_DEST:-$HOME/.claude/scripts}"
PLIST="$HOME/Library/LaunchAgents/com.burkestudio.ensemble-version-watch.plist"
# Discovered, not listed. The hardcoded three-root list here meant .claude-gmail
# and .claude-autreymail never got the hook wired at all, so two of five accounts
# had no staleness warning and nothing said so. A list only stays right until the
# next account is added, and two already had been.
# ENSEMBLE_CONFIG_ROOTS matches the override ensemble-sync.sh already takes, so
# this path can be exercised against a scratch root instead of five live ones.
if [ -n "${ENSEMBLE_CONFIG_ROOTS+x}" ]; then
  read -r -a CONFIG_ROOTS <<< "$ENSEMBLE_CONFIG_ROOTS"
else
  CONFIG_ROOTS=()
  for d in "$HOME"/.claude "$HOME"/.claude-*; do
    [ -d "$d" ] && [ -f "$d/settings.json" ] || continue
    # This script REWRITES settings.json, so adopting a backup copy by accident
    # edits the very file someone made to be able to go back. Skip by name, say so.
    case "$(basename "$d")" in
      *backup*|*copy*|*.bak|*-bak|*.old|*-old|*.orig|*-orig|*save)
        echo "  skipping $(basename "$d") — the name reads as a backup copy"; continue ;;
    esac
    CONFIG_ROOTS+=("$d")
  done
fi
HOOK_CMD="$DEST_DIR/ensemble-version-hook.sh SessionStart"

die() { echo "✗ $*" >&2; exit 1; }

# Wiring zero roots and printing nothing is how this silently did nothing before.
[ ${#CONFIG_ROOTS[@]} -gt 0 ] || die "no Claude config root found under $HOME (looked for .claude*/settings.json)"
echo "Config roots (${#CONFIG_ROOTS[@]}): $(printf '%s ' "${CONFIG_ROOTS[@]##*/}")"

mkdir -p "$DEST_DIR" || die "could not create $DEST_DIR"

for f in ensemble-version-hook.sh ensemble-version-watch.sh; do
  [ -f "$REPO_DIR/scripts/$f" ] || die "$f missing from $REPO_DIR/scripts — wrong branch?"
  install -m 755 "$REPO_DIR/scripts/$f" "$DEST_DIR/$f" || die "could not install $f"
  echo "✓ $DEST_DIR/$f"
done

# Wire the hook, replacing any command that references the same script under a
# DIFFERENT path — that is exactly how #97 happened, and leaving the stale entry
# behind would keep erroring alongside the good one.
for root in "${CONFIG_ROOTS[@]}"; do
  f="$root/settings.json"
  [ -f "$f" ] || continue
  tmp="$f.tmp.$$"
  jq --arg cmd "$HOOK_CMD" '
    .hooks //= {} |
    .hooks.SessionStart //= [] |
    .hooks.SessionStart |= map(
      .hooks |= map(
        if (.command // "") | test("ensemble-version-hook\\.sh")
        then .command = $cmd else . end
      )
    ) |
    if [.hooks.SessionStart[].hooks[]?.command] | any(. == $cmd)
    then .
    else .hooks.SessionStart += [{"hooks":[{"type":"command","command":$cmd}]}]
    end
  ' "$f" > "$tmp" 2>/dev/null && jq -e . "$tmp" >/dev/null 2>&1 \
    && mv "$tmp" "$f" && echo "✓ hook wired in $(basename "$root")" \
    || { rm -f "$tmp"; die "could not update $f — left untouched"; }
done

# The launchd job has the same hazard, so point it at the installed copy too.
if [ -f "$PLIST" ]; then
  if grep -q "$REPO_DIR/scripts/ensemble-version-watch.sh" "$PLIST"; then
    sed -i '' "s|$REPO_DIR/scripts/ensemble-version-watch.sh|$DEST_DIR/ensemble-version-watch.sh|g" "$PLIST"
    launchctl unload "$PLIST" 2>/dev/null
    # No failure branch here meant the one repair path that #97 is about could fail
    # and print nothing at all: the job stays unloaded, the daily check never runs,
    # and the hook it feeds goes quiet — which is the incident, not a warning about it.
    if load_out="$(launchctl load "$PLIST" 2>&1)"; then
      echo "✓ launchd job repointed and reloaded"
    else
      printf '%s\n' "$load_out" | sed 's/^/    /' >&2
      die "plist repointed but launchctl load failed — the version watcher is NOT running.
  Load it by hand:  launchctl load \"$PLIST\""
    fi
  else
    echo "✓ launchd job already points outside the worktree"
  fi
else
  echo "  (no launchd plist yet — see the ops notes in CLAUDE.md)"
fi

# Prove it, rather than trusting the copy. A hook that cannot run is the whole bug.
echo
if out="$("$DEST_DIR/ensemble-version-hook.sh" SessionStart 2>&1)"; then
  echo "✓ hook runs from $DEST_DIR (exit 0)${out:+ and reports:}"
  [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/    /'
else
  die "hook installed but does not run — sessions would error at startup"
fi

for root in "${CONFIG_ROOTS[@]}"; do
  f="$root/settings.json"
  [ -f "$f" ] || continue
  # Count BOTH. Counting only the stale entries gave 0 for a root that was never
  # wired at all, which is the exact state (.claude-gmail, .claude-autreymail at
  # zero entries) this script was changed to fix — the gate would have passed the
  # failure it exists to catch. Reproduced against a never-wired fixture.
  counts="$(jq -r --arg d "$DEST_DIR" '
    [.hooks.SessionStart[]?.hooks[]?.command // "" | select(test("ensemble-version-hook\\.sh"))]
    | "\(map(select(startswith($d))) | length) \(map(select(startswith($d) | not)) | length)"' "$f")"
  good="${counts%% *}"; stale="${counts##* }"
  [ "$stale" = "0" ] || die "$f still has $stale hook entry(s) pointing outside $DEST_DIR"
  [ "${good:-0}" -ge 1 ] || die "$f has no ensemble-version-hook entry at all — this root was never wired"
done
echo "✓ every config root runs the hook from $DEST_DIR, none from inside a git worktree"
