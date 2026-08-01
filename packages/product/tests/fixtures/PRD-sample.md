---
document_id: PRD-2026-a1b2c3d4
label: prd-sample-feature
version: 1.2.0
status: Draft
date: 2026-06-29
scale_depth: STANDARD
total_requirements: 2
readiness_score: 4.5
---

# PRD-2026-a1b2c3d4: Sample Feature

## PRD Health Summary

| Metric | Value |
| --- | --- |
| Must | 1 |

## Requirements by Feature Area

### REQ-001: User Authentication [Must] [Medium]

Users must be able to authenticate with email and password.

- **AC-001-1:** Given a user with valid credentials, when they submit the login form, then they are authenticated and see the dashboard.
- **AC-001-2:** Given a user with an invalid password, when they submit the login form, then they see an error message and remain on the login page.

### REQ-002: Password Reset [Should] [Low]

Users should be able to reset a forgotten password.

- AC-002-1: Given a user on the login page, when they request a password reset and submit a valid email, then a reset link is emailed and a confirmation is shown.
- **AC-002-2:** The system enforces password complexity rules on reset.
- **AC-002-3:** Given a logged-out user, when they open a reset link, then they can set a new password [NEEDS CLARIFICATION: should reset links expire after 24h?].
