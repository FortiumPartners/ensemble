# Superseded: Ensemble and Foreman Behavior Runtime Plans

This combined plan has been replaced because Ensemble and Foreman are separate repositories with separate ownership boundaries.

Use these repository-local plans instead:

- [Ensemble Behavior Runtime and Pi/OMP Harness](./ensemble-behavior-runtime-plan.md)
- [Foreman Behavior Control Plane](./foreman-behavior-control-plane-plan.md)

## Split decision

```text
Ensemble
  behavior definitions, validation, packaging, simulation,
  TypeScript Pi/OMP harness, local execution

Foreman
  durable event ingestion, activation, policy, execution,
  recovery, causal history, approvals, operator control

Pi/OMP
  agent loop and invocation substrate
```

The current implementation must not be interpreted as a completed Pi/OMP integration merely because it supports generated artifacts or a hook-based observer path. Hooks are optional compatibility transports. Native Pi support requires the TypeScript Ensemble extension described in the Ensemble plan. A thin launcher is optional for Foreman-owned sessions; neither plan calls for a replacement Pi agent loop or a Pi fork unless an extension-API gap is demonstrated.

Elixir remains the recommended language for Foreman’s durable control plane. TypeScript is the recommended language for the Pi extension, shared agent integration package, and optional thin launcher distributed through npm.

## Event-model scope

The behavior system is not limited to test monitoring. The supported lifecycle model spans:

```text
product requirements
  -> technical requirements/design
  -> implementation
  -> review
  -> validation
  -> release
  -> learning and constitution evolution
```

The canonical event families include:

```text
prd.*
trd.*
implementation.*
trd.implementation.*
review.*
validation.*
release.*
learning.*
constitution.*
test.*
repository.*
pull_request.*
```

Examples include `prd.created`, `prd.refined`, `trd.created`, `trd.approved`, `implementation.started`, `implementation.completed`, `trd.implementation.completed`, `review.changes_requested`, `validation.completed`, `release.proposed`, and `learning.observation.recorded`. Test events are one specialized family within this broader lifecycle model.

See the event catalogs in the repository-local Ensemble and Foreman plans for producer ownership, typed custom-tool mappings, external ingress mappings, schemas, and durable control-plane transitions.
