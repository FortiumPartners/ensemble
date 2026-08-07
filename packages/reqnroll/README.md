# ensemble-reqnroll

Reqnroll + xUnit BDD binding layer for the Ensemble PRD → test pipeline.

## What it provides

- **`reqnroll-binding-specialist`** agent — fills auto-generated, `Pending()` Reqnroll
  step definitions with real arrange/act/assert bodies, **test-first** (outside-in),
  against the system under test. It never edits the generated `[Given/When/Then(@"…")]`
  attributes (the step-matching layer stays deterministic).
- **`skills/reqnroll/SKILL.md`** — Reqnroll + xUnit patterns: package set, `reqnroll.json`,
  `ScenarioContext` state-sharing, FluentAssertions, `WebApplicationFactory<Program>`
  integration, and the red→green test-first loop.

## Where it fits

```
PRD ──(deterministic, ensemble-product)──▶ .feature files                [/ensemble:generate-feature-tests]
 │
 ├──(deterministic, ensemble-product)──▶ Reqnroll/xUnit project + step STUBS   [/ensemble:generate-reqnroll-bindings]
 │                                            │
 │                                            └──(agentic, THIS plugin)──▶ filled step BODIES, test-first
 │
 ├── PRD ↔ .feature drift               [/ensemble:check-feature-drift]
 └── .feature ↔ bindings drift          [/ensemble:check-binding-drift]
```

The deterministic codegen lives in `@fortium/ensemble-product`
(`lib/reqnroll-{gen,run,cli}.js`). This package is the agentic half: the specialist
agent + the Reqnroll knowledge it loads.

## The one rule

Step-matching `[Given(@"…")]` attributes are **generated and authoritative**. Bindings
are filled by editing method **bodies only**. Wrong/missing attributes are drift
(`/ensemble:check-binding-drift`), never hand-edited.

## Orchestration

`/ensemble:reqnroll-tdd` runs the red-gated loop: scaffold → author binding (red gate)
→ implement (inner TDD) → green gate → review.
