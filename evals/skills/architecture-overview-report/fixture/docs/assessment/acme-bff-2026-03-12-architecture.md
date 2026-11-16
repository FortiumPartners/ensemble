# acme-bff - Architecture Analysis

**Date:** 2026-03-12
**Evidence tier:** deep-dive (file:line cited)

## Component Architecture

A Node/Express backend-for-frontend listening on port 8080.

- `OrdersController` (src/controllers/orders.ts:14) exposes the REST routes used by acme-console.
- `OrdersService` (src/services/orders.ts:9) holds the business rules.
- `OrdersRepository` (src/repositories/orders.ts:11) reads and writes the Postgres database on port 5432.
- `TokenVerifier` (src/auth/verify.ts:6) validates Keycloak-issued JWTs.

## Layering Assessment

Controller -> Service -> Repository is the intended direction (src/controllers/orders.ts:14, src/services/orders.ts:9, src/repositories/orders.ts:11).

- **Medium (F-004):** `OrdersService` imports the repository of another module directly (src/services/orders.ts:31), bypassing that module's service.

## Integration Points

- acme-console -> acme-bff (port 8080): src/server.ts:22.
- acme-bff -> Keycloak (JWKS fetch): src/auth/verify.ts:6.
- acme-bff -> Postgres (port 5432): src/repositories/orders.ts:11.
- acme-bff imports `acme-contracts` v1.5.0 for DTO validation: package.json:21.

## Coupling findings

- **High (F-002):** a single Keycloak realm is a hard runtime dependency; if the JWKS fetch fails every request is rejected, and there is no cached fallback (src/auth/verify.ts:40).
- **Medium (F-007):** the Helm chart defines no readiness probe (deploy/chart/values.yaml:55).
