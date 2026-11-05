# Fix Report: beads:ensemble:br-mvaw

Run: `run-ec9d1ce7a3934aa9faf7c7ef68094a66` · Workflow: `fix` · Branch: `foreman/br-mvaw/run-ec9d1ce7a3934aa9faf7c7ef68094a66` (base `dev`)

> Note: the first version of this file, committed by phase 1, held a captured
> tool-error wrapper instead of a report. This is the real report.

## Defect

`extractReqPriorities()` in `packages/development/lib/prd-parser.js` read a
requirement's MoSCoW priority **only** from a dedicated
`**Priority:** Must|Should|Could|Won't` line. PRDs authored with the priority
inline in the heading — `### REQ-NNN: Title (Must)`, which is what
`create-trd` emits and what `docs/PRD/PRD-2026-82b6a138-pr-review-cycle-time.md`
uses for all 25 of its REQs — resolved **every** requirement to
`priority: null`.

`completion-verification`'s Step 3 gates only on `priority in {Must, Should}`,
so a PRD that parses to all-null priorities makes that gate vacuous: the skill
reports `VERDICT: COMPLETE (0 gaps)` for a PRD whose requirements it never
actually checked. The failure was documented as a Known Limitation, but the
silent pass — not the limitation — is the hazard.

Reproduced before touching anything:

```
parsed=25 null=25   →  Step 3 gated REQ count = 0
```

## Fix

1. `packages/development/lib/prd-parser.js` — `extractReqPriorities()` now also
   reads a bracketed MoSCoW tag from the REQ heading itself
   (`(Must)`, `[Should]`, `(Wont)`, optionally followed by a `[RISK: ...]` or
   `[NEEDS CLARIFICATION: ...]` suffix), and keeps the `**Priority:**` line as
   the fallback. The tag must be bracketed **and** sit at end-of-heading, so
   ordinary title words are never misread as a priority: `REQ-001 (FR1.1)` and
   "What the reviewer must say" both stay `null`. Captured values are
   canonicalized by the new `normalizeMoscowTag()` (shared with the
   `**Priority:**` path, replacing its inline `won't` ternary), so `(must)`
   returns `'Must'` — a lowercase tag would otherwise leak through the
   case-insensitive regex and silently drop that REQ out of the Must/Should
   gate.
2. `packages/development/skills/completion-verification/SKILL.md` — Step 3
   gains **4b, a classification sanity check**: a PRD exposing no parseable
   REQ headings, or one whose REQs all resolve to `null`, now emits
   `GAP: class=REQ-PRIORITY-UNPARSED`, which makes the verdict `INCOMPLETE`
   and routes it through the existing Step 6 explicit-override gate instead of
   passing silently. A partially-classified PRD is deliberately *not* a gap:
   its classified REQs gate normally. The Known Limitations entry now describes
   what is read, what is not, and how to clear the new gap.

Both changes are in the source files only; `packages/pi/**` mirrors were
produced by `npm run generate` / `npm run generate:pi`, never hand-edited.

## Regression coverage

`packages/development/tests/prd-parser.test.js` — 9 new tests in
`describe('extractReqPriorities')`, all **red on `dev` and green here** (7 of
them fail against the pre-fix library): inline `(Must)` / `(Should)` /
`[Could]` / `(Wont)` tags, a tag followed by `[RISK: ...]`, null when neither
tag nor line is present, the two false-positive guards (`(FRn.m)` refs and
mid-title "must"/"should" words), case canonicalization, and an end-to-end
test over the real `docs/PRD/PRD-2026-82b6a138-*.md` asserting that every REQ
the skill parses is Must/Should-gatable (the property Step 3 depends on).
Pre-existing tests are untouched and still pass, including
`does not match the legacy "# REQ-NNN — Title" em-dash heading style`, which
pins the one heading shape this extractor intentionally does not read.

## Effect on existing PRDs

Measured across `docs/PRD/*.md`: 23 PRDs expose `###`/`####` `REQ-NNN`
headings; 22 now resolve every REQ to a real MoSCoW priority (previously most
of them were all-null). One does not:
`PRD-2026-019-operator-dashboard.md` (`#### REQ-NNN (FRn.m): Title`, no
priority anywhere in the file). It legitimately has no priorities to gate on
and now trips 4b rather than passing vacuously — a true positive, and the
class of silent pass this task is about.

## Verification

| Command | Result |
|---------|--------|
| `npm run generate:pi && npm run generate` | ok; mirrors regenerated |
| `npm run generate:validate` | `✓ Validation passed (65 files)` — exit 0 |
| `npm run validate` | exit 0 (see phase review report) |
| `npx jest tests/prd-parser.test.js` | 26 passed / 26 — exit 0 |
| `npx jest tests/implement-trd-beads-generated-parity.test.js` | 5 passed — exit 0 |
| `npx jest` (packages/development, full) | see review report for result |

## Risk

`extractReqPriorities()` has one in-repo consumer — the
`completion-verification` skill, invoked through
`implement-trd-beads.yaml` — so the blast radius is that gate's verdict. The
behavior change an operator will actually notice: runs that previously
returned `COMPLETE (0 gaps)` against an inline-tag PRD can now return
`INCOMPLETE (1 gap)` if a satisfying task is genuinely missing for a Must/Should
REQ. That is the gate doing its job; `--force-complete`-style override (Step 6)
already exists for a deliberate pass. Revert is a single-commit backout of the
library, skill and test changes plus a regenerated `packages/pi` mirror.
