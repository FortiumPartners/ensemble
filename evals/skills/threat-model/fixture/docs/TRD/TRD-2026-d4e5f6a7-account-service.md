---
status: Draft
design_readiness_score: null
---

# TRD-2026-d4e5f6a7: Account Service

## Overview

Implements PRD-2026-c3d4e5f6: a small HTTP service where users sign in, keep a profile and upload an avatar.

## Architecture

The service is a Node.js process behind a public load balancer. Components:

- **AuthController** accepts `POST /login` (email and password) and returns a session token.
- **TokenService** signs and verifies the session tokens (JWT, HS256) used by every other route.
- **ProfileService** reads and writes the user's name, email and phone number in the `users` table of the Postgres database.
- **AvatarUploadHandler** accepts `POST /avatar` (multipart, PNG or JPEG), stores the file in the `avatars` S3 bucket and records its key on the profile.
- **EmailClient** calls the third-party Mailgun API to send the verification message of REQ-004.

Data flows: browser to load balancer to the service; the service to Postgres, to S3 and to Mailgun.

## Master Task List

- [ ] **TRD-001**: Create the `users` table and the repository layer (2h) [satisfies REQ-001, REQ-002]
  - Implementation AC: Given a migration run on an empty database, when it completes, then the `users` table exists with a unique email column.
- [ ] **TRD-002**: Implement AuthController login with password hash check (3h) [satisfies REQ-001]
  - Implementation AC: Given a correct email and password, when `POST /login` is called, then it returns a token; given a wrong password, then it returns 401.
- [ ] **TRD-003**: Implement TokenService signing and verification middleware (3h) [satisfies REQ-001] [depends: TRD-002]
  - Implementation AC: Given a token with a bad signature or past its expiry, when any route is called, then it returns 401.
- [ ] **TRD-004**: Implement ProfileService read and update (3h) [satisfies REQ-002] [depends: TRD-001, TRD-003]
  - Implementation AC: Given a signed-in user, when they `PUT /profile`, then the name, email and phone number are stored.
- [ ] **TRD-005**: Implement AvatarUploadHandler with S3 storage (4h) [satisfies REQ-003] [depends: TRD-003]
  - Implementation AC: Given a PNG upload by a signed-in user, when `POST /avatar` is called, then the file is stored in the `avatars` bucket and its key saved on the profile.
- [ ] **TRD-006**: Implement EmailClient and the verification message (2h) [satisfies REQ-004] [depends: TRD-004]
  - Implementation AC: Given a new email address, when the profile is saved, then one Mailgun request is made for that address.
- [ ] **TRD-007**: Deploy behind the load balancer with TLS (2h) [satisfies REQ-001]
  - Implementation AC: Given the deployed service, when it is called over plain HTTP, then the request is redirected to HTTPS.
