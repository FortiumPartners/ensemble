# legacy-billing - Architecture Analysis

**Date:** 2026-03-12
**Evidence tier:** deep-dive (file:line cited)

## Component Architecture

A standalone Java batch application. It has its own MySQL database on port 3306 and its own login table; it shares no auth provider, data store, library or pipeline with any other assessed repo.

- `InvoiceJob` (src/main/java/InvoiceJob.java:25) generates invoices nightly.
- `InvoiceStore` (src/main/java/InvoiceStore.java:14) persists them to MySQL.

## Integration Points

None found. No import, endpoint or shared contract links legacy-billing to another assessed repo (searched build.gradle and src/main).

## Coupling findings

- **Medium (F-005):** the nightly InvoiceJob runs on a single host with no failover (src/main/java/InvoiceJob.java:25).
