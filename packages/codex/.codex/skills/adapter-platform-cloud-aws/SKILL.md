---
name: adapter-platform-cloud-aws
description: AWS CLI `platform-cloud` toolchain adapter (TRD-2026-8d825f54 TRD-044). Loaded by the toolchain resolver, not invoked directly by name. Shipped default platform-cloud adapter.
---

# AWS CLI Platform-Cloud Adapter

This is a `platform-cloud`-only toolchain adapter (`adapter: aws`), the shipped default for the
`platform-cloud` category (`packages/development/toolchain/toolchain.default.yaml`), selectable
explicitly by setting `platform-cloud: aws` in `toolchain.yaml`. A skill directory, not a
command: the toolchain resolver (`packages/development/lib/toolchain/adapters.js#loadAdapter`)
loads `adapter.yaml` and runs its capabilities through `packages/development/lib/toolchain/
runner.js#runCapability`.

Backing tool: the `aws` CLI, following this package's own `skills/aws/SKILL.md` conventions
(`AWS_PROFILE`/SSO auth, confirm the account with `aws sts get-caller-identity` first, least-
privilege IAM). `aws` is not installed in this environment, so no capability below was executed
live.

## Vocabulary

- `platform-cloud.get-resource`: read an EC2 instance's status (`aws ec2 describe-instances --instance-ids <resource> --output json`)
- `platform-cloud.deploy-service`: roll a new task definition out to an ECS service (`aws ecs update-service --service <service> --task-definition <image> --force-new-deployment --output json`)

Required environment variable (`env:`): `AWS_PROFILE` -- the real, documented way the `aws` CLI
selects a named profile for non-interactive auth.

## Manifest

`adapter.yaml` declares `categories: [platform-cloud]` only, `contract: {platform-cloud:
"1.0"}`. `detect: []` -- shipped DEFAULT for `platform-cloud`, not remote-detected, per TRD
interpretation I2 (same convention as `adapter-workflow-plain-git`).

`binaries: [aws]`. `allowlist: [{bin: aws, sub: ["ec2 describe-instances", "ecs
update-service", "sts get-caller-identity", "--version"]}]` -- the first two back the wired
capabilities below; `sts get-caller-identity` backs the `aws-identity-reachable` health check;
`"--version"` exists purely so the `aws-installed` health check passes `validateAllowlist`.

## Known limits

- **`platform-cloud.get-resource` only reaches EC2 instances.** The `aws` CLI has no single
  generic "describe any resource" verb -- every AWS service has its own `describe-*`/`get-*`/
  `list-*` subcommands shaped around that service's own resource model. `ec2
  describe-instances` was picked as one concrete, real, documented read call; `resource` is
  interpreted as an EC2 instance id. A caller needing an S3 bucket's status, an RDS instance's
  status, etc. cannot reach it through this capability as declared.
- **`platform-cloud.deploy-service`'s `image` input is interpreted as a task-definition
  identifier, not a raw container image reference.** `aws ecs update-service` has no flag that
  accepts a container image directly -- an ECS service's running containers are always driven by
  a task definition (`family:revision` or a full ARN), which is itself the artifact that
  references a container image. This is the closest real, documented ECS deploy primitive to the
  category contract's generic `image` input, not a literal image-reference passthrough.
- **Neither capability was executed live.** `aws` is not installed in this environment and
  `platform-cloud.deploy-service` is side-effecting; both run templates are grounded in the
  `aws` CLI's own real, documented flags and response shapes (`aws ec2 describe-instances
  help`, `aws ecs update-service help`), not a captured live run.
