# TRD: Inventory Sync

**PRD:** docs/PRD/PRD-2026-c3d4e5f6-inventory-sync.md

## Master Task List

### Phase 1: Import and export

**Shippable State:** stock levels can be imported and exported

- [x] **TRD-001**: Import stock files (3h) [satisfies REQ-001]
  - Implementation AC:
    - [x] Stock files are parsed and stored
- [x] **TRD-001-TEST**: Test the import (1h) [verifies TRD-001] [satisfies REQ-001] [depends: TRD-001]
  - Test AC:
    - [x] Import tests pass
    - Validates PRD ACs: AC-001-1, AC-001-2, AC-001-3
- [x] **TRD-002**: Export stock files (2h) [satisfies REQ-002] [depends: TRD-001]
  - Implementation AC:
    - [x] Stored levels are written to a file
- [x] **TRD-002-TEST**: Test the export (1h) [verifies TRD-002] [satisfies REQ-002] [depends: TRD-002]
  - Test AC:
    - [x] Export tests pass
    - Validates PRD ACs: AC-002-1

### Phase 2: Alerts and audit

**Shippable State:** low stock raises an alert and syncs are audited

- [ ] **TRD-003**: Record low-stock alerts (2h) [satisfies REQ-003] [depends: TRD-001]
  - Implementation AC:
    - [ ] An alert is stored when a SKU is below its threshold
- [ ] **TRD-003-TEST**: Test the alerts (1h) [verifies TRD-003] [satisfies REQ-003] [depends: TRD-003]
  - Test AC:
    - [ ] Alert tests pass
    - Validates PRD ACs: AC-003-1
- [x] **TRD-004**: Write the audit entry (1h) [satisfies REQ-004] [depends: TRD-001]
  - Implementation AC:
    - [x] Every sync writes an audit entry
