# Authoring a toolchain adapter

An adapter teaches the Ensemble toolchain how to run one tool (`gh`, `br`, `terraform`, and so on) for one or more tool categories. Commands, agents and skills never name the tool; they call a capability such as `tracker.show` or `host.change-request-create`, and the resolved adapter turns that into a command line. This guide covers writing, placing and validating an adapter. For what each category must provide, see the [category contracts](../toolchain/contracts/README.md). To move existing hardcoded tool references onto capabilities, see the [migration guide](toolchain-migration.md).

An adapter is data plus prose. There is no code to write: the shared runner (`packages/development/lib/toolchain/runner.js`) executes the argv templates in `adapter.yaml` directly, without a shell.

## Layout

An adapter is a skill directory with exactly two required files:

```text
adapter-<category>-<tool>/
  SKILL.md        frontmatter, prose, and a "## Vocabulary" section
  adapter.yaml    the machine-readable manifest
```

Shipped adapters are named `adapter-<category>-<tool>` (for example `adapter-host-github` or `adapter-tracker-beads`), but the directory name is not what selects an adapter: the manifest's `adapter:` id is. `SKILL.md` needs a `name` and a `description` in its frontmatter, and must contain a `## Vocabulary` heading that lists each capability the adapter implements in prose. `toolchain-cli validate` rejects an adapter without that heading.

The lint `scripts/lint-provider-refs.js` skips every `adapter-*` directory, because an adapter is the one place allowed to name its tool.

### Where adapters are found

The resolver searches three locations in this order and uses the first match:

1. Repo-local: `.ensemble/adapters/<dir>/` under the project root.
2. User: `$XDG_CONFIG_HOME/ensemble/adapters/<dir>/`. When `XDG_CONFIG_HOME` is unset the root falls back to `~/.config/ensemble/` if `~/.config` exists, otherwise `~/.ensemble/`.
3. Installed: the `skills/<dir>/` directory of every installed Ensemble package, which is where the shipped adapters live. A subdirectory of `skills/` that holds no valid manifest of its own is treated as a **group**, and its own immediate children are scanned too — one level, and no deeper. That is how the full bundle's grouped adapters resolve: `packages/full/skills/git` is a symlink into `packages/git/skills`, and `claude plugin install` dereferences it while copying only `packages/full`, so in an install those adapters sit at `skills/git/<dir>/adapter.yaml`. "No valid manifest" is wider than "no `adapter.yaml`": an absent file, YAML that will not parse, and a manifest with no string `adapter` id all make a directory a candidate group, because none of them names an adapter that directory could be. A directory carrying its own `SKILL.md` is a skill rather than a container of skills, so it is never descended into — which also keeps the scan cheap, since nearly all of the ~180 non-adapter directories under the installed roots are ordinary skills.

A repo-local adapter is committed code that runs binaries on every contributor's machine. In a non-interactive run it is only used when its id is listed under `trustedRepoAdapters` in the user-level `toolchain.yaml` (never the project one); otherwise resolution fails with `UNTRUSTED_REPO_ADAPTER`.

### Selecting an adapter

A project selects an adapter per category in `.ensemble/toolchain.yaml`, a user in `$XDG_CONFIG_HOME/ensemble/toolchain.yaml`:

```yaml
tracker: jira
host: azure-devops
```

Keys are the 14 category names, values are manifest `adapter:` ids. Categories you do not set fall back to detection signals and then to the shipped defaults in `packages/development/toolchain/toolchain.default.yaml`.

## Manifest fields

`adapter.yaml` is validated against `packages/development/toolchain/schemas/adapter-manifest-schema.json`. No other top-level keys are allowed, and all of the following are required:

| Field | Meaning |
| --- | --- |
| `adapter` | Unique adapter id, for example `github`. |
| `version` | The adapter's own version, independent of contract versions. |
| `categories` | The categories it implements. One manifest may implement several. |
| `contract` | The `major.minor` contract version targeted, keyed by category. Every entry in `categories` needs a matching key. |
| `binaries` | Binary names it runs. The first element of every argv must be one of these. |
| `allowlist` | Per-binary subcommand allowlist (see [Allowlist](#allowlist)). |
| `env` | Environment variable names it needs, for example `GH_TOKEN`. Names only, never values. May be `[]`. |
| `health` | Health checks (see [Health checks](#health-checks)). May be `[]`. |
| `detect` | Signals that auto-select the adapter. May be `[]`. |
| `capabilities` | The capabilities it implements, keyed `<category>.<capability>`. |

A minimal capability:

```yaml
capabilities:
  tracker.show:
    run: ["br", "show", "${id}", "--json"]
    parse:
      format: json
      root: "$[0]"
      map:
        id: "$.id"
        title: "$.title"
```

- `run` is an argv array. `${name}` placeholders are replaced by validated capability arguments and are never interpreted by a shell. Every placeholder must be an input declared for that capability in the category contract.
- `parse` maps the tool's output to the contract's output names. `format`, `root`, `map` and `statusMap` are the recognized keys. `map` keys must be outputs declared in the contract. Omit `parse` to return the tool's raw text.
- `variants` (optional) selects a different `run` template by the value of one input, written as `variants: {<input>: {<value>: [argv...]}}`. The selector must be a declared input of that capability, and a value outside the declared variants is rejected as `NOT_ALLOWED`.
- `successExitCodes` (optional) lists extra exit codes, besides 0, whose stdout is still parsed instead of failing with `TOOL_FAILED`.

Implement every capability the contract marks `required`. Optional capabilities may be omitted; callers then use the documented `fallback` when there is one, or get `UNAVAILABLE`.

### Detection

Each `detect` entry has a `signal` and the fields that signal needs:

| Signal | Extra field | Matches when |
| --- | --- | --- |
| `remote_url_matches` | `pattern` | The `origin` remote URL matches the regular expression. |
| `file_exists` | `path` | The file exists under the project. |
| `dir_exists` | `path` | The directory exists under the project. |
| `git_config_set` | `key` | The git config key is set. |

Detection decides only when no configuration names an adapter. If two installed adapters match, resolution fails as `AMBIGUOUS_PROVIDER` in non-interactive runs and asks in interactive runs.

## Allowlist

The allowlist is the security boundary of an adapter. The runner refuses any argv whose binary and subcommand pair is not listed.

```yaml
binaries: [gh]
allowlist:
  - bin: gh
    sub: [pr, auth, "--version"]
```

- Each entry names a `bin` that appears in `binaries` and lists the `sub` subcommands the runner may execute.
- A `sub` entry is either one word or several space-separated words, such as `boards work-item show`. Every word must equal the argv element at the same position; substring and prefix matches never count.
- The allowlist checks the binary and its subcommand words only. Flags, option values and substituted arguments are not checked here; the runner validates substituted arguments against the contract's input types before every call.
- The same check covers every `health` command and every `variants` template, so a health check cannot run something the allowlist does not grant.
- Use a literal path in `sub` to grant exactly one file argument, as `adapter-tracker-beads` does for `cat .beads/issues.jsonl`.

## Health checks

Health checks prove the tool is installed and authenticated before a command does anything with side effects.

```yaml
health:
  - id: gh-installed
    run: ["gh", "--version"]
    timeoutMs: 5000
  - id: gh-auth-status
    run: ["gh", "auth", "status"]
    timeoutMs: 10000
```

- `id`, `run` (an argv array) and `timeoutMs` (a positive integer) are all required.
- Checks run during `toolchain-cli preflight` before any side-effecting capability. The first failure stops the run with `HEALTH_FAILED`, naming the adapter and the check id.
- Keep checks cheap and read-only. A checked binary and subcommand must also be in the allowlist.

## Validate

Run the static gate against an adapter directory:

```bash
node packages/development/lib/toolchain-cli.js validate .ensemble/adapters/my-adapter
```

The command is `toolchain-cli validate <adapter-dir> [--json]`. It prints `ok` and exits 0, or prints one error per line and exits non-zero. With `--json` it prints `{ok, errors}`. It runs four checks and reports the union of their errors:

1. Manifest schema: the field rules above, plus a `## Vocabulary` heading in `SKILL.md` and variant selectors that are declared contract inputs.
2. Allowlist: every capability, variant and health `run` starts with a declared binary and an allowed subcommand.
3. Contract conformance: every `required` capability of each declared category is implemented, `${name}` placeholders match the contract's inputs, and `parse.map` keys match its outputs.
4. Credential scan: no secret-shaped literal in `adapter.yaml`, `SKILL.md` or any other file in the directory, so use `env:` names such as `GH_TOKEN` and never values.

Validation is static: it never runs the tool. After it passes, run `toolchain-cli preflight` against a real project to exercise the health checks, and `toolchain-cli explain` to confirm your adapter is the one resolved and why.
