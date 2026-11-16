# acme-contracts - Architecture Analysis

**Date:** 2026-03-12
**Evidence tier:** deep-dive (file:line cited)

## Component Architecture

A shared TypeScript schema package (JSON Schema plus generated types), published to the internal registry.

- `schemas/order.json` (schemas/order.json:1) defines the order DTO.
- `schemas/customer.json` (schemas/customer.json:1) defines the customer DTO.

## Integration Points

- Consumed by acme-console (package.json:18 in acme-console) and acme-bff (package.json:21 in acme-bff).

## Coupling findings

- **High (F-001):** no CI gate validates the schema contract before consumers upgrade; a breaking change in schemas/order.json can ship silently to both consumers (.github/workflows/release.yml:1).
