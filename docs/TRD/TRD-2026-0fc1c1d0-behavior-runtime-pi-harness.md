---
document_id: TRD-2026-0fc1c1d0
label: trd-behavior-runtime-pi-harness
prd_reference: PRD-2026-0fc1c1d0 (docs/PRD/PRD-2026-0fc1c1d0-behavior-runtime-pi-harness.md v1.0.0)
version: 1.0.0
status: Draft
date: 2026-09-24
design_readiness_score: 4.4
kind: trd
constitution_compliance: passed
---

# TRD-2026-0fc1c1d0: Ensemble Behavior Runtime and Pi/OMP Harness (Phases E0-E2)

**Source PRD:** `docs/PRD/PRD-2026-0fc1c1d0-behavior-runtime-pi-harness.md` (v1.0.0, readiness 4.25 PASS)

## Companion Artifacts

- [TRD-2026-0fc1c1d0-behavior-runtime-pi-harness-data-model.md](./TRD-2026-0fc1c1d0-behavior-runtime-pi-harness-data-model.md) — event/behavior-package schema, entities, and validation rules for the closed event catalog and local outbox sink.

## Capability Reuse Check

`node packages/development/lib/trd-graph-cli.js capabilities docs/TRD --json` returned an empty capability registry (no foundational TRD currently declares reusable capability tokens). `packages/pi` was inspected directly: it is a generator/translator package (`translates ensemble artifacts for Pi coding agent`, builds `dist/index.js` from source, ships generated `prompts/`, `skills/`, `agents/`) with no `extensions/`, `src/session.ts`, or runtime harness code. It is **not** a Pi/OMP runtime harness and provides no reusable capability for this TRD's scope. No cross-TRD dependency is added; `packages/agent-core` and `packages/pi-extension` are new packages built fresh, additive to (not replacing) `packages/pi`.

## Architecture Decision

**Chosen approach: Option C — `agent-core` + `pi-extension` (balanced, matches source architecture doc)**

Two new npm workspace packages:

- `packages/agent-core` — shared, provider-neutral event/tool/protocol/behavior-compiler code. No Pi/OMP-specific types.
- `packages/pi-extension` — thin Pi-specific adapter over `agent-core`, loaded into a live Pi session via Pi's native extension mechanism.

`packages/omp-adapter` and `packages/session-launcher` are explicitly deferred (per the source PRD's Non-Goals): they are built only after the OMP extension API is confirmed compatible and only when Foreman needs to own a session, respectively. Building them now would contradict the PRD's approved Won't items (Phase E3 hooks, Phase E4 Foreman protocol, Phase E5 pilot package are out of scope this release).

### Alternatives Considered

- **Option A (single `pi-extension` package, inline types):** rejected — collapses the provider-neutral/Pi-specific boundary the source architecture doc requires (§4, §6), making a future OMP adapter a rewrite rather than an addition.
- **Option B (build all four packages now, including `omp-adapter`/`session-launcher`):** rejected — directly contradicts the PRD's Non-Goals and the architecture doc's explicit sequencing ("Do not build the Elixir activation runner first... before testing the extension API"; "packages/omp-adapter # only if OMP compatibility is proven").

### Where the behavior-package compiler lives

The source architecture doc's package shape (§4) does not name a distinct package for the behavior schema/compiler (§7-§8: `compile`, `validate`, `match`, `simulate`, `conformance_run`). Because those APIs are explicitly provider-neutral, this TRD places them inside `packages/agent-core/src/behavior/` (`schema.ts`, `discovery.ts`, `compiler.ts`, `conformance.ts`), consistent with the doc's statement that "shared event/tool/protocol code belongs in `agent-core`." This is a TRD-level architecture decision, not a change to the source PRD's package names.

## Domain Analysis

- **Technical domains touched:** API/extension-integration layer (Pi extension API), data model (event schema + local outbox sink), infrastructure (npm workspace packaging, CI).
- **Companion domains detected:** `data-model` — REQ-016 (runtime-owned event metadata schema) and REQ-017 (local outbox/evidence sink) introduce a real, validated schema for durable local records (events, evidence references, acceptance-state enum), not incidental data mentions.
- **Research domain:** not detected. The architecture doc already resolved the one open technology decision this PRD touches (TypeScript extension vs. Elixir fork/hooks) as a Non-Goal; no further vendor/tool comparison is needed within this TRD's scope.

## System Architecture

### Components

```text
packages/agent-core/
├── src/
│   ├── tools.ts            — ToolGrant, GovernedTool, tool-boundary enforcement types
│   ├── domain-tools.ts     — typed wrappers: record_observation, record_outcome,
│   │                          propose_change, report_blocked, request_approval
│   ├── events.ts           — closed event catalog union type, InvocationEvent
│   ├── event-sinks.ts      — EventSink interface; LocalOutboxSink implementation
│   ├── normalize.ts        — provider-specific -> InvocationEvent/InvocationResult
│   ├── protocol.ts         — versioned InvocationRequest/InvocationEvent/InvocationResult
│   └── behavior/
│       ├── schema.ts       — behavior.yaml schema + validation
│       ├── discovery.ts    — deterministic package discovery
│       ├── compiler.ts     — behavior.yaml -> Pi prompts/skills/governed tools
│       └── conformance.ts  — fixture-based conformance runner
└── package.json

packages/pi-extension/
├── src/
│   ├── extension.ts        — Pi extension entry point (pi.registerTool, activation)
│   ├── session.ts          — session lifecycle, cancellation/timeout cleanup
│   └── pi-events.ts        — Pi lifecycle event subscription -> agent-core normalize.ts
└── package.json
```

### Data Flow

1. A behavior package author writes `behavior.yaml` under `packages/<domain>/behaviors/<behavior-id>/`.
2. `agent-core`'s `discovery.ts` + `schema.ts` deterministically discover and validate the package (capability/mutation-class declarations, immutable digest).
3. `compiler.ts` compiles the validated package into Pi prompt templates, skill files, and governed domain-tool definitions plus runtime configuration.
4. `pi-extension`'s `extension.ts` loads the compiled artifacts into a live Pi session and registers the governed tools via Pi's native tool API.
5. During an agent turn, `session.ts` and `pi-events.ts` capture lifecycle and tool-call events, normalize them via `normalize.ts`, and route governed domain-tool calls through `domain-tools.ts`, which validates payload/event-type/evidence and stamps runtime-owned metadata (`events.ts`).
6. Validated events append to `event-sinks.ts`'s `LocalOutboxSink` before acknowledging acceptance; the tool result reports one of: accepted locally / queued for forwarding / rejected / malformed / unauthorized (never "accepted by Foreman" in local-only mode).
7. On completion, timeout, or cancellation, `session.ts` returns a normalized `InvocationResult` and guarantees no orphan Pi process/session remains.

### Integration Points

- **Pi extension API** (external dependency): tool registration, lifecycle subscription, cancellation hooks. If any required capability is unavailable, `pi-extension` documents the gap; no Pi fork/patch is introduced without a separate, explicitly approved minimal upstreamable change.
- **Existing `packages/pi` generator**: untouched; `agent-core`/`pi-extension` are additive workspace packages, not a replacement for command/agent/skill generation.
- **Foreman protocol (future)**: `protocol.ts`'s versioned types are the seam Foreman will consume in Phase E4; this TRD does not implement transport, only versioning.

## Master Task List

### PR 1: Ownership Boundary and Governance Docs

**Shippable State:** Maintainers, contributors, and Foreman integrators reading Ensemble's docs see the frozen Ensemble/Foreman governing boundary and can verify no exported API implies durable production activation.

- [ ] **TRD-001** (Est: 3h) [satisfies REQ-001] [Depends: none]
  Document the Ensemble/Foreman ownership boundary in `README.md` and `docs/architecture/ensemble-behavior-runtime-plan.md` cross-reference, explicitly listing what Ensemble does not own and recording that the existing Elixir activation runner is not the Pi/OMP adapter.
  Validates PRD ACs: AC-001-1, AC-001-2
  Implementation AC checklist:
  - [ ] Given the merged documentation, when a reader looks for "does Ensemble schedule production behavior," then the doc explicitly states it does not and names Foreman as the owner.
  - [ ] Given the existing Elixir activation runner, when the boundary doc is published, then it explicitly records that the runner is not the Pi/OMP adapter.

- [ ] **TRD-001-TEST** (Est: 1h) [Verifies TRD-001] [Satisfies REQ-001] [Depends: TRD-001]
  Test AC:
  - [ ] Scenario: boundary doc names Foreman as scheduler owner: Given the merged documentation, when a reader searches for production scheduling ownership, then the doc explicitly attributes it to Foreman.
  - [ ] Scenario: Elixir runner explicitly disclaimed: Given the boundary doc, when read, then it states the Elixir activation runner is not the Pi/OMP adapter.

- [ ] **TRD-002** (Est: 2h) [satisfies REQ-002] [Depends: TRD-001]
  Audit and (if needed) rename any `agent-core`/`pi-extension` exported function or class that could imply durability, recovery, or Foreman ownership; explicitly mark any local runner as `LocalRunner`/`Simulator`.
  Validates PRD ACs: AC-002-1, AC-002-2
  Implementation AC checklist:
  - [ ] Given the shipped `agent-core`/`pi-extension` API surface, when reviewed, then no exported function name or docstring claims durability, recovery, or Foreman ownership.
  - [ ] Given the local runner implementation, when instantiated, then its type/class name and docs are explicitly marked local/simulation-only.

- [ ] **TRD-002-TEST** (Est: 1h) [Verifies TRD-002] [Satisfies REQ-002] [Depends: TRD-002]
  Test AC:
  - [ ] Scenario: no production-looking API names: Given the exported API surface of `agent-core` and `pi-extension`, when scanned for `start_durable_activation`/`dispatch_production_behavior`-style names, then none are found.
  - [ ] Scenario: local runner is explicitly marked: Given the local runner class, when inspected, then its name and JSDoc state "local/simulation-only".

### PR 2: TypeScript Pi Extension Harness Proof

**Shippable State:** A Pi/OMP daily-driver developer installs `@ensemble/pi-extension`, gets one governed custom tool, and observes a normalized lifecycle event, a normalized tool-call event, and a normalized `InvocationResult` from a real Pi session — with zero Claude-style hook dependency and no Foreman running.

- [ ] **TRD-003** (Est: 5h) [satisfies REQ-003] [Depends: TRD-002]
  Scaffold `packages/agent-core` as an npm workspace package (`tools.ts`, `domain-tools.ts`, `events.ts`, `event-sinks.ts`, `normalize.ts`, `protocol.ts` stubs) following the `packages/pi` build/test conventions (`tsc`, `jest`).
  Validates PRD ACs: AC-003-1, AC-003-2
  Implementation AC checklist:
  - [ ] Given `packages/agent-core`, when imported by `packages/pi-extension`, then no Pi-specific type leaks back into `agent-core`.
  - [ ] Given the package.json, when `npm install` runs at the monorepo root, then `agent-core` resolves as a workspace package without errors, consistent with existing `packages/*` conventions.

- [ ] **TRD-003-TEST** (Est: 2h) [Verifies TRD-003] [Satisfies REQ-003] [Depends: TRD-003]
  Test AC:
  - [ ] Scenario: workspace resolves cleanly: Given the monorepo root, when `npm install` runs, then `packages/agent-core` resolves as a workspace package without errors.
  - [ ] Scenario: no Pi-type leakage: Given `agent-core`'s exported types, when statically checked, then none reference Pi-specific session/session-config types.

- [ ] **TRD-004** (Est: 8h) [RISK: dependent on Pi extension-API capabilities not yet confirmed; candidate for further breakdown once the API gap-check lands] [satisfies REQ-004] [Depends: TRD-003]
  Scaffold `packages/pi-extension` (`extension.ts`, `session.ts`, `pi-events.ts`) and implement the extension entry point that loads into a real Pi session via Pi's supported extension mechanism, without forking Pi.
  Validates PRD ACs: AC-004-1, AC-004-2
  Implementation AC checklist:
  - [ ] Given a Pi session with `@ensemble/pi-extension` installed, when Pi starts, then the extension activates and appears in Pi's extension status with no load-time errors.
  - [ ] Given the extension activates, when a required Pi extension-API capability is unavailable, then this is documented as a blocking gap and no Pi fork/patch is introduced without a separately documented, explicitly approved minimal upstreamable change.

- [ ] **TRD-004-TEST** (Est: 3h) [Verifies TRD-004] [Satisfies REQ-004] [Depends: TRD-004]
  Test AC:
  - [ ] Scenario: extension activates cleanly: Given a Pi session with only `@ensemble/pi-extension` installed, when Pi starts, then the extension appears active with zero load errors.
  - [ ] Scenario: capability gap is documented, not patched: Given a simulated missing extension-API capability, when detected, then a gap report is produced and no Pi source file is modified.

- [ ] **TRD-005** (Est: 6h) [satisfies REQ-005] [Depends: TRD-004]
  Register at least one governed custom tool via Pi's native tool registration API and enforce tool-grant denial at the runtime boundary.
  Validates PRD ACs: AC-005-1, AC-005-2
  Implementation AC checklist:
  - [ ] Given the extension is active, when the agent calls the registered tool, then the tool executes and returns a typed result.
  - [ ] Given a tool call with an unauthorized tool grant, when invoked, then the runtime boundary denies it with an "unauthorized" result — prompt text cannot bypass this.

- [ ] **TRD-005-TEST** (Est: 2h) [Verifies TRD-005] [Satisfies REQ-005] [Depends: TRD-005]
  Test AC:
  - [ ] Scenario: registered tool is callable: Given the extension is active, when the agent calls the governed tool, then a typed result is returned.
  - [ ] Scenario: denial cannot be bypassed by prompt text: Given a prompt instructing the model to call an ungranted tool, when the call is attempted, then it is denied with an "unauthorized" result.

- [ ] **TRD-006** (Est: 6h) [satisfies REQ-006] [Depends: TRD-004]
  Subscribe to Pi's native lifecycle events (session started, prompt submitted, tool called/completed, session completed/failed/cancelled/timed out, process exited) with zero Claude-style hook dependency.
  Validates PRD ACs: AC-006-1, AC-006-2
  Implementation AC checklist:
  - [ ] Given a Pi session with no hook configuration present, when a prompt runs, then at least a `runtime.session.started` and `runtime.session.completed` (or `.failed`) event is observed.
  - [ ] Given the same session running with hook configuration absent entirely, when compared, then lifecycle event capture is unaffected (proves hook-independence).

- [ ] **TRD-006-TEST** (Est: 2h) [Verifies TRD-006] [Satisfies REQ-006] [Depends: TRD-006]
  Test AC:
  - [ ] Scenario: lifecycle events observed with no hooks: Given a Pi session with no hook configuration, when a prompt runs, then `runtime.session.started` and `runtime.session.completed` events are observed.
  - [ ] Scenario: hook-independence: Given hook configuration entirely absent, when compared to a run with it present, then lifecycle event capture is identical.

- [ ] **TRD-007** (Est: 5h) [satisfies REQ-007] [Depends: TRD-005, TRD-006]
  Capture both governed custom tool calls and native Pi tool calls as normalized `tool_call`/`tool_result` event pairs, distinguishing governed from native.
  Validates PRD ACs: AC-007-1, AC-007-2
  Implementation AC checklist:
  - [ ] Given an agent turn that calls a registered custom tool, when the call completes, then a normalized tool-call and tool-result event pair is observed with matching correlation.
  - [ ] Given a native Pi tool call (not a custom tool), when it completes, then it is also captured and normalized, distinguishing it from a governed custom tool call.

- [ ] **TRD-007-TEST** (Est: 2h) [Verifies TRD-007] [Satisfies REQ-007] [Depends: TRD-007]
  Test AC:
  - [ ] Scenario: custom tool call/result pair captured: Given a registered custom tool call, when it completes, then a matching tool-call/tool-result pair is observed via correlation id.
  - [ ] Scenario: native tool call distinguished: Given a native Pi tool call (e.g. `read`), when it completes, then it is normalized and tagged as non-governed.

- [ ] **TRD-008** (Est: 4h) [satisfies REQ-008] [Depends: TRD-007]
  Implement `normalize.ts` result assembly returning a provider-neutral `InvocationResult` (status, output, usage, toolCalls, failure).
  Validates PRD ACs: AC-008-1, AC-008-2
  Implementation AC checklist:
  - [ ] Given a completed invocation, when the result is returned, then it matches the versioned `InvocationResult` schema and contains no raw Pi-session objects.
  - [ ] Given a failed invocation, when the result is returned, then `status: "failed"` is set and `failure` is populated with a `NormalizedFailure`.

- [ ] **TRD-008-TEST** (Est: 2h) [Verifies TRD-008] [Satisfies REQ-008] [Depends: TRD-008]
  Test AC:
  - [ ] Scenario: successful result matches schema: Given a completed invocation, when the result is returned, then it validates against the `InvocationResult` schema with no raw Pi objects.
  - [ ] Scenario: failed result reports NormalizedFailure: Given a failing invocation, when the result is returned, then `status` is `"failed"` and `failure` is populated.

- [ ] **TRD-009** (Est: 5h) [satisfies REQ-009] [Depends: TRD-005, TRD-006, TRD-007, TRD-008]
  Assemble and script the minimal end-to-end harness proof: load extension -> register one tool -> run one prompt -> observe one lifecycle event -> observe one tool call -> return one normalized result.
  Validates PRD ACs: AC-009-1, AC-009-2
  Implementation AC checklist:
  - [ ] Given a fresh Pi installation with only `@ensemble/pi-extension` added, when the proof script/test runs, then all five observation points succeed in one run.
  - [ ] Given the same proof run twice, when compared, then event normalization is deterministic (same shape/fields across runs, timestamps aside).

- [ ] **TRD-009-TEST** (Est: 2h) [Verifies TRD-009] [Satisfies REQ-009] [Depends: TRD-009]
  Test AC:
  - [ ] Scenario: full proof succeeds in one run: Given a fresh Pi install with only the extension added, when the proof script runs, then all five observation points pass.
  - [ ] Scenario: normalization is deterministic: Given the proof run twice, when the two event sets are diffed (ignoring timestamps), then they are structurally identical.

- [ ] **TRD-010** (Est: 3h) [satisfies REQ-010] [Depends: TRD-008]
  Define and version `InvocationRequest`/`InvocationEvent`/`InvocationResult` in `protocol.ts` with an explicit schema-version field/tag.
  Validates PRD ACs: AC-010-1, AC-010-2
  Implementation AC checklist:
  - [ ] Given `protocol.ts`, when inspected, then each exported type carries or is associated with an explicit schema version.
  - [ ] Given a breaking change to any of the three types, when made, then the version is bumped and existing consumers fail loudly rather than silently misinterpreting fields.

- [ ] **TRD-010-TEST** (Est: 1h) [Verifies TRD-010] [Satisfies REQ-010] [Depends: TRD-010]
  Test AC:
  - [ ] Scenario: schema version present: Given `protocol.ts`'s exported types, when inspected, then each carries an explicit version tag.
  - [ ] Scenario: breaking change bumps version and fails loudly: Given a simulated breaking field removal, when a stale consumer parses the new payload, then it throws a version-mismatch error rather than silently misreading fields.

### PR 3: Behavior Package Schema and Compiler

**Shippable State:** A behavior-package author can write a `behavior.yaml`, have it deterministically discovered, validated against the schema (capability vs. mutation-class distinction enforced), and checked against fixture-based conformance tests — even before it executes inside Pi.

- [ ] **TRD-011** (Est: 6h) [RISK: schema under-specification could let a tool grant imply broader mutation authority than intended] [satisfies REQ-011] [Depends: TRD-010]
  Implement `behavior/schema.ts`: `behavior.yaml` schema (`api_version`, `kind: Behavior`, `metadata`, `trigger`, `policy`, `capabilities.tools`, `capabilities.mutation_classes`, `execution.graph`, `outcomes`) with an immutable per-version digest, distinguishing requested tools from mutation authority.
  Validates PRD ACs: AC-011-1, AC-011-2
  Implementation AC checklist:
  - [ ] Given a `behavior.yaml` with `capabilities.tools: [bash.test]` but no `mutation_classes` for `artifact.write`, when compiled, then the compiled package cannot perform artifact writes even though it has bash access.
  - [ ] Given two behavior packages with identical `metadata.version` but different content, when validated, then the digest mismatch fails validation.

- [ ] **TRD-011-TEST** (Est: 2h) [Verifies TRD-011] [Satisfies REQ-011] [Depends: TRD-011]
  Test AC:
  - [ ] Scenario: tool grant does not imply mutation authority: Given a package granted `bash.test` only, when its compiled tool set is inspected, then `artifact.write` is absent.
  - [ ] Scenario: digest mismatch fails validation: Given two packages sharing a version but differing content, when validated, then validation fails on digest mismatch.

- [ ] **TRD-012** (Est: 5h) [satisfies REQ-012] [Depends: TRD-011]
  Implement `behavior/discovery.ts`: deterministic discovery of `packages/<domain>/behaviors/<behavior-id>/` packages and field-level validation errors.
  Validates PRD ACs: AC-012-1, AC-012-2
  Implementation AC checklist:
  - [ ] Given a directory of behavior packages, when discovery runs twice with no changes, then the discovered set and order are identical (deterministic).
  - [ ] Given a malformed `behavior.yaml` (e.g. missing required field), when validation runs, then it fails with a specific field-level error, not a generic parse failure.

- [ ] **TRD-012-TEST** (Est: 2h) [Verifies TRD-012] [Satisfies REQ-012] [Depends: TRD-012]
  Test AC:
  - [ ] Scenario: deterministic discovery order: Given an unchanged directory, when discovery runs twice, then the ordered package list is identical both times.
  - [ ] Scenario: field-level validation error: Given a `behavior.yaml` missing `metadata.version`, when validated, then the error names the missing field.

- [ ] **TRD-013** (Est: 4h) [satisfies REQ-013] [Depends: TRD-012]
  Implement `behavior/conformance.ts`: run a behavior package's fixtures (`fixtures/events/`, `fixtures/expected-matches/`, `fixtures/expected-outcomes/`) against its declared behavior.
  Validates PRD ACs: AC-013-1
  Implementation AC checklist:
  - [ ] Given a behavior package with fixtures, when `conformance_run` executes, then matches/outcomes produced equal the expected fixtures structurally for at least one test package.

- [ ] **TRD-013-TEST** (Est: 2h) [Verifies TRD-013] [Satisfies REQ-013] [Depends: TRD-013]
  Test AC:
  - [ ] Scenario: conformance run matches fixtures: Given a test behavior package with fixtures, when `conformance_run` executes, then produced matches/outcomes equal the expected fixtures.

### PR 4: Local Pi/OMP Execution and Governed Domain Tools

**Shippable State:** A Pi/OMP daily-driver developer runs one bounded local behavior end-to-end: compiled prompts/skills/governed tools execute inside a real Pi session, typed domain-tool calls validate against the closed event catalog with runtime-owned metadata, results land in a local outbox distinguishing acceptance states, tool grants are enforced at the boundary, and timeout/cancellation leave no orphan process.

- [ ] **TRD-014** (Est: 9h) [RISK: 8h+ estimate — candidate for further breakdown into "compile prompts/skills" and "compile governed tools + runtime config" sub-tasks during sprint planning] [satisfies REQ-014] [Depends: TRD-013, TRD-009]
  Implement `behavior/compiler.ts`: compile a validated `behavior.yaml` into Pi prompt templates, skill files, governed domain tools, and runtime configuration, reusing `packages/pi`'s existing generator patterns without breaking them.
  Validates PRD ACs: AC-014-1, AC-014-2
  Implementation AC checklist:
  - [ ] Given a compiled behavior package, when loaded into a Pi session via the extension, then the compiled prompts/skills/tools are available and functional.
  - [ ] Given the existing `packages/pi` command/agent/skill generation, when the behavior compiler is added, then existing generated Pi artifacts remain byte-identical/compatible (no regression).

- [ ] **TRD-014-TEST** (Est: 3h) [Verifies TRD-014] [Satisfies REQ-014] [Depends: TRD-014]
  Test AC:
  - [ ] Scenario: compiled package loads and functions: Given a compiled behavior package, when loaded via the extension, then its prompts/skills/tools are available and callable.
  - [ ] Scenario: existing generator output unregressed: Given the pre-existing `packages/pi` generated artifact snapshot, when the behavior compiler is added and generation reruns, then the snapshot is unchanged.

- [ ] **TRD-015** (Est: 7h) [satisfies REQ-015] [Depends: TRD-014]
  Implement the five typed domain tools (`ensemble.record_observation`, `ensemble.record_outcome`, `ensemble.propose_change`, `ensemble.report_blocked`, `ensemble.request_approval`) in `domain-tools.ts`, each validating a fixed event type/payload/evidence/transition per the documented mapping.
  Validates PRD ACs: AC-015-1, AC-015-2
  Implementation AC checklist:
  - [ ] Given `ensemble.record_observation` called with a payload matching `behavior.observation.recorded`, when invoked, then the event validates and is accepted.
  - [ ] Given any typed tool called with an event type outside its permitted mapping, when invoked, then it is rejected as malformed/unauthorized.

- [ ] **TRD-015-TEST** (Est: 3h) [Verifies TRD-015] [Satisfies REQ-015] [Depends: TRD-015]
  Test AC:
  - [ ] Scenario: valid observation accepted: Given a valid `behavior.observation.recorded` payload via `ensemble.record_observation`, when invoked, then it is accepted.
  - [ ] Scenario: out-of-mapping event type rejected: Given a domain tool call attempting a `runtime.*` event type, when invoked, then it is rejected as unauthorized.

- [ ] **TRD-016** (Est: 4h) [satisfies REQ-016] [Depends: TRD-015]
  Implement runtime-owned metadata stamping (`event_id`, `execution_id`, `session_id`, `behavior_id`, `behavior_digest`, `occurred_at`, `source`, `correlation_id`, `causation_id`, `deduplication_key`) in `events.ts`, overriding any agent-supplied values for these fields.
  Validates PRD ACs: AC-016-1, AC-016-2
  Implementation AC checklist:
  - [ ] Given a domain tool call, when the agent attempts to pass an `event_id` or `occurred_at` in its payload, then the runtime overwrites/ignores agent-supplied values and assigns its own.
  - [ ] Given two invocations of the same tool, when correlation is inspected, then `execution_id` and `session_id` are consistently runtime-derived, never agent-supplied.

- [ ] **TRD-016-TEST** (Est: 2h) [Verifies TRD-016] [Satisfies REQ-016] [Depends: TRD-016]
  Test AC:
  - [ ] Scenario: agent-supplied identity fields overridden: Given a payload with an agent-supplied `event_id`, when processed, then the stored event carries a runtime-assigned `event_id` instead.
  - [ ] Scenario: consistent runtime-derived correlation: Given two tool calls in the same session, when compared, then `session_id` matches and is never agent-supplied.

- [ ] **TRD-017** (Est: 6h) [RISK: conflating "accepted locally" with "accepted by Foreman" would misrepresent durability guarantees] [satisfies REQ-017] [Depends: TRD-016]
  Implement `event-sinks.ts`'s `LocalOutboxSink`: append-before-acknowledge local evidence sink reporting accepted-locally / queued-for-forwarding / rejected / malformed / unauthorized, never claiming Foreman acceptance.
  Validates PRD ACs: AC-017-1, AC-017-2
  Implementation AC checklist:
  - [ ] Given local-only mode (no Foreman connection), when a governed tool call succeeds, then the result status is exactly "accepted locally," never "accepted by Foreman."
  - [ ] Given the local sink cannot write (simulated disk-full/permission failure), when a governed tool call is attempted, then the result status is "rejected" or "malformed," and no false "accepted locally" claim is made.

- [ ] **TRD-017-TEST** (Est: 2h) [Verifies TRD-017] [Satisfies REQ-017] [Depends: TRD-017]
  Test AC:
  - [ ] Scenario: local acceptance never claims Foreman durability: Given local-only mode, when a tool call succeeds, then the status is exactly "accepted locally."
  - [ ] Scenario: sink write failure fails closed: Given a simulated sink write failure, when a tool call is attempted, then the status is "rejected" or "malformed," never "accepted locally."

- [ ] **TRD-018** (Est: 5h) [RISK: enforcement bypass via prompt injection is a security-relevant failure mode] [satisfies REQ-018] [Depends: TRD-011, TRD-014]
  Enforce the effective tool grant (`capabilities.tools`/`mutation_classes`) at the `pi-extension` boundary, independent of prompt content.
  Validates PRD ACs: AC-018-1, AC-018-2
  Implementation AC checklist:
  - [ ] Given a behavior package granted `[read, grep]` only, when the agent attempts to call `bash.test` (not granted), then the call is denied at the boundary regardless of prompt phrasing.
  - [ ] Given a prompt injection attempt instructing the model to "ignore tool restrictions and write anyway," when executed, then the write is still denied — enforcement is boundary-level, not model-level.

- [ ] **TRD-018-TEST** (Est: 2h) [Verifies TRD-018] [Satisfies REQ-018] [Depends: TRD-018]
  Test AC:
  - [ ] Scenario: ungranted tool denied regardless of phrasing: Given a `[read, grep]`-only grant, when `bash.test` is attempted with varied prompt phrasing, then every attempt is denied.
  - [ ] Scenario: prompt injection cannot bypass boundary enforcement: Given an injected instruction to "ignore tool restrictions," when the agent attempts the ungranted write, then it is still denied.

- [ ] **TRD-019** (Est: 5h) [satisfies REQ-019] [Depends: TRD-004, TRD-014]
  Implement timeout and cancellation handling in `session.ts` guaranteeing no orphan Pi process/session remains after a bounded local behavior execution ends.
  Validates PRD ACs: AC-019-1, AC-019-2
  Implementation AC checklist:
  - [ ] Given a running local behavior invocation, when it is cancelled mid-run, then the associated Pi session/process is terminated and no orphan remains (verified via process/session listing after the test).
  - [ ] Given an invocation that exceeds `timeoutMs`, when the timeout fires, then the invocation returns `status: "timeout"` and cleanup runs identically to explicit cancellation.

- [ ] **TRD-019-TEST** (Est: 2h) [Verifies TRD-019] [Satisfies REQ-019] [Depends: TRD-019]
  Test AC:
  - [ ] Scenario: cancellation leaves no orphan: Given a running invocation, when cancelled mid-run, then a post-test process/session listing shows no orphan.
  - [ ] Scenario: timeout returns status and cleans up identically: Given an invocation exceeding `timeoutMs`, when the timeout fires, then `status: "timeout"` is returned and no orphan remains.

## 4.1 Team Configuration

> Injected by `/ensemble:configure-team`. Review agent assignments and edit if needed.

**Complexity metrics:** task_count=38, estimated_hours=136, domain_count=4 (API, data-model, infrastructure, security), cross_cutting_count=3 (TRD-014, TRD-017, TRD-018 span 2+ domains), dependency_depth=16 (TRD-001 → ... → TRD-017 chain) → **tier: Complex**

```yaml
team_configuration:
  complexity:
    task_count: 38
    estimated_hours: 136
    domain_count: 4
    domains: [api, data-model, infrastructure, security]
    cross_cutting_count: 3
    dependency_depth: 16
    tier: complex
  roles:
    lead:
      agent: tech-lead-orchestrator
      owns: [task-selection, architecture-review, final-approval]
    builders:
      - agent: backend-developer
        owns: [api, data-model, security]
      - agent: build-orchestrator
        owns: [infrastructure]
    reviewer:
      agent: code-reviewer
      owns: [code-review, security-quality-gate]
    qa:
      agent: qa-orchestrator
      owns: [test-coverage-validation, bdd-scenario-verification]
  marketplace:
    gaps_found: 0
    plugins_installed: []
    note: "All required agents (backend-developer, build-orchestrator, code-reviewer, qa-orchestrator, tech-lead-orchestrator) already exist in the local agent registry (packages/development/agents, packages/infrastructure/agents, packages/pi/agents, packages/quality/agents) — no marketplace gap, no plugin installs required."
```

## Sprint Planning

| Sprint | PR(s) | Focus |
|---|---|---|
| Sprint 1 | PR 1 | Freeze and publish the ownership boundary and API-naming audit before any harness code lands |
| Sprint 2 | PR 2 | Build and prove the TypeScript Pi extension harness (TRD-003 through TRD-010) — the Phase E0 exit gate |
| Sprint 3 | PR 3 | Behavior package schema, discovery, and conformance fixtures (TRD-011 through TRD-013) |
| Sprint 4 | PR 4 | Compile behavior packages into working Pi/OMP execution with governed domain tools, enforcement, and cleanup (TRD-014 through TRD-019) |

Dependencies are strictly sequential across PRs (PR 2 depends on PR 1's naming audit informing `agent-core`'s public surface; PR 3 depends on PR 2's versioned contract; PR 4 depends on both PR 2's harness and PR 3's compiler). No circular dependencies exist in the task graph.

## Acceptance Criteria Traceability

| REQ-NNN | Description | Implementation Tasks | Test Tasks |
|---|---|---|---|
| REQ-001 | Documented ownership boundary | TRD-001 | TRD-001-TEST |
| REQ-002 | API surface excludes production-looking calls | TRD-002 | TRD-002-TEST |
| REQ-003 | `agent-core` shared package | TRD-003 | TRD-003-TEST |
| REQ-004 | `pi-extension` loads into real Pi session | TRD-004 | TRD-004-TEST |
| REQ-005 | Register/invoke one governed custom tool | TRD-005 | TRD-005-TEST |
| REQ-006 | Capture lifecycle events without Claude hooks | TRD-006 | TRD-006-TEST |
| REQ-007 | Capture tool calls and tool results | TRD-007 | TRD-007-TEST |
| REQ-008 | Return normalized `InvocationResult` | TRD-008 | TRD-008-TEST |
| REQ-009 | Minimal end-to-end harness proof | TRD-009 | TRD-009-TEST |
| REQ-010 | Version the provider-neutral contract | TRD-010 | TRD-010-TEST |
| REQ-011 | `behavior.yaml` schema + mutation classes | TRD-011 | TRD-011-TEST |
| REQ-012 | Deterministic discovery/validation | TRD-012 | TRD-012-TEST |
| REQ-013 | Conformance fixtures and tests | TRD-013 | TRD-013-TEST |
| REQ-014 | Compile behavior package to Pi artifacts | TRD-014 | TRD-014-TEST |
| REQ-015 | Typed domain tool vocabulary | TRD-015 | TRD-015-TEST |
| REQ-016 | Runtime-owned event metadata | TRD-016 | TRD-016-TEST |
| REQ-017 | Local outbox/evidence sink | TRD-017 | TRD-017-TEST |
| REQ-018 | Tool-grant enforcement at runtime boundary | TRD-018 | TRD-018-TEST |
| REQ-019 | Timeout, cancellation, orphan cleanup | TRD-019 | TRD-019-TEST |

Traceability check: 19 requirements covered, 0 uncovered, 0 orphaned annotations.

## Quality Requirements

- **Security:** Tool-grant and mutation-class enforcement occurs at the extension runtime boundary, never inferred from prompt content (TRD-018); typed domain tools validate against a closed event catalog and reject unmapped event types (TRD-015).
- **Performance:** No explicit latency targets carried over from the PRD; the harness proof (TRD-009) and normalization (TRD-008/TRD-010) must not introduce unbounded blocking — bounded by `timeoutMs` (TRD-019).
- **Accessibility:** Not applicable — this is a developer-facing CLI/extension surface, no UI component.
- **Reliability:** Local outbox sink fails closed on write failure rather than silently dropping (TRD-017); timeout/cancellation leaves no orphan process (TRD-019).
- **Testing standards:** Every implementation task has a paired `-TEST` task; unit tests via Jest per existing monorepo convention (`packages/pi`'s `test` script pattern); no test asserts internal wiring or source text — only observable results (accepted/rejected status, event shapes, process absence).

## Design Readiness Scorecard

| Dimension | Score (1-5) | Notes |
|---|---|---|
| Architecture completeness | 5 | All components, interfaces, and data flows defined; behavior-compiler placement decision explicitly documented since the source doc left it open |
| Task coverage | 4 | Every REQ-NNN has exactly one implementation task and one test task; PRD's 2-AC-per-requirement depth (STANDARD) is below the ideal 3-AC BDD coverage floor this command targets — noted below, not blocking |
| Dependency clarity | 5 | All dependencies explicit and acyclic; PR boundaries drawn along dependency lines with no circular deps |
| Estimate confidence | 4 | Two tasks (TRD-004, TRD-014) are 8h+ and flagged as breakdown candidates; estimates are otherwise consistent with complexity ratings carried from the PRD |

**Overall score:** 4.5 → adjusted to **4.4** for the coverage note below.

**Gate decision:** PASS (≥4.0)

### Coverage and Testability Notes

- Every functional REQ-NNN in the source PRD carries exactly 2 ACs (STANDARD-depth minimum), not the 3-AC happy/edge/error floor this command's Acceptance Criteria Review step targets for BDD scaffolding richness. This is carried forward as-is rather than inventing a third AC unsupported by the PRD; each TRD-NNN-TEST task therefore has 2 Scenario checklist items, matching its PRD ACs one-to-one. Recommended resolution if broader BDD coverage is desired later: run `/ensemble:refine-prd` to add a third (error/negative) AC per Must requirement, then regenerate the affected TRD tasks.
- TRD-004 (8h) and TRD-014 (9h) are flagged as breakdown candidates; sprint planning may split them further once implementation starts and their actual sub-steps are clearer.

## Constitution Gate

**Constitution source:** `docs/standards/constitution.md` (canonical; no `.specify/memory/constitution.md` present, no divergence to warn about).

| Constitution Reference | Check | Result |
|---|---|---|
| Non-Negotiable Rule 1 (No secrets in code) | No task introduces credentials in source | Passed — no task touches secrets/credentials |
| Non-Negotiable Rule 2 (Input validation required) | External input validated at boundaries | Passed — TRD-012 (behavior.yaml validation), TRD-015 (domain-tool payload validation) |
| Non-Negotiable Rule 3 (Tests accompany features) | Every feature has test coverage | Passed — every TRD-NNN has a paired TRD-NNN-TEST |
| Non-Negotiable Rule 4 (Ownership boundary is preserved) | No durable activation/scheduling/recovery built | Passed — PR 1 documents and PR 2-4 scope excludes all durable-Foreman-owned capability; Non-Goals preserved from source PRD |
| Non-Negotiable Rule 5 (Governed tool boundary enforced at runtime, not model) | Tool grants enforced at boundary, not by prompt | Passed — TRD-018 explicitly implements and tests this |

**Constitution compliance: passed.**

## Changelog

| Date | Change | Author |
|---|---|---|
| 2026-09-24 | Initial TRD generated from PRD-2026-0fc1c1d0 via `/ensemble-create-trd` | ensemble-create-trd workflow |
