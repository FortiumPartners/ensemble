# Fix Report — beads:ensemble:br-bhj9

Bead: `trd-cli parse` truncates stdout at 65536 bytes when piped.

## Status: NOT FIXED

Phase 1 (implement) of this run produced no code changes. The only artifact it
committed was this file, and its committed content was stray tool-call XML
rather than a report, so no analysis, patch or regression test for the bead was
ever recorded by that phase.

## Confirmed defect (verified in this worktree)

- `packages/development/lib/trd-cli.js:1658` — the CLI wrapper ends with
  `if (require.main === module) { const code = main(process.argv.slice(2)); process.exit(code); }`.
  `process.exit()` does not wait for the stdout pipe buffer to drain, so
  `node packages/development/lib/trd-cli.js parse <large TRD> | consumer`
  truncates the JSON at 65536 bytes; redirecting to a file works.
- Suggested fix (per the bead): write with `fs.writeSync(1, json + '\n')`, or
  set `process.exitCode` instead of calling `process.exit`.
- Relevant files for the fix: `packages/development/lib/trd-cli.js` (`main`
  ~lines 1583-1622, wrapper ~lines 1655-1659) and
  `packages/development/tests/trd-cli.test.js` (needs a failing-first
  regression test that pipes a >64 KiB parse output through a consumer).

## Review phase note

Phase 2 (coderabbit review) handled this corrupted artifact: it repaired this
report and recorded the unfixed bug as an unresolved finding instead of
implementing another phase's work here.
