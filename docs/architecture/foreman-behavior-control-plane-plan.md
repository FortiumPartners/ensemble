# Foreman Behavior Control Plane

- **Status:** Proposed
- **Date:** 2026-09-24
- **Repository:** Foreman
- **Primary runtime:** Elixir/OTP
- **Agent backend:** Provider-neutral AgentRuntime, including the Ensemble TypeScript Pi/OMP harness
- **Related document:** Ensemble behavior runtime and Pi/OMP harness plan

## 1. Decision

Foreman is the one durable production behavior coordinator. It owns event ingestion, activation, policy admission, execution, recovery, causal history, approvals, and operator control.

Foreman consumes versioned behavior packages produced by Ensemble. It must not become a behavior-authoring monolith, and Pi/OMP-specific concepts must not leak through Foreman’s domain model.

Foreman owns:

- event ingestion and normalization, including events emitted by governed Ensemble tools;
- behavior catalog loading and immutable execution snapshots;
- behavior matching at the durable control-plane boundary;
- activation decisions and deduplication;
- cooldowns, leases, budgets, retries, and concurrency;
- causal roots, parent/child relationships, and recursion limits;
- execution graphs and integration with existing runs/workers/worktrees/slots;
- approval and mutation governance;
- provider-neutral agent dispatch;
- projections, dashboards, reconciliation, and operator controls.

Foreman does not own:

- the source authoring experience for behavior packages;
- Pi/OMP session internals;
- hook-specific configuration;
- npm packaging or the local Pi/OMP daily-driver CLI;
- raw provider session state;
- direct ownership of Ensemble skills, commands, or custom-tool implementations.

## 2. One coordinator rule

For a Foreman deployment there must be exactly one durable behavior coordinator: Foreman.

```text
external event
  -> Foreman ingress
  -> durable activation decision
  -> Foreman execution
  -> AgentRuntime adapter
  -> provider-specific harness
```

Ensemble may compile, validate, simulate, and package behavior. The Ensemble local harness may run explicit local work. Neither may independently activate durable Foreman behavior.

A local supervised function runner, audit ledger, or hook observer is not a substitute for Foreman’s durable activation ledger.

## 3. Domain model

```text
Behavior.Definition       validated immutable package snapshot
Behavior.Event            normalized event envelope
Behavior.Activation       durable match/admission decision
Behavior.Execution        durable attempt and lifecycle record
Behavior.PolicyDecision   activate, suppress, block, or require approval
Behavior.Proposal         reviewable mutation proposal
Behavior.Budget           token, time, fan-out, and tool limits
Behavior.CausalLink       parent/child relationship
Behavior.Deduplication    stable idempotency and cooldown state
```

Recommended modules:

```text
ForemanServer.Behavior.Catalog
ForemanServer.Behavior.EventNormalizer
ForemanServer.Behavior.Matcher
ForemanServer.Behavior.Policy
ForemanServer.Behavior.Activator
ForemanServer.Behavior.ExecutionGraph
ForemanServer.Behavior.Reconciler
ForemanServer.Behavior.Proposal
ForemanServer.Behavior.Projector
```

The subsystem must use Foreman’s existing command gateway and event store. It must not introduce a second event database or write projections directly.

## 4. Event envelope

All behavior-triggering events must use a stable versioned envelope:

```elixir
%{
  event_id: binary(),
  event_type: binary(),
  occurred_at: DateTime.t(),
  source: binary(),
  project_id: binary() | nil,
  subject_id: binary(),
  payload: map(),
  schema_version: pos_integer(),
  correlation_id: binary() | nil,
  causation_id: binary() | nil,
  actor: %{type: atom(), id: binary() | nil},
  deduplication_key: binary()
}
```

The event ID identifies one fact. The deduplication key identifies semantically equivalent triggers. They must not be conflated.

Events emitted by Ensemble custom tools are input claims, not trusted activation decisions. Foreman must validate their schema, source, execution context, capability, authorization, causation, and delivery status before they can affect behavior state.

A tool call may request or report a state transition; only Foreman may authorize and commit that transition. Tool emission never directly activates behavior or grants mutation authority.

Matching must be driven from committed events, not pre-commit broadcasts. Missed notifications must be recoverable through replay or boot reconciliation.

## 5. Activation and policy

Every eligible match must produce an auditable decision:

```text
activated | suppressed | blocked | rejected | failed
```

Activation must enforce:

- stable deduplication;
- behavior, subject, and project cooldowns;
- project/subject/behavior concurrency limits;
- causal root, parent, depth, and fan-out limits;
- budgets before dispatch;
- explicit approval requirements;
- fail-closed catalog, policy, lease, and capability resolution;
- validation and authorization of agent-emitted domain events;
- separation of local acceptance, queued forwarding, and durable Foreman acceptance.

The activation record must include at least:

- event ID and deduplication key;
- behavior ID, version, and digest;
- policy decision and reason;
- causal root and parent activation;
- lease/ownership information;
- execution identity;
- retry attempt;
- terminal outcome.

No activation path may dispatch arbitrary code merely because a matcher found a definition. No activation path may bypass policy evaluation.

## 6. AgentRuntime boundary

Retain `ForemanServer.AgentRuntime` as the only public invocation boundary.

The runtime request is provider-neutral:

```elixir
%{
  execution_id: binary(),
  prompt: binary(),
  context: map(),
  tools: [tool_id()],
  worktree: worktree_spec() | nil,
  model: model_alias() | nil,
  timeout_ms: pos_integer(),
  attempt: pos_integer()
}
```

The runtime result contains only normalized output, status, usage metadata, structured tool/outcome records, and normalized failure information.

### Pi/OMP extension adapter

Implement:

```elixir
ForemanServer.AgentRuntime.Adapters.PiOmpAdapter
```

This adapter communicates with the Ensemble TypeScript Pi extension package, or with its thin session launcher when Foreman owns a fresh session, through the versioned stdio/JSON-RPC protocol. It must not embed Pi/OMP types in aggregates, projections, behavior definitions, or workflow manifests. Foreman must not require a Pi fork or replacement agent loop.

The adapter must support:

- provider readiness checks;
- model alias mapping;
- Foreman tool-grant mapping;
- lifecycle and tool-event normalization;
- timeout and cancellation propagation;
- orphan process/session cleanup when using the optional launcher;
- normalized failure codes;
- capability reporting;
- correlation of every event to the Foreman execution.

The adapter does not depend on Claude hooks. Hooks, when available, are an external event-source compatibility path, not the Pi extension contract.

The adapter must surface both classes of events separately:

```text
harness-generated:
  session, prompt, tool-call, tool-result, failure, timeout, cancellation

agent-emitted:
  observation, outcome, proposal, blocked, approval request, child request
```

Agent-emitted events must retain runtime-owned execution/session/behavior metadata and must be treated as untrusted input until Foreman validates and commits them. A local Ensemble acceptance or outbox acknowledgement is not durable Foreman acceptance.

Keep the Jido Harness adapter operational until Pi/OMP parity is measured.

## 7. Tools and governance

Tools must be registered through a provider-neutral capability registry and resolved at execution time. Every tool declares:

- stable ID and version;
- read/write classification;
- required authority;
- supported contexts;
- input and output schemas;
- idempotency characteristics;
- side effects;
- cancellation behavior;
- audit fields;
- approval requirement.

A behavior requests capabilities; Foreman resolves effective grants from project policy, operator policy, and execution context. The Pi/OMP harness enforces the resulting grant at the custom-tool boundary.

Suggested mutation classes:

```text
read.repository
read.logs
execute.tests
write.artifact
write.source
vcs.commit
vcs.push
pr.open
pr.merge
constitution.propose
constitution.apply
behavior.propose
behavior.apply
policy.propose
policy.apply
```

A prompt must never expand tool authority. An unrecognized capability must fail closed.

### Ensemble event tools

The initial governed event-tool vocabulary is intentionally small:

```text
ensemble.record_observation
ensemble.record_outcome
ensemble.propose_change
ensemble.report_blocked
ensemble.request_approval
```

These tools are implemented and typed by Ensemble, then exposed to Foreman through the versioned AgentRuntime protocol. Foreman owns the authoritative event schema, authorization, deduplication, policy evaluation, and state transition. Skills and commands must not write directly to the Foreman event store or emit arbitrary event types.

Every tool declaration must identify:

- the semantic event type(s) it may request;
- payload schema and required evidence;
- allowed lifecycle transitions;
- required capability and authority;
- idempotency/deduplication behavior;
- side effects and approval requirements.

A tool result must distinguish accepted, rejected, malformed, unauthorized, queued, and committed. Foreman must not treat `accepted locally` or `queued for forwarding` as a committed domain event.

## 8. Supported event catalog

Foreman maintains the authoritative versioned event catalog. Ensemble’s harness catalog is the producer-facing subset; Foreman additionally owns external ingress events and durable control-plane events.

### Harness lifecycle events

These facts are emitted by the Pi/OMP harness and normalized by the AgentRuntime adapter:

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

### Ensemble semantic events

These are emitted through governed Ensemble tools and arrive as untrusted requests or observations. The catalog is intentionally lifecycle-oriented; test events are only one specialized family.

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

`trd.implementation.*` events are explicit contextual forms for implementation work linked to a TRD. The catalog must define whether they are aliases or distinct facts; duplicate facts for one transition are not allowed.

Foreman must validate the producer, execution context, behavior digest, capability, artifact identity and version/digest, payload schema, evidence references, allowed transition, and deduplication key for every semantic event. The agent cannot select an arbitrary event type through a generic emitter.

### Product lifecycle and external ingress events

Product lifecycle events are not limited to test execution. Foreman should support them whether they arrive from an Ensemble custom tool, a repository/document adapter, or an external system. The producer determines the trust and validation path; the canonical event vocabulary remains stable.

The initial product lifecycle families are:

```text
prd.*                 product requirements and product decisions
trd.*                 technical requirements and design decisions
implementation.*     implementation lifecycle
review.*              review lifecycle
validation.*         validation lifecycle
release.*             release lifecycle
learning.*            learning and feedback lifecycle
```

External adapters may normalize provider facts into these lifecycle events, for example a GitHub pull request review into `review.completed` or a CI result into `validation.completed`. The adapter must preserve provider identity in source metadata without leaking provider payloads into the canonical event name.

### External ingress events

The initial external catalog should include only events that have a defined adapter and replayable identity:

```text
source.github.issue.opened
source.github.issue.updated
source.github.pull_request.opened
source.github.pull_request.updated
source.github.pull_request.review_requested
source.github.check.completed
source.ci.run.failed
source.ci.run.passed
source.jira.issue.created
source.jira.issue.updated
source.deployment.failed
source.deployment.completed
source.schedule.fired
```

These names are canonical Foreman events; provider payloads remain inside ingress adapters and are normalized before matching.

### Durable control-plane events

Foreman owns the durable lifecycle events generated by activation and policy decisions:

```text
activation.matched
activation.activated
activation.suppressed
activation.blocked
activation.rejected
activation.lease_acquired
activation.lease_expired
activation.cancelled
execution.started
execution.progressed
execution.completed
execution.failed
execution.timed_out
execution.retry_scheduled
proposal.created
proposal.approved
proposal.rejected
mutation.applied
```

A semantic event such as `approval.requested` creates a proposal or approval workflow; it does not itself mean `proposal.approved` or authorize a mutation. Only Foreman commands and committed events may produce those durable control-plane transitions.

### Event catalog rules

- The catalog is closed and versioned.
- Every event declares its producer, schema version, source class, idempotency rules, and allowed transitions.
- Harness facts, semantic requests, external facts, and durable control-plane events remain distinct classes.
- Unknown, deprecated, unauthorized, or context-incompatible events fail closed.
- Event types are not inferred from free-form agent text.
- Adding an event requires schema, adapter/tool support, policy implications, projections, and conformance fixtures.

## 9. Execution substrate

Use Foreman’s existing run, phase, worker, worktree, slot, lease, retry, and projection machinery as the initial execution substrate.

Do not immediately replace `RunExecutor` with a generalized engine. Instead:

1. compile a behavior activation into an existing run/workflow;
2. persist behavior and causal metadata alongside the run;
3. add graph execution only where real behaviors require branching, parallelism, waiting, or child activation;
4. extract generalized graph scheduling only after the proven path exists.

Reuse `RunSlots`; do not introduce a second concurrency budget.

Retries must use a fresh worker/session and declared worktree semantics. Non-idempotent mutations are not automatically retried.

## 9. Constitution and mutation governance

A behavior may read a constitution when policy permits, identify a violated or missing rule, and produce an evidence-backed amendment proposal. It may not silently apply the change.

Every amendment proposal records:

- source behavior and version;
- triggering event;
- evidence references;
- proposed diff;
- approving actor;
- resulting constitution version;
- affected projects or behaviors;
- rollback/reversion information.

Constitution, behavior-definition, tool-policy, merge, and production-impacting mutations are approval-gated by default and remain blocked across restarts until approved.

## 10. Delivery plan

### Phase F0 — Contract and boundary ratification

- Adopt the separate Ensemble plan and this Foreman plan as repository-local sources of truth.
- Define the versioned behavior-package import contract.
- Define the normalized event envelope and AgentRuntime request/result protocol.
- Define the custom-tool event contract, trust boundary, delivery statuses, and local-outbox semantics.
- Confirm no Foreman domain module imports Pi/OMP or TypeScript types.
- Confirm existing task-to-run behavior remains unchanged.

**Exit gate:** a contract test can exchange one invocation request and normalized result with the TypeScript harness.

### Phase F1 — Event normalization and catalog

- Add `Behavior.Event` and codec.
- Map internal Foreman events to normalized envelopes.
- Accept and validate Ensemble custom-tool events as untrusted ingress.
- Preserve event source, execution, session, behavior digest, correlation, causation, and deduplication metadata.
- Load validated Ensemble packages into the catalog.
- Persist definition digest and source metadata.
- Retain immutable definition snapshots for active executions.
- Block invalid or unknown schema versions.

### Phase F2 — Durable activation ledger

- Implement deterministic matching.
- Ensure agent-emitted events cannot bypass activation policy or directly commit activation state.
- Implement activation commands/events/projections.
- Implement deduplication, cooldowns, concurrency, causal tracking, and policy decisions.
- Add leases and blocked/dead-letter states for resolution failures.
- Add replay and boot reconciliation.

**Exit gate:** duplicate event delivery creates one activation decision and every suppression/block is explainable.

### Phase F3 — Pi/OMP AgentRuntime adapter

- Implement `PiOmpAdapter` against the versioned TypeScript extension protocol.
- Prove the direct daily-driver Pi extension path before adding the optional Foreman-owned launcher.
- Map approved tool grants.
- Expose the initial governed Ensemble event-tool vocabulary through the protocol.
- Capture normalized lifecycle and tool results.
- Implement cancellation, timeout, readiness checks, and cleanup.
- Keep Jido tests and adapter behavior green.

**Exit gate:** a bounded Foreman execution runs through Pi/OMP without Claude hooks and provider-specific state does not leak into Foreman.

### Phase F4 — Behavior execution through existing runs

- Add behavior metadata to run/phase snapshots.
- Add activation-to-run dispatch.
- Reuse worktrees, run slots, workers, timeouts, retries, and logs.
- Add projections/API/MCP/dashboard views.
- Add behavior budgets before agent dispatch.
- Reconcile pending activations after restart.

### Phase F5 — Proposals and approvals

- Add proposal aggregate/events/projection.
- Add evidence references and regression-test requirements.
- Add approval, apply, reject, defer, and rollback transitions.
- Enforce mutation classes at command and tool boundaries.

### Phase F6 — Native graphs and child behaviors

- Extend the existing Foreman work graph design.
- Add behavior graph identity and node metadata.
- Enforce graph size, depth, fan-out, and deadline limits.
- Reuse run slots and add fair scheduling.
- Add dependency failure propagation and graph reconciliation.

### Phase F7 — Pilot and migration

Pilot behaviors:

1. `investigate-test-failure`;
2. `recover-stalled-run`;
3. `pr-review-remediation`;
4. `constitution-proposal`.

Start in shadow mode, then enable one behavior per project with explicit limits. Existing commands and workflows remain the rollback path until equivalence evidence exists.

## 11. Tests and acceptance criteria

- Replaying an event produces byte-equivalent normalized data.
- Invalid packages never enter the active catalog.
- Active executions retain their original definition snapshot.
- Duplicate delivery creates one activation.
- Cooldown, lease, causal-depth, fan-out, and budget limits are enforced.
- Policy failure blocks or suppresses; it never expands authority.
- Activation and execution transitions are replayable and projected.
- Restart during activation or dispatch reconciles to one execution.
- Pause, resume, cancel, retry, abandon, and inspect remain operator-controlled.
- Pi/OMP unavailable produces `backend_unavailable`.
- Timeout and cancellation leave no orphan process/session.
- Tool denial cannot be bypassed by prompt text.
- Agent-emitted event payloads cannot forge runtime-owned identity, causality, approval, authority, or delivery metadata.
- Local acceptance, queued forwarding, and durable Foreman commit are distinct statuses.
- Malformed or unauthorized custom-tool events fail closed and do not activate behavior.
- Provider-specific output does not leak through the public runtime result.
- Existing ungraphed task runs remain compatible.
- Jido remains operational until Pi/OMP parity is demonstrated.
- Approval-gated mutations remain blocked across restart.

## 12. Non-goals

- Moving behavior authoring and Pi/OMP packaging into Foreman.
- Making Foreman parse arbitrary TRDs into execution graphs.
- Embedding a Pi/OMP session implementation in Foreman’s domain model.
- Depending on Claude hooks for Pi/OMP execution.
- Treating Ensemble custom-tool events as trusted activation decisions.
- Allowing skills or commands to write directly to the Foreman event store.
- Replacing every existing workflow before behavior pilots prove value.
- Removing Jido before adapter parity is measured.
- Allowing arbitrary behavior code to execute in the matcher.
- Introducing a second event database or concurrency budget.

## 13. Definition of done

Foreman is ready for general behavior use when:

- it loads and snapshots a validated Ensemble behavior;
- Ensemble custom-tool events are validated, authorized, deduplicated, and committed through the same durable path as all other events;
- a committed normalized event produces one durable activation decision;
- duplicates, cooldowns, leases, recursion, budgets, and policy are enforced;
- an activation runs through the provider-neutral AgentRuntime boundary;
- Pi works through the TypeScript extension without host hooks;
- any Foreman-owned launcher remains a thin process adapter and does not replace Pi’s agent loop;
- existing Jido-backed workflows remain operational;
- the causal chain is visible in projections and operator views;
- proposals and mutations are approval-gated;
- restart, retry, cancellation, and reconciliation are tested;
- at least two pilots run in shadow mode and one runs opt-in active;
- measured cost and latency are acceptable relative to the existing baseline.
