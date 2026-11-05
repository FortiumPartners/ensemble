# CodeRabbit Review Report — beads:ensemble:br-o701

Run: `run-ca4e378dfab2defc64664a62b4f14398` · Phase 2 (`coderabbit-review`) ·
Branch `foreman/br-o701/run-ca4e378dfab2defc64664a62b4f14398` · Diff base `dev` (`$FOREMAN_BASE_BRANCH`).

## Review engine

Command run from the worktree root:

```
coderabbit review --agent --base "$FOREMAN_BASE_BRANCH"
```

Resolved binary: `/Users/ldangelo/.local/bin/coderabbit`. Exit code `0`; no
authentication errors. Review context reported by the engine:
`reviewType: all`, `currentBranch: foreman/br-o701/run-ca4e378dfab2defc64664a62b4f14398`,
`baseBranch: dev`. Files reviewed:
`docs/reports/foreman-beads:ensemble:br-o701/FIX_REPORT.md`,
`packages/development/lib/trd-parser.js`,
`packages/development/tests/trd-frontmatter-key-spelling.test.js`.

Note on progress reporting: neither `foreman_inbox_send` nor
`foreman_task_add_comment` was exposed as a tool in this phase session, so
operator notes were recorded to `~/.omp/foreman-progress/beads:ensemble:br-o701/log.md`
instead (per the repo rule against scratch files in `/tmp`).

## Rounds

### Round 1

Findings received: **1** (0 Critical, 0 Major, 1 Minor, 0 Nitpick).

| # | Severity | Location | Finding | Action |
|---|----------|----------|---------|--------|
| 1 | minor | `docs/reports/foreman-beads:ensemble:br-o701/FIX_REPORT.md:1-2` | Fix report contains only a captured `edit` tool error instead of the report. | **Fixed** |

Fixed: 1 · Declined: 0.

**Stopping condition met after round 1.** No `Critical` or `Major` finding was
produced by any round, so rounds 2 and 3 were not run (phase rule: stop early
when a round yields no Critical/Major finding you fixed).

## Fixed

### 1. `docs/reports/foreman-beads:ensemble:br-o701/FIX_REPORT.md`

- **What was wrong:** the file committed by phase 1 was not a report. Its
  entire contents were a synthetic tool-result wrapper reading
  `Error: Could not find edits[2] in packages/development/lib/trd-parser.js. The
  oldText must match exactly including all whitespace and newlines.` — i.e. the
  phase-1 agent's failed `edit` call output got written into the artifact it was
  supposed to be describing. Any reader (including the next phase) had no way to
  see what changed or what was verified.
- **What changed:** replaced the file with an actual fix report. Content was
  reconstructed only from verifiable state, not invented: `git diff dev...HEAD`
  for `packages/development/lib/trd-parser.js` (the `PRD_PATH_KEYS`
  addition, the `extractPrdReference()` fallback and its precedence doc
  comment), the five new tests in
  `packages/development/tests/trd-frontmatter-key-spelling.test.js`, and a live
  `npx jest tests/trd-frontmatter-key-spelling.test.js` run (14 passed). The
  report also states the outstanding limitation below rather than implying the
  bead is fully closed.
- **Code impact:** documentation only; no `src` change, so no re-test beyond the
  parser suite was required.

## Declined

None. The single finding was valid against the current tree and was fixed.

## Verification

| Command | Exit | Result |
|---------|------|--------|
| `coderabbit review --agent --base dev` | 0 | 1 finding, review completed |
| `node --version` | 0 | v24.3.0 |
| `cd packages/development && npx jest tests/trd-frontmatter-key-spelling.test.js` | 0 | 14 passed / 14 |
| `cd packages/development && npx jest tests/trd-frontmatter-key-spelling.test.js tests/trd-parser.test.js` | 0 | 103 passed / 103 (2 suites) |
| `cd packages/development && npx eslint .` | 0 | 27 problems: 3 errors, 24 warnings — all pre-existing in files this run did not touch (`tests/beads-label-default-run.test.js:213` and `tests/beads-stage-tracker-capability.test.js:257`: `import/no-dynamic-require` rule not found; `tests/local-ci-config.test.js:47`: `no-regex-spaces`). Zero errors/warnings in `lib/trd-parser.js` or `tests/trd-frontmatter-key-spelling.test.js`. |
| `npm run generate:validate` (repo root) | 0 | Validation passed (65 files) |

`npm run generate` / `generate:pi` were not re-run: this phase edited no YAML,
command, agent or prompt source, and no generated artifact, so nothing derived
could have gone stale. `npm run validate` (the broader root script) was not run,
as the phase calls for the narrowest relevant tooling; `generate:validate` and
the package's own jest/eslint runs are the narrow equivalents for these files.

## Outstanding item for a human (not raised by CodeRabbit)

`packages/development/commands/create-trd.yaml:222` still instructs that the
`prd_reference` value **is the PRD file path** and never mentions `prd_path`.
The parser fix accepts `prd_path`, so a TRD carrying
`prd_reference: PRD-2026-<uuid>` **plus** `prd_path: docs/PRD/…` now resolves.
A TRD carrying the id alone, with no `prd_path` and no body path, still parses as
`prdReference: null` — the "or have create-trd emit a body `Based on PRD:` line"
alternative in the task description is a prompt/command change and belongs to a
separate phase.

<!-- FOREMAN_REVIEW_FINDINGS_START -->
- `packages/development/commands/create-trd.yaml:222` Major — create-trd still tells authors to put the PRD file path directly in `prd_reference` and never emits `prd_path` or a body `Based on PRD:` line, so a TRD whose frontmatter carries only `prd_reference: PRD-2026-<uuid>` continues to parse as `prdReference: null` and completion-verification Step 3 is still skipped.
<!-- FOREMAN_REVIEW_FINDINGS_END -->
