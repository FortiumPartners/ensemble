---
title: Slugify Util
status: Draft
design_readiness_score: 4.5
prd: docs/PRD/PRD-slugify.md
ensemble_implement_trd_beads:
  branch_name: feature/trd-2026-b1c2d3e4-slugify-pr-1
  use_proposed: true
  stacked_prs: true
---

# TRD: Slugify Util

## Overview

A tiny slug helper in two shippable steps.

## Master Task List

### PR 1: Core slugify

**Shippable State:** slugify converts text to a slug

- [ ] **TRD-001**: Implement slugify (1h) [satisfies REQ-001]
  - Implementation AC:
    - [ ] slugify lowercases and joins words with dashes
- [ ] **TRD-001-TEST**: Test slugify (1h) [verifies TRD-001] [satisfies REQ-001] [depends: TRD-001]
  - Test AC:
    - [ ] Tests cover lowercase and joining
    - Validates PRD ACs: AC-001-1

### PR 2: Edge cases

**Shippable State:** slugify trims separators and rejects bad input

- [ ] **TRD-002**: Trim separators (1h) [satisfies REQ-001] [depends: TRD-001]
  - Implementation AC:
    - [ ] Leading and trailing dashes are removed
- [ ] **TRD-002-TEST**: Test trimming (1h) [verifies TRD-002] [satisfies REQ-001] [depends: TRD-002]
  - Test AC:
    - [ ] Tests cover trimming
    - Validates PRD ACs: AC-001-2
- [ ] **TRD-003**: Handle non-string input (1h) [satisfies REQ-002] [depends: TRD-001]
  - Implementation AC:
    - [ ] Non-string input returns an empty string
- [ ] **TRD-003-TEST**: Test non-string input (1h) [verifies TRD-003] [satisfies REQ-002] [depends: TRD-003]
  - Test AC:
    - [ ] Tests cover non-string input
    - Validates PRD ACs: AC-002-1
