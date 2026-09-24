# Ensemble Behavior Runtime and Pi/OMP Harness

- **Status:** Proposed
- **Date:** 2026-09-24
- **Repository:** Ensemble
- **Primary local runtime:** Pi/OMP
- **Harness language:** TypeScript
- **Durable orchestration:** Not owned by Ensemble; see the separate Foreman plan

## 1. Decision

Ensemble is the portable behavior-definition, packaging, validation, and local agent-harness project. It must not become a durable production scheduler or activation coordinator.

Ensemble owns:

- versioned behavior definitions;
- event patterns and deterministic predicates;
- policy declarations and capability requirements;
- behavior composition and reusable guidance;
- constitution and learning artifacts as package inputs/outputs;
- validation, fixtures, simulation, and conformance tests;
- Pi/OMP packaging and the local Pi/OMP harness;
- provider-neutral request/result schemas shared with Foreman;
- governed custom tools for semantic event emission, proposals, outcomes, and control requests.

Ensemble does **not** own:

- durable production event ingestion;
- durable activation decisions;
- deduplication leases or cooldown state;
- production retries, recovery, or execution scheduling;
- durable causal history;
- approval enforcement for production mutations;
- a second dispatcher competing with Foreman.

The governing boundary is:

```text
Ensemble = describe, validate, package, simulate, and locally run behavior
Foreman  = activate, govern, schedule, execute, recover, and audit production behavior
Pi/OMP   = provide the agent loop and invocation substrate
```

## 2. Runtime decision: TypeScript extension first, not an Elixir harness

The Pi/OMP-facing integration must be implemented in TypeScript and distributed through the Node/npm ecosystem. The first implementation is a Pi extension, not a fork of Pi and not a replacement agent loop. Elixir remains appropriate for Foreman’s durable control plane, but it is not the implementation language for the local interactive integration.

Reasons:

- Pi/OMP APIs and extension points are TypeScript-native.
- The daily-driver workflow must not require a separately installed BEAM runtime.
- npm distribution provides the lowest-friction installation and upgrade path.
- A TypeScript extension uses Pi’s native tool, command, and lifecycle APIs directly.
- A TypeScript package avoids a second process/API boundary merely to control Pi/OMP.
- Interactive sessions need direct access to streaming lifecycle events, custom tools, steering, cancellation, and session state.
- An Elixir release can be distributed, but it adds platform packaging, runtime, release, and debugging complexity without improving the Pi/OMP integration.

The extension package may expose a thin launcher or stable stdio/JSON-RPC protocol for Foreman-owned sessions. That protocol is the boundary; Foreman must not import TypeScript implementation details.

Do not fork or modify Pi unless a concrete extension-API gap is demonstrated. Any Pi modification must first be documented as a minimal upstreamable change or an explicitly maintained compatibility patch.

## 3. Hooks are optional compatibility transports

Hooks must not be the primary integration contract.

The existing hook-based observer path may remain as an optional adapter for runtimes that support hooks, including Claude-style environments. It must not be required for Pi/OMP behavior support.

The following is explicitly non-functional as a Pi/OMP integration by itself:

```text
Pi/OMP artifacts + Claude-style hook configuration
```

Generated prompts, skills, agents, and `AGENTS.md` files change agent guidance, but they do not install a Pi/OMP event bridge. A hook-based observer only works when the host runtime actually invokes that hook.

## 4. Ensemble Pi extension and thin session adapter

The first implementation target is an Ensemble TypeScript package containing a Pi extension. The extension is used directly by the daily-driver Pi session. A thin launcher/session adapter is added only when Foreman needs to start and own a fresh session.

The extension is responsible for integration with Pi; it does not reimplement Pi’s agent loop. If OMP exposes a compatible extension API, add a thin OMP adapter over the shared Ensemble event/tool core. Keep Pi/OMP-specific types inside their respective adapters.

### Required capabilities

The extension/package must:

1. load into a Pi session through the supported extension mechanism;
2. register one or more governed custom tools;
3. pass an invocation request into the agent loop;
4. capture lifecycle events without relying on Claude hooks;
5. capture tool calls and tool results;
6. expose typed tools for semantic events, observations, outcomes, proposals, and control requests;
7. route events to a local sink or Foreman protocol sink;
8. enforce the effective tool grant at the runtime boundary;
9. support cancellation and timeout cleanup;
10. normalize provider-specific events into provider-neutral records;
11. return normalized completion, failure, usage, and tool-call results;
12. expose a local daily-driver extension/package interface.

The initial proof must be small and real:

```text
load Ensemble extension into Pi
  -> register one custom tool
  -> run one prompt
  -> observe one lifecycle event
  -> observe one tool call
  -> return normalized result
```

Do not build the Elixir activation runner first. Do not treat an arbitrary Elixir function callback as an agent-runtime adapter. Do not build a replacement Pi agent loop before testing the extension API.

### Suggested package shape

```text
packages/agent-core/
├── src/
│   ├── tools.ts
│   ├── domain-tools.ts
│   ├── events.ts
│   ├── event-sinks.ts
│   ├── normalize.ts
│   └── protocol.ts
└── package.json

packages/pi-extension/
├── src/
│   ├── extension.ts
│   ├── session.ts
│   └── pi-events.ts
└── package.json

packages/omp-adapter/       # only if OMP compatibility is proven
packages/session-launcher/  # thin Foreman-owned launcher, if needed
```

Names are illustrative. Shared event/tool/protocol code belongs in `agent-core`; Pi/OMP-specific types remain inside their adapters. The extension is the primary daily-driver integration. A launcher is an optional process boundary for Foreman-owned sessions, not a replacement agent runtime.

### Local usage

The package must support a low-friction direct mode, for example:

```text
pi --extension @ensemble/pi-extension
ensemble-pi doctor
ensemble-pi serve --stdio
```

The exact commands may differ, but the daily-driver path must not require Foreman to be running. A launcher is optional for Foreman-owned sessions; it is not required for direct interactive Pi use.

## 5. Governed custom tools and semantic events

Custom tools are the primary explicit event-emission mechanism for behaviors running in Pi/OMP. They are registered by the Ensemble extension and replace reliance on host-specific hooks for semantic progress. Harness-generated lifecycle events come from the extension’s Pi lifecycle subscriptions, not from a replacement agent loop.

The event model has two distinct classes:

```text
Harness-generated events
  session started, prompt submitted, tool called, tool completed,
  session failed, cancelled, timed out, process exited

Agent-invoked domain tools
  observations, diagnoses, outcomes, proposals, approvals,
  blocked states, and child-behavior requests
```

The agent may report semantic content, but the runtime owns authoritative metadata. Agents must not choose event IDs, execution IDs, timestamps, actors, approval state, capabilities, or delivery claims.

### Initial tool vocabulary

Start with a small typed set:

```text
ensemble.record_observation
ensemble.record_outcome
ensemble.propose_change
ensemble.report_blocked
ensemble.request_approval
```

A generic `ensemble.emit_event` may exist internally, but behavior skills and commands should prefer typed domain wrappers. Each wrapper validates a fixed event type and payload schema, required evidence, and allowed lifecycle transition. Skills must not emit arbitrary event types or write directly to an event store.

### Event sinks

The same tool interface must support both local and Foreman-backed execution:

```text
local mode:
  governed tool -> validate -> local outbox/evidence sink -> local matcher or simulation

Foreman mode:
  governed tool -> validate -> versioned protocol sink -> Foreman ingress
```

The local sink is a delivery buffer and evidence mechanism, not a second durable Foreman event store. It must append before acknowledging acceptance and should support forwarding when Foreman becomes available.

Tool results must distinguish:

```text
accepted locally
accepted by Foreman
queued for forwarding
rejected
malformed
unauthorized
```

A successful local acceptance must not be represented as durable Foreman acceptance.

### Event metadata

Runtime-owned fields include:

```text
event_id, execution_id, session_id, behavior_id, behavior_digest,
occurred_at, source, correlation_id, causation_id, deduplication_key
```

Agent-provided fields are limited to validated semantic payload, summary, evidence references, and requested transition. Every emitted event remains subject to normal schema and capability validation.

### Supported event catalog

The event catalog is intentionally closed and versioned. A skill, command, or agent cannot invent an event type by passing a new string to a generic emitter. New event types require a schema, source classification, producer, allowed transitions, capability requirement, and conformance fixtures.

#### Harness lifecycle events

These are emitted by the TypeScript harness and cannot be claimed by the agent:

```text
runtime.session.started
runtime.prompt.submitted
runtime.tool_call.started
runtime.tool_call.completed
runtime.message.emitted
runtime.session.completed
runtime.session.failed
runtime.session.cancelled
runtime.session.timed_out
runtime.process.exited
```

#### Semantic behavior events

These are emitted through typed domain tools and contain agent-reported observations or requested transitions. The catalog is intentionally broad enough to describe the software/product lifecycle; test monitoring is only one event family.

```text
behavior.observation.recorded
behavior.outcome.recorded
behavior.blocked
behavior.unblocked
behavior.completed
behavior.abandoned
child_behavior.requested
approval.requested
change.proposed

prd.created
prd.refined
prd.approved
prd.deprecated

trd.created
trd.refined
trd.approved
trd.deprecated

implementation.started
implementation.progressed
implementation.blocked
implementation.completed
implementation.abandoned

trd.implementation.started
trd.implementation.progressed
trd.implementation.completed

review.requested
review.completed
review.changes_requested

validation.requested
validation.completed

release.proposed
release.approved
release.completed

learning.observation.recorded
constitution.proposed
```

The `trd.implementation.*` aliases are retained for clarity when the implementation is explicitly linked to a TRD. A producer must choose the canonical form defined by the schema; aliases must not create duplicate facts for the same transition.

Test and repository events are specialized lifecycle families rather than the behavior model itself:

```text
test.failure.observed
test.failure.investigated
test.passed
test.regression_detected
repository.changed
repository.branch.created
pull_request.proposed
pull_request.opened
pull_request.updated
```

The typed tools map to this catalog as follows:

```text
ensemble.record_observation  -> behavior.observation.recorded
                               prd.created | prd.refined
                               trd.created | trd.refined
                               implementation.progressed
                               test.failure.observed | test.failure.investigated
                               review.completed | validation.completed
ensemble.record_outcome      -> behavior.outcome.recorded
                               test.passed | implementation.completed
                               trd.implementation.completed
                               release.completed
ensemble.propose_change      -> change.proposed
                               prd.refined | trd.refined
                               constitution.proposed | release.proposed
ensemble.report_blocked      -> behavior.blocked | behavior.unblocked
                               implementation.blocked
ensemble.request_approval    -> approval.requested
                               prd.approved | trd.approved | release.approved
```

The wrapper, not the model, selects the permitted event type based on the tool schema and context. Tools must carry the relevant artifact identity, version/digest, lifecycle transition, evidence references, and parent/causation information. Terminal events require explicit runtime support and must not be exposed merely because a prompt mentions them.

#### Event support rules

- `runtime.*` events are harness-owned facts.
- `behavior.*`, `prd.*`, `trd.*`, `implementation.*`, `review.*`, `validation.*`, `release.*`, `learning.*`, `test.*`, `repository.*`, and `pull_request.*` events are typed semantic requests or observations.
- Local mode may record the full catalog, but only the local runner may execute supported local transitions.
- Foreman mode may accept the catalog only after normal ingress validation and policy evaluation.
- Unknown, deprecated, or context-incompatible event types fail closed.
- Event schemas are versioned independently from behavior packages.
- Every event type declares whether it is informational, state-transitioning, proposal-producing, or control-plane-only.

The catalog is a starting set, not permission to emit arbitrary domain events. Product lifecycle events may be emitted locally by Ensemble when the relevant artifact and evidence are present; external facts such as GitHub, CI, Jira, or deployment events belong to Foreman’s ingress catalog and are documented in the Foreman plan. A semantic event should describe a fact or requested transition, not merely an agent message.

## 6. Provider-neutral contract

The harness must translate between Pi/OMP-native concepts and a provider-neutral contract. The contract should include at least:

```ts
type InvocationRequest = {
  executionId: string;
  prompt: string;
  context: Record<string, unknown>;
  tools: ToolGrant[];
  worktree?: WorktreeSpec;
  model?: string;
  timeoutMs: number;
  attempt: number;
};

type InvocationEvent = {
  executionId: string;
  kind: "started" | "progress" | "tool_call" | "tool_result" | "message" | "failed" | "completed";
  occurredAt: string;
  payload: Record<string, unknown>;
};

type InvocationResult = {
  executionId: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  output: string;
  usage?: Usage;
  toolCalls: ToolCallRecord[];
  failure?: NormalizedFailure;
};
```

The final schema is a cross-repository contract and must be versioned. It must not expose raw Pi/OMP sessions as Ensemble or Foreman domain state.

## 7. Behavior package format

Preserve existing command, agent, and skill formats while adding behavior packages.

```text
packages/<domain>/behaviors/<behavior-id>/
├── behavior.yaml
├── prompts/
├── skills/
├── fixtures/
│   ├── events/
│   ├── expected-matches/
│   └── expected-outcomes/
├── constitution-rules.yaml
└── README.md
```

Example:

```yaml
api_version: ensemble.sunstone.dev/v1
kind: Behavior
metadata:
  name: investigate-test-failure
  version: 1.0.0
trigger:
  event_type: test.failed
  predicate:
    command: { matches: "npm test|mix test|pytest|go test" }
    exit_code: { not: 0 }
policy:
  mode: propose
  timeout: 30m
capabilities:
  tools: [read, grep, glob, bash.test, git.diff]
  mutation_classes: [artifact.write, pr.open, constitution.propose]
execution:
  graph: investigate-test-failure
outcomes:
  - test.failure.investigated
  - constitution.change.proposed
```

The schema must distinguish requested tools from mutation authority. A tool grant never implies unrestricted authority over every mutation reachable through that tool.

## 8. Ensemble APIs and boundaries

Preferred Ensemble responsibilities:

```text
compile(definition)
validate(package)
match(event, catalog)
simulate(event, options)
shadow_record(event, matches)
conformance_run(definition, fixtures)
export(package, target)
```

The following must not be production-looking Ensemble APIs:

```text
start_durable_activation(...)
dispatch_production_behavior(...)
```

A local runner may exist, but it must be explicit and named as local/simulation-only, for example `LocalRunner` or `Simulator`. It must not claim durability, recovery, or Foreman ownership.

In particular, Ensemble must not execute an arbitrary zero-arity function as a substitute for governed Pi/OMP invocation. Any local execution path must use the same explicit invocation/tool boundary as the TypeScript harness or be clearly marked as a test fixture.

## 9. Hook adapter

Implement hooks only as an optional event-source adapter:

```text
host hook
  -> local event adapter
  -> normalized event
  -> Ensemble matcher or Foreman ingress
```

The adapter must:

- be disabled when the host does not support hooks;
- never be required for native Pi/OMP operation;
- normalize events into the shared envelope where possible;
- clearly identify the source and capability limitations;
- avoid implying that hook observation equals runtime control.

## 10. Delivery plan

### Phase E0 — Boundary and harness proof

- Freeze the Ensemble/Foreman ownership boundary.
- Record that the current Elixir activation runner is not the Pi/OMP adapter.
- Build the TypeScript proof: one session, one governed custom tool, one semantic event, one lifecycle event, and one normalized result.
- Prove local event acceptance through an outbox/evidence sink without Foreman.
- Prove operation with native Pi/OMP without Claude hooks.
- Define and version the provider-neutral protocol.

**Exit gate:** a real Pi/OMP session is controlled and observed by the TypeScript harness without host hooks.

### Phase E1 — Behavior schema and compiler

- Add behavior schema, semantic/API versions, and immutable digest.
- Add deterministic package discovery and validation.
- Add capability and mutation-class declarations.
- Preserve existing command/agent/skill generation.
- Add fixtures and conformance tests.

### Phase E2 — Local Pi/OMP execution

- Compile a behavior package into Pi/OMP prompts, skills, governed domain tools, and runtime configuration.
- Implement typed wrappers for observation, outcome, proposal, blocked, and approval requests.
- Keep harness lifecycle events separate from agent-emitted semantic events.
- Execute one bounded local behavior through the TypeScript harness.
- Enforce tool grants at the custom-tool boundary.
- Normalize lifecycle, tool, usage, failure, and completion records.
- Support timeout, cancellation, and orphan cleanup.

### Phase E3 — Optional hook compatibility

- Retain or repair hook-based event sources where useful.
- Test hook and native Pi/OMP sources against the same normalized event contract.
- Keep hook support explicitly optional.

### Phase E4 — Foreman integration contract

- Publish the versioned stdio/JSON-RPC protocol.
- Add a client/server contract test.
- Do not add durable activation, leases, retries, or approval state to Ensemble.
- Coordinate implementation with the separate Foreman plan.

### Phase E5 — Pilot package

Start with one narrow local behavior:

```text
test.failed -> investigate-test-failure -> bounded Pi/OMP run -> proposal
```

The local pilot must end in an evidence-backed proposal and must not silently mutate a constitution, behavior definition, or policy.

## 11. Tests and acceptance criteria

- Existing generated Pi artifacts remain compatible.
- A native Pi/OMP session works without Claude hooks.
- One governed custom tool can be registered and invoked.
- Typed domain tools validate payloads and cannot emit arbitrary event types.
- Agent-emitted events receive runtime-owned identity and causality metadata.
- Local event acceptance uses an outbox/evidence sink and distinguishes queued from Foreman-accepted delivery.
- Foreman-backed event delivery uses the versioned protocol sink.
- Tool denial cannot be bypassed by prompt text.
- Lifecycle and tool events normalize deterministically.
- Timeout and cancellation leave no orphan process/session.
- Provider-specific types do not leak from the harness protocol.
- Local simulation produces no external mutations by default.
- Behavior matching is deterministic without an agent invocation.
- Invalid tools, mutation classes, event schemas, and runtime features fail clearly.
- No Ensemble test depends on a durable Foreman event store.
- No Ensemble module claims ownership of durable activation or recovery.

## 12. Non-goals

- Building a durable scheduler in Ensemble.
- Reimplementing Foreman’s event store, activation ledger, leases, or recovery.
- Making hooks universal across agent runtimes.
- Treating agent-emitted events as trusted activation decisions.
- Allowing skills or commands to write directly to a local or Foreman event store.
- Making generated prompt artifacts equivalent to runtime integration.
- Embedding arbitrary behavior code in the matcher.
- Requiring an Elixir runtime for the Pi/OMP daily driver.
- Removing existing command, agent, or skill formats during the first migration.
