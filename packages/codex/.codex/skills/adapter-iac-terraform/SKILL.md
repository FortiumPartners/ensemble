---
name: adapter-iac-terraform
description: Terraform `iac` toolchain adapter (TRD-2026-8d825f54 TRD-044). Loaded by the toolchain resolver, not invoked directly by name. Shipped default iac adapter.
---

# Terraform IaC Adapter

This is an `iac`-only toolchain adapter (`adapter: terraform`), the shipped default for the
`iac` category (`packages/development/toolchain/toolchain.default.yaml`), selectable explicitly
by setting `iac: terraform` in `toolchain.yaml`. A skill directory, not a command: the toolchain
resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads `adapter.yaml` and
runs its capabilities through `packages/development/lib/toolchain/runner.js#runCapability`.

Backing tool: `terraform`, following this package's own `skills/aws/SKILL.md` conventions
(non-interactive `-input=false` flow, no unreviewed auto-apply). `terraform` is not installed in
this environment, so no capability below was executed live.

## Vocabulary

- `iac.plan`: compute a change plan without applying it (`terraform plan -input=false -no-color`)
- `iac.apply`: apply infrastructure changes (`terraform apply -input=false -auto-approve`)
- `iac.destroy`: tear down infrastructure (`terraform destroy -input=false -auto-approve`)

## Manifest

`adapter.yaml` declares `categories: [iac]` only, `contract: {iac: "1.0"}`. `detect: []` --
shipped DEFAULT for `iac`, not remote-detected, per TRD interpretation I2 (same convention as
`adapter-workflow-plain-git`); this also makes `terraform` the one legitimate `iac` adapter a
future `UNKNOWN_ADAPTER` error can name.

`binaries: [terraform]`. `allowlist: [{bin: terraform, sub: [plan, apply, destroy, version]}]`
-- `version` exists purely so the `terraform-installed` health check passes
`validateAllowlist`. `env: []` -- Terraform itself reads no single named credential env var;
provider credentials (AWS, GCP, Azure, ...) are each configured provider's own concern.

## Known limits

- **`-auto-approve` on `apply`/`destroy` is required, not merely convenient.** Without it (and
  without `-input=false`), both commands prompt interactively on stdin for a "yes" confirmation
  before mutating/destroying infrastructure -- a child process spawned with no stdin
  (`runner.js#runCapability`, `execFile`, no pty) can never answer that prompt; the call would
  hang until this adapter's own timeout killed it without ever actually applying/destroying
  anything. This means `preflight.js`'s health-check gate (`PREFLIGHT_REQUIRED` before any
  `sideEffect: true` capability) is the only safety gate standing between a caller and a real,
  unreviewed infrastructure mutation -- there is no manifest-level "show me the plan first"
  confirmation step inside this adapter itself.
- **`workspace` is unreferenced on all three capabilities.** Each assumes it is invoked with the
  process's cwd already set to the target Terraform root module (the same "caller must already
  be positioned correctly" convention `adapter-workflow-plain-git#workflow.branch-create`
  discloses for its own unreferenced `baseBranch`). Terraform's own `-chdir=<dir>` global flag
  must appear BEFORE the subcommand (`terraform -chdir=<dir> plan`), which would put a
  `${workspace}` placeholder in `argv[1]` -- breaking `validateAllowlist`/
  `denyRuntimeAllowlist`'s positional subcommand-word match, which expects the literal
  subcommand word immediately after the binary. There is no way to honor this input without
  that breakage, so it is left disclosed-unreferenced rather than silently mis-wired.
- **No capability declares a `parse` block; `status`/`changes` are never populated.**
  `terraform plan`/`apply`/`destroy`'s own human-readable summaries (ending e.g. "Plan: N to
  add, M to change, K to destroy.") have no regex/string-split primitive in `mapping.js`'s
  dotted-path grammar to extract into `status`/`changes` without a `-json` flag (which emits an
  NDJSON line stream `mapping.js`'s grammar has no multi-line-decode primitive for) -- the raw
  command output is returned as `data` instead of a fabricated shape.
- **No capability was executed live.** `terraform` is not installed in this environment and
  `iac.apply`/`iac.destroy` are side-effecting (and destroy irreversible); every run template is
  grounded in `terraform`'s own real, documented flags (`terraform plan/apply/destroy -help`),
  not a captured live run.
