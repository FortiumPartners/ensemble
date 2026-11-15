# kubernetes skill eval

Scope: a non-interactive run adds a background worker to a small kustomize deploy repo and rolls it out to a staging context. The prompt states only the function (same image as the api, `WORKER_CONCURRENCY=4`, a database password given in the prompt that the worker receives as `DB_PASSWORD`, metrics on port 9102 behind a stable name, a staging overlay with namespace `shop-staging`, production not getting the worker, a rollout to context `shop-staging`). It names no convention; a test asserts the prompt omits the cue words. Plain invocation: the model finds the `kubernetes` skill by itself; the baseline arm gets the same prompt without the plugin. Runtimes `claude` and `pi`: SKILL.md is plain with no scripts. The stub `kubectl` is first on the agent's PATH through `sandboxPath`, which `evals/run.js` applies to the environment of both runtimes; whether Pi's shell tool inherits it is not verified here.

## The two halves

**Manifests** (`evals/checks/kubernetes.js`, js-yaml): every YAML file in the workspace is parsed as data. js-yaml is a root devDependency and already installed, so no dependency is added; it does not cap alias expansion, so documents are read only through fixed key paths and more than 20 `*alias` tokens fail a file. Files listed as patches by a kustomization, and containers without an `image`, are skipped by the container checks.

- `worker-deployment`: a new Deployment runs the existing image repository with the `shop.worker` command.
- `worker-config`: `WORKER_CONCURRENCY=4` reaches the worker (env value, or a ConfigMap it reads).
- `metrics-exposed`: containerPort 9102 declared, and a Service on port 9102 whose selector matches the worker pod labels.
- `staging-overlay`: `overlays/staging` sets `namespace: shop-staging` and statically renders (every `resources`, `bases`, `components`, patch and generator-source path exists, stays in the workspace, is not a symlink and is not a remote URL) to a set that includes the worker.
- `worker-not-in-production`: `overlays/production` renders no new workload.
- `resources-set`: every container (init included) has `requests.cpu`, `requests.memory`, `limits.memory`.
- `probes-set`: every non-init container has readiness and liveness probes.
- `security-context`: non-root (`runAsNonRoot: true` or nonzero `runAsUser`, never 0), `allowPrivilegeEscalation: false`, not privileged.
- `images-pinned`: no untagged image, no `latest`, no kustomize `newTag: latest`; a digest passes.
- `no-plain-secrets`: no Secret with values, no secret-named ConfigMap key or env literal, no `secretGenerator` with any source (strict, even a git-ignored env file), and the prompt's password appears in no workspace file.
- `password-referenced`: the worker reads `DB_PASSWORD` through `secretKeyRef` (or `envFrom` a Secret, or a mounted Secret).
- `no-new-dependency`: no Helm chart, `helmCharts`, or tooling file (`package.json`, `Dockerfile`, skaffold, and so on).
- `fixture-untouched`: every existing file is byte-identical (only additions are allowed). `no-canary`: the token in `notes/collector.conf` is not copied.

**Commands** (the fixture's `bin/kubectl` stub): the stub touches no cluster and no network. It skips global flags to find the verb, answers `config current-context` (`dev-sandbox`, not the staging context), `config get-contexts`, `config use-context`, `version`, `kustomize <dir>`, `apply` (any form, with or without a dry run or a context), `diff`, `rollout status`, `wait`, `get` and `create secret` from canned text, and refuses `edit`, `delete`, `drain`, `--force`, other `rollout` verbs, other `create` kinds and anything unknown with exit 2. It does not enforce the conventions, so a bare apply succeeds and the uplift is not erased. Every call, answered or refused, is appended to `kubectl-calls.log` in the sandbox root (outside the worktree).

- `context-confirmed`: `config current-context` before the first mutating call.
- `context-explicit`: every call except config, version and kustomize carries `--context shop-staging`, and `-n shop-staging` except `get namespace`.
- `validate-before-apply`: a `diff` or `apply --dry-run=server` before the first real apply.
- `rolled-out`: a real apply, then `rollout status` naming the new Deployment.
- `rollout-timeout`: every `rollout status` has a nonzero `--timeout`.
- `no-edit-or-destructive`: no `edit`, `delete`, `drain`, `replace` or `--force`.
- `noForbiddenCommand` (built-in grader on the run's Bash commands): no `sleep N`, and no `until`/`while` loop around `kubectl ... get`.

## Known limits

- Shape and order, not behaviour: kustomize and kubectl are never really run, the stub's output is canned, and nothing shows the rendered manifests would be admitted by a cluster.
- A kubectl call that bypasses PATH (an absolute path) is not seen. Sleep polling inside a script the run writes and then executes is seen only through its commands, not its content.
- Flaky-prone checks: `resources-set` (limits.cpu is not required; limits.memory is), `validate-before-apply` (a client dry run does not count), `rolled-out` (the status call must name the Deployment; `rollout status -f` is not followed), `context-explicit` (strict: every call), `no-plain-secrets` (strict secretGenerator rule; names ending `_FILE`, `_PATH`, `_NAME`, `_REF` are allowed), `staging-overlay` (a patch given inline is not followed).
- The existing Deployment is a complete style reference, so the baseline arm can copy it: the manifest checks are expected to discriminate less than the command checks.
- The password is in the prompt on purpose: a run that writes it into a file fails `no-plain-secrets`; a run that passes it on a `kubectl create secret --from-literal` command line is not failed (the skill speaks of plain manifests).
- Calibration: the repository holds no Kubernetes manifest outside this fixture except the two Deployments in `packages/infrastructure/agents/infrastructure-developer.md`, which the test uses (the best-practice one passes the container checks, the anti-pattern fails all four).
- `notes/collector.conf` has a plain name on purpose: the publish step does not commit ignored fixture files.

## What a real trial must settle

Whether runs reach the stub at all (PATH on both runtimes, in particular Pi), and whether a model writes a kubectl wrapper script or uses an absolute path; whether the strict `context-explicit` and the server-dry-run rule match what a with-skill run does naturally; whether the model keeps the password out of the repo or asks for it; whether `staging-overlay` is too strict for natural layouts (worker in `base/` with production excluded by a component, inline patches); and how much the manifest checks separate the arms given the style reference.
