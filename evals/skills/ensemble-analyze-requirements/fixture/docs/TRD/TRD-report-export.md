---
status: Draft
design_readiness_score: 4.0
---

# TRD: Report Export

Based on PRD: docs/PRD/PRD-2026-c3d4e5f6-report-export.md

## Master Task List

### Phase 1: Export service

- [ ] **TRD-001**: Build the CSV writer (3h) [satisfies REQ-001]
  - Validates PRD ACs: AC-001-1, AC-001-2
  - Implementation AC:
    - [ ] The writer emits a header row and one line per row
- [ ] **TRD-001-TEST**: Test the CSV writer (2h) [verifies TRD-001]
  - Test AC:
    - [ ] Header-only output for an empty report
- [ ] **TRD-002**: Queue exports on a background worker and return a job id; the CSV is ready within 30 seconds (4h) [satisfies REQ-001] [depends: TRD-001]
  - Validates PRD ACs: AC-001-1
  - Implementation AC:
    - [ ] The request returns a job id immediately and the file is fetched later
- [ ] **TRD-002-TEST**: Test the export queue (2h) [verifies TRD-002] [depends: TRD-002]
  - Test AC:
    - [ ] A queued export completes
- [ ] **TRD-003**: Wire the export button to the service [satisfies REQ-001] [depends: TRD-009]
  - Implementation AC:
    - [ ] The button calls the export endpoint
