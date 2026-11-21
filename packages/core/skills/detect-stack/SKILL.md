---
name: detect-stack
description: Detect a project's framework, test runner, infrastructure tooling and cloud provider with weighted multi-signal confidence scoring, so the matching technology skills (react, jest, helm, aws, ...) can be loaded. Use at task start, before writing framework, test, infrastructure or cloud code.
---

# detect-stack

Detect a project's technology stack in one call: its **framework**, **test runner**, **infrastructure tooling** and **cloud provider**. Every answer carries a confidence score and the signals behind it, and names the skill to load next.

## Quick Reference

**When to use**: at task start, before loading framework, test, infrastructure or cloud skills, or whenever you need to know which technology a project uses.

| Axis | Question it answers | Detector names |
|------|---------------------|----------------|
| `framework` | Which application framework? | `nestjs`, `react`, `phoenix`, `rails`, `dotnet`, `blazor` |
| `test` | Which test runner(s)? | `jest`, `pytest`, `rspec`, `xunit`, `exunit` |
| `tooling` | Which infrastructure tooling? | `helm`, `kubernetes`, `kustomize`, `argocd`, `flyio` |
| `cloud` | Which cloud provider? | `aws`, `gcp`, `azure` |

Detector names are skill names: load `skills/<name>/SKILL.md` for the detected name. Exceptions: `kustomize` is covered by the `kubernetes` skill, and `argocd`, `gcp` and `azure` have no dedicated skill (use cloud-agnostic guidance).

## Usage

### CLI

```bash
node skills/detect-stack/detect-stack.js [project-path] --axis=<axis> [options]
```

`project-path` defaults to the current directory. `--axis` is one of `framework`, `test`, `tooling`, `cloud` or `all` (the default).

| Option | Applies to | Meaning |
|--------|------------|---------|
| `--axis=<axis>` | all | Axis to run (`--axis <axis>` also works) |
| `--framework=<name>` | framework | Manual override, skips detection (`nestjs`, `react`, `phoenix`, `rails`, `dotnet`, `blazor`) |
| `--provider=<name>` | cloud | Manual override (`aws`, `gcp`, `azure`) |
| `--tools=<a,b>` | tooling | Only evaluate these tools |
| `--min-confidence=<n>` | tooling, cloud | Detection threshold, `0 < n <= 1` (default 0.7) |
| `-h`, `--help` | all | Print usage |

Exit codes: `0` something detected, `1` nothing detected (JSON is still printed), `2` usage or runtime error (message on stderr, nothing on stdout). Errors are: unknown axes, options, override names and tool names, a bad `--min-confidence` value, a project path that is not a directory, and an unreadable or invalid patterns file. The API rejects with the same messages.

```bash
node skills/detect-stack/detect-stack.js --axis=framework .          # framework of the current directory
node skills/detect-stack/detect-stack.js /path/to/project --axis=test
node skills/detect-stack/detect-stack.js --axis=tooling --tools=helm,kubernetes .
node skills/detect-stack/detect-stack.js --axis=cloud --provider=aws .
node skills/detect-stack/detect-stack.js .                           # every axis at once
```

### JavaScript API

```javascript
const { detect } = require('./skills/detect-stack/detect-stack');

const framework = await detect('framework', '/path/to/project');
console.log(framework.primary);      // "react"
console.log(framework.confidence);   // 2.36
console.log(framework.results);      // detected candidates, best first

const tooling = await detect('tooling', '/path/to/project', { tools: ['helm'], minimumConfidence: 0.8 });
const everything = await detect('all', '/path/to/project');
```

Options mirror the CLI flags: `framework`, `skipDetection` (framework), `provider` (cloud), `tools` and `useCache` (tooling), `minimumConfidence` (tooling, cloud).

## Output envelope

Every axis prints the same JSON shape:

```jsonc
{
  "axis": "tooling",
  "detected": true,
  "primary": "helm",
  "confidence": 0.89,
  "threshold": 0.7,
  "results": [
    {
      "name": "helm",
      "display_name": "Helm",
      "confidence": 0.89,
      "signals": { "chart_yaml": true, "values_yaml": true, "templates_dir": true, "cli": false, "config": false },
      "signal_count": 3,
      "description": "Kubernetes package manager",   // tooling-specific, see below
      "high_confidence": false                        // tooling-specific, see below
    }
  ],
  "all_results": [
    // the same entry shape for helm, kubernetes, kustomize, argocd and flyio, best first
  ]
}
```

| Field | Meaning |
|-------|---------|
| `axis` | The axis that produced the result |
| `detected` | `true` when `results` is not empty |
| `primary` | `results[0].name`, or `null` when nothing was detected |
| `confidence` | Confidence of `primary`, `0` when nothing was detected |
| `threshold` | Minimum confidence to appear in `results`. `null` on the `test` axis, where any signal counts |
| `results` | Candidates that meet the axis's detection rule, best first |
| `all_results` | Every candidate evaluated, best first, including those below the threshold or with no signal. Use it to see how close a miss was |

Every entry of `results` and `all_results`:

| Field | Meaning |
|-------|---------|
| `name` | Detector name (`react`, `jest`, `helm`, `aws`, ...), the same as the skill name |
| `display_name` | Human-readable name (`React`, `Jest`, `Helm`, `Amazon Web Services (AWS)`) |
| `confidence` | Score for this candidate (see the axis sections for the formula) |
| `signals` | Signal name to boolean: which evidence was found |
| `signal_count` | Number of `true` signals |

Axis-specific entry fields:

| Axis | Extra fields |
|------|--------------|
| `framework` | `details`: per fired signal `{ matches, weight, score }` |
| `test` | `language`, `version`, `config_files`, `test_directory`, `test_pattern` |
| `tooling` | `description`, `high_confidence` (a signal of weight 0.7 or more fired) |
| `cloud` | none |

Optional top-level flags: `manual_override: true` (an override flag was applied; the single result has confidence 1 and empty `signals`), `skipped: true` (framework `skipDetection`), `message` (test axis, nothing detected).

`--axis=all` prints `{ "axis": "all", "detected": <any axis detected>, "axes": { "framework": {...}, "test": {...}, "tooling": {...}, "cloud": {...} } }`, each value being a full envelope.

Parsing with `jq`:

```bash
node skills/detect-stack/detect-stack.js --axis=cloud . | jq -r '.primary'               # aws, gcp, azure or null
node skills/detect-stack/detect-stack.js --axis=tooling . | jq -r '.results[].name'      # every detected tool
node skills/detect-stack/detect-stack.js --axis=test . | jq -r '.results[0].version'     # version of the primary runner
```

## Framework

Multi-signal detection with confidence scoring for six frameworks: NestJS, React, Phoenix, Rails, .NET / ASP.NET Core and Blazor. Run it before loading a framework skill.

```bash
node skills/detect-stack/detect-stack.js /path/to/project --axis=framework
```

### Detection signals

| Signal | Weight | What is checked |
|--------|--------|-----------------|
| Package manager | 10 | `package.json` dependencies (dev dependencies count), `Gemfile` gems, `mix.exs` dependencies, `*.csproj` PackageReferences and SDKs |
| Files | 7 to 9 | Framework config and layout files. Required files count double, optional files once. Wildcards such as `*.csproj` are supported |
| Imports | 7 to 8 | Regex patterns over source files (up to 20 files; `node_modules`, `dist`, `build`, `vendor` ignored) |
| Boost factors | x1.2 to x1.6 | Strong indicators multiply the confidence |

Some package signals need more than one match: NestJS and Phoenix require 2 (`minMatches`), the others 1.

What each framework looks for:

```text
NestJS    @nestjs/core, @nestjs/common in package.json; nest-cli.json exists;
          @Module and @Controller decorators in .ts files
React     react, react-dom in package.json; .jsx or .tsx files exist;
          useState or useEffect, createRoot in code
Phoenix   {:phoenix, in mix.exs; config/config.exs exists;
          Phoenix.Endpoint, Phoenix.Router in .ex files
Rails     gem 'rails' in Gemfile; config/application.rb exists;
          Rails.application, ActiveRecord::Base in code
.NET      Microsoft.AspNetCore in .csproj; Program.cs exists;
          [ApiController] in .cs files, using Microsoft.AspNetCore
Blazor    Microsoft.AspNetCore.Components in .csproj; .razor files exist;
          @page directive in .razor files, ComponentBase in code
```

Boost factors (multiplied together when present): NestJS `nest-cli.json` x1.5, `@Module(` x1.3, `@Controller(` x1.2; React JSX/TSX files x1.4, `useState`/`useEffect` x1.3, `createRoot` x1.2; Phoenix `Phoenix.Endpoint` x1.5, `Phoenix.Router` x1.3, `Phoenix.LiveView` x1.4; Rails `config/application.rb` x1.5, `config/routes.rb` x1.3, `ActiveRecord::Base` x1.2; .NET `Program.cs` x1.4, `[ApiController]` x1.3, `Microsoft.EntityFrameworkCore` x1.2; Blazor `.razor` files x1.6, `@page` x1.4, `ComponentBase` x1.3.

### Confidence

```text
confidence = sum(matches x weight) / (3 x sum of the framework's signal weights) x boost factors
```

A framework is reported when its confidence reaches the threshold of **0.8**, and at most 3 candidates are returned (the primary plus two alternates). Confidence is not capped at 1.0: matches beyond the assumed 3 per signal and boost factors can push it above 1.

| Confidence | Interpretation |
|------------|----------------|
| 0.9 and above | Very high |
| 0.8 to 0.9 | High |
| 0.6 to 0.8 | Medium (below the threshold, so not reported; visible in `all_results`) |
| below 0.6 | Low |

### Overrides and edge cases

- `--framework=<name>` skips detection and returns that framework with confidence 1.0 and `manual_override: true`. An unknown name is an error that lists the valid ones.
- Nothing detected: `primary: null`, `confidence: 0`, `results: []`.
- Monorepos: several frameworks can pass the threshold. The first is `primary`; the rest are in `results` after it.

```json
{ "axis": "framework", "detected": true, "primary": "react", "confidence": 2.36, "threshold": 0.8,
  "results": [ { "name": "react" }, { "name": "nestjs" } ] }
```

### Performance

Imports are sampled from at most 20 files and each boost check searches at most 10. Common build and dependency directories are ignored. Detection of a typical project takes well under a second.

### Loading the matching skill

```javascript
const { detect } = require('./skills/detect-stack/detect-stack');

async function frameworkSkillPath(projectRoot) {
  const result = await detect('framework', projectRoot);
  if (!result.detected) {
    return null; // ask the user, or pass --framework
  }
  if (result.confidence < 0.9) {
    console.warn(`Medium confidence for ${result.primary}; alternates: ${result.results.slice(1).map(r => r.name)}`);
  }
  return `skills/${result.primary}/SKILL.md`;
}
```

## Test runners

Identify which test runner(s) a project uses by examining package manifests (`package.json`, `requirements.txt`, `Gemfile`, `*.csproj`, `mix.exs`), test configuration files, and directory structure and naming conventions. Agents such as `deep-debugger` run it before generating or executing tests, then load the matching test skill (`jest`, `pytest`, `rspec`, `xunit`, `exunit`).

```bash
node skills/detect-stack/detect-stack.js /path/to/project --axis=test
DEBUG=true node skills/detect-stack/detect-stack.js . --axis=test    # diagnostics on stderr
```

Test-axis entries add these fields to the common ones:

```json
{
  "name": "jest",
  "display_name": "Jest",
  "language": "JavaScript/TypeScript",
  "confidence": 0.95,
  "signals": { "configFile": true, "packageDependency": true, "testDirectory": true, "testFiles": true },
  "signal_count": 4,
  "version": "29.7.0",
  "config_files": ["jest.config.js"],
  "test_directory": "tests",
  "test_pattern": "**/*.test.js"
}
```

### Supported runners

| Runner | Config files | Dependency indicators (file) | Test directories | Test files |
|--------|--------------|------------------------------|------------------|------------|
| Jest (JavaScript/TypeScript) | `jest.config.js`, `.ts`, `.mjs`, `.cjs`, `.json` | `jest`, `@types/jest`, `ts-jest`, `babel-jest` (`package.json`) | `tests`, `test`, `__tests__`, `src/__tests__` | `*.test.*`, `*.spec.*` (js, ts, jsx, tsx), `__tests__/**` |
| pytest (Python) | `pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini` | `pytest`, `pytest-cov`, `pytest-mock`, `pytest-asyncio` (`requirements.txt`, `requirements-dev.txt`, `pyproject.toml`, `setup.py`) | `tests`, `test` | `test_*.py`, `*_test.py`, `tests/**/*.py` |
| RSpec (Ruby) | `.rspec`, `spec/spec_helper.rb`, `spec/rails_helper.rb` | `rspec`, `rspec-core`, `rspec-rails`, `rspec-mocks` (`Gemfile`, `Gemfile.lock`) | `spec` | `*_spec.rb`, `spec/**/*.rb` |
| xUnit (C#/.NET) | `xunit.runner.json` | `xunit`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk`, `xunit.core` (`*.csproj`, `*.sln`) | `Tests`, `Test`, `tests`, `test` | `*Tests.cs`, `*Test.cs`, `Tests/**/*.cs` |
| ExUnit (Elixir) | `test/test_helper.exs`, `mix.exs` | `ex_unit`, `{:ex_unit`, `ExUnit` (`mix.exs`, `mix.lock`) | `test` | `test/**/*_test.exs`, `**/*_test.exs` |

### Confidence

Per runner, summed and capped at 1.0:

| Signal | Weight | Counted |
|--------|--------|---------|
| Config file present | +0.4 | first config file found only |
| Package dependency found | +0.3 | `version` is extracted when the file format allows it, otherwise `"unknown"` |
| Test directory exists | +0.2 | first directory found only |
| Test files found | +0.1 | any file matching a test pattern; `test_pattern` is the runner's first pattern |

There is no minimum threshold on this axis: every runner with confidence above 0 is reported, best first, so `results` can hold several entries (for example Jest and pytest in a monorepo). A bare `test/` directory alone gives pytest, xUnit and ExUnit 0.2 each. Pick `primary`, or compare `confidence`.

### Using the result

1. Run the test axis for the project path.
2. Read `primary` (and `results[0].version`).
3. Load the matching skill (`skills/<primary>/SKILL.md`: `jest`, `pytest`, `rspec`, `xunit` or `exunit`).
4. Generate or execute tests with that skill's patterns.

When nothing is detected, `results` is empty and `message` reads `No test framework detected. Please specify framework manually.`

## Tooling

Automatic detection of infrastructure and DevOps tooling by multi-signal analysis: **Helm** (Kubernetes package manager), **Kubernetes** (container orchestration), **Kustomize** (configuration customization), **ArgoCD** (GitOps delivery) and **Fly.io** (platform as a service).

Use it to auto-load tooling skills (`helm`, `kubernetes`, `flyio`), to analyze the tooling stack of an existing project, or for dynamic skill loading in CI/CD.

```bash
node skills/detect-stack/detect-stack.js /path/to/project --axis=tooling                       # every tool
node skills/detect-stack/detect-stack.js /path/to/project --axis=tooling --tools=helm          # one tool
node skills/detect-stack/detect-stack.js /path/to/project --axis=tooling --min-confidence=0.8  # stricter
```

### Detection signals

Signals are scored by weight. The content signals (`api_version`, `kind_field`, `application_yaml`, `cli`, `fly_cli`, `fly_domain`) match regular expressions against file contents.

| Tool | Signal | Weight | Evidence |
|------|--------|--------|----------|
| Helm | `chart_yaml` | 0.6 | `Chart.yaml` |
| | `values_yaml` | 0.3 | `values.yaml` |
| | `templates_dir` | 0.2 | `templates/` directory |
| | `cli` | 0.2 | root `*.sh` containing `helm install`, `upgrade`, `rollback`, `template`, `lint`, `package`, `dependency` |
| | `config` | 0.1 | `.helmignore`, `requirements.yaml`, `Chart.lock` |
| Kubernetes | `api_version` | 0.5 | root `*.yaml` with `apiVersion: v1`, `apps/v1`, `batch/v1`, `networking.k8s.io/v1`, `policy/v1` or `rbac.authorization.k8s.io/v1` |
| | `kind_field` | 0.4 | root `*.yaml` with `kind:` Deployment, Service, Pod, StatefulSet, DaemonSet, Job, CronJob, Ingress, ConfigMap, Secret, PersistentVolume, PersistentVolumeClaim, ServiceAccount, Role, RoleBinding, ClusterRole, ClusterRoleBinding, NetworkPolicy |
| | `kustomization` | 0.3 | `kustomization.yaml` or `.yml` |
| | `cli` | 0.2 | root `*.sh` containing `kubectl apply`, `get`, `describe`, `delete`, `create`, `exec`, `logs`, `port-forward` |
| | `config` | 0.2 | `.kube/config`, `kubeconfig`, or a `k8s/` entry |
| | `manifests_dir` | 0.1 | `k8s/`, `kubernetes/` or `manifests/` directory |
| Kustomize | `kustomization_yaml` | 0.7 | `kustomization.yaml` or `.yml` |
| | `cli` | 0.3 | root `*.sh` containing `kustomize build`, `kubectl apply -k`, `kubectl kustomize` |
| ArgoCD | `application_yaml` | 0.6 | root `*.yaml` with `kind: Application` or `apiVersion: argoproj.io/v1alpha1` |
| | `cli` | 0.3 | root `*.sh` containing `argocd app`, `argocd sync`, `argocd login` |
| | `config` | 0.2 | `argocd/` directory |
| Fly.io | `fly_toml` | 0.7 | `fly.toml`, found within 3 path levels (`fly.toml`, `a/fly.toml`, `a/b/fly.toml`) |
| | `fly_cli` | 0.15 | root `*.sh`, `*.yml`, `*.yaml` containing `fly deploy`, `launch`, `scale`, `secrets`, `regions`, `status`, `logs`, `ssh`, `machine`, `redis`, or `flyctl deploy`, `launch` |
| | `fly_domain` | 0.1 | `*.toml`, `*.yaml`, `*.yml`, `*.json`, `.env*`, `config.env` (within 5 path levels) containing `.fly.dev`, `.fly.io`, `fly_app_name`, `FLY_APP_NAME`, `FLY_API_TOKEN`, `FLY_REGION` |
| | `dockerfile_flyio` | 0.05 | a root `Dockerfile` (existence only) |

Root-level means the project directory itself, not its subdirectories. A manifest in `k8s/deployment.yaml` does not trigger `api_version` or `kind_field` (only the `k8s/` directory signals fire), and a script in `scripts/deploy.sh` does not trigger a `cli` signal. `fly_domain` is the one content signal that searches subdirectories.

### Confidence

```text
confidence = sum of detected signal weights / sum of all the tool's signal weights
             + 0.1 when at least 3 signals are detected, capped at 1.0
```

A tool is reported at confidence 0.7 or more (`--min-confidence` changes this). Examples: a Helm chart with `Chart.yaml`, `values.yaml` and `templates/` scores (0.6 + 0.3 + 0.2) / 1.4 + 0.1 = 0.89; adding a `helm upgrade` script gives (0.6 + 0.3 + 0.2 + 0.2) / 1.4 = 0.93, plus the boost, capped at 1.0. `Chart.yaml` and `values.yaml` alone (0.64, no boost) are not enough. A lone `fly.toml` scores exactly 0.7 and is detected.

Tooling entries add `description` and `high_confidence` (a signal of weight 0.7 or more fired, which only `kustomization_yaml` and `fly_toml` can do).

### Using the result

```bash
TOOLING=$(node skills/detect-stack/detect-stack.js --axis=tooling /path/to/project)

if echo "$TOOLING" | jq -e '.results[] | select(.name=="helm")' > /dev/null; then
  cat skills/helm/SKILL.md
fi
if echo "$TOOLING" | jq -e '.results[] | select(.name=="kubernetes")' > /dev/null; then
  cat skills/kubernetes/SKILL.md
fi
```

```javascript
const { detect } = require('./skills/detect-stack/detect-stack');

const result = await detect('tooling', projectPath);
for (const tool of result.results) {
  console.log(`${tool.display_name}: ${(tool.confidence * 100).toFixed(0)}%`, tool.signals);
}
```

### Example projects

Helm chart:

```text
my-chart/
  Chart.yaml           chart_yaml
  values.yaml          values_yaml
  templates/           templates_dir
    deployment.yaml
  .helmignore          config
```

Result: `helm` at 0.96 with four signals (`chart_yaml`, `values_yaml`, `templates_dir`, `config`).

Kubernetes manifests with Kustomize (manifests in the project root, because the content signals do not look into subdirectories):

```text
my-app/
  deployment.yaml      api_version, kind_field
  service.yaml
  ingress.yaml
  kustomization.yaml   kustomization (Kubernetes) and kustomization_yaml (Kustomize)
```

Result: `kubernetes` at 0.81 (`api_version`, `kind_field`, `kustomization`) and `kustomize` at 0.70 (`kustomization_yaml`).

Helm chart that is deployed with `kubectl apply -k`, with a `deploy.sh` containing `helm upgrade --install` and `kubectl apply -k`:

```text
my-app/
  Chart.yaml, values.yaml, templates/
  service.yaml, kustomization.yaml
  deploy.sh
```

Result: `helm` 1.00, `kustomize` 1.00 and `kubernetes` 0.92, all three in `results`; load the `helm` and `kubernetes` skills.

### Troubleshooting

- Nothing detected: inspect `all_results` for the closest candidate and its signals, or lower `--min-confidence`.
- False positives: raise `--min-confidence` (for example 0.8).
- Slow scans: keep dependency and build output out of the project tree; `node_modules`, `.git` and `vendor` are already skipped.

## Cloud providers

Auto-detect AWS, GCP or Azure usage by multi-signal analysis of Terraform, package manifests, config files, CLI scripts and Dockerfiles.

```bash
node skills/detect-stack/detect-stack.js --axis=cloud                          # current directory
node skills/detect-stack/detect-stack.js /path/to/project --axis=cloud
node skills/detect-stack/detect-stack.js /path/to/project --axis=cloud --provider=aws        # manual override
node skills/detect-stack/detect-stack.js /path/to/project --axis=cloud --min-confidence=0.8
```

```javascript
const { detect } = require('./skills/detect-stack/detect-stack');

const result = await detect('cloud', '/path/to/project');
if (result.detected) {
  console.log(`Detected: ${result.results[0].display_name}`);
  console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`Signals: ${result.results[0].signal_count}`);
}
const forced = await detect('cloud', '/path/to/project', { provider: 'aws' });
```

### Detection signals

| Signal | Weight | Evidence |
|--------|--------|----------|
| `terraform` | 0.5 | Any `*.tf` file declaring the provider or its resources: `provider "aws"`, `aws_vpc`; `provider "google"`, `google_compute_instance`; `provider "azurerm"`, `azurerm_storage_account` |
| `npm` | 0.3 | Root `package.json` containing `@aws-sdk/`, `aws-sdk`, `@aws-cdk/`, `aws-cdk-lib`; `@google-cloud/`, `googleapis`; `@azure/`, `azure-` |
| `python` | 0.3 | Root `requirements.txt` containing `boto3`, `botocore`, `aws-cdk-lib`; `google-cloud-`, `google-api-python-client`; `azure-`, `msrestazure` |
| `config` | 0.3 | Existence of `.aws/config`, `.aws/credentials`, `aws-cli.yml`, `cloudformation.yml`; `.gcloud/`, `gcloud-cli.yml`, `cloudbuild.yaml`, `service-account.json`; `.azure/`, `azure-pipelines.yml`, `azuredeploy.json` |
| `cli` | 0.2 | Any `*.sh` containing `aws configure`, `aws s3`, `aws ec2`, ...; `gcloud` or `gsutil` commands, ...; `az` commands, `azure-cli`, `az vm`, ... |
| `docker` | 0.2 | Any `Dockerfile*` with base images `FROM public.ecr.aws`, `FROM amazon/`; `FROM gcr.io`, `FROM us.gcr.io`, `FROM eu.gcr.io`; `FROM mcr.microsoft.com`, `FROM azurecr.io` |

Example indicators per provider: AWS `aws_s3_bucket`, `aws_lambda_function`, `@aws-sdk/client-s3`, `boto3`, `aws s3 sync`, `FROM public.ecr.aws/lambda/nodejs`; GCP `google_storage_bucket`, `@google-cloud/storage`, `google-cloud-storage`, `gcloud compute`, `gsutil cp`, `FROM gcr.io/google-appengine/nodejs`; Azure `azurerm_virtual_machine`, `@azure/storage-blob`, `azure-storage-blob`, `az vm create`, `FROM mcr.microsoft.com/azure-functions/node`. Pattern lists are in `patterns/cloud.json`.

### Confidence

```text
confidence = sum of detected signal weights / 1.8 (the sum of all six weights)
             + 0.3 when at least 3 signals are detected, capped at 1.0
```

A provider is detected at confidence 0.7 or more. The boost is each provider's `confidence_boost` (0.3); the `multi_signal_boost` value in `detection_rules` is not used.

Consequences worth knowing: one signal is never enough (Terraform alone scores 0.5 / 1.8 = 0.28, a config file or package 0.17, a script or Dockerfile 0.11), and two signals are never enough either (the boost needs three). Three well-chosen signals are, for example Terraform + `package.json` SDK + a CLI script = (0.5 + 0.3 + 0.2) / 1.8 + 0.3 = 0.86. For a project with a single signal, read `all_results[0]` (the top candidate and its signals) or pass `--min-confidence`.

`results` lists every provider at or above the threshold, so a multi-cloud project reports several; load the skill of each. `primary` is the highest.

### Using the result

```bash
DETECTION=$(node skills/detect-stack/detect-stack.js --axis=cloud .)
PROVIDER=$(echo "$DETECTION" | jq -r '.primary')

case "$PROVIDER" in
  aws)       cat skills/aws/SKILL.md ;;
  gcp|azure) echo "No dedicated skill for $PROVIDER; use cloud-agnostic patterns" ;;
  null)      echo "No cloud provider detected" ;;
esac

echo "$DETECTION" | jq -r '.results[].name'    # every provider above the threshold
```

An `infrastructure-specialist` style workflow: detect at task start, load the matching skill when the provider is detected with 70% or more confidence, load every provider's skill for multi-cloud projects, and accept a `--cloud-provider` style flag to bypass detection.

### Common issues

- Low confidence (below 0.7): the project may use several providers (compare `all_results`), have few cloud-specific files, or use infrastructure as code other than Terraform.
- False positives: raise `--min-confidence` and check which signals fired. Some patterns are short substrings (the `az` and `gcloud` command prefixes, `azure-`), so unrelated text in scripts or manifests can match.
- No detection: check the project path, that the files are not under `node_modules` or `.git`, and that `patterns/cloud.json` lists the indicators you expect.

### Best practices

1. Run detection early, at task start, so the right skill is loaded before any provider-specific work.
2. Log the confidence and signals, so detection accuracy can be reviewed afterwards.
3. Provide `--provider` for edge cases instead of guessing.
4. Handle multi-cloud projects: load a skill for every provider in `results`.
5. Cache the detection result for the session instead of re-scanning.

### Performance

Typically under 100 ms for a normal project: glob patterns with ignore lists, whole-file reads of the matched files only.

## Configuration

Detection rules live in `patterns/<axis>.json`:

| File | Contents |
|------|----------|
| `patterns/framework.json` | Frameworks with package, file and import patterns, boost factors, `detectionConfig` (threshold 0.8, at most 3 candidates) |
| `patterns/test.json` | Runners with config files, package indicators, test directories and patterns, and the four confidence weights |
| `patterns/tooling.json` | Tools with weighted signals, `confidence_boost`, `detection_rules` (threshold 0.7, boost from 3 signals) |
| `patterns/cloud.json` | Providers with weighted signals, `confidence_boost`, `detection_rules` |

To add a framework, runner, tool or provider, add an entry to the matching file. The key becomes the detector name, so use the name of the skill it should load (lowercase kebab-case). The tests in `__tests__/detect-stack.test.js` check that every detector name is an existing skill name; a name without a skill must be listed there as an exception.

Adjusting weights, thresholds or boosts changes scoring for every consumer; `__tests__/axes.test.js` and `__tests__/cloud.test.js` pin the current values and will fail until updated deliberately.

Example: adding a cloud provider. Only the six signal kinds above (`terraform`, `npm`, `python`, `cli`, `docker`, `config`) are evaluated, and a provider's confidence is measured against the signals it defines, so a provider that defines only `terraform` reaches 1.0 on one match:

```json
{
  "providers": {
    "digitalocean": {
      "name": "DigitalOcean",
      "confidence_boost": 0.3,
      "detection_signals": {
        "terraform": {
          "weight": 0.5,
          "patterns": ["provider \"digitalocean\"", "digitalocean_droplet"]
        }
      }
    }
  }
}
```

Example: adjusting detection rules. `tooling.json` and `cloud.json` read two values from `detection_rules`, `minimum_confidence` (lower is more permissive) and `minimum_signals_for_boost` (lower applies the boost earlier); the boost itself is each entry's `confidence_boost`:

```json
{
  "detection_rules": {
    "minimum_confidence": 0.6,
    "minimum_signals_for_boost": 2
  }
}
```

## Dependencies

- Node.js 18 or later.
- No npm dependency: file matching uses the bundled `glob.js`.
- Other plugins that use this skill (`ensemble-infrastructure`, `ensemble-quality`) need `ensemble-core` installed, because the detectors live here. See their READMEs.

## See Also

- [REFERENCE.md](./REFERENCE.md) - full CLI and API reference, per-axis internals, inherited limitations, migration from the four former detector skills
- [patterns/](./patterns) - detection patterns, weights and thresholds
- `skills/react`, `skills/jest`, `skills/helm`, `skills/aws` - examples of skills selected by detector names
