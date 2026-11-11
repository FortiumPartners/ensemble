---
name: adapter-e2e-quality-playwright
description: Playwright/Lighthouse-CI `e2e-quality` toolchain adapter (TRD-2026-8d825f54 TRD-043, PRD REQ-006). Loaded by the toolchain resolver, not invoked directly by name. Shipped default e2e-quality adapter.
---

# Playwright E2E Quality Adapter

This is an `e2e-quality`-only toolchain adapter (`adapter: playwright`), the shipped default for
the `e2e-quality` category (`packages/development/toolchain/toolchain.default.yaml`). A skill
directory, not a command: the toolchain resolver
(`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads `adapter.yaml` and runs its
capabilities through `packages/development/lib/toolchain/runner.js#runCapability`.

Backing tools: `npx playwright test` (end-to-end runs and, via `@axe-core/playwright`'s
`AxeBuilder`, accessibility audits -- see `writing-playwright-tests`/`a11y-perf-checks` skills in
this same package) and `npx @lhci/cli autorun` (performance budget checks).

## Vocabulary

- `e2e-quality.run-e2e`: run Playwright end-to-end tests against `target` (`npx playwright test <target>`)
- `e2e-quality.audit-performance`: run a Lighthouse CI budget check (`npx @lhci/cli autorun`) -- `target` is not referenced, see "Known limits"
- `e2e-quality.audit-accessibility`: run an axe-equipped Playwright spec at `target` -- a disclosed alias of `run-e2e`, see "Known limits"
- Binaries: `npx`
- Env: none

## Manifest

`adapter.yaml` declares `categories: [e2e-quality]` only, `contract: {e2e-quality: "1.0"}`.

`detect: []` -- `playwright` is the shipped DEFAULT for `e2e-quality`, not remote-detected, per
TRD interpretation I2 (same convention `adapter-workflow-plain-git`/`adapter-tracker-beads` use).

`binaries: [npx]`. `allowlist: [{bin: npx, sub: ["playwright test", "playwright --version",
"@lhci/cli autorun", "--version"]}]`.

## Known limits

- **No `parse` block on any capability.** Playwright's default console reporter and `@lhci/cli
  autorun`'s own output are both human-readable text with no single machine-parseable
  success/fail scalar this engine's dotted-path grammar (`mapping.js`) could extract without a
  `--reporter=json` flag this adapter does not add (adding one, and the shape it would need to
  map, is unverified against a real run -- see "never executed live" below). `status`/`report`
  (each capability's two declared outputs) are left unmapped; the raw stdout is returned as
  `data`, the same disclosed convention `adapter-workflow-plain-git`'s `workflow.push` uses.
- **`e2e-quality.audit-performance`'s `target` input is not referenced.** Lighthouse CI's own
  `autorun` reads its target URL(s) from a `lighthouserc.*` config file, not a CLI positional
  argument (confirmed via `@lhci/cli autorun --help`'s own documented flags) -- the same
  disclosed "declared input, not referenced by this run template" convention
  `adapter-workflow-plain-git`'s `workflow.branch-create` uses for `baseBranch`.
- **`e2e-quality.audit-accessibility` is a disclosed alias of `run-e2e`, not a separate
  mechanism.** axe-core has no standalone CLI; an accessibility audit IS a Playwright test run
  (via `@axe-core/playwright`'s `AxeBuilder`, per `a11y-perf-checks/SKILL.md`), so this
  capability's run template is identical to `run-e2e`'s -- a caller distinguishes an
  accessibility audit only by pointing `target` at an axe-equipped spec file, the same
  "disclosed alias" convention `adapter-workflow-plain-git`'s `workflow.propose` (an alias of
  `workflow.push`) uses.
- **Never executed live.** `@playwright/test` and `@lhci/cli` are not installed anywhere in
  this repository (`packages/e2e-testing/package.json` lists `playwright` only in `keywords`,
  not `devDependencies`) and no `lighthouserc.*` config exists -- there is no installed,
  configured target this bead could run either tool against. Every `run[]` template above is
  grounded in the real, documented CLI usage from `writing-playwright-tests/SKILL.md` and
  `a11y-perf-checks/SKILL.md`, not fabricated flags.
