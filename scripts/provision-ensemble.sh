#!/usr/bin/env bash
# provision-ensemble.sh — bring every Claude config root on this machine to the
# same Ensemble install, and repair the ones that have drifted.
#
# WHY THIS EXISTS. Burke runs four accounts, launched by ccrgm / ccram / ccrfs /
# ccrfp, each with its own config root. Ensemble was set up by hand in whichever
# root happened to be in front of me at the time, so every new account arrived
# with Ensemble missing, and twice with something worse: the plugin registered and
# enabled in settings.json while its install directory did not exist at all. A
# session in that state reports the plugin as present and has none of its 48
# commands or 38 agents. That is how `.claude-autreymail` and `.claude-gmail` both
# ended up silently without Ensemble.
#
# Idempotent. Run it after adding an account, or any time a session says the
# ensemble commands are missing.
#
#   scripts/provision-ensemble.sh            provision every known root
#   scripts/provision-ensemble.sh --check    report only, exit 1 if any root is wrong
#   scripts/provision-ensemble.sh <root>...  provision only the roots named

set -uo pipefail

LIVE_WORKTREE="${ENSEMBLE_LIVE_WORKTREE:-$HOME/projects/.worktrees/ensemble-live}"

# The four accounts plus the default root. `.claude-sessions` is session storage,
# not a config root — it has no settings.json and is deliberately absent.
DEFAULT_ROOTS=(
  "$HOME/.claude"
  "$HOME/.claude-gmail"
  "$HOME/.claude-autreymail"
  "$HOME/.claude-fortiumsoftware"
  "$HOME/.claude-fortiumpartners"
)

# The set every root should carry. ensemble-full alone would serve every command,
# but the established roots also register the eight individual plugins, and some
# sessions address commands through those names. Standardising on the larger set
# is additive; trimming to ensemble-full would remove a namespace already in use.
STANDARD_PLUGINS=(
  ensemble-core ensemble-development ensemble-full ensemble-git
  ensemble-infrastructure ensemble-metrics ensemble-product
  ensemble-quality ensemble-react
)

CHECK_ONLY=0
ROOTS=()
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) ROOTS+=("$arg") ;;
  esac
done
[ ${#ROOTS[@]} -eq 0 ] && ROOTS=("${DEFAULT_ROOTS[@]}")

[ -d "$LIVE_WORKTREE/.claude-plugin" ] || {
  echo "✗ live worktree missing at $LIVE_WORKTREE — nothing to install from" >&2
  exit 1
}

# What a correct install looks like. Taken from the version the marketplace
# declares, then from a root that actually has that version — NOT from whatever
# directory `find | head -1` happens to return. The first version of this line
# picked up a stale 5.13.0 cache left over from April, whose commands directory is
# empty, so want_commands was 0, the `-gt 0` guard never fired, and the count check
# below printed numbers it could never object to.
want_version=$(jq -r '.version // empty' \
  "$LIVE_WORKTREE/packages/full/.claude-plugin/plugin.json" 2>/dev/null)
[ -n "$want_version" ] || { echo "✗ cannot read the plugin version from $LIVE_WORKTREE" >&2; exit 1; }

want_commands=0
for r in "${DEFAULT_ROOTS[@]}"; do
  d="$r/plugins/cache/ensemble/ensemble-full/$want_version"
  [ -d "$d" ] || continue
  n=$(find "$d/commands" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt "$want_commands" ] && want_commands=$n
done
if [ "$want_commands" -eq 0 ]; then
  echo "  no root yet has a populated ensemble-full $want_version — installing from source"
fi

problems=0

# Report on one plugin in one root. Echoes a short status word.
plugin_state() {
  local root="$1" plugin="$2" path
  path=$(jq -r --arg k "${plugin}@ensemble" \
    '.plugins[$k][]? | select(.scope=="user") | .installPath' \
    "$root/plugins/installed_plugins.json" 2>/dev/null | head -1)
  if [ -z "$path" ]; then echo "absent"; return; fi
  # The failure that started this: recorded but not on disk. An `ls` of the
  # directory, not a diff — diff against a missing directory errors, and a
  # check that swallows that error reports the root as healthy.
  if [ ! -d "$path" ]; then echo "hollow"; return; fi
  if [ -z "$(ls -A "$path" 2>/dev/null)" ]; then echo "empty"; return; fi
  echo "ok"
}

for root in "${ROOTS[@]}"; do
  name=$(basename "$root")
  if [ ! -f "$root/settings.json" ]; then
    printf '  %-26s skipped — no settings.json, not a config root\n' "$name"
    continue
  fi

  # The marketplace must resolve to the worktree, never to a remote.
  src=$(jq -r '.ensemble.source.path // ""' "$root/plugins/known_marketplaces.json" 2>/dev/null)
  if [ "$src" != "$LIVE_WORKTREE" ]; then
    if [ "$CHECK_ONLY" -eq 1 ]; then
      printf '  %-26s ✗ marketplace points at %s\n' "$name" "${src:-<none>}"
      problems=$((problems + 1)); continue
    fi
    CLAUDE_CONFIG_DIR="$root" claude plugin marketplace add "$LIVE_WORKTREE" >/dev/null 2>&1
  fi

  broken=(); missing=()
  for p in "${STANDARD_PLUGINS[@]}"; do
    case "$(plugin_state "$root" "$p")" in
      ok) ;;
      absent) missing+=("$p") ;;
      *) broken+=("$p") ;;
    esac
  done

  if [ ${#broken[@]} -eq 0 ] && [ ${#missing[@]} -eq 0 ]; then
    printf '  %-26s ✓ all %s plugins present\n' "$name" "${#STANDARD_PLUGINS[@]}"
    continue
  fi

  if [ "$CHECK_ONLY" -eq 1 ]; then
    printf '  %-26s ✗ %s missing, %s broken (%s)\n' \
      "$name" "${#missing[@]}" "${#broken[@]}" "$(printf '%s ' "${broken[@]}" "${missing[@]}")"
    problems=$((problems + 1)); continue
  fi

  CLAUDE_CONFIG_DIR="$root" claude plugin marketplace update ensemble >/dev/null 2>&1
  for p in "${broken[@]}" "${missing[@]}"; do
    # Uninstall first: a hollow entry has to be cleared before install will
    # rebuild it, and uninstalling something absent is harmless.
    CLAUDE_CONFIG_DIR="$root" claude plugin uninstall "$p" >/dev/null 2>&1
    CLAUDE_CONFIG_DIR="$root" claude plugin install "${p}@ensemble" >/dev/null 2>&1
  done

  # Re-check rather than trust the installer's exit status.
  still=()
  for p in "${STANDARD_PLUGINS[@]}"; do
    [ "$(plugin_state "$root" "$p")" = "ok" ] || still+=("$p")
  done
  if [ ${#still[@]} -ne 0 ]; then
    printf '  %-26s ✗ still wrong after repair: %s\n' "$name" "$(printf '%s ' "${still[@]}")"
    problems=$((problems + 1)); continue
  fi
  printf '  %-26s ✓ repaired %s plugin(s)\n' "$name" "$(( ${#broken[@]} + ${#missing[@]} ))"
done

# A plugin directory can exist and still be wrong, so check what a session would
# actually get: the command count, against the same count in a known-good root.
echo
for root in "${ROOTS[@]}"; do
  name=$(basename "$root")
  [ -f "$root/settings.json" ] || continue
  path=$(jq -r '.plugins["ensemble-full@ensemble"][]? | select(.scope=="user") | .installPath' \
    "$root/plugins/installed_plugins.json" 2>/dev/null | head -1)
  if [ -z "$path" ] || [ ! -d "$path" ]; then
    printf '  %-26s ✗ ensemble-full unusable\n' "$name"; problems=$((problems + 1)); continue
  fi
  c=$(find "$path/commands" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  a=$(find "$path/agents" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$want_commands" -eq 0 ]; then
    printf '  %-26s %s commands, %s agents (UNVERIFIED — no reference count)\n' "$name" "$c" "$a"
    problems=$((problems + 1)); continue
  fi
  if [ "$c" -ne "$want_commands" ]; then
    printf '  %-26s ✗ %s commands, expected %s\n' "$name" "$c" "$want_commands"
    problems=$((problems + 1)); continue
  fi
  printf '  %-26s %s commands, %s agents\n' "$name" "$c" "$a"
done

echo
if [ "$problems" -ne 0 ]; then
  echo "✗ $problems root(s) still wrong."
  exit 1
fi
echo "✓ Every root carries the same Ensemble install."
echo "  A running session keeps what it loaded at startup — restart to pick this up."
