---
document_id: TRD-2026-PARITY
label: engine-parity
kind: trd
status: Draft
---

# TRD: Engine mount parity fixture

## Master Task List

### Phase 1: Mount

**Shippable State:** the fixture parses

- [x] **TRD-001**: Mount the group (2h) [satisfies REQ-001]
  - Implementation AC:
    - [x] The group is mounted
- [x] **TRD-001-TEST**: Test the mount (1h) [verifies TRD-001] [satisfies REQ-001] [depends: TRD-001]
  - Test AC:
    - [x] Mount tests pass

### Phase 2: Parity

**Shippable State:** output is byte-identical

- [ ] **TRD-002**: Keep legacy output (2h) [satisfies REQ-002] [depends: TRD-001]
  - Implementation AC:
    - [ ] Output is byte-identical
- [ ] **TRD-002-TEST**: Test parity (1h) [verifies TRD-002] [satisfies REQ-002] [depends: TRD-002]
  - Test AC:
    - [ ] Parity tests pass
