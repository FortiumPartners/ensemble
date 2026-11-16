# acme-console - Architecture Analysis

**Date:** 2026-03-12
**Evidence tier:** deep-dive (file:line cited)

## Component Architecture

A React single-page application served by nginx on port 3000.

- `ApiClient` (src/api/client.ts:12) sends every request to acme-bff on port 8080.
- `AuthGate` (src/auth/gate.tsx:20) redirects the browser to Keycloak for login and holds the access token.
- `Dashboard` (src/pages/dashboard.tsx:8) renders data returned by acme-bff.

## Integration Points

- acme-console -> acme-bff (port 8080) over HTTPS/JSON: src/api/client.ts:12.
- acme-console -> Keycloak (OIDC authorization-code flow): src/auth/gate.tsx:20.
- acme-console imports `acme-contracts` v1.2.0 for request types: package.json:18.

## Coupling findings

- **Medium (F-003):** the console pins acme-contracts 1.2.0 while the contracts package is at 1.5.0 (package.json:18).
- **Low (F-006):** no bundle-size budget (webpack.config.js:40).
