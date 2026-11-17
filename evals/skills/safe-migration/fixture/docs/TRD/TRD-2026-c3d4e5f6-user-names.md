---
document_id: TRD-2026-c3d4e5f6
label: trd-user-names
version: 1.0.0
status: Draft
---

# TRD-2026-c3d4e5f6: Structured user names

## Context

The users service stores one `fullname` string per user. Billing and mail need the first and last name separately.

## Tasks

- [ ] TRD-001: Store first and last name for each user (REQ-001)
- [ ] TRD-002: Make the user API return first_name and last_name (REQ-001)

## Non-goals

- Changing the sign-up form.
