---
name: adapter-container-deploy-docker-kubectl
description: Docker+kubectl `container-deploy` toolchain adapter (TRD-2026-8d825f54 TRD-044). Loaded by the toolchain resolver, not invoked directly by name. Shipped default container-deploy adapter.
---

# Docker + kubectl Container-Deploy Adapter

This is a `container-deploy`-only toolchain adapter (`adapter: docker-kubectl`), the shipped
default for the `container-deploy` category (`packages/development/toolchain/
toolchain.default.yaml`), selectable explicitly by setting `container-deploy: docker-kubectl`
in `toolchain.yaml`. A skill directory, not a command: the toolchain resolver
(`packages/development/lib/toolchain/adapters.js#loadAdapter`) loads `adapter.yaml` and runs
its capabilities through `packages/development/lib/toolchain/runner.js#runCapability`.

Backing tools: `docker` (build) and `kubectl` (deploy), following this package's own
`skills/kubernetes/SKILL.md` conventions (declarative `apply`/`set image`, non-interactive
rollouts, pinned image tags). Neither binary is installed/reachable in this environment, so no
capability below was executed live.

## Vocabulary

- `container-deploy.build-image`: build a container image (`docker build -t <tag> <context>`)
- `container-deploy.deploy`: roll a built image out to a cluster deployment (`kubectl set image deployment/<target> <target>=<image> --record=false`)

## Manifest

`adapter.yaml` declares `categories: [container-deploy]` only, `contract: {container-deploy:
"1.0"}`. `detect: []` -- shipped DEFAULT for `container-deploy`, not remote-detected, per TRD
interpretation I2 (same convention as `adapter-workflow-plain-git`).

`binaries: [docker, kubectl]`. `allowlist: [{bin: docker, sub: [build, push, "--version"]},
{bin: kubectl, sub: ["set image", apply, version]}]` -- `build`/`set image` are wired below;
`push`/`apply` are declared but unwired (reserved for future push-only/manifest-apply
capabilities, the same "declared but unused" convention `adapter-host-github`'s own unused
`api` entry uses); `"--version"`/`version` exist purely so the two health checks pass
`validateAllowlist`. `env: []` -- neither binary reads a single named credential env var (docker
uses the ambient daemon socket/context, kubectl the ambient kubeconfig).

## Known limits

- **`container-deploy.build-image` never pushes the built image.** `run[]` is a single argv
  spawned once (never shell-interpreted, TRD-010), so `docker build ... && docker push ...`
  cannot be expressed as one template, and the category contract declares no separate
  registry/push input to drive a second internal step. A caller needing the image pushed to a
  registry must do so separately.
- **`container-deploy.deploy` assumes the deployment's container is named the same as the
  deployment itself.** `kubectl set image deployment/<target> <target>=<image>` reuses
  `${target}` for both the deployment name and the container name inside it (the common
  single-container-per-deployment convention) -- `kubectl set image` has no "update every
  container" wildcard, and the category contract declares no separate `container` input. A
  multi-container deployment whose container name differs from the deployment name cannot be
  targeted through this capability as declared.
- **`container-deploy.deploy`'s `url` output is never populated.** `kubectl set image` reports
  only that the rollout was accepted, never an externally reachable URL (that would come from a
  Service/Ingress this capability never queries).
- **Neither capability was executed live.** Both are side-effecting (a real image build, a real
  cluster mutation) and no Docker daemon or reachable Kubernetes context exists in this
  environment; their run templates are grounded in `docker`/`kubectl`'s own real, documented
  flags (`docker build --help`, `kubectl set image --help`), not a captured live run.
