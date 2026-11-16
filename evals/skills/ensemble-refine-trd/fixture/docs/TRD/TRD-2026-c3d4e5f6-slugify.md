---
document_id: TRD-2026-c3d4e5f6
label: trd-slugify
kind: trd
prd_reference: PRD-2026-b2c3d4e5
prd_path: docs/PRD/PRD-2026-b2c3d4e5-slugify.md
version: 1.0.0
status: Draft
date: 2026-11-02
Constitution compliance: passed
---

# TRD-2026-c3d4e5f6: Slugify Helper

Based on PRD: docs/PRD/PRD-2026-b2c3d4e5-slugify.md

## Architecture Decision

**Chosen approach:** One pure function, `slugify(text)`, in `src/slugify.js`, with no dependencies.

**Rationale:** The PRD asks for a small helper; a single module is the least that satisfies it.

## Master Task List

### PR 1: Core slugify
**Shippable State:** A developer can call `slugify("Hello, World!")` and get `hello-world`, with leading and trailing dashes trimmed.

- [ ] **TRD-001** Implement lowercase and dash-join (`src/slugify.js`) [satisfies REQ-001] (3h)
  - Validates PRD ACs: AC-001-1, AC-001-2

- [ ] **TRD-001-TEST** Lowercase and dash-join behavior [Verifies TRD-001] [Satisfies REQ-001] [Depends: TRD-001] (2h)
  - Validates PRD ACs: AC-001-1, AC-001-2

- [ ] **TRD-002** Trim leading and trailing dashes [satisfies REQ-002] [Depends: TRD-001] (2h)
  - Validates PRD ACs: AC-002-1

### PR 2: Input tolerance

- [ ] **TRD-003** Return an empty string for empty or non-string input [Depends: TRD-001] (2h)
  - Validates PRD ACs: AC-003-1

- [ ] **TRD-003-TEST** Empty and non-string input [Verifies TRD-003] [Depends: TRD-003] (1h)
  - Validates PRD ACs: AC-003-1

## Acceptance Criteria Traceability

| PRD requirement | Implementation task | Test task |
|---|---|---|
| REQ-001 | TRD-001 | TRD-001-TEST |
| REQ-002 | TRD-002 | (none) |

## Changelog

- **1.0.0 (2026-11-02):** Initial draft from `create-trd`.
