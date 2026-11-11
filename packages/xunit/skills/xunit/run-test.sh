#!/usr/bin/env bash
# xUnit Test Runner wrapper
#
# Usage: run-test.sh --file=<test .cs | .csproj | .sln | directory> [--filter=<expr>] [--coverage]
#
#   --file      A *.cs test file (its nearest enclosing .csproj is tested, filtered to the
#               class named after the file), or a .csproj/.sln/.slnx/directory (default: .)
#   --filter    `dotnet test --filter` expression (overrides the filter derived from a .cs file)
#   --coverage  Collect coverage with coverlet (needs the coverlet.collector package)
#
# Prints one JSON object: {success, passed, failed, skipped, total, duration, failures[]}.
# On a build/restore failure it prints {success:false, error, output} instead.
# Requires: dotnet SDK and node (to turn the TRX report into JSON).
set -u

FILE="."
FILTER=""
COVERAGE=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --file=*) FILE="${1#*=}"; shift ;;
    --file) FILE="${2:-.}"; shift $(( $# > 1 ? 2 : 1 )) ;;
    --filter=*) FILTER="${1#*=}"; shift ;;
    --filter) FILTER="${2:-}"; shift $(( $# > 1 ? 2 : 1 )) ;;
    --coverage) COVERAGE=1; shift ;;
    *) shift ;;
  esac
done

fail() {
  node -e 'console.log(JSON.stringify({ success: false, error: process.argv[1], file: process.argv[2] }))' "$1" "$FILE"
  exit 1
}

command -v dotnet >/dev/null 2>&1 || fail "dotnet SDK not found"
command -v node >/dev/null 2>&1 || fail "node not found (needed to build the JSON result)"
[[ -e "$FILE" ]] || fail "Test target not found"

# Resolve symlinks (macOS /tmp -> /private/tmp): dotnet works with real paths, and alternating
# between logical and real paths across runs was observed to produce a spurious rebuild and
# "Catastrophic failure: Could not find/load xunit.execution.dotnet.dll" from the test host.
if [[ -d "$FILE" ]]; then
  TARGET="$(cd "$FILE" && pwd -P)"
else
  TARGET="$(cd "$(dirname "$FILE")" && pwd -P)/$(basename "$FILE")"
fi
if [[ "$FILE" == *.cs ]]; then
  # dotnet test takes a project/solution, not a source file: find the owning project.
  dir="$(cd "$(dirname "$FILE")" && pwd -P)"
  TARGET=""
  while [[ "$dir" != "/" ]]; do
    proj="$(find "$dir" -maxdepth 1 -name '*.csproj' | head -n 1)"
    if [[ -n "$proj" ]]; then TARGET="$proj"; break; fi
    dir="$(dirname "$dir")"
  done
  [[ -n "$TARGET" ]] || fail "No .csproj found above the test file"
  if [[ -z "$FILTER" ]]; then
    base="$(basename "$FILE" .cs)"
    FILTER="FullyQualifiedName~${base}"
  fi
fi

RESULTS="$(mktemp -d)"
trap 'rm -rf "$RESULTS"' EXIT

ARGS=(test "$TARGET" --logger trx --results-directory "$RESULTS")
[[ -n "$FILTER" ]] && ARGS+=(--filter "$FILTER")
[[ "$COVERAGE" -eq 1 ]] && ARGS+=(--collect:"XPlat Code Coverage")

dotnet "${ARGS[@]}" >"$RESULTS/output.txt" 2>&1
EXIT_CODE=$?

node - "$RESULTS" "$EXIT_CODE" <<'JS'
const fs = require('fs');
const path = require('path');
const [dir, exitCode] = process.argv.slice(2);

const trxFiles = [];
(function walk(d) {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.trx')) trxFiles.push(full);
  }
})(dir);

if (trxFiles.length === 0) {
  const lines = fs.readFileSync(path.join(dir, 'output.txt'), 'utf8').trimEnd().split('\n');
  console.log(JSON.stringify({ success: false, error: 'dotnet test produced no results (build or restore failed?)', output: lines.slice(-40).join('\n') }));
  process.exit(1);
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#xD;/g, '').replace(/&#xA;/g, '\n').replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? decode(m[1]) : null; };

let passed = 0, failed = 0, skipped = 0, total = 0, duration = 0;
const failures = [];

for (const trx of trxFiles) {
  const xml = fs.readFileSync(trx, 'utf8');
  const counters = /<Counters\b[^>]*>/.exec(xml);
  if (counters) {
    total += Number(attr(counters[0], 'total'));
    passed += Number(attr(counters[0], 'passed'));
    failed += Number(attr(counters[0], 'failed'));
  }
  const times = /<Times\b[^>]*>/.exec(xml);
  if (times) {
    const ms = Date.parse(attr(times[0], 'finish')) - Date.parse(attr(times[0], 'start'));
    if (!Number.isNaN(ms)) duration += ms / 1000;
  }
  const results = xml.match(/<UnitTestResult\b[\s\S]*?(?:\/>|<\/UnitTestResult>)/g) || [];
  for (const result of results) {
    const outcome = attr(result, 'outcome');
    if (outcome === 'NotExecuted') skipped += 1;
    if (outcome !== 'Failed') continue;
    const message = /<Message>([\s\S]*?)<\/Message>/.exec(result);
    const stack = /<StackTrace>([\s\S]*?)<\/StackTrace>/.exec(result);
    const location = stack ? /in (.+):line (\d+)/.exec(decode(stack[1])) : null;
    failures.push({
      test: attr(result, 'testName'),
      error: message ? decode(message[1]).trim() : 'Test failed',
      file: location ? location[1] : null,
      line: location ? Number(location[2]) : null,
    });
  }
}

console.log(JSON.stringify({
  success: failed === 0 && total > 0 && Number(exitCode) === 0,
  passed, failed, skipped, total,
  duration: Math.round(duration * 1000) / 1000,
  failures,
}));
process.exit(failed === 0 && Number(exitCode) === 0 ? 0 : 1);
JS
