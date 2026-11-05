# Fix Report — beads:ensemble:br-o701

Run: `run-ca4e378dfab2defc64664a62b4f14398` · Phase 1 (fix) · Diff base: `dev`

## Problem

`trd-parser.js` `extractPrdReference()` only accepted a **path-shaped** PRD
reference (`docs/PRD/*.md` in the body, a `Based on PRD:` / `PRD:` line, or a
path-like `prd_reference` frontmatter value). A create-trd-style TRD that
records the source PRD as a **document id** in `prd_reference`
(`prd_reference: PRD-2026-<uuid>`) with the real path in a sibling
`prd_path` key parsed as `prdReference: null`, so
`completion-verification` Step 3 (PRD cross-check) was silently skipped —
no error, just missing verification.

## Change

- `packages/development/lib/trd-parser.js`
  - Added `PRD_PATH_KEYS = ['prd_path']` alongside the existing
    `PRD_REFERENCE_KEYS`, and exported it.
  - `extractPrdReference()` gained fallback (5): when no body reference and no
    path-shaped `prd_reference` / `prd` / `source_prd` is found, return the
    `prd_path` frontmatter value if `looksLikePath()` accepts it. Body
    references and a path-shaped `prd_reference` keep winning, so an
    in-document path stays authoritative.
  - Documented the precedence list and the reason for the fallback in the
    function's doc comment.
- `packages/development/tests/trd-frontmatter-key-spelling.test.js`
  - Regression suite `parseTRD — prd_reference id plus prd_path` (5 tests):
    id+`prd_path` resolves; path-shaped `prd_reference` beats `prd_path`;
    body reference beats `prd_path`; body `docs/PRD` path takes precedence;
    id-only with no path stays `null`.

No generated artifacts were affected (no YAML/prompt/command source changed),
so `npm run generate` / `generate:pi` were not needed for this change.

## Verification

- `node --version`: v24.3.0
- `cd packages/development && npx jest tests/trd-frontmatter-key-spelling.test.js`
  → 14 passed, 0 failed (5 of them new).

## Known limitation (declared, not hidden)

The fix accepts `prd_path` as a second source of truth. The canonical emit rule
in `packages/development/commands/create-trd.yaml` still instructs authors to
put the PRD **file path** directly in `prd_reference` and never mentions
`prd_path`. So a TRD containing only `prd_reference: PRD-2026-<uuid>` (no
`prd_path`, no body path) still parses as `prdReference: null` by design — that
is the "have create-trd emit a path or a body `Based on PRD:` line" half of the
task, which is a separate prompt change outside this phase's scope.
