---
document_id: PRD-2026-c3d4e5f6
label: prd-account-service
version: 1.0.0
status: Locked
date: 2026-11-01
---

# PRD-2026-c3d4e5f6: Account Service

## Requirements

### REQ-001: Sign in with email and password (Must)

- AC-001-1: Given a registered user, when they submit a correct email and password, then they receive a session token.
- AC-001-2: Given a wrong password, when they sign in, then access is refused.

### REQ-002: Manage a profile (Must)

- AC-002-1: Given a signed-in user, when they save their name, email and phone number, then the profile is stored and shown back to them.

### REQ-003: Upload an avatar image (Should)

- AC-003-1: Given a signed-in user, when they upload a PNG or JPEG avatar, then it is shown on their profile.

### REQ-004: Send a verification email (Should)

- AC-004-1: Given a new email address, when the user saves it, then a verification message is sent to it by the email provider.

## Goals and Non-Goals

**Non-goals:** social sign-in, payments, administrative tooling.
