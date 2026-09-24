---
document_id: PRD-2026-0fc1c1d0
label: prd-behavior-runtime-pi-harness
version: 1.0.0
status: Draft
date: 2026-09-24
scale_depth: STANDARD
total_requirements: 19
readiness_score: 4.25
---

# PRD-2026-0fc1c1d0: Ensemble Behavior Runtime and Pi/OMP Harness (Phases E0-E2)

## PRD Health Summary

| Metric | Value |
|---|---|
| Must requirements | 15 |
| Should requirements | 4 |
| Could requirements | 0 |
| Won't (this release) | 3 |
| AC coverage | 19/19 (100%) |
| Risk flags | 6 |
| Cross-requirement dependencies | 14 |
| Clarification markers | 0 |

## Problem Statement

Ensemble's full-lifecycle development workflows — PRD/TRD creation, implementation orchestration, code review, git automation, quality pipelines — are only available to Claude Code and OpenCode users today. Pi, a rapidly growing open-source coding agent with 28k+ stars and an extensible package ecosystem, has no equivalent workflow suite, because Ensemble has no native runtime bridge into Pi/OMP: Claude-style hooks do not work in Pi/OMP by themselves, and generated prompt/skill/agent artifacts change agent guidance without installing any event bridge.

At the same time, Ensemble risks quietly growing into a second durable scheduler/activation coordinator — an existing Elixir activation runner already blurs this boundary — which would duplicate and conflict with Foreman's ownership of durable production activation, scheduling, retries, and recovery.

Both problems must be fixed together: Ensemble maintainers and Foreman integrators need a frozen, unambiguous ownership boundary before more behavior-package work is safe to build on top of, and Pi/OMP daily-driver developers need a real, working local harness — governed custom tools, semantic events, and normalized lifecycle results — to get feature parity with Claude Code/OpenCode users.

### Who feels the pain today

- **Ensemble/Foreman maintainers** — cannot safely add behavior-package features while the Ensemble/Foreman ownership boundary is undocumented and an Elixir activation runner exists that looks like (but is not) a Pi/OMP adapter.
- **Pi/OMP daily-driver developers** — get no structured PRD/TRD workflow, no governed custom tools, and no semantic event emission; they either work without structured workflows or build their own from scratch.
- **Foreman integrators** — need a versioned, provider-neutral protocol to consume from Ensemble without importing TypeScript implementation details or Ensemble owning durable state.

## Goals and Non-Goals

### Goals (this PRD: Phases E0-E2)

- Freeze and document the Ensemble/Foreman ownership boundary (describe/validate/package/simulate/local-run vs. activate/govern/schedule/execute/recover/audit).
- Ship a real, working TypeScript Pi extension (`packages/pi-extension`) and shared `packages/agent-core` package implementing the minimal harness proof: load into a Pi session, register one governed custom tool, run one prompt, observe one lifecycle event, observe one tool call, return one normalized result — without relying on Claude-style hooks.
- Define and version the provider-neutral invocation/event/result contract (`InvocationRequest`, `InvocationEvent`, `InvocationResult`).
- Add the behavior package schema (`behavior.yaml`), deterministic package discovery/validation, capability/mutation-class declarations, and conformance fixtures (Phase E1).
- Compile a behavior package into Pi/OMP prompts, skills, and governed domain tools, and execute one bounded local behavior end-to-end through the TypeScript harness with tool-grant enforcement, timeout/cancellation cleanup, and normalized results (Phase E2).
- Implement the initial typed domain tool vocabulary (`ensemble.record_observation`, `ensemble.record_outcome`, `ensemble.propose_change`, `ensemble.report_blocked`, `ensemble.request_approval`) against the closed, versioned event catalog.
- Provide a local outbox/evidence sink that distinguishes "accepted locally," "queued for forwarding," "rejected," "malformed," and "unauthorized," without claiming durable Foreman acceptance.

### Non-Goals (this release)

- **Won't** — Building or wiring the Foreman-facing versioned stdio/JSON-RPC protocol client/server contract (Phase E4). [RISK: deferring this may require a compatible-but-unproven wire format in E0's protocol versioning]
- **Won't** — Delivering the pilot behavior package end-to-end (`test.failed -> investigate-test-failure -> bounded run -> proposal`) (Phase E5).
- **Won't** — Building or repairing the optional hook-based compatibility adapter (Phase E3).
- Building a durable scheduler, activation ledger, leases, retries, or recovery inside Ensemble (belongs to Foreman, permanently out of scope).
- Reimplementing Foreman's event store or durable causal history.
- Making hooks universal across agent runtimes.
- Forking or modifying Pi's agent loop absent a demonstrated, documented extension-API gap.
- An OMP adapter package, unless/until the OMP extension API is confirmed compatible with the shared `agent-core`.
- Removing or breaking existing command/agent/skill generation formats.

## User Analysis

### User Roles

| Role | Pain Today | What They Gain |
|---|---|---|
| Ensemble/Foreman maintainer | No documented, enforceable boundary between "describe/validate/simulate" and "activate/govern/schedule"; an Elixir activation runner already blurs it | A frozen governing boundary, explicit non-goals, and a package structure (`agent-core` / `pi-extension`) that cannot be mistaken for a durable scheduler |
| Foreman integrator | No versioned, provider-neutral contract to consume; would otherwise have to import TypeScript internals | A versioned `InvocationRequest`/`InvocationEvent`/`InvocationResult` contract and closed event catalog to build the Phase E4 protocol against later |
| Pi/OMP daily-driver developer | No structured PRD/TRD/implementation workflow parity with Claude Code/OpenCode; no governed custom tools; no semantic event emission | A working Pi extension providing governed custom tools, semantic events, normalized lifecycle results, and eventually compiled behavior packages, without needing Foreman running |

### Success Metrics

- A real Pi session loads `@ensemble/pi-extension`, registers a governed custom tool, and completes the doc's minimal proof end-to-end with zero Claude-style hook dependency.
- 100% of the initial typed domain tool vocabulary (5 tools) validate payloads against the closed event catalog and reject any event type outside it.
- Zero Ensemble tests depend on a durable Foreman event store.
- Tool-grant denial cannot be bypassed by prompt text, verified by an adversarial fixture/test.
- Timeout and cancellation leave zero orphan processes/sessions across the test suite.
- One bounded local behavior executes through the compiled Pi/OMP harness end-to-end (Phase E2 exit gate) with a local outbox/evidence sink that never represents "accepted locally" as "accepted by Foreman."

## Technical Dependency Mapping

- **Pi extension APIs** — tool registration, lifecycle event subscription, custom-tool invocation, cancellation/timeout hooks. External dependency; if a required capability is unsupported, the gap must be documented (not worked around by forking Pi). [RISK: extension-API gap discovery could block Phase E0's exit gate]
- **OMP extension API** — only if proven compatible; produces a thin adapter over `agent-core`, not duplicated logic.
- **npm/Node workspace tooling** — existing monorepo `packages/*` workspace convention (validated in `packages/pi`), reused for `packages/agent-core` and `packages/pi-extension`.
- **Existing Ensemble command/agent/skill generator** (`scripts/generate-markdown.js`, `packages/pi`) — must remain compatible; the behavior-package compiler (E1/E2) is additive, not a replacement.
- **Local outbox/evidence sink** — filesystem or embedded store local to the harness; not a durable Foreman event store.
- **Foreman protocol (future, E4)** — out of scope for implementation this release, but the E0 provider-neutral contract must be versioned so E4 can consume it without a breaking rewrite.

| REQ cluster | Depends On | Data flow direction |
|---|---|---|
| Harness proof (E0) | Pi/OMP extension API | Pi session → extension → normalized event/result |
| Behavior schema/compiler (E1) | Harness proof contract types | behavior.yaml → compiled prompts/skills/tools |
| Local execution (E2) | Behavior compiler, harness proof | compiled package → Pi session → local outbox |
| Local outbox/evidence sink | Governed tool validation | governed tool → validate → sink (never emits durable Foreman claims) |

## Requirements by Feature Area

---

### Feature Area 1: Ownership Boundary and Governance

#### REQ-001: Documented Ensemble/Foreman ownership boundary {#req-001}
**Priority:** Must | **Complexity:** Low

Ensemble's README or architecture docs must state the governing boundary (describe/validate/package/simulate/local-run vs. activate/govern/schedule/execute/recover/audit) and explicitly list what Ensemble does not own (durable ingestion, activation decisions, dedup leases, cooldowns, retries/recovery, durable causal history, production-mutation approval enforcement, a second dispatcher).

- AC-001-1: Given the merged documentation, when a reader looks for "does Ensemble schedule production behavior," then the doc explicitly states it does not and names Foreman as the owner.
- AC-001-2: Given the existing Elixir activation runner, when the boundary doc is published, then it explicitly records that the runner is not the Pi/OMP adapter.

#### REQ-002: Ensemble API surface excludes production-looking calls {#req-002}
**Priority:** Must | **Complexity:** Low [RISK: naming choices are easy to get wrong silently]

Ensemble's public API (`compile`, `validate`, `match`, `simulate`, `shadow_record`, `conformance_run`, `export`) must not include or imply `start_durable_activation` or `dispatch_production_behavior`-style entry points. Any local runner must be explicitly named/marked as local/simulation-only (e.g. `LocalRunner`, `Simulator`).

- AC-002-1: Given the shipped `agent-core`/`pi-extension` API surface, when reviewed, then no exported function name or docstring claims durability, recovery, or Foreman ownership.
- AC-002-2: Given the local runner implementation, when instantiated, then its type/class name and docs are explicitly marked local/simulation-only.

---

### Feature Area 2: TypeScript Pi Extension (Phase E0 harness proof)

#### REQ-003: `packages/agent-core` shared event/tool/protocol package {#req-003}
**Priority:** Must | **Complexity:** Medium

Create `packages/agent-core` containing shared, provider-neutral event/tool/protocol code (`tools.ts`, `domain-tools.ts`, `events.ts`, `event-sinks.ts`, `normalize.ts`, `protocol.ts`) usable by any adapter. Pi/OMP-specific types remain out of this package.

- AC-003-1: Given `packages/agent-core`, when imported by `packages/pi-extension`, then no Pi-specific type leaks back into `agent-core`.
- AC-003-2: Given the package.json, when `npm install` runs at the monorepo root, then `agent-core` resolves as a workspace package without errors, consistent with existing `packages/*` conventions.

#### REQ-004: `packages/pi-extension` loads into a real Pi session {#req-004}
**Priority:** Must | **Complexity:** High [RISK: dependent on Pi extension-API capabilities not yet confirmed]

Implement `packages/pi-extension` (`extension.ts`, `session.ts`, `pi-events.ts`) that loads into a Pi session through the supported extension mechanism, without forking or modifying Pi's agent loop.

- AC-004-1: Given a Pi session with `@ensemble/pi-extension` installed, when Pi starts, then the extension activates and appears in Pi's extension status with no load-time errors.
- AC-004-2: Given the extension activates, when a required Pi extension-API capability (e.g. lifecycle subscription, tool-call capture) is unavailable, then this is documented as a blocking gap and no Pi fork/patch is introduced without a separately documented, explicitly-approved minimal upstreamable change.

#### REQ-005: Register and invoke one governed custom tool {#req-005}
**Priority:** Must | **Complexity:** Medium

The extension must register at least one governed custom tool via Pi's native tool registration API and make it callable from an agent turn.

- AC-005-1: Given the extension is active, when the agent calls the registered tool, then the tool executes and returns a typed result.
- AC-005-2: Given a tool call with an unauthorized tool grant, when invoked, then the runtime boundary denies it with an "unauthorized" result — prompt text cannot bypass this.

#### REQ-006: Capture lifecycle events without Claude hooks {#req-006}
**Priority:** Must | **Complexity:** Medium

Capture Pi lifecycle events (session started, prompt submitted, tool called, tool completed, session completed/failed/cancelled/timed out, process exited) via the extension's native Pi lifecycle subscriptions, independent of any Claude-style hook mechanism.

- AC-006-1: Given a Pi session with no hook configuration present, when a prompt runs, then at least a `runtime.session.started` and `runtime.session.completed` (or `.failed`) event is observed.
- AC-006-2: Given the same session running with hook configuration absent entirely, when compared, then lifecycle event capture is unaffected (proves hook-independence).

#### REQ-007: Capture tool calls and tool results {#req-007}
**Priority:** Must | **Complexity:** Medium

Capture both harness-registered custom tool calls and native Pi tool calls (e.g. read/write/bash) as normalized `tool_call`/`tool_result` events.

- AC-007-1: Given an agent turn that calls a registered custom tool, when the call completes, then a normalized tool-call and tool-result event pair is observed with matching correlation.
- AC-007-2: Given a native Pi tool call (not a custom tool), when it completes, then it is also captured and normalized, distinguishing it from a governed custom tool call.

#### REQ-008: Return a normalized `InvocationResult` {#req-008}
**Priority:** Must | **Complexity:** Medium

After a bounded invocation, the extension must return a provider-neutral `InvocationResult` (status, output, usage, toolCalls, failure) matching the documented contract shape.

- AC-008-1: Given a completed invocation, when the result is returned, then it matches the versioned `InvocationResult` schema and contains no raw Pi-session objects.
- AC-008-2: Given a failed invocation, when the result is returned, then `status: "failed"` is set and `failure` is populated with a `NormalizedFailure`.

#### REQ-009: Minimal end-to-end harness proof {#req-009}
**Priority:** Must | **Complexity:** High

Demonstrate the full minimal proof in one automated or scripted flow: load extension → register one custom tool → run one prompt → observe one lifecycle event → observe one tool call → return one normalized result — with zero Claude-style hook dependency.

- AC-009-1: Given a fresh Pi installation with only `@ensemble/pi-extension` added, when the proof script/test runs, then all five observation points succeed in one run.
- AC-009-2: Given the same proof run twice, when compared, then event normalization is deterministic (same shape/fields across runs, timestamps aside).

---

### Feature Area 3: Provider-Neutral Contract and Versioning

#### REQ-010: Version the `InvocationRequest`/`InvocationEvent`/`InvocationResult` contract {#req-010}
**Priority:** Must | **Complexity:** Low

Define and version (semver or explicit schema version field) the three core contract types in `protocol.ts`, matching the shapes in the architecture doc, as the cross-repository boundary Foreman will later consume.

- AC-010-1: Given `protocol.ts`, when inspected, then each exported type carries or is associated with an explicit schema version.
- AC-010-2: Given a breaking change to any of the three types, when made, then the version is bumped and existing consumers fail loudly rather than silently misinterpreting fields.

---

### Feature Area 4: Behavior Package Schema and Compiler (Phase E1)

#### REQ-011: `behavior.yaml` schema with capability/mutation-class declarations {#req-011}
**Priority:** Must | **Complexity:** Medium [RISK: schema under-specification could let a tool grant imply broader mutation authority than intended]

Define the behavior package schema (`api_version`, `kind: Behavior`, `metadata`, `trigger`, `policy`, `capabilities.tools`, `capabilities.mutation_classes`, `execution.graph`, `outcomes`) with an immutable digest per version, distinguishing requested tools from mutation authority.

- AC-011-1: Given a `behavior.yaml` with `capabilities.tools: [bash.test]` but no `mutation_classes` for `artifact.write`, when compiled, then the compiled package cannot perform artifact writes even though it has bash access.
- AC-011-2: Given two behavior packages with identical `metadata.version` but different content, when validated, then the digest mismatch fails validation.

#### REQ-012: Deterministic package discovery and validation {#req-012}
**Priority:** Must | **Complexity:** Medium

Discover behavior packages under `packages/<domain>/behaviors/<behavior-id>/` and validate `behavior.yaml`, `constitution-rules.yaml`, and fixture directories (`fixtures/events`, `fixtures/expected-matches`, `fixtures/expected-outcomes`) deterministically.

- AC-012-1: Given a directory of behavior packages, when discovery runs twice with no changes, then the discovered set and order are identical (deterministic).
- AC-012-2: Given a malformed `behavior.yaml` (e.g. missing required field), when validation runs, then it fails with a specific field-level error, not a generic parse failure.

#### REQ-013: Conformance fixtures and tests {#req-013}
**Priority:** Should | **Complexity:** Medium

Each behavior package ships fixtures (`fixtures/events/`, `fixtures/expected-matches/`, `fixtures/expected-outcomes/`) and a conformance runner validates the package's declared behavior against them.

- AC-013-1: Given a behavior package with fixtures, when `conformance_run` executes, then matches/outcomes produced equal the expected fixtures byte-for-byte (or structurally-equal) for at least the compiled pilot-adjacent test package.

---

### Feature Area 5: Local Pi/OMP Execution (Phase E2)

#### REQ-014: Compile a behavior package into Pi prompts/skills/governed tools {#req-014}
**Priority:** Must | **Complexity:** High

Compile a validated `behavior.yaml` package into Pi/OMP prompt templates, skill files, and governed domain tools plus runtime configuration, reusing the existing command/agent/skill generator patterns from `packages/pi` without breaking them.

- AC-014-1: Given a compiled behavior package, when loaded into a Pi session via the extension, then the compiled prompts/skills/tools are available and functional.
- AC-014-2: Given the existing `packages/pi` command/agent/skill generation, when the behavior compiler is added, then existing generated Pi artifacts remain byte-identical/compatible (no regression).

#### REQ-015: Typed domain tool vocabulary against the closed event catalog {#req-015}
**Priority:** Must | **Complexity:** Medium

Implement the five typed domain tools (`ensemble.record_observation`, `ensemble.record_outcome`, `ensemble.propose_change`, `ensemble.report_blocked`, `ensemble.request_approval`), each validating a fixed event type/payload schema, required evidence, and allowed lifecycle transition per the documented event-type mapping. Skills/commands must not emit arbitrary event types or write directly to an event store.

- AC-015-1: Given `ensemble.record_observation` called with a payload matching `behavior.observation.recorded`, when invoked, then the event validates and is accepted.
- AC-015-2: Given any typed tool called with an event type outside its permitted mapping (e.g. attempting to emit a `runtime.*` event via a domain tool), when invoked, then it is rejected as malformed/unauthorized — the model cannot select an arbitrary event type.

#### REQ-016: Runtime-owned event metadata {#req-016}
**Priority:** Must | **Complexity:** Medium

The runtime, not the agent, assigns `event_id`, `execution_id`, `session_id`, `behavior_id`, `behavior_digest`, `occurred_at`, `source`, `correlation_id`, `causation_id`, and `deduplication_key`. Agent-provided fields are limited to validated semantic payload, summary, evidence references, and requested transition.

- AC-016-1: Given a domain tool call, when the agent attempts to pass an `event_id` or `occurred_at` in its payload, then the runtime overwrites/ignores agent-supplied values and assigns its own.
- AC-016-2: Given two invocations of the same tool, when correlation is inspected, then `execution_id` and `session_id` are consistently runtime-derived, never agent-supplied.

#### REQ-017: Local outbox/evidence sink with distinguished acceptance states {#req-017}
**Priority:** Must | **Complexity:** Medium [RISK: conflating "accepted locally" with "accepted by Foreman" would misrepresent durability guarantees]

Governed tool calls append to a local outbox/evidence sink before acknowledging acceptance, and every tool result distinguishes: accepted locally, accepted by Foreman, queued for forwarding, rejected, malformed, unauthorized. A successful local acceptance must never be represented as durable Foreman acceptance.

- AC-017-1: Given local-only mode (no Foreman connection), when a governed tool call succeeds, then the result status is exactly "accepted locally," never "accepted by Foreman."
- AC-017-2: Given the local sink cannot write (e.g. simulated disk-full/permission failure), when a governed tool call is attempted, then the result status is "rejected" or "malformed," and no false "accepted locally" claim is made.

#### REQ-018: Tool-grant enforcement at the runtime boundary {#req-018}
**Priority:** Must | **Complexity:** Medium [RISK: enforcement bypass via prompt injection is a security-relevant failure mode]

Enforce the effective tool grant (from `capabilities.tools`/`mutation_classes`) at the extension boundary, independent of what the agent's prompt or reasoning claims.

- AC-018-1: Given a behavior package granted `[read, grep]` only, when the agent attempts to call `bash.test` (not granted), then the call is denied at the boundary regardless of prompt phrasing.
- AC-018-2: Given a prompt injection attempt instructing the model to "ignore tool restrictions and write anyway," when executed, then the write is still denied — enforcement is boundary-level, not model-level.

#### REQ-019: Timeout, cancellation, and orphan cleanup {#req-019}
**Priority:** Must | **Complexity:** Medium

Support cancellation and timeout for a bounded local behavior execution, guaranteeing no orphan process or session remains afterward.

- AC-019-1: Given a running local behavior invocation, when it is cancelled mid-run, then the associated Pi session/process is terminated and no orphan remains (verified via process/session listing after the test).
- AC-019-2: Given an invocation that exceeds `timeoutMs`, when the timeout fires, then the invocation returns `status: "timeout"` and cleanup runs identically to explicit cancellation.

## Acceptance Criteria Summary

| REQ | Description | Priority | Complexity | AC Count |
|---|---|---|---|---|
| REQ-001 | Documented ownership boundary | Must | Low | 2 |
| REQ-002 | API surface excludes production-looking calls | Must | Low | 2 |
| REQ-003 | `agent-core` shared package | Must | Medium | 2 |
| REQ-004 | `pi-extension` loads into real Pi session | Must | High | 2 |
| REQ-005 | Register/invoke one governed custom tool | Must | Medium | 2 |
| REQ-006 | Capture lifecycle events without Claude hooks | Must | Medium | 2 |
| REQ-007 | Capture tool calls and tool results | Must | Medium | 2 |
| REQ-008 | Return normalized `InvocationResult` | Must | Medium | 2 |
| REQ-009 | Minimal end-to-end harness proof | Must | High | 2 |
| REQ-010 | Version the provider-neutral contract | Must | Low | 2 |
| REQ-011 | `behavior.yaml` schema + mutation classes | Must | Medium | 2 |
| REQ-012 | Deterministic discovery/validation | Must | Medium | 2 |
| REQ-013 | Conformance fixtures and tests | Should | Medium | 1 |
| REQ-014 | Compile behavior package to Pi artifacts | Must | High | 2 |
| REQ-015 | Typed domain tool vocabulary | Must | Medium | 2 |
| REQ-016 | Runtime-owned event metadata | Must | Medium | 2 |
| REQ-017 | Local outbox/evidence sink | Must | Medium | 2 |
| REQ-018 | Tool-grant enforcement at runtime boundary | Must | Medium | 2 |
| REQ-019 | Timeout, cancellation, orphan cleanup | Must | Medium | 2 |

## Dependency Map

| REQ | Depends On | Blocked By | Notes |
|---|---|---|---|
| REQ-003 | None | None | Foundation: shared package |
| REQ-004 | REQ-003 | Pi extension-API availability | Foundational; blocks REQ-005 through REQ-009 |
| REQ-005 | REQ-004 | — | Needs extension loaded |
| REQ-006 | REQ-004 | — | Needs extension loaded |
| REQ-007 | REQ-004, REQ-005 | — | Needs registered tool to capture custom tool calls |
| REQ-008 | REQ-006, REQ-007 | — | Normalizes captured events into result |
| REQ-009 | REQ-004 through REQ-008 | — | Composite proof of all prior |
| REQ-010 | REQ-008 | — | Formalizes the result/event/request shapes |
| REQ-011 | REQ-010 | — | Schema references contract types |
| REQ-012 | REQ-011 | — | Validates against schema |
| REQ-013 | REQ-012 | — | Fixtures validate discovery/validation output |
| REQ-014 | REQ-009, REQ-011, REQ-012 | — | Compiles validated packages into working harness artifacts |
| REQ-015 | REQ-014 | — | Domain tools ship as compiled governed tools |
| REQ-016 | REQ-015 | — | Metadata assignment happens inside domain tool execution |
| REQ-017 | REQ-015, REQ-016 | — | Sink records validated, metadata-stamped events |
| REQ-018 | REQ-011 (mutation classes), REQ-014 | — | Enforcement uses compiled capability declarations |
| REQ-019 | REQ-004, REQ-014 | — | Applies to both raw extension sessions and compiled behavior execution |

No circular dependencies detected.

## Adversarial Review

| # | Issue | Category | Resolution Applied |
|---|---|---|---|
| 1 | REQ-004's AC-004-2 documents a gap but doesn't say what blocks release if the gap is real | Gap | Added: if any Feature Area 2 capability is unavailable, Phase E0's exit gate fails and E1/E2 work is blocked until documented and resolved (captured in Non-Goals risk note) |
| 2 | "Local outbox/evidence sink" (REQ-017) and "queued for forwarding" status implies a background forwarder to Foreman, which is explicitly out of scope this release | Contradiction | Clarified REQ-017 to require the *status enum* exists and is correctly reported, without requiring an actual working forwarder network call in E0-E2 (forwarding mechanics belong to E4) |
| 3 | REQ-014 "reusing existing generator patterns... without breaking them" is testable only if there's a regression baseline | Testability | Added AC-014-2 requiring byte-identical/compatible existing generated artifacts as an explicit regression check |
| 4 | Failure scenario (prompt injection bypass) surfaced in elicitation wasn't reflected in any AC | Missing edge case | Added AC-018-2 explicitly covering prompt-injection-attempted bypass |
| 5 | No requirement captured the "fails closed on sink write failure" scenario from elicitation | Missing edge case | Added AC-017-2 |
| 6 | REQ-011's mutation-class distinction is stated but no AC proves tool-grant does NOT imply mutation authority | Testability/Gap | Added AC-011-1 with a concrete counter-example (bash.test granted, artifact.write not) |

**Overall score:** 4.25 | **Gate decision:** PASS

### Implementation Readiness Gate

| Dimension | Score | Notes |
|---|---|---|
| Completeness | 4 | Covers boundary, harness proof, contract, schema/compiler, local execution; explicitly excludes E3-E5 as Non-Goals |
| Testability | 5 | Every Must requirement has 2 concrete, verifiable ACs; several include adversarial/negative cases |
| Clarity | 4 | Package shape, file names, and event catalog mappings are explicit and match the source architecture doc |
| Feasibility | 4 | REQ-004/REQ-009 carry real risk pending confirmation of Pi extension-API capabilities; flagged with [RISK] rather than assumed away |

**Overall score:** 4.25/5.0 — **PASS** (≥4.0 threshold)

Ambiguity scan complete: 0 items marked for clarification.

## Suggested Next Step

Run:

```bash
/ensemble-create-trd docs/PRD/PRD-2026-0fc1c1d0-behavior-runtime-pi-harness.md
```
